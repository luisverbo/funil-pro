// ============================================================================
// Venda do Quiz avulso — landing + Stripe
// ----------------------------------------------------------------------------
// Pedido do dono: "landing muito boa para vender só o quiz" + "modo de
// pagamento só para o nosso quiz". Aqui se tranca:
//   1. o cliente Stripe puro (assinatura do webhook, leitura de sessão)
//   2. a régua da venda (com/sem Stripe, exigir pagamento, preço exibido)
//   3. as costuras: proxy (público sem vazar o editor), checkout, webhook,
//      cadastro só com sessão paga, onboarding ligando compra ao tenant,
//      admin com as chaves, migration versionada, landing sem segredo
// Nenhuma chamada de rede: tudo é puro ou leitura de fonte.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  lerHeaderAssinatura, verificarAssinaturaStripe, assinarComoStripe, lerEventoStripe,
  sessaoPaga, emailDaSessao, fimDoPeriodo, idDeSessaoValido,
} from '@/lib/billing/stripe'
import {
  stripeConfigurado, exigePagamento, destinoDoCta, precoExibido, cadastroQuizLiberado,
  urlsDeRetorno, acaoParaEvento, CHAVES_VENDA_QUIZ,
} from '@/lib/billing/quiz-venda'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const SEM: Record<string, string> = {}
const COM = { stripe_secret_key: 'sk_test_x', stripe_quiz_price_id: 'price_1', stripe_webhook_secret: 'whsec_1' }

