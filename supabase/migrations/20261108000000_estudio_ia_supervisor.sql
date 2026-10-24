-- ============================================================================
-- ESTÚDIO IA — Supervisor da Ana: um 2º agente lê as conversas, dá nota,
-- aponta onde a cliente parou / mensagens erradas / o que faltou saber e
-- sugere a correção. O Luís aplica com 1 clique (vira regra/FAQ na base ou
-- texto da Ana). Só colunas/tabelas NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- Até onde cada conversa já foi revisada (não revisa a mesma coisa 2×).
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS revisado_ate timestamptz;

-- Uma revisão por conversa (cada vez que ela tem mensagens novas e parou).
CREATE TABLE IF NOT EXISTS estudio_revisoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contato_id   uuid NOT NULL REFERENCES estudio_contatos(id) ON DELETE CASCADE,
  nota         int CHECK (nota BETWEEN 0 AND 10),
  resumo       text,
  parou_em     text,              -- etapa / motivo em que a cliente parou
  venda        text,              -- vendeu | perdeu | em_andamento
  mensagens    int NOT NULL DEFAULT 0,
  custo_usd    numeric(12,6) NOT NULL DEFAULT 0,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estudio_revisoes_tenant_idx ON estudio_revisoes (tenant_id, criado_em DESC);

-- Cada problema apontado, com a correção sugerida.
CREATE TABLE IF NOT EXISTS estudio_achados (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  revisao_id   uuid NOT NULL REFERENCES estudio_revisoes(id) ON DELETE CASCADE,
  contato_id   uuid NOT NULL REFERENCES estudio_contatos(id) ON DELETE CASCADE,
  gravidade    text NOT NULL CHECK (gravidade IN ('alta', 'media', 'baixa')),
  tipo         text NOT NULL,     -- travou | robotica | errada | faltou_info | venda_perdida | fluxo
  trecho       text,              -- a mensagem da Ana (ou da cliente) em questão
  problema     text NOT NULL,
  deveria      text,              -- como deveria ter sido
  correcao     jsonb NOT NULL DEFAULT '{}',   -- {destino: regra|faq|nao_dizer|codigo, pergunta?, texto}
  status       text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'aplicado', 'ignorado')),
  aplicado_em  timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estudio_achados_tenant_idx ON estudio_achados (tenant_id, status, criado_em DESC);

ALTER TABLE estudio_revisoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_achados  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_revisoes;
DROP POLICY IF EXISTS tenant_isolation ON estudio_achados;
CREATE POLICY tenant_isolation ON estudio_revisoes USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON estudio_achados  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_revisoes FROM anon;
REVOKE ALL ON estudio_achados  FROM anon;

-- ─── De hora em hora (no minuto 17): revisa as conversas paradas ───────────
CREATE OR REPLACE FUNCTION disparar_supervisor_estudio()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_segredo text;
BEGIN
  SELECT value INTO v_segredo FROM platform_settings WHERE key = 'conteudos_cron_secret';
  PERFORM net.http_get(
    url := 'https://funil-pro.vercel.app/api/cron/estudio-supervisor',
    headers := jsonb_build_object('x-funilpro-cron', coalesce(v_segredo, '')),
    timeout_milliseconds := 300000
  );
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'estudio-supervisor';
SELECT cron.schedule('estudio-supervisor', '17 * * * *', $$SELECT disparar_supervisor_estudio()$$);
