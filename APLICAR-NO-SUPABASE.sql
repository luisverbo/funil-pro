-- ═══════════════════════════════════════════════════════════════════════════
-- FunilPro — Script único e idempotente (pode rodar sem medo, mesmo repetido)
-- Cole TUDO no Supabase Studio → SQL Editor → New query → Run
-- Projeto: hcadyqktfowfkxsbogmj (FunilPro)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) QUIZ v1 (interactive_questions / interactive_responses) + page_type
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_page_type_check;
ALTER TABLE pages ADD CONSTRAINT pages_page_type_check
  CHECK (page_type IN ('capture','vsl','delivery','thankyou','form','sales','interactive'));

CREATE TABLE IF NOT EXISTS interactive_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  question_type text NOT NULL DEFAULT 'single_choice',
  question_text text NOT NULL DEFAULT '',
  subtitle text,
  options jsonb NOT NULL DEFAULT '[]',
  required boolean NOT NULL DEFAULT true,
  next_question_id uuid,
  config jsonb NOT NULL DEFAULT '{}',
  pos_x float NOT NULL DEFAULT 0,
  pos_y float NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE interactive_questions DROP CONSTRAINT IF EXISTS interactive_questions_question_type_check;
ALTER TABLE interactive_questions ADD CONSTRAINT interactive_questions_question_type_check
  CHECK (question_type IN ('single_choice','multi_choice','text_short','text_long','scale','email','phone','final_capture','result','calc'));
ALTER TABLE interactive_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iq_tenant" ON interactive_questions;
CREATE POLICY "iq_tenant" ON interactive_questions FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS interactive_responses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}',
  result_profile text,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE interactive_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ir_tenant" ON interactive_responses;
CREATE POLICY "ir_tenant" ON interactive_responses FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_iq_page_id ON interactive_questions(page_id);
CREATE INDEX IF NOT EXISTS idx_ir_page_id ON interactive_responses(page_id);
CREATE INDEX IF NOT EXISTS idx_ir_lead_id ON interactive_responses(lead_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) QUIZ v2 — coluna quiz_data
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pages ADD COLUMN IF NOT EXISTS quiz_data jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) QUIZ LEADS + eventos (rastreamento público do quiz)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
  current_page_id text,
  score int NOT NULL DEFAULT 0,
  result_shown text,
  name text, email text, phone text
);
CREATE TABLE IF NOT EXISTS quiz_lead_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES quiz_leads(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  block_id text,
  event_type text NOT NULL CHECK (event_type IN ('page_viewed','choice_selected','text_entered','button_clicked','form_submitted','quiz_completed')),
  value jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_leads_quiz_id ON quiz_leads(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_leads_tenant_id ON quiz_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quiz_leads_started_at ON quiz_leads(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_lead_events_lead ON quiz_lead_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_quiz_lead_events_quiz ON quiz_lead_events(quiz_id);
ALTER TABLE quiz_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_lead_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quiz_leads_tenant_select" ON quiz_leads;
CREATE POLICY "quiz_leads_tenant_select" ON quiz_leads FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "quiz_leads_tenant_delete" ON quiz_leads;
CREATE POLICY "quiz_leads_tenant_delete" ON quiz_leads FOR DELETE USING (
  tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "quiz_leads_public_insert" ON quiz_leads;
CREATE POLICY "quiz_leads_public_insert" ON quiz_leads FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "quiz_leads_public_update" ON quiz_leads;
CREATE POLICY "quiz_leads_public_update" ON quiz_leads FOR UPDATE USING (true);
DROP POLICY IF EXISTS "quiz_lead_events_tenant_select" ON quiz_lead_events;
CREATE POLICY "quiz_lead_events_tenant_select" ON quiz_lead_events FOR SELECT USING (
  tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "quiz_lead_events_tenant_delete" ON quiz_lead_events;
CREATE POLICY "quiz_lead_events_tenant_delete" ON quiz_lead_events FOR DELETE USING (
  tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "quiz_lead_events_public_insert" ON quiz_lead_events;
CREATE POLICY "quiz_lead_events_public_insert" ON quiz_lead_events FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) QUIZ WEBHOOK LOGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_webhook_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES quiz_leads(id) ON DELETE SET NULL,
  block_id text NOT NULL,
  url text NOT NULL,
  status_code int,
  success boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_webhook_logs_quiz ON quiz_webhook_logs(quiz_id);
ALTER TABLE quiz_webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_logs_tenant_select" ON quiz_webhook_logs;
CREATE POLICY "webhook_logs_tenant_select" ON quiz_webhook_logs FOR SELECT USING (
  quiz_id IN (SELECT id FROM pages WHERE tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())));
DROP POLICY IF EXISTS "webhook_logs_public_insert" ON quiz_webhook_logs;
CREATE POLICY "webhook_logs_public_insert" ON quiz_webhook_logs FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) AGENTES IA (4 tabelas + RLS)
-- ─────────────────────────────────────────────────────────────────────────────
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
  product_name text, product_description text, product_price_cents int,
  tone_of_voice text DEFAULT 'amigável e consultivo',
  greeting_message text, qualification_rules text, objection_handling text, payment_link text,
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
DROP POLICY IF EXISTS tenant_isolation ON ai_agents;
CREATE POLICY tenant_isolation ON ai_agents USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON ai_agents;
CREATE POLICY tenant_isolation_insert ON ai_agents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_update ON ai_agents;
CREATE POLICY tenant_isolation_update ON ai_agents FOR UPDATE USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_delete ON ai_agents;
CREATE POLICY tenant_isolation_delete ON ai_agents FOR DELETE USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS agent_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id),
  file_name text, file_url text, extracted_text text,
  uploaded_at timestamptz DEFAULT now()
);
ALTER TABLE agent_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_documents;
CREATE POLICY tenant_isolation ON agent_documents USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON agent_documents;
CREATE POLICY tenant_isolation_insert ON agent_documents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS agent_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES ai_agents(id),
  lead_id uuid REFERENCES leads(id),
  tenant_id uuid REFERENCES tenants(id),
  status text DEFAULT 'active' CHECK (status IN ('active','qualified','disqualified','sold','routed_to_funnel','handed_to_human','abandoned')),
  message_count int DEFAULT 0,
  outcome_summary text, qualification_score int,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_conversations;
CREATE POLICY tenant_isolation ON agent_conversations USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON agent_conversations;
CREATE POLICY tenant_isolation_insert ON agent_conversations FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_update ON agent_conversations;
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
DROP POLICY IF EXISTS tenant_isolation ON agent_messages;
CREATE POLICY tenant_isolation ON agent_messages USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON agent_messages;
CREATE POLICY tenant_isolation_insert ON agent_messages FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_ai_agents_tenant ON ai_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_agent ON agent_conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) CORREÇÕES DO AGENTE (idempotência, ativações atômicas, reset mensal) + bucket
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_key_id text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_processed_wa_messages_created ON processed_wa_messages (created_at);
ALTER TABLE processed_wa_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_agent_activations(p_agent_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE ai_agents SET activations_used = COALESCE(activations_used, 0) + 1 WHERE id = p_agent_id;
$$;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY agent_id, lead_id ORDER BY started_at DESC) AS rn
  FROM agent_conversations WHERE status = 'active' AND lead_id IS NOT NULL
)
UPDATE agent_conversations SET status = 'abandoned', ended_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_conversation_per_lead
  ON agent_conversations (agent_id, lead_id) WHERE status = 'active' AND lead_id IS NOT NULL;

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS activations_reset_at date DEFAULT current_date;