const tests: Record<string, () => void> = {
  // ── Stripe puro ───────────────────────────────────────────────────────────
  'header Stripe-Signature é lido; lixo devolve null': () => {
    assert.deepEqual(lerHeaderAssinatura('t=1700000000,v1=abc,v1=def'), { t: 1700000000, v1: ['abc', 'def'] })
    assert.equal(lerHeaderAssinatura(null), null)
    assert.equal(lerHeaderAssinatura('v1=abc'), null, 'sem timestamp não dá para checar replay')
    assert.equal(lerHeaderAssinatura('t=1700000000'), null)
  },
  'assinatura válida passa; secret errado, payload alterado e replay velho não passam': () => {
    const payload = '{"id":"evt_1","type":"invoice.paid","data":{"object":{}}}'
    const t = 1_700_000_000
    const h = assinarComoStripe(payload, 'whsec_abc', t)
    assert.ok(verificarAssinaturaStripe(payload, h, 'whsec_abc', t + 10))
    assert.ok(!verificarAssinaturaStripe(payload, h, 'whsec_OUTRO', t + 10), 'secret errado')
    assert.ok(!verificarAssinaturaStripe(payload + ' ', h, 'whsec_abc', t + 10), 'payload alterado')
    assert.ok(!verificarAssinaturaStripe(payload, h, 'whsec_abc', t + 600), 'replay de 10 min')
    assert.ok(!verificarAssinaturaStripe(payload, h, '', t), 'sem secret nunca confia')
    assert.ok(!verificarAssinaturaStripe(payload, 't=1,v1=zz', 'whsec_abc', 1), 'v1 não-hex não derruba o processo')
  },
  'evento é lido com id/type/objeto; sessão paga e e-mail em qualquer dos campos': () => {
    assert.equal(lerEventoStripe('nope'), null)
    assert.equal(lerEventoStripe('{"id":"x"}'), null)
    const e = lerEventoStripe('{"id":"evt","type":"checkout.session.completed","data":{"object":{"id":"cs_test_abc"}}}')
    assert.equal(e?.type, 'checkout.session.completed')
    assert.ok(sessaoPaga({ id: 'cs_test_1', payment_status: 'paid' }))
    assert.ok(sessaoPaga({ id: 'cs_test_1', status: 'complete' }))
    assert.ok(!sessaoPaga({ id: 'cs_test_1', payment_status: 'unpaid', status: 'open' }))
    assert.ok(!sessaoPaga(null))
    assert.equal(emailDaSessao({ id: 'x', customer_details: { email: ' Ana@X.com ' } }), 'ana@x.com')
    assert.equal(emailDaSessao({ id: 'x', customer_email: 'b@y.com' }), 'b@y.com')
    assert.equal(emailDaSessao({ id: 'x' }), null)
  },
  'fim do período vira ISO; id de sessão só no formato da Stripe': () => {
    assert.equal(fimDoPeriodo({ id: 's', current_period_end: 1_700_000_000 }), '2023-11-14T22:13:20.000Z')
    assert.equal(fimDoPeriodo({ id: 's' }), null)
    assert.ok(idDeSessaoValido('cs_test_a1B2c3D4e5F6g7'))
    assert.ok(idDeSessaoValido('cs_live_a1B2c3D4e5F6g7'))
    assert.ok(!idDeSessaoValido('cs_test_abc'), 'curto demais')
    assert.ok(!idDeSessaoValido('sub_123456789012'))
    assert.ok(!idDeSessaoValido("cs_test_' OR 1=1"))
    assert.ok(!idDeSessaoValido(undefined))
  },

  // ── Régua da venda ────────────────────────────────────────────────────────
  'sem Stripe: botão vai ao cadastro; com Stripe: botão é POST no checkout': () => {
    assert.ok(!stripeConfigurado(SEM))
    assert.deepEqual(destinoDoCta(SEM), { tipo: 'cadastro', href: '/register?plano=quiz' })
    assert.ok(stripeConfigurado(COM))
    assert.deepEqual(destinoDoCta(COM), { tipo: 'checkout', action: '/api/checkout/quiz' })
    assert.ok(!stripeConfigurado({ stripe_secret_key: 'sk_test_x' }), 'sem preço não cobra')
  },
  'exigir pagamento só vale com Stripe configurado': () => {
    assert.ok(!exigePagamento({ quiz_exigir_pagamento: 'true' }), 'sem Stripe, exigir travaria todo mundo')
    assert.ok(!exigePagamento({ ...COM, quiz_exigir_pagamento: 'false' }))
    assert.ok(exigePagamento({ ...COM, quiz_exigir_pagamento: 'true' }))
  },
  'cadastro no plano quiz: livre sem exigência; com exigência só sessão PAGA': () => {
    assert.ok(cadastroQuizLiberado(SEM, null))
    const cfg = { ...COM, quiz_exigir_pagamento: 'true' }
    assert.ok(!cadastroQuizLiberado(cfg, null), 'sem sessão → landing')
    assert.ok(!cadastroQuizLiberado(cfg, { id: 'cs_test_a1B2c3D4e5F6g7', payment_status: 'unpaid', status: 'open' }))
    assert.ok(cadastroQuizLiberado(cfg, { id: 'cs_test_a1B2c3D4e5F6g7', payment_status: 'paid' }))
    assert.ok(!cadastroQuizLiberado(cfg, { id: 'forjado', payment_status: 'paid' }), 'id fora do formato não passa')
  },
  'preço exibido: "97", "97,00", "R$ 97,90" — lixo vira null (nunca "R$ NaN")': () => {
    assert.deepEqual(precoExibido('97'), { inteiro: '97', centavos: null })
    assert.deepEqual(precoExibido('97,00'), { inteiro: '97', centavos: null })
    assert.deepEqual(precoExibido('R$ 97,90'), { inteiro: '97', centavos: '90' })
    assert.deepEqual(precoExibido('197.5'), { inteiro: '197', centavos: '50' })
    assert.equal(precoExibido('abc'), null)
    assert.equal(precoExibido(''), null)
    assert.equal(precoExibido(null), null)
  },
  'URLs de retorno: sucesso cai no cadastro com a sessão; cancelar volta à landing': () => {
    const u = urlsDeRetorno('https://app.funil.pro/')
    assert.equal(u.successUrl, 'https://app.funil.pro/register?plano=quiz&cs={CHECKOUT_SESSION_ID}')
    assert.equal(u.cancelUrl, 'https://app.funil.pro/quiz?cancelado=1')
  },
  'eventos do webhook mapeiam para registrar/renovar/cancelar; o resto ignora': () => {
    assert.equal(acaoParaEvento('checkout.session.completed').acao, 'registrar_compra')
    assert.equal(acaoParaEvento('invoice.paid').acao, 'renovar')
    assert.equal(acaoParaEvento('customer.subscription.deleted').acao, 'cancelar')
    assert.equal(acaoParaEvento('charge.refunded').acao, 'ignorar')
  },

  // ── Costuras ──────────────────────────────────────────────────────────────
  'migration cria as chaves do admin, colunas Stripe no tenant e quiz_purchases com RLS': () => {
    const sql = ler('supabase/migrations/20260916000000_venda_quiz_stripe.sql')
    for (const k of CHAVES_VENDA_QUIZ) assert.ok(sql.includes(`('${k}'`), `chave ${k} precisa nascer na migration`)
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS stripe_customer_id'))
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS quiz_purchases'))
    assert.ok(sql.includes('checkout_session_id text UNIQUE NOT NULL'), 'idempotência por sessão')
    assert.ok(sql.includes('ALTER TABLE quiz_purchases ENABLE ROW LEVEL SECURITY'))
  },
  'proxy: /quiz e o checkout são públicos por rota EXATA — /quiz-editor continua privado': () => {
    const src = ler('src/proxy.ts')
    assert.ok(src.includes("'/quiz', '/api/checkout/quiz'"), 'as duas rotas em PUBLIC_ROUTES')
    const prefixos = src.slice(src.indexOf('PUBLIC_PREFIXES = ['), src.indexOf(']', src.indexOf('PUBLIC_PREFIXES = [')))
    assert.ok(!/'\/quiz'/.test(prefixos), "'/quiz' como PREFIXO deixaria /quiz-editor público")
    assert.ok(!/'\/api\/checkout/.test(prefixos))
  },
  'checkout: sem Stripe cai no cadastro; erro volta à landing; nunca expõe a chave': () => {
    const src = ler('src/app/api/checkout/quiz/route.ts')
    assert.ok(src.includes('if (!stripeConfigurado(cfg))'))
    assert.ok(src.includes('NextResponse.redirect(new URL(CADASTRO_QUIZ, origem), 303)'))
    assert.ok(src.includes('?erro=checkout'))
    assert.ok(!src.includes('stripe_secret_key }'), 'a chave não pode ir para o corpo da resposta')
  },
  'webhook: recusa sem secret, verifica assinatura, registra/renova/cancela': () => {
    const src = ler('src/app/api/webhooks/stripe/route.ts')
    assert.ok(src.includes("status: 503"), 'sem secret não dá para confiar no payload')
    assert.ok(src.includes("verificarAssinaturaStripe(raw, request.headers.get('stripe-signature'), secret)"))
    assert.ok(src.includes("case 'registrar_compra'") && src.includes("case 'renovar'") && src.includes("case 'cancelar'"))
    assert.ok(src.includes("onConflict: 'checkout_session_id'"), 'reenvio da Stripe não duplica compra')
    assert.ok(src.includes(".eq('stripe_customer_id', customer)"), 'renovação/cancelamento acham o tenant pelo customer')
  },
  'cadastro: com exigência e sem sessão paga, volta para a landing; e-mail pago pré-preenchido': () => {
    const pg = ler('src/app/(auth)/register/page.tsx')
    assert.ok(pg.includes('if (!cadastroQuizLiberado(cfg, sessao)) redirect(`${LANDING_QUIZ}?pagar=1`)'))
    assert.ok(pg.includes('idDeSessaoValido(cs)'), 'só gasta chamada na Stripe com id no formato')
    assert.ok(pg.includes('emailInicial={emailPago'))
    const form = ler('src/app/(auth)/register/register-form.tsx')
    assert.ok(form.includes('name="cs"'))
    assert.ok(form.includes('defaultValue={emailInicial}'))
    const auth = ler('src/app/actions/auth.ts')
    assert.ok(auth.includes("idDeSessaoValido(csBruto)"), 'metadata só recebe id válido')
    assert.ok(auth.includes('checkout_session_id: checkoutSession'))
  },
  'onboarding: tenant no plano quiz liga a compra (customer, assinatura, vencimento)': () => {
    const onb = ler('src/app/actions/onboarding.ts')
    assert.ok(onb.includes("if (plan === 'quiz')"))
    assert.ok(onb.includes('ligarCompraAoTenant(admin, tenant!.id'))
    const c = ler('src/lib/billing/compra.ts')
    assert.ok(c.includes("update({ tenant_id: tenantId })"))
    assert.ok(c.includes('plan_expires_at: compra.current_period_end'))
    assert.ok(c.includes('buscarSessaoCheckout('), 'se o webhook ainda não chegou, confirma direto na Stripe')
  },
  'admin: seção Stripe com as 5 chaves; landing recebe só o que é público': () => {
    const adm = ler('src/app/admin/settings/settings-form.tsx')
    for (const k of CHAVES_VENDA_QUIZ) assert.ok(adm.includes(`'${k}'`), `campo ${k} no admin`)
    const pg = ler('src/app/quiz/page.tsx')
    assert.ok(pg.includes('configPublica(cfg)'))
    assert.ok(!pg.includes('stripe_secret_key'), 'a página da landing nem menciona a chave')
    const land = ler('src/app/quiz/quiz-landing.tsx')
    assert.ok(!/stripe_secret|whsec|sk_live|sk_test/.test(land), 'nada de segredo no componente cliente')
    assert.ok(land.includes('method="POST" action={cta.action}'), 'com Stripe o botão é um POST no checkout')
    assert.ok(land.includes('href={cta.href}'), 'sem Stripe o botão é link para o cadastro')
  },
  'landing: demonstração viva, preço vindo do admin e FAQ — sem depoimento inventado': () => {
    const land = ler('src/app/quiz/quiz-landing.tsx')
    assert.ok(land.includes('function PhoneDemo'), 'o celular roda o quiz sozinho')
    assert.ok(land.includes('{preco.inteiro}'))
    assert.ok(land.includes('Consulte'), 'preço inválido não vira R$ NaN')
    assert.ok(land.includes('Exemplo ilustrativo'), 'números de exemplo são rotulados como exemplo')
    assert.ok(!/id="depoimentos"|testimonial|"Cliente desde|— @/i.test(land), 'não inventamos clientes (depoimento só como nome de bloco)')
    assert.ok(land.includes('id="preco"') && land.includes('id="faq"') && land.includes('id="compare"'))
  },
}

// ─── Execução ───────────────────────────────────────────────────────────────

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
