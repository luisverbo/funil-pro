-- Interactive quiz support

-- Update page_type constraint
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_page_type_check;
ALTER TABLE pages ADD CONSTRAINT pages_page_type_check
  CHECK (page_type IN ('capture','vsl','delivery','thankyou','form','sales','interactive'));

-- Questions table
CREATE TABLE IF NOT EXISTS interactive_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  question_type text NOT NULL DEFAULT 'single_choice' CHECK (question_type IN (
    'single_choice','multi_choice','text_short','text_long',
    'scale','email','phone','final_capture','result'
  )),
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

ALTER TABLE interactive_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iq_tenant" ON interactive_questions
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
  );

-- Responses table
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

CREATE POLICY "ir_tenant" ON interactive_responses
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
  );

-- Index for analytics
CREATE INDEX IF NOT EXISTS idx_iq_page_id ON interactive_questions(page_id);
CREATE INDEX IF NOT EXISTS idx_ir_page_id ON interactive_responses(page_id);
CREATE INDEX IF NOT EXISTS idx_ir_lead_id ON interactive_responses(lead_id);
