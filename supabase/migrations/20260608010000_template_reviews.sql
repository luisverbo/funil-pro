-- template_reviews: avaliações de templates por tenant
CREATE TABLE IF NOT EXISTS template_reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid REFERENCES funnel_templates(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  rating int CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE template_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON template_reviews
  USING (tenant_id = (
    SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid() LIMIT 1
  ));

-- Um review por tenant por template
CREATE UNIQUE INDEX IF NOT EXISTS template_reviews_unique_per_tenant
  ON template_reviews(template_id, tenant_id);
