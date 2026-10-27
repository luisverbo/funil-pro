-- ============================================================================
-- VÁRIAS CONTAS DO INSTAGRAM POR TENANT ("Conectar Instagram")
-- ----------------------------------------------------------------------------
-- Até aqui havia UM token da plataforma (platform_settings.ig_access_token).
-- Agora cada tenant conecta as próprias contas pelo login do Instagram; o
-- token de 60 dias de cada uma fica aqui e o cron renova a cada 24h.
-- O token da plataforma continua valendo para quem não escolher conta
-- (nada do que já funciona muda).
--
-- O token NUNCA é lido pela chave pública: RLS ligado e nenhuma política —
-- só a service role (servidor) entra, igual a platform_settings.
-- ============================================================================
CREATE TABLE IF NOT EXISTS instagram_contas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ig_user_id      text NOT NULL,
  username        text,
  nome            text,
  foto_url        text,
  token           text NOT NULL,
  token_expira_em timestamptz,
  renovado_em     timestamptz,
  status          text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'erro')),
  erro            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ig_user_id)
);
CREATE INDEX IF NOT EXISTS idx_instagram_contas_ig_user ON instagram_contas (ig_user_id);

ALTER TABLE instagram_contas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON instagram_contas FROM anon, authenticated;

-- Conta escolhida para cada conteúdo (null = token da plataforma, como antes).
ALTER TABLE conteudos_instagram
  ADD COLUMN IF NOT EXISTS instagram_conta_id uuid REFERENCES instagram_contas(id) ON DELETE SET NULL;

-- ID do app (Instagram App ID) para o login — colado em /admin/settings.
INSERT INTO platform_settings (key, value) VALUES ('ig_app_id', null)
ON CONFLICT (key) DO NOTHING;
