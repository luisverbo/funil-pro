-- ============================================================================
-- ESTÚDIO IA — Fase 4: Pix do Luís conferido pelo COMPROVANTE + cérebro da Ana
-- (base de conhecimento, custo de IA por chamada) + dados de venda gravados
-- no pedido pago (para o Painel da Fase 6).
-- Só tabelas/colunas NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- ─── Pix do Luís (Configurações) ────────────────────────────────────────────
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS pix_chave      text;   -- a chave exatamente como é
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS pix_tipo       text;   -- cpf | cnpj | celular | email | aleatoria
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS pix_recebedor  text;   -- nome que aparece no comprovante
-- Cotação para o total em reais do Painel (Fase 6), editável.
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS cotacoes jsonb NOT NULL DEFAULT '{"BRL": 1, "USD": 5.5, "EUR": 6.0}';

-- ─── Pagamento e dados de venda no pedido ───────────────────────────────────
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS pix_e2e_id          text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS pago_por            text;   -- comprovante | manual | hotmart
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS forma_pagamento     text;   -- pix_comprovante | hotmart
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS valor_pago_cents    int;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS comprovante_path    text;   -- estudio-clientes/<pedido>/comprovante.*
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS comprovante_dados   jsonb;  -- o que a IA leu
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS conferencia_motivo  text;   -- por que não aprovou sozinho
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS origem              text;   -- anuncio | organico
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS ad_id               text;   -- referral.source_id do anúncio
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS veio_de_previa      boolean NOT NULL DEFAULT false;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS custo_ia_usd        numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS cancelado_em        timestamptz;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS cancelado_motivo    text;
-- O mesmo comprovante nunca paga dois pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS estudio_pedidos_pix_e2e_uk ON estudio_pedidos (pix_e2e_id) WHERE pix_e2e_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estudio_pedidos_pago_em_idx ON estudio_pedidos (tenant_id, pago_em);

-- ─── Base de conhecimento da Ana (subaba Atendente) ─────────────────────────
CREATE TABLE IF NOT EXISTS estudio_conhecimento (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('faq', 'regra', 'nao_dizer')),
  pergunta   text,                      -- só para faq
  resposta   text NOT NULL,             -- resposta da faq, ou o texto da regra
  ativo      boolean NOT NULL DEFAULT true,
  ordem      int NOT NULL DEFAULT 0,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE estudio_conhecimento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_conhecimento;
CREATE POLICY tenant_isolation ON estudio_conhecimento USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_conhecimento FROM anon;

-- ─── Custo de cada chamada de IA (tokens) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_ia_uso (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contato_id     uuid REFERENCES estudio_contatos(id) ON DELETE SET NULL,
  pedido_id      uuid REFERENCES estudio_pedidos(id) ON DELETE SET NULL,
  finalidade     text NOT NULL,         -- resposta | foto | comprovante
  modelo         text NOT NULL,
  intencao       text,
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  cache_read     int NOT NULL DEFAULT 0,
  cache_write    int NOT NULL DEFAULT 0,
  custo_usd      numeric(12,6) NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estudio_ia_uso_contato_idx ON estudio_ia_uso (contato_id);
CREATE INDEX IF NOT EXISTS estudio_ia_uso_pedido_idx ON estudio_ia_uso (pedido_id);
ALTER TABLE estudio_ia_uso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_ia_uso;
CREATE POLICY tenant_isolation ON estudio_ia_uso USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_ia_uso FROM anon;
