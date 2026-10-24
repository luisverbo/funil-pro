-- ============================================================================
-- ESTÚDIO IA — Espanha (teste 24/10/2026): preços em EURO, valor FINAL com IVA
-- (4%, somado pela Hotmart no checkout), produto Hotmart 8801266
-- "Sesión de Fotos con IA - España". Link: M108178486V?off=<oferta> (+ &sck=<pedido>
-- que a Ana acrescenta). wa_id +34 → pais 'ES', idioma 'es-ES' (já no código).
-- Só linhas novas em estudio_precos — nada da seção 4 muda de nome.
-- Para trocar um preço depois: Configurações → Preços (país ES).
-- ============================================================================
INSERT INTO estudio_precos (tenant_id, pais, moeda, pacote_qtd, valor_cents, link_pagamento)
SELECT c.tenant_id, 'ES', 'EUR', v.qtd, v.cents, v.link
FROM estudio_config c
CROSS JOIN (VALUES
  (2,  822,  'https://pay.hotmart.com/M108178486V?off=h4m9qqsz'),
  (3,  1030, 'https://pay.hotmart.com/M108178486V?off=0i4gjuy7'),
  (5,  1550, 'https://pay.hotmart.com/M108178486V?off=knnonr26'),
  (10, 2278, 'https://pay.hotmart.com/M108178486V?off=j4zpkkr9'),
  (15, 3110, 'https://pay.hotmart.com/M108178486V?off=vaszuwyv')
) AS v(qtd, cents, link)
ON CONFLICT (tenant_id, pais, pacote_qtd) DO UPDATE
  SET moeda = EXCLUDED.moeda, valor_cents = EXCLUDED.valor_cents, link_pagamento = EXCLUDED.link_pagamento;

-- Produtos aceitos no webhook da Hotmart: o antigo (USD) + o da Espanha (EUR).
UPDATE estudio_config SET hotmart_produto_id = '8794754,8801266'
 WHERE hotmart_produto_id IS NULL OR hotmart_produto_id IN ('', '8794754');
