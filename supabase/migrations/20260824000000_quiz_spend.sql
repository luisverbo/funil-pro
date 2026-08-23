-- ============================================================================
-- INVESTIMENTO MANUAL POR FUNIL — enquanto a Meta não conecta
-- ----------------------------------------------------------------------------
-- O dono lança "gastei R$ 300 no dia X" para cada quiz. O portal do cliente
-- usa isso para mostrar custo por lead e custo por lead quente. Uma linha por
-- dia por funil (UNIQUE): lançar de novo no mesmo dia CORRIGE, não soma —
-- somar em silêncio duplicaria gasto a cada clique repetido.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quiz_spend_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id      uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  date         date NOT NULL,
  amount_cents int  NOT NULL CHECK (amount_cents > 0),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, page_id, date)
);

CREATE INDEX IF NOT EXISTS idx_quiz_spend_page ON quiz_spend_entries(page_id, date DESC);

ALTER TABLE quiz_spend_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_spend_entries_tenant_isolation ON quiz_spend_entries;
CREATE POLICY quiz_spend_entries_tenant_isolation ON quiz_spend_entries
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
