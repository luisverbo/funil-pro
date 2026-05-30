-- Admin panel migration
ALTER TABLE users_tenants ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member'));

CREATE TABLE IF NOT EXISTS platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text,
  updated_at timestamptz DEFAULT now()
);

-- No RLS — admin-only access via service role

INSERT INTO platform_settings (key, value) VALUES
  ('meta_app_id', null),
  ('meta_app_secret', null),
  ('evolution_api_url', null),
  ('evolution_api_key', null),
  ('resend_api_key', null),
  ('resend_domain', null)
ON CONFLICT (key) DO NOTHING;
