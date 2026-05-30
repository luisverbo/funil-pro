ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_pixel_id text;

CREATE TABLE IF NOT EXISTS ad_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  campaign_id text,
  adset_id text,
  ad_name text,
  campaign_name text,
  spend_cents int NOT NULL DEFAULT 0,
  impressions int NOT NULL DEFAULT 0,
  clicks int NOT NULL DEFAULT 0,
  leads_count int NOT NULL DEFAULT 0,
  revenue_cents int NOT NULL DEFAULT 0,
  cpl_cents int NOT NULL DEFAULT 0,
  roas float NOT NULL DEFAULT 0,
  date date NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_metrics_tenant_ad_date ON ad_metrics(tenant_id, ad_id, date);
ALTER TABLE ad_metrics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ad_metrics' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY "tenant_isolation" ON ad_metrics FOR ALL USING (
      tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid())
    );
  END IF;
END
$$;
