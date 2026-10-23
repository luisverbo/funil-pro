-- ============================================================================
-- ESTÚDIO IA — Fase 5: fila de produção, aviso, ENTREGA AUTOMÁTICA, ajuste
-- grátis, prazo e chave "Motor de produção" (seções 8 e 8b).
-- Só colunas NOVAS — nada da seção 4 muda de nome (contrato com producao.py:
-- status aguardando_producao → gerando → pronto, estudio_entregas 'aprovada',
-- estudio-entregas/<pedido>/<numero>.png continuam iguais).
-- ============================================================================

-- ─── Configurações da produção ──────────────────────────────────────────────
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS motor              text NOT NULL DEFAULT 'chatgpt_site';
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS aprovacao_manual   boolean NOT NULL DEFAULT false;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS gemini_api_key     text;      -- só service role
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS prazo_min          int NOT NULL DEFAULT 60;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS ajustes_gratis     int NOT NULL DEFAULT 1;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS upsell_qtd         int NOT NULL DEFAULT 5;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS upsell_desconto_pct int NOT NULL DEFAULT 20;
DO $$ BEGIN
  ALTER TABLE estudio_config ADD CONSTRAINT estudio_config_motor_ck CHECK (motor IN ('chatgpt_site', 'api_gemini'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE ALL ON estudio_config FROM anon, authenticated;

-- ─── Pedido na fila ─────────────────────────────────────────────────────────
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS fila_em             timestamptz;  -- entrou em aguardando_producao
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS atraso_avisado_em   timestamptz;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS entrega_iniciada_em timestamptz;  -- trava contra entrega dupla
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS entrega_erro        text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS api_iniciada_em     timestamptz;  -- trava da geração por API
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS api_erro            text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS ajuste_em           timestamptz;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS ajuste_poses        text[] NOT NULL DEFAULT '{}';
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS upsell_de           uuid REFERENCES estudio_pedidos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS estudio_pedidos_status_idx ON estudio_pedidos (status, fila_em);

-- ─── Fotos entregues ────────────────────────────────────────────────────────
ALTER TABLE estudio_entregas ADD COLUMN IF NOT EXISTS motor      text;          -- chatgpt_site | api_gemini
ALTER TABLE estudio_entregas ADD COLUMN IF NOT EXISTS envio_path text;          -- JPEG enviado (com marca d'água na prévia)
ALTER TABLE estudio_entregas ADD COLUMN IF NOT EXISTS enviada_em timestamptz;

-- ─── Robô da produção: o banco chama a rota a cada minuto, só se houver trabalho
CREATE OR REPLACE FUNCTION disparar_producao_estudio()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_segredo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM estudio_pedidos p
    WHERE (p.status = 'pronto' AND p.entrega_iniciada_em IS NULL)
       OR (p.status IN ('aguardando_producao', 'ajuste') AND p.motor = 'api_gemini'
           AND (p.api_iniciada_em IS NULL OR p.api_iniciada_em < now() - interval '6 minutes'))
       OR (p.status IN ('aguardando_producao', 'gerando') AND p.atraso_avisado_em IS NULL
           AND coalesce(p.fila_em, p.pago_em) < now() - interval '60 minutes')
  ) THEN RETURN; END IF;
  SELECT value INTO v_segredo FROM platform_settings WHERE key = 'conteudos_cron_secret';
  PERFORM net.http_get(
    url := 'https://funil-pro.vercel.app/api/cron/estudio-producao',
    headers := jsonb_build_object('x-funilpro-cron', coalesce(v_segredo, '')),
    timeout_milliseconds := 300000
  );
END;
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'estudio-producao';
SELECT cron.schedule('estudio-producao', '* * * * *', $$SELECT disparar_producao_estudio()$$);
