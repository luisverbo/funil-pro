-- ============================================================================
-- GESTOR DE TRÁFEGO — FASE 1 (rastreamento + leitura de métricas)
-- ----------------------------------------------------------------------------
-- Esta migration prepara TODO o schema da Fase 1 de uma vez, para ser aplicada
-- numa única passada no Supabase Studio.
--
-- O que ela resolve, na ordem dos defeitos encontrados na auditoria:
--   1. lead_sources não guardava utm_medium, utm_term nem fbclid — sem eles
--      não há como casar venda com anúncio quando a UTM se perde;
--   2. venda era apenas um lead_event, sem id da transação: webhook repetido
--      duplicava receita e reembolso não tinha como ser registrado;
--   3. só existia UMA conta de anúncio por tenant (colunas em `tenants`);
--   4. ad_metrics só guardava nível de anúncio, sem CTR/CPM/frequência e sem
--      as conversões do pixel.
--
-- Nada aqui é destrutivo: `ad_metrics` e as colunas de `tenants` continuam
-- intactas, e o código atual segue funcionando enquanto a migração de dados
-- não acontece.
-- ============================================================================

-- ─── 1. Rastreamento completo da origem ─────────────────────────────────────
-- APLICADO EM 18/08 pelo Luís direto no Studio. Mantido aqui por ser
-- idempotente (IF NOT EXISTS) e para o arquivo descrever o schema inteiro.

ALTER TABLE lead_sources
  ADD COLUMN IF NOT EXISTS utm_medium     text,
  ADD COLUMN IF NOT EXISTS utm_term       text,
  ADD COLUMN IF NOT EXISTS fbclid         text,
  ADD COLUMN IF NOT EXISTS fbp            text,
  ADD COLUMN IF NOT EXISTS ip             text,
  ADD COLUMN IF NOT EXISTS user_agent     text,
  ADD COLUMN IF NOT EXISTS first_touch_at timestamptz;

-- A atribuição consulta por ad_id; sem índice, cada varredura vira table scan.
CREATE INDEX IF NOT EXISTS idx_lead_sources_ad
  ON lead_sources(utm_ad_id) WHERE utm_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_sources_fbclid
  ON lead_sources(fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_sources_lead
  ON lead_sources(lead_id);

-- ─── 2. Contas de anúncio (VÁRIAS por tenant) ───────────────────────────────

CREATE TABLE IF NOT EXISTS ad_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta')),
  -- ID da conta SEM o prefixo act_, como o código já normaliza hoje.
  external_id     text NOT NULL,
  name            text,
  currency        text,
  timezone_name   text,
  -- Token POR CONTA: contas diferentes podem vir de logins diferentes.
  access_token    text,
  token_expires_at timestamptz,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'disabled', 'token_expired', 'error')),
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_accounts_tenant ON ad_accounts(tenant_id);

-- ─── 3. Estrutura da conta: campanha → conjunto → anúncio ───────────────────

CREATE TABLE IF NOT EXISTS ad_entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id    uuid NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  level            text NOT NULL CHECK (level IN ('campaign', 'adset', 'ad')),
  external_id      text NOT NULL,
  parent_external_id text,
  name             text,
  status           text,
  effective_status text,
  objective        text,
  daily_budget_cents    integer,
  lifetime_budget_cents integer,
  bid_strategy     text,
  created_time     timestamptz,
  raw              jsonb NOT NULL DEFAULT '{}',
  synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, level, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_entities_tenant_level ON ad_entities(tenant_id, level);
CREATE INDEX IF NOT EXISTS idx_ad_entities_parent ON ad_entities(parent_external_id);

-- ─── 4. Métricas completas, nos três níveis ─────────────────────────────────

CREATE TABLE IF NOT EXISTS ad_insights (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id  uuid NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  level          text NOT NULL CHECK (level IN ('campaign', 'adset', 'ad')),
  external_id    text NOT NULL,
  date           date NOT NULL,
  -- NULL = dia fechado; 0..23 = recorte horário.
  hour           smallint CHECK (hour IS NULL OR (hour >= 0 AND hour <= 23)),
  spend_cents    integer NOT NULL DEFAULT 0,
  impressions    bigint  NOT NULL DEFAULT 0,
  reach          bigint,
  clicks         bigint  NOT NULL DEFAULT 0,
  link_clicks    bigint,
  ctr            numeric(10,4),
  cpm_cents      integer,
  cpc_cents      integer,
  frequency      numeric(10,4),
  -- Conversões do pixel, como a Meta devolve (lista de {action_type, value}).
  actions        jsonb NOT NULL DEFAULT '[]',
  action_values  jsonb NOT NULL DEFAULT '[]',
  currency       text,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, level, external_id, date, hour)
);

CREATE INDEX IF NOT EXISTS idx_ad_insights_tenant_date ON ad_insights(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_insights_lookup ON ad_insights(ad_account_id, level, date DESC);

-- ─── 5. Venda como ENTIDADE (hoje é só um lead_event) ───────────────────────

CREATE TABLE IF NOT EXISTS sales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  platform       text NOT NULL,
  -- Transação na plataforma: é o que impede webhook repetido de duplicar receita.
  external_id    text NOT NULL,
  status         text NOT NULL DEFAULT 'approved'
                 CHECK (status IN ('approved','refunded','chargeback','pending','canceled')),
  revenue_cents  integer NOT NULL DEFAULT 0,
  product_name   text,
  buyer_email    text,
  buyer_phone    text,
  -- Atribuição CONGELADA no instante da venda: se a origem mudar depois, o
  -- histórico financeiro não se reescreve sozinho.
  attr_ad_id       text,
  attr_adset_id    text,
  attr_campaign_id text,
  attr_utm_source  text,
  attr_model       text NOT NULL DEFAULT 'first_touch',
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_date ON sales(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_attr_ad ON sales(attr_ad_id) WHERE attr_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_lead ON sales(lead_id);

-- ─── 6. Diagnósticos do agente analista ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS traffic_diagnoses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id  uuid REFERENCES ad_accounts(id) ON DELETE CASCADE,
  scope_level    text NOT NULL CHECK (scope_level IN ('account','campaign','adset','ad')),
  scope_id       text,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('info','atencao','critico')),
  title          text NOT NULL,
  body           text NOT NULL,
  -- Ação proposta; a Fase 2 é que executa.
  suggestion     jsonb NOT NULL DEFAULT '{}',
  metrics_snapshot jsonb NOT NULL DEFAULT '{}',
  model          text,
  prompt_version text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diag_tenant_date ON traffic_diagnoses(tenant_id, created_at DESC);

-- ─── 7. RLS: mesmo padrão do resto do projeto ───────────────────────────────

ALTER TABLE ad_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_insights       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE traffic_diagnoses ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_accounts','ad_entities','ad_insights','sales','traffic_diagnoses']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I_tenant_isolation ON %1$I;
      CREATE POLICY %1$I_tenant_isolation ON %1$I
        FOR ALL
        USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
    $f$, t);
  END LOOP;
END $$;

-- ─── 8. Migração dos dados que já existem ───────────────────────────────────
-- Cada tenant que já tem conta configurada em `tenants` ganha a linha
-- equivalente em `ad_accounts`. O código antigo continua lendo de `tenants`
-- até a Fase 1 terminar de migrar.

INSERT INTO ad_accounts (tenant_id, provider, external_id, access_token, status)
SELECT id, 'meta', meta_ad_account_id, meta_access_token, 'active'
FROM tenants
WHERE meta_ad_account_id IS NOT NULL AND meta_ad_account_id <> ''
ON CONFLICT (tenant_id, provider, external_id) DO NOTHING;
