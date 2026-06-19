-- current_tenant_id() helper (create if not exists)
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS ai_agents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  name text NOT NULL,
  status text DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
  mode text DEFAULT 'standalone' CHECK (mode IN ('standalone','funnel_block')),
  objective text DEFAULT 'qualify' CHECK (objective IN ('qualify','route_to_funnel','sell_direct')),
  product_name text,
  product_description text,
  product_price_cents int,
  tone_of_voice text DEFAULT 'amigável e consultivo',
  greeting_message text,
  qualification_rules text,
  objection_handling text,
  payment_link text,
  target_funnel_id uuid REFERENCES funnels(id),
  max_messages_per_conversation int DEFAULT 20,
  handoff_to_human_keywords text[] DEFAULT ARRAY['falar com humano','atendente','pessoa real'],
  business_hours_only boolean DEFAULT false,
  business_hours_start time DEFAULT '09:00',
  business_hours_end time DEFAULT '18:00',
  whatsapp_instance_id uuid REFERENCES whatsapp_instances(id),
  max_activations_per_month int DEFAULT 500,
  activations_used int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_agents
  USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON ai_agents FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON ai_agents FOR UPDATE
  USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON ai_agents FOR DELETE
  USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS agent_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id),
  file_name text,
  file_url text,
  extracted_text text,
  uploaded_at timestamptz DEFAULT now()
);
ALTER TABLE agent_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_documents USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON agent_documents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS agent_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES ai_agents(id),
  lead_id uuid REFERENCES leads(id),
  tenant_id uuid REFERENCES tenants(id),
  status text DEFAULT 'active' CHECK (status IN ('active','qualified','disqualified','sold','routed_to_funnel','handed_to_human','abandoned')),
  message_count int DEFAULT 0,
  outcome_summary text,
  qualification_score int,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_conversations USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON agent_conversations FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON agent_conversations FOR UPDATE USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES agent_conversations(id),
  tenant_id uuid REFERENCES tenants(id),
  role text CHECK (role IN ('lead','agent')),
  content text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_messages USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON agent_messages FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_ai_agents_tenant ON ai_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_agent ON agent_conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id);
