CREATE TABLE IF NOT EXISTS quiz_webhook_logs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quiz_id     uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  lead_id     uuid REFERENCES quiz_leads(id) ON DELETE SET NULL,
  block_id    text NOT NULL,
  url         text NOT NULL,
  status_code int,
  success     boolean NOT NULL DEFAULT false,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_webhook_logs_quiz ON quiz_webhook_logs(quiz_id);
ALTER TABLE quiz_webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook_logs_tenant_select" ON quiz_webhook_logs
  FOR SELECT USING (
    quiz_id IN (SELECT id FROM pages WHERE tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
  );
CREATE POLICY "webhook_logs_public_insert" ON quiz_webhook_logs
  FOR INSERT WITH CHECK (true);
