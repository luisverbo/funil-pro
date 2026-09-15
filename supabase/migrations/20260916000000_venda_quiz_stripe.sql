-- ============================================================================
-- VENDA DO QUIZ AVULSO — Stripe
-- ----------------------------------------------------------------------------
-- As chaves da Stripe ficam em platform_settings (mesmo lugar de Meta/Resend),
-- coladas pelo dono em /admin/settings — sem variável de ambiente nova.
-- quiz_purchases guarda cada checkout concluído (idempotente por sessão) e
-- liga ao tenant quando o comprador termina o cadastro.
-- ============================================================================

INSERT INTO platform_settings (key, value) VALUES
  ('stripe_secret_key', null),
  ('stripe_webhook_secret', null),
  ('stripe_quiz_price_id', null),
  ('quiz_preco_exibido', '97'),
  ('quiz_exigir_pagamento', 'false')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
CREATE INDEX IF NOT EXISTS tenants_stripe_customer_idx ON tenants (stripe_customer_id);

CREATE TABLE IF NOT EXISTS quiz_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id text UNIQUE NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  email text,
  amount_cents int,
  currency text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'canceled')),
  current_period_end timestamptz,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  raw jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_purchases_customer_idx ON quiz_purchases (stripe_customer_id);
CREATE INDEX IF NOT EXISTS quiz_purchases_email_idx ON quiz_purchases (lower(email));

-- Só o service role (webhook, cadastro, admin) toca nesta tabela.
ALTER TABLE quiz_purchases ENABLE ROW LEVEL SECURITY;
