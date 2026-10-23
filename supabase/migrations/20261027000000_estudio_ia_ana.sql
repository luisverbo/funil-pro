-- ============================================================================
-- ESTÚDIO IA — Fase 3: a Ana (roteiro da seção 5), idiomas, cobranças e push
-- ----------------------------------------------------------------------------
-- Só tabelas/colunas NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- ─── Textos e áudios por idioma (sem linha → a Ana usa o texto padrão do código)
CREATE TABLE IF NOT EXISTS estudio_textos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave      text NOT NULL,            -- boas_vindas, menu, a1…a6, cobranca_1…
  idioma     text NOT NULL,            -- pt-BR | pt-PT | es | en
  texto      text,                     -- vazio = usa o padrão
  audio_path text,                     -- estudio-catalogo/midias/<idioma>/<chave>.ogg
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, chave, idioma)
);
ALTER TABLE estudio_textos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_textos;
CREATE POLICY tenant_isolation ON estudio_textos USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_textos FROM anon;

-- ─── Preço por país/moeda (Brasil = BRL + Pix; fora = Hotmart na Fase 7)
CREATE TABLE IF NOT EXISTS estudio_precos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pais            text NOT NULL,        -- BR, PT, ES, US… ('*' = demais países)
  moeda           text NOT NULL,        -- BRL, EUR, USD
  pacote_qtd      int  NOT NULL,
  valor_cents     int  NOT NULL,
  link_pagamento  text,                 -- Hotmart (Fase 7)
  UNIQUE (tenant_id, pais, pacote_qtd)
);
ALTER TABLE estudio_precos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_precos;
CREATE POLICY tenant_isolation ON estudio_precos USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_precos FROM anon;

-- Preços do Brasil (seção 6) para quem já tem o estúdio conectado.
INSERT INTO estudio_precos (tenant_id, pais, moeda, pacote_qtd, valor_cents)
SELECT c.tenant_id, 'BR', 'BRL', v.qtd, v.cents
FROM estudio_config c
CROSS JOIN (VALUES (2, 1890), (3, 2990), (5, 4990), (10, 6990), (15, 9890)) AS v(qtd, cents)
ON CONFLICT (tenant_id, pais, pacote_qtd) DO NOTHING;

-- ─── Estado da conversa com a Ana ───────────────────────────────────────────
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS dados             jsonb NOT NULL DEFAULT '{}';  -- tema, pacote, poses, idade…
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS pedido_atual_id   uuid REFERENCES estudio_pedidos(id) ON DELETE SET NULL;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS idioma_fixo       boolean NOT NULL DEFAULT false; -- cliente escolheu o idioma
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ultima_cliente_em timestamptz;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ultima_ana_em     timestamptz;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS cobrancas         int NOT NULL DEFAULT 0;      -- desde a última resposta
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS nao_entendeu      int NOT NULL DEFAULT 0;      -- 2 seguidas → humano

-- ─── Pedido: idioma/país/moeda e tipo (pacote | previa) ─────────────────────
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS idioma text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS pais   text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS moeda  text NOT NULL DEFAULT 'BRL';
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS tipo   text NOT NULL DEFAULT 'pacote';
DO $$ BEGIN
  ALTER TABLE estudio_pedidos ADD CONSTRAINT estudio_pedidos_tipo_ck CHECK (tipo IN ('pacote', 'previa'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'aguardando_conferencia' (Pix por comprovante, Fase 4) entra já no CHECK.
ALTER TABLE estudio_pedidos DROP CONSTRAINT IF EXISTS estudio_pedidos_status_check;
ALTER TABLE estudio_pedidos ADD CONSTRAINT estudio_pedidos_status_check CHECK (status IN (
  'novo', 'aguardando_pagamento', 'aguardando_conferencia', 'pago', 'aguardando_fotos',
  'aguardando_producao', 'gerando', 'pronto', 'aguardando_aprovacao',
  'entregue', 'ajuste', 'finalizado', 'cancelado'));

-- ─── Web Push (app fechado) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_push (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  aparelho   text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE estudio_push ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON estudio_push FROM anon, authenticated;

-- Chaves VAPID geradas pelo servidor na 1ª vez (privada nunca sai do servidor).
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS vapid_publica text;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS vapid_privada text;
REVOKE ALL ON estudio_config FROM anon, authenticated;

-- ─── Cobranças: o próprio banco chama a rota a cada 5 min ───────────────────
-- Mesmo segredo e mesmo padrão do agendador dos Conteúdos (pg_cron + pg_net).
CREATE OR REPLACE FUNCTION disparar_cobrancas_estudio()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_segredo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM estudio_contatos
    WHERE modo = 'ana' AND cobrancas < 3 AND janela_ate > now()
      AND ultima_ana_em IS NOT NULL AND ultima_ana_em < now() - interval '10 minutes'
      AND (ultima_cliente_em IS NULL OR ultima_cliente_em < ultima_ana_em)
  ) THEN RETURN; END IF;
  SELECT value INTO v_segredo FROM platform_settings WHERE key = 'conteudos_cron_secret';
  PERFORM net.http_get(
    url := 'https://funil-pro.vercel.app/api/cron/estudio-cobrancas',
    headers := jsonb_build_object('x-funilpro-cron', coalesce(v_segredo, '')),
    timeout_milliseconds := 60000
  );
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'estudio-cobrancas';
SELECT cron.schedule('estudio-cobrancas', '*/5 * * * *', $$SELECT disparar_cobrancas_estudio()$$);
