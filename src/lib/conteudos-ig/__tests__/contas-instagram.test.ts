// ============================================================================
// Várias contas do Instagram ("Conectar Instagram"): state assinado, callbacks
// da Meta, troca do code, publicador usando o token da conta escolhida.
// ============================================================================
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assinarEstado, lerEstado, lerSignedRequest, urlDeAutorizacao, situacaoDaConta, expiraEm } from '@/lib/instagram/contas'
import { trocarCodigo } from '@/lib/instagram/contas-servidor'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SEG = 'segredo-de-teste'

const tests: Record<string, () => void | Promise<void>> = {
  'state: leva o tenant, recusa adulterado, outro segredo e vencido': () => {
    const st = assinarEstado('t1', SEG, 1000)
    assert.equal(lerEstado(st, SEG, 2000), 't1')
    assert.equal(lerEstado(st, 'outro', 2000), null)
    assert.equal(lerEstado(st, SEG, 1000 + 16 * 60_000), null, 'vence em 15 min')
    const [corpo, sig] = st.split('.')
    const falso = Buffer.from(JSON.stringify({ t: 't2', e: 9e15 })).toString('base64url')
    assert.equal(lerEstado(`${falso}.${sig}`, SEG, 2000), null)
    assert.equal(lerEstado(corpo, SEG), null); assert.equal(lerEstado(null, SEG), null)
  },
  'signed_request da Meta: só com a assinatura certa': () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 123 })).toString('base64url')
    const sig = createHmac('sha256', SEG).update(payload).digest('base64url')
    assert.deepEqual(lerSignedRequest(`${sig}.${payload}`, SEG), { user_id: '123' })
    assert.equal(lerSignedRequest(`${sig}.${payload}`, 'x'), null)
    assert.equal(lerSignedRequest('lixo', SEG), null)
  },
  'url de autorização com escopos de publicar': () => {
    const u = new URL(urlDeAutorizacao('999', 'https://app/api/instagram/callback', 'S'))
    assert.equal(u.host, 'www.instagram.com'); assert.equal(u.searchParams.get('client_id'), '999')
    assert.match(u.searchParams.get('scope')!, /instagram_business_content_publish/)
    assert.equal(u.searchParams.get('state'), 'S')
  },
  'troca do code: curto → 60 dias → perfil (sem rede)': async () => {
    const chamadas: string[] = []
    const f = async (url: string) => {
      chamadas.push(url)
      if (url.includes('oauth/access_token')) return new Response(JSON.stringify({ access_token: 'curto', user_id: 1 }))
      if (url.includes('ig_exchange_token')) return new Response(JSON.stringify({ access_token: 'longo', expires_in: 5183944 }))
      return new Response(JSON.stringify({ user_id: '1784', username: 'loja', profile_picture_url: 'p.jpg' }))
    }
    const r = await trocarCodigo({ code: 'c', appId: 'a', segredo: 's', redirectUri: 'r' }, f)
    assert.deepEqual([r.token, r.igUserId, r.username, r.foto], ['longo', '1784', 'loja', 'p.jpg'])
    assert.equal(chamadas.length, 3)
    await assert.rejects(trocarCodigo({ code: 'c', appId: 'a', segredo: 's', redirectUri: 'r' },
      async () => new Response(JSON.stringify({ error_type: 'OAuthException', error_message: 'code usado' , error: 'x'}), { status: 400 })))
  },
  'situação e validade da conta': () => {
    assert.ok(expiraEm(86400, 0)!.startsWith('1970-01-02'))
    assert.equal(situacaoDaConta({ status: 'ativa', token_expira_em: null }).ok, true)
    assert.equal(situacaoDaConta({ status: 'ativa', token_expira_em: new Date(0).toISOString() }).ok, false)
    assert.equal(situacaoDaConta({ status: 'erro', token_expira_em: null }).ok, false)
  },
  'integração: token da conta escolhida, fallback da plataforma, renovação no cron, tabela fechada': () => {
    const pub = ler('src/lib/conteudos-ig/publicador.ts')
    assert.match(pub, /item\.instagram_conta_id[\s\S]*credencialDaConta\(item\.instagram_conta_id, item\.tenant_id\)/)
    assert.match(ler('src/app/api/cron/publicar-instagram/route.ts'), /renovarContas\(\)/)
    const sql = ler('supabase/migrations/20261113000000_instagram_contas.sql')
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /REVOKE ALL ON instagram_contas FROM anon, authenticated/)
    assert.ok(!/CREATE POLICY/i.test(sql), 'token só pela service role')
    assert.match(ler('src/app/api/conteudos/route.ts'), /escolherContaDoConteudo/)
    assert.ok(!/\btoken\b/.test(ler('src/lib/instagram/contas-servidor.ts').match(/COLS_PUBLICAS = '([^']+)'/)![1]), 'tela nunca recebe o token')
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
