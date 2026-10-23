-- ============================================================================
-- ESTÚDIO IA — Fase 7: pagamento internacional pela Hotmart (USD)
-- Cliente fora do Brasil (DDI ≠ +55) paga no checkout da Hotmart; o webhook
-- POST /api/webhooks/hotmart confirma e o pedido segue igual ao Pix.
-- Só colunas/linhas NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- ─── Hotmart (Configurações) ────────────────────────────────────────────────
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS hotmart_hottok     text;                      -- só service role
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS hotmart_produto_id text NOT NULL DEFAULT '8794754';
REVOKE ALL ON estudio_config FROM anon, authenticated;

-- ─── Pedido pago pela Hotmart: a transação nunca conta 2× ───────────────────
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS hotmart_transacao text;
CREATE UNIQUE INDEX IF NOT EXISTS estudio_pedidos_hotmart_tx_uk ON estudio_pedidos (hotmart_transacao) WHERE hotmart_transacao IS NOT NULL;
-- forma_pagamento: 'pix_comprovante' | 'hotmart' · pago_por: 'comprovante' | 'manual' | 'hotmart'
-- (colunas de texto livre desde a Fase 4 — não precisam de CHECK novo)

-- Status 'reembolsado' (reembolso/chargeback da Hotmart) entra no CHECK.
ALTER TABLE estudio_pedidos DROP CONSTRAINT IF EXISTS estudio_pedidos_status_check;
ALTER TABLE estudio_pedidos ADD CONSTRAINT estudio_pedidos_status_check CHECK (status IN (
  'novo', 'aguardando_pagamento', 'aguardando_conferencia', 'pago', 'aguardando_fotos',
  'aguardando_producao', 'gerando', 'pronto', 'aguardando_aprovacao',
  'entregue', 'ajuste', 'finalizado', 'cancelado', 'reembolsado'));

-- Eventos da Hotmart: procurar por transação (auditoria e "evento repetido").
CREATE INDEX IF NOT EXISTS estudio_eventos_transacao_idx ON estudio_eventos ((detalhe->>'transacao')) WHERE tipo LIKE 'hotmart_%';

-- ─── Preços internacionais (USD, link da oferta) — 'INT' vale para todo país ≠ BR
-- (um país com linha própria, ex. 'PT', vence a 'INT').
INSERT INTO estudio_precos (tenant_id, pais, moeda, pacote_qtd, valor_cents, link_pagamento)
SELECT c.tenant_id, 'INT', 'USD', v.qtd, v.cents, v.link
FROM estudio_config c
CROSS JOIN (VALUES
  (2,  690,  'https://pay.hotmart.com/O108165649T?off=kyupvkhm'),
  (3,  890,  'https://pay.hotmart.com/O108165649T?off=ea8dk76w'),
  (5,  1190, 'https://pay.hotmart.com/O108165649T?off=c5bjv7m1'),
  (10, 1690, 'https://pay.hotmart.com/O108165649T?off=fj0e1f7t'),
  (15, 2190, 'https://pay.hotmart.com/O108165649T?off=69k2yih6')
) AS v(qtd, cents, link)
ON CONFLICT (tenant_id, pais, pacote_qtd) DO UPDATE
  SET moeda = EXCLUDED.moeda, valor_cents = EXCLUDED.valor_cents, link_pagamento = EXCLUDED.link_pagamento;