-- Bucket de imagens do quiz
INSERT INTO storage.buckets (id, name, public)
VALUES ('quiz-assets', 'quiz-assets', true)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "quiz assets upload" ON storage.objects;
CREATE POLICY "quiz assets upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'quiz-assets');
DROP POLICY IF EXISTS "quiz assets update own" ON storage.objects;
CREATE POLICY "quiz assets update own" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'quiz-assets');
DROP POLICY IF EXISTS "quiz assets delete own" ON storage.objects;
CREATE POLICY "quiz assets delete own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'quiz-assets');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) ATIVAR PLANO SCALE para o dono (luisverbo@gmail.com) — necessário p/ Agentes IA
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE tenants SET plan = 'scale'
WHERE id IN (
  SELECT ut.tenant_id FROM users_tenants ut
  JOIN auth.users u ON u.id = ut.user_id
  WHERE u.email = 'luisverbo@gmail.com'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) VERIFICAÇÃO — deve retornar tudo preenchido / plan='scale'
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
     AND table_name IN ('interactive_questions','interactive_responses','quiz_leads','quiz_lead_events','quiz_webhook_logs','ai_agents','agent_documents','agent_conversations','agent_messages','processed_wa_messages')) AS tabelas_de_10,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='ai_agents' AND column_name IN ('activations_reset_at','whatsapp_instance_id','mode')) AS ai_agents_cols_de_3,
  (SELECT count(*) FROM pg_proc WHERE proname='increment_agent_activations') AS func_increment,
  (SELECT count(*) FROM storage.buckets WHERE id='quiz-assets') AS bucket_quiz,
  (SELECT string_agg(name || '=' || plan, ', ') FROM tenants) AS tenants_planos;
