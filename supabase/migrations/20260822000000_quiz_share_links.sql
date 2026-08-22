-- ============================================================================
-- Painel compartilhado de leads do quiz — link com senha
-- ----------------------------------------------------------------------------
-- Caso de uso: quem capta lead para clientes manda /ql/<token> + senha, e o
-- cliente abre o painel DAQUELE quiz e baixa os leads, sem conta no sistema.
--
-- Uma linha por quiz (UNIQUE page_id): renovar o link substitui o anterior —
-- o link velho morre junto com a senha velha, de propósito.
--
-- password_hash guarda scrypt(salt, senha), NUNCA a senha em claro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quiz_share_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id        uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  token          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  access_count   int NOT NULL DEFAULT 0,
  last_access_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_share_token ON quiz_share_links(token);
CREATE INDEX IF NOT EXISTS idx_quiz_share_tenant ON quiz_share_links(tenant_id);

ALTER TABLE quiz_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_share_links_tenant_isolation ON quiz_share_links;
CREATE POLICY quiz_share_links_tenant_isolation ON quiz_share_links
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));

-- Contador de acesso incrementado pela rota pública (service role), atômico.
CREATE OR REPLACE FUNCTION increment_share_access(p_token text)
RETURNS void AS $$
  UPDATE quiz_share_links
  SET access_count = access_count + 1, last_access_at = now()
  WHERE token = p_token;
$$ LANGUAGE sql SECURITY DEFINER;
