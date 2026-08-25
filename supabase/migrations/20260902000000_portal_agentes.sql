-- ============================================================================
-- PORTAL DO CLIENTE: agentes IA como fonte de leads
-- ----------------------------------------------------------------------------
-- O mesmo portal (link + senha) que entrega leads de quiz passa a entregar as
-- conversas do agente (WhatsApp, web e Instagram caem todas em
-- agent_conversations — o portal não precisa de três fontes).
--
-- Duas tabelas novas, espelhando o desenho do quiz:
--   • client_portal_agents  — QUAIS agentes entram no portal e O QUE o
--     cliente vê de cada um (público, transcrição, data de corte)
--   • portal_agent_status   — o desfecho que o CLIENTE marca por conversa
--     (kanban) + o vendedor responsável. Tabela própria porque
--     portal_lead_status referencia quiz_leads — chave de outra fonte.
--
-- "Quente" aqui não é coluna: é derivado do STATUS da conversa contra o
-- OBJETIVO do agente (agendou/vendeu/qualificou) — regra no código, testada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_portal_agents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id        uuid NOT NULL REFERENCES client_portals(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  -- 'quentes' = só quem atingiu o objetivo do agente (padrão do lead quente).
  publico          text NOT NULL DEFAULT 'quentes'
                   CHECK (publico IN ('quentes', 'agendados', 'com_contato', 'todos')),
  -- Transcrição completa é sensível (lead que xinga, agente que escorrega):
  -- desligada por padrão; o cliente vê o resumo e os dados.
  mostrar_conversa boolean NOT NULL DEFAULT false,
  -- 'YYYY-MM-DD' — o cliente só vê conversas a partir deste dia.
  desde            date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_agents_portal ON client_portal_agents(portal_id);

CREATE TABLE IF NOT EXISTS portal_agent_status (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id          uuid NOT NULL REFERENCES client_portals(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  -- MESMA lista fechada do quiz: o vocabulário/kanban do portal é um só.
  status             text NOT NULL DEFAULT 'novo'
                     CHECK (status IN ('novo', 'contactado', 'agendado', 'fechado', 'perdido')),
  assigned_member_id uuid REFERENCES portal_members(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_agent_status_portal ON portal_agent_status(portal_id);

-- RLS: dono só enxerga o próprio tenant; a rota pública usa service role e
-- valida token+senha por conta própria (mesmo desenho das tabelas irmãs).
ALTER TABLE client_portal_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_agent_status  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_portal_agents','portal_agent_status']
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
