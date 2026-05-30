CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform text NOT NULL, -- hotmart | kiwify | eduzz | yampi
  product_id_external text NOT NULL,
  name text NOT NULL,
  price_cents int NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT 'main', -- main | order_bump | upsell
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_platform_ext_idx ON products(tenant_id, platform, product_id_external);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON products FOR ALL USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
