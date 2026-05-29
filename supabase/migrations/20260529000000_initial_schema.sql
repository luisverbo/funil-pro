-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TENANTS
-- ============================================================
CREATE TABLE tenants (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                text NOT NULL,
  slug                text UNIQUE NOT NULL,
  custom_domain       text,
  plan                text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'scale')),
  plan_expires_at     timestamptz,
  meta_access_token   text,
  meta_ad_account_id  text,
  resend_api_key      text,
  email_quota_used    int NOT NULL DEFAULT 0,
  email_quota_limit   int NOT NULL DEFAULT 1000,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS <-> TENANTS junction
-- ============================================================
CREATE TABLE users_tenants (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

-- ============================================================
-- TENANT ADDONS
-- ============================================================
CREATE TABLE tenant_addons (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  addon_type  text NOT NULL CHECK (addon_type IN ('whatsapp_instance', 'form', 'pages')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  price_cents int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- WHATSAPP INSTANCES
-- ============================================================
CREATE TABLE whatsapp_instances (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name   text NOT NULL,
  phone_number    text,
  status          text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'connecting')),
  is_addon        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNNELS
-- ============================================================
CREATE TABLE funnels (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  description             text,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused')),
  whatsapp_instance_id    uuid REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  agent_enabled           boolean NOT NULL DEFAULT false,
  agent_prompt            text,
  utm_source              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  published_at            timestamptz
);

-- ============================================================
-- FUNNEL BLOCKS
-- ============================================================
CREATE TABLE funnel_blocks (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id   uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  block_type  text NOT NULL CHECK (block_type IN ('message', 'condition', 'delay', 'tag', 'sale', 'form', 'page')),
  label       text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}',
  position_x  float NOT NULL DEFAULT 0,
  position_y  float NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNNEL EDGES
-- ============================================================
CREATE TABLE funnel_edges (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id        uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  source_block_id  uuid NOT NULL REFERENCES funnel_blocks(id) ON DELETE CASCADE,
  target_block_id  uuid NOT NULL REFERENCES funnel_blocks(id) ON DELETE CASCADE,
  condition        text NOT NULL DEFAULT 'default' CHECK (condition IN ('opened','not_opened','clicked','not_clicked','replied','purchased','default')),
  condition_value  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNNEL TEMPLATES
-- ============================================================
CREATE TABLE funnel_templates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  category        text,
  funnel_json     jsonb NOT NULL DEFAULT '{}',
  is_public       boolean NOT NULL DEFAULT false,
  price_cents     int NOT NULL DEFAULT 0,
  downloads_count int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE leads (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  funnel_id               uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  name                    text,
  phone                   text,
  email                   text,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'unsubscribed', 'lost')),
  current_block_id        uuid REFERENCES funnel_blocks(id) ON DELETE SET NULL,
  agent_active            boolean NOT NULL DEFAULT false,
  agent_last_at           timestamptz,
  funnel_paused_at        timestamptz,
  funnel_resume_block_id  uuid,
  tags                    text[] NOT NULL DEFAULT '{}',
  metadata                jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- LEAD SOURCES (immutable)
-- ============================================================
CREATE TABLE lead_sources (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id          uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  utm_source       text,
  utm_campaign     text,
  utm_campaign_id  text,
  utm_adset_id     text,
  utm_ad_id        text,
  utm_content      text,
  referrer_url     text,
  landing_url      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- LEAD EVENTS
-- ============================================================
CREATE TABLE lead_events (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id        uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  funnel_id      uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  block_id       uuid REFERENCES funnel_blocks(id) ON DELETE SET NULL,
  event_type     text NOT NULL,
  event_data     jsonb NOT NULL DEFAULT '{}',
  platform       text,
  revenue_cents  int,
  product_name   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- AD METRICS
-- ============================================================
CREATE TABLE ad_metrics (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_id          text NOT NULL,
  campaign_id    text,
  adset_id       text,
  ad_name        text,
  campaign_name  text,
  spend_cents    int NOT NULL DEFAULT 0,
  impressions    int NOT NULL DEFAULT 0,
  clicks         int NOT NULL DEFAULT 0,
  leads_count    int NOT NULL DEFAULT 0,
  revenue_cents  int NOT NULL DEFAULT 0,
  cpl_cents      int NOT NULL DEFAULT 0,
  roas           float NOT NULL DEFAULT 0,
  date           date NOT NULL,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ad_id, date)
);

-- ============================================================
-- PAGES (Phase 2)
-- ============================================================
CREATE TABLE pages (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  funnel_id               uuid REFERENCES funnels(id) ON DELETE CASCADE,
  title                   text NOT NULL,
  slug                    text NOT NULL,
  content                 jsonb NOT NULL DEFAULT '{}',
  video_url               text,
  button_text             text,
  button_show_at_seconds  int,
  button_url              text,
  pixel_meta_id           text,
  published               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PAGE EVENTS (Phase 2)
-- ============================================================
CREATE TABLE page_events (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id               uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  lead_id               uuid REFERENCES leads(id) ON DELETE SET NULL,
  event_type            text NOT NULL,
  video_seconds_watched int,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FUNNEL AGENTS (Phase 2)
-- ============================================================
CREATE TABLE funnel_agents (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  funnel_id                   uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled                     boolean NOT NULL DEFAULT false,
  model                       text NOT NULL DEFAULT 'claude-haiku',
  system_prompt               text,
  product_name                text,
  product_description         text,
  payment_link                text,
  max_activations_per_month   int NOT NULL DEFAULT 200,
  activations_used            int NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_users_tenants_user_id   ON users_tenants(user_id);
CREATE INDEX idx_users_tenants_tenant_id ON users_tenants(tenant_id);
CREATE INDEX idx_whatsapp_tenant         ON whatsapp_instances(tenant_id);
CREATE INDEX idx_funnels_tenant          ON funnels(tenant_id);
CREATE INDEX idx_funnel_blocks_funnel    ON funnel_blocks(funnel_id);
CREATE INDEX idx_funnel_edges_funnel     ON funnel_edges(funnel_id);
CREATE INDEX idx_leads_tenant            ON leads(tenant_id);
CREATE INDEX idx_leads_funnel            ON leads(funnel_id);
CREATE INDEX idx_leads_status            ON leads(status);
CREATE INDEX idx_lead_sources_lead       ON lead_sources(lead_id);
CREATE INDEX idx_lead_events_lead        ON lead_events(lead_id);
CREATE INDEX idx_lead_events_tenant      ON lead_events(tenant_id);
CREATE INDEX idx_lead_events_type        ON lead_events(event_type);
CREATE INDEX idx_ad_metrics_tenant_date  ON ad_metrics(tenant_id, date);
CREATE INDEX idx_ad_metrics_ad_id        ON ad_metrics(ad_id);
CREATE INDEX idx_pages_tenant            ON pages(tenant_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE tenants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_addons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnels            ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_blocks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_edges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_metrics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_agents      ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's tenant
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT tenant_id FROM users_tenants
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- RLS POLICIES
CREATE POLICY "tenant_select" ON tenants
  FOR SELECT USING (id = current_tenant_id());

CREATE POLICY "users_tenants_select" ON users_tenants
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "users_tenants_insert" ON users_tenants
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "tenant_isolation_tenant_addons" ON tenant_addons
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_whatsapp" ON whatsapp_instances
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_funnels" ON funnels
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_funnel_blocks" ON funnel_blocks
  FOR ALL USING (
    funnel_id IN (SELECT id FROM funnels WHERE tenant_id = current_tenant_id())
  );

CREATE POLICY "tenant_isolation_funnel_edges" ON funnel_edges
  FOR ALL USING (
    funnel_id IN (SELECT id FROM funnels WHERE tenant_id = current_tenant_id())
  );

CREATE POLICY "funnel_templates_select" ON funnel_templates
  FOR SELECT USING (is_public = true OR tenant_id = current_tenant_id());

CREATE POLICY "funnel_templates_write" ON funnel_templates
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_leads" ON leads
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_lead_sources" ON lead_sources
  FOR ALL USING (
    lead_id IN (SELECT id FROM leads WHERE tenant_id = current_tenant_id())
  );

CREATE POLICY "tenant_isolation_lead_events" ON lead_events
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_ad_metrics" ON ad_metrics
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_pages" ON pages
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_page_events" ON page_events
  FOR ALL USING (tenant_id = current_tenant_id());

CREATE POLICY "tenant_isolation_funnel_agents" ON funnel_agents
  FOR ALL USING (tenant_id = current_tenant_id());
