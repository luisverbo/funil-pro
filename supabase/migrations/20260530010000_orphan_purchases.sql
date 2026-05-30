CREATE TABLE IF NOT EXISTS orphan_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  platform text NOT NULL,
  buyer_email text,
  buyer_phone text,
  buyer_name text,
  product_name text,
  revenue_cents int,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orphan_purchases_tenant_id_idx ON orphan_purchases(tenant_id);
CREATE INDEX IF NOT EXISTS orphan_purchases_buyer_email_idx ON orphan_purchases(buyer_email);
