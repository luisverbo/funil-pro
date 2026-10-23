// ============================================================================
// Estúdio IA — Fase 2b: webhook por número (override) com o app Cobrazap
// ----------------------------------------------------------------------------
// O app Cobrazap tem o webhook apontado para o CobrarZap e NÃO pode mudar.
// Só o número do estúdio vem para o FunilPro (override_callback_uri), assinado
// com o App Secret do Cobrazap e verificado com o verify_token do estúdio.
// ============================================================================
import assert from 'node:assert/strict'
import crypto from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assinaturaConfere, tokenConfere, novoVerifyToken, URL_WEBHOOK_ESTUDIO } from '@/lib/estudio/assinatura'
import { apontarWebhookDoNumero, webhookDoNumero } from '@/lib/estudio/whatsapp'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const assinar = (raw: string, sec: string) => 'sha256=' + crypto.createHmac('sha256', sec).update(raw).digest('hex')

function fetchFalso(corpo: unknown, status = 200) {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init })
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

const tests: Record<string, () => void | Promise<void>> = {
  'assinatura: confere com o secret certo, recusa outro secret, header vazio ou corpo mexido': () => {
    const raw = '{"entry":[]}'; const sec = 'a'.repeat(32)
    assert.ok(assinaturaConfere(raw, assinar(raw, sec), sec))
    assert.ok(!assinaturaConfere(raw, assinar(raw, 'b'.repeat(32)), sec))
    assert.ok(!assinaturaConfere(raw + ' ', assinar(raw, sec), sec))
    assert.ok(!assinaturaConfere(raw, null, sec)); assert.ok(!assinaturaConfere(raw, assinar(raw, sec), null))
    assert.ok(!assinaturaConfere(raw, 'sha256=curto', sec), 'tamanho diferente não estoura')
  },
  'verify_token: aleatório de 48 hex e comparação exata': () => {
    const t = novoVerifyToken()
    assert.match(t, /^[a-f0-9]{48}$/); assert.notEqual(t, novoVerifyToken())
    assert.ok(tokenConfere(t, t)); assert.ok(!tokenConfere(t, t.slice(1))); assert.ok(!tokenConfere(null, t))
  },
  'override: POST /{phone_number_id} com override_callback_uri e verify_token, token no header': async () => {
    const { fn, chamadas } = fetchFalso({ success: true })
    await apontarWebhookDoNumero('1418653454665224', 'TOK', URL_WEBHOOK_ESTUDIO, 'vt123', fn)
    assert.ok(chamadas[0].url.endsWith('/1418653454665224'))
    assert.equal(chamadas[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(chamadas[0].init?.body)), {
      webhook_configuration: { override_callback_uri: 'https://funil-pro.vercel.app/api/webhooks/meta-wa', verify_token: 'vt123' },
    })
    assert.ok(!chamadas[0].url.includes('TOK'))
    await assert.rejects(apontarWebhookDoNumero('1', 'T', 'http://x', 'v', fn), /https/)
    await assert.rejects(apontarWebhookDoNumero('1', 'T', URL_WEBHOOK_ESTUDIO, '', fn), /verify_token/)
    const g = fetchFalso({ webhook_configuration: { application: 'https://cobrarzap.com.br/api/webhooks/whatsapp-cloud', phone_number: URL_WEBHOOK_ESTUDIO } })
    const w = await webhookDoNumero('1418653454665224', 'T', g.fn)
    assert.equal(w.phone_number, URL_WEBHOOK_ESTUDIO); assert.ok(g.chamadas[0].url.includes('fields=webhook_configuration'))
  },
  'override nunca mexe no webhook do APP (CobrarZap continua igual)': () => {
    const w = ler('src/lib/estudio/whatsapp.ts')
    assert.ok(!/subscriptions|\/app\b|callback_url/.test(w.split('export async function apontarWebhookDoNumero')[1] ?? ''), 'só override do número')
    assert.ok(w.includes('override_callback_uri: callbackUri'))
  },
  'rota: GET aceita o verify_token do estúdio; POST aceita assinatura do Cobrazap sem mudar a regra do inbox': () => {
    const r = ler('src/app/api/webhooks/meta-wa/route.ts')
    assert.ok(r.includes("if (modo === 'subscribe' && token && challenge && await verifyTokenDoEstudio(token))"))
    assert.ok(r.includes('const assinadoPeloEstudio = (await secretsDoEstudio()).some(sec => assinaturaConfere(raw, assinatura, sec))'))
    assert.ok(r.includes('if (!assinadoPeloEstudio && !assinaturaValida(raw, assinatura))'), 'inbox continua com a regra de sempre')
    assert.ok(r.includes('if (estudio.app_secret && !assinadoPeloEstudio)'), 'mensagem do estúdio sem a assinatura do app dele é ignorada')
  },
  'ação: exige App Secret antes de apontar; verify_token salvo ANTES do POST (a Meta verifica na hora)': () => {
    const a = ler('src/app/actions/estudio.ts')
    const fn = a.split('export async function apontarWebhookEstudio')[1]
    assert.ok(fn.includes('if (!c.app_secret) return'))
    assert.ok(fn.indexOf(".update({ verify_token: verify })") < fn.indexOf('await apontarWebhookDoNumero('))
    assert.ok(a.includes('if (!/^[a-f0-9]{32}$/i.test(sec))'), 'App Secret validado no formato')
    assert.ok(a.includes('const { access_token, app_secret, verify_token: _vt, ...resto } = c'), 'segredos nunca vão para a tela')
  },
  'SQL: colunas novas e tabela fechada; leitura sobrevive sem a coluna': () => {
    const sql = ler('supabase/migrations/20261025000000_estudio_ia_webhook_override.sql')
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS app_secret   text'))
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS verify_token text'))
    assert.ok(sql.includes('REVOKE ALL ON estudio_config FROM anon, authenticated;'))
    assert.ok(ler('src/lib/estudio/entrada.ts').includes("if (error && /app_secret/.test(error.message))"))
  },
}

;(async () => {
  let passed = 0
  const nomes = Object.keys(tests)
  for (const nome of nomes) {
    try { await tests[nome](); passed++; console.log(`  ok   ${nome}`) }
    catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
  }
  console.log(`\n${passed}/${nomes.length} testes passaram`)
  if (passed !== nomes.length) process.exit(1)
})()
