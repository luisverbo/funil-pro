-- ============================================================================
-- MERCOS: venda no ERP fecha o lead no portal, com o VALOR da venda
-- ----------------------------------------------------------------------------
-- O cliente do dono usa o Mercos. Quando ele fatura um pedido lá, o webhook
-- avisa aqui e o lead correspondente é movido para "Fechado" no kanban do
-- portal — com o valor — fechando o ciclo custo por venda / faturamento.
--
--   • sale_value_cents nas duas tabelas de desfecho (quiz e agente)
--   • mercos_clientes: o payload de PEDIDO do Mercos traz só cliente_id;
--     quem traz nome/e-mail/telefone é o evento de CLIENTE. Guardamos o
--     cadastro para resolver o contato quando o pedido chegar.
--   • mercos_events: todo evento recebido fica gravado com o resultado do
--     casamento — auditável quando "a venda não apareceu".
-- ============================================================================

ALTER TABLE portal_lead_status  ADD COLUMN IF NOT EXISTS sale_value_cents int;
ALTER TABLE portal_agent_status ADD COLUMN IF NOT EXISTS sale_value_cents int;

CREATE TABLE IF NOT EXISTS mercos_clientes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id text NOT NULL,
  nome       text,
  email      text,
  telefone   text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cliente_id)
);

CREATE TABLE IF NOT EXISTS mercos_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evento     text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- casado | sem_correspondencia | cliente_salvo | ignorado
  resultado  text,
  detalhe    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mercos_events_tenant ON mercos_events(tenant_id, created_at DESC);

ALTER TABLE mercos_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mercos_events   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mercos_clientes','mercos_events']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I_tenant_isolation ON %1$I;
      CREATE POLICY %1$I_tenant_isolation ON %1$I
        FOR ALL
        USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
    $f$, t);
  END LOOP;
END $$;
