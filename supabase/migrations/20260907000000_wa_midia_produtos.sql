-- ============================================================================
-- MULTIATENDIMENTO: mídia nas mensagens + catálogo de produtos com fotos
-- ----------------------------------------------------------------------------
--   • wa_messages.media_url: imagem/vídeo/áudio/documento enviados pelo inbox
--     (hospedados no Storage; a Cloud API busca pelo link público)
--   • wa_produtos: o catálogo da equipe — o cliente pede as fotos e o
--     atendente envia com UM clique. Visibilidade por departamento:
--     departamento_id NULL = todos veem; preenchido = só quem vende aquilo.
-- ============================================================================

ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS media_url text;

CREATE TABLE IF NOT EXISTS wa_produtos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  preco_cents     int,
  descricao       text,
  -- NULL = liberado para toda a equipe; senão, só o departamento que vende.
  departamento_id uuid REFERENCES wa_departamentos(id) ON DELETE SET NULL,
  -- [{ url, tipo: 'imagem'|'video', caption }]
  midias          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_produtos_tenant ON wa_produtos(tenant_id);

ALTER TABLE wa_produtos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_produtos_tenant_isolation ON wa_produtos;
CREATE POLICY wa_produtos_tenant_isolation ON wa_produtos
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
