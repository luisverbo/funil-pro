-- quiz_leads: one row per quiz session (anonymous lead)
CREATE TABLE IF NOT EXISTS quiz_leads (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id          uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress','completed','abandoned')),
  current_page_id  text,
  score            int NOT NULL DEFAULT 0,
  result_shown     text,
  name             text,
  email            text,
  phone            text
);

-- quiz_lead_events: per-block interaction events
CREATE TABLE IF NOT EXISTS quiz_lead_events (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id    uuid NOT NULL REFERENCES quiz_leads(id) ON DELETE CASCADE,
  quiz_id    uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id    text NOT NULL,
  block_id   text,
  event_type text NOT NULL
             CHECK (event_type IN ('page_viewed','choice_selected','text_entered','button_clicked','form_submitted','quiz_completed')),
  value      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quiz_leads_quiz_id     ON quiz_leads(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_leads_tenant_id   ON quiz_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quiz_leads_started_at  ON quiz_leads(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_lead_events_lead  ON quiz_lead_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_quiz_lead_events_quiz  ON quiz_lead_events(quiz_id);

-- RLS: public can INSERT (quiz runs publicly), tenant can SELECT/DELETE
ALTER TABLE quiz_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_lead_events ENABLE ROW LEVEL SECURITY;

-- Authenticated tenant members can read/delete their own quiz leads
CREATE POLICY "quiz_leads_tenant_select" ON quiz_leads
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "quiz_leads_tenant_delete" ON quiz_leads
  FOR DELETE USING (
    tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
  );

-- Public (anon) can insert (tracking from public quiz page)
CREATE POLICY "quiz_leads_public_insert" ON quiz_leads
  FOR INSERT WITH CHECK (true);

CREATE POLICY "quiz_leads_public_update" ON quiz_leads
  FOR UPDATE USING (true);

CREATE POLICY "quiz_lead_events_tenant_select" ON quiz_lead_events
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "quiz_lead_events_tenant_delete" ON quiz_lead_events
  FOR DELETE USING (
    tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "quiz_lead_events_public_insert" ON quiz_lead_events
  FOR INSERT WITH CHECK (true);
