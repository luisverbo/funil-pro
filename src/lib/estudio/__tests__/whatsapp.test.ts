// ============================================================================
// Estúdio IA — Fase 2: número exclusivo na Cloud API
// ----------------------------------------------------------------------------
// Regras: janela 24h (72h vindo de anúncio), separação total do inbox,
// token só no servidor, registro com PIN, inscrição do app na WABA.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  origemDaMensagem, fimDaJanela, dentroDaJanela, normalizarWhatsApp, deveResponderTeste, pinValido, limparErro,
  registrarNumero, inscreverApp, appsInscritos, statusDoNumero, JANELA_ANUNCIO_H,
} from '@/lib/estudio/whatsapp'
import { lerWebhookCloud } from '@/lib/whatsapp-cloud/webhook-parser'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sql = ler('supabase/migrations/20261024000000_estudio_ia_fase2.sql')

function fetchFalso(corpo: unknown, status = 200) {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init })
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

const tests: Record<string, () => void | Promise<void>> = {
  'janela: 24h orgânico, 72h vindo de anúncio Converse conosco': () => {
    const t = Date.parse('2026-10-24T12:00:00Z') / 1000
    assert.equal(fimDaJanela(t, 'organico'), '2026-10-25T12:00:00.000Z')
    assert.equal(fimDaJanela(t, 'anuncio'), '2026-10-27T12:00:00.000Z')
    assert.equal(JANELA_ANUNCIO_H, 72)
    assert.ok(dentroDaJanela('2026-10-25T12:00:00Z', new Date('2026-10-25T11:59:00Z')))
    assert.ok(!dentroDaJanela('2026-10-25T12:00:00Z', new Date('2026-10-25T12:01:00Z')))
    assert.ok(!dentroDaJanela(null))
  },
  'origem: mensagem com referral = anúncio': () => {
    assert.equal(origemDaMensagem({ source_id: '120', source_type: 'ad', ctwa_clid: 'x' }), 'anuncio')
    assert.equal(origemDaMensagem(null), 'organico')
    assert.equal(origemDaMensagem({}), 'organico')
  },
  'parser: guarda o id da mídia e o referral do anúncio': () => {
    const r = lerWebhookCloud({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '1418653454665224' },
      contacts: [{ wa_id: '5521999', profile: { name: 'Maryana' } }],
      messages: [
        { id: 'w1', from: '5521999', timestamp: '1', type: 'text', text: { body: 'Olá' }, referral: { source_id: 'ad1', headline: 'Ensaio' } },
        { id: 'w2', from: '5521999', timestamp: '2', type: 'image', image: { id: 'MID123', caption: 'rosto' } },
      ],
    } }] }] })
    assert.equal(r.mensagens[0].referral?.source_id, 'ad1'); assert.equal(r.mensagens[0].mediaId, null)
    assert.equal(r.mensagens[1].mediaId, 'MID123'); assert.equal(r.mensagens[1].corpo, 'rosto')
    assert.equal(r.mensagens[0].nome, 'Maryana')
  },
  'número para avisos: aceita colchetes/máscara e põe o 55': () => {
    assert.equal(normalizarWhatsApp('[21980120036]'), '5521980120036')
    assert.equal(normalizarWhatsApp('+55 (21) 98012-0036'), '5521980120036')
    assert.equal(normalizarWhatsApp('123'), null)
  },
  'resposta de teste: no máximo 1 a cada 30 min': () => {
    const agora = new Date('2026-10-24T12:00:00Z')
    assert.ok(deveResponderTeste(null, agora))
    assert.ok(!deveResponderTeste('2026-10-24T11:45:00Z', agora))
    assert.ok(deveResponderTeste('2026-10-24T11:29:00Z', agora))
  },
  'registro: PIN de 6 dígitos, POST /{id}/register com messaging_product': async () => {
    assert.ok(pinValido('123456')); assert.ok(!pinValido('12345')); assert.ok(!pinValido('12a456'))
    const { fn, chamadas } = fetchFalso({ success: true })
    await registrarNumero('1418653454665224', 'TOK', '123456', fn)
    assert.ok(chamadas[0].url.endsWith('/1418653454665224/register'))
    assert.equal(chamadas[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(chamadas[0].init?.body)), { messaging_product: 'whatsapp', pin: '123456' })
    assert.ok(!chamadas[0].url.includes('TOK'), 'token no header, nunca na URL')
    await assert.rejects(registrarNumero('1', 'T', '12', fn), /6 dígitos/)
  },
  'WABA: lista e inscreve o app; status do número; erro da Meta sem token': async () => {
    const a = fetchFalso({ data: [{ whatsapp_business_api_data: { id: '99', name: 'FunilPro' } }] })
    assert.deepEqual(await appsInscritos('2250778325757289', 'T', a.fn), [{ id: '99', name: 'FunilPro' }])
    const b = fetchFalso({ success: true })
    await inscreverApp('2250778325757289', 'T', b.fn)
    assert.ok(b.chamadas[0].url.endsWith('/2250778325757289/subscribed_apps')); assert.equal(b.chamadas[0].init?.method, 'POST')
    const c = fetchFalso({ display_phone_number: '+55 21 99077-3595', platform_type: 'CLOUD_API' })
    assert.equal((await statusDoNumero('1418653454665224', 'T', c.fn)).platform_type, 'CLOUD_API')
    const d = fetchFalso({ error: { message: 'bad access_token=EAAGsegredo' } }, 400)
    await assert.rejects(statusDoNumero('1', 'T', d.fn), (e: Error) => !e.message.includes('EAAGsegredo'))
    assert.equal(limparErro('x access_token=abc&y'), 'x access_token=***&y')
  },
  'separação: o webhook desvia o número do estúdio ANTES do inbox': () => {
    const w = ler('src/app/api/webhooks/meta-wa/route.ts')
    const desvio = w.indexOf('const estudio = await doEstudio(m.phoneNumberId)')
    const inbox = w.indexOf(".from('wa_accounts')")
    assert.ok(desvio > 0 && inbox > desvio, 'desvio vem antes de procurar a conta do inbox')
    assert.ok(w.includes('await processarEntradaEstudio(admin, estudio, m)\n        continue'))
    assert.ok(w.includes("const tabela = (await doEstudio(st.phoneNumberId)) ? 'estudio_mensagens' : 'wa_messages'"))
    const e = ler('src/lib/estudio/entrada.ts')
    assert.ok(!/from\('wa_/.test(e), 'estúdio nunca lê nem escreve tabelas do inbox')
    assert.ok(ler('src/app/actions/estudio.ts').includes("Esse número já está conectado na aba WhatsApp (inbox)"))
  },
  'entrada: dedupe por wamid, contato por wa_id, janela pela origem, só responde se ativo': () => {
    const e = ler('src/lib/estudio/entrada.ts')
    assert.ok(e.includes(".from('estudio_mensagens').select('id').eq('wamid', m.wamid).maybeSingle()"))
    assert.ok(e.includes("existente?.origem === 'anuncio' ? 'anuncio' : origemDaMensagem(m.referral)"))
    assert.ok(e.includes('if (!cfg.ativo || !cfg.access_token) return'))
  },
  'segurança: token só no servidor; tabela de config fechada; tela não recebe o token': () => {
    assert.ok(sql.includes('REVOKE ALL ON estudio_config FROM anon, authenticated;'))
    assert.ok(/ALTER TABLE estudio_config\s+ENABLE ROW LEVEL SECURITY/.test(sql))
    const a = ler('src/app/actions/estudio.ts')
    assert.ok(a.includes('const { access_token, ...resto } = c'))
    assert.ok(a.includes('temToken: !!access_token'))
    assert.ok(!ler('src/app/estudio/catalogo/dados.ts').includes('access_token'), 'página pública não lê o token')
    assert.ok(ler('src/app/(dashboard)/estudio-ia/aba-config.tsx').includes('type="password"'))
  },
  'tabelas novas e catálogo com wa.me do estúdio': () => {
    for (const t of ['estudio_config', 'estudio_contatos', 'estudio_mensagens']) assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t)
    assert.ok(sql.includes('UNIQUE (tenant_id, wa_id)'))
    assert.ok(sql.includes('wamid           text UNIQUE'))
    assert.ok(ler('src/app/estudio/catalogo/[slug]/page.tsx').includes('whatsapp={whatsapp}'))
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
