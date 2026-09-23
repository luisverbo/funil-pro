// ============================================================================
// Token do Instagram — banco primeiro, renovação a cada 24h
// ----------------------------------------------------------------------------
// Relato do dono (23/09): "está aparecendo 'Instagram não conectado' mas meu
// Instagram já está conectado". O detalhe técnico dizia: "Session has expired
// on 17-Sep-26". CAUSA RAIZ: o token de longa duração vale 60 dias e o
// FunilPro só o lia da variável de ambiente, sem nunca renovar.
//
// Aqui se tranca:
//   1. deveRenovar (puro): nunca renovou → sim; < 24h → não; ≥ 24h → sim
//   2. pedirRenovacao com fetch falso: token novo volta; erro da Meta lança
//   3. explicarErroDeToken traduz a mensagem da Meta com a data
//   4. costuras: nenhum process.env.IG_ACCESS_TOKEN fora do módulo de token;
//      admin tem o campo; salvar token zera o carimbo; cron renova; telas
//      explicam; migration cria as chaves
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

import { deveRenovar, pedirRenovacao, explicarErroDeToken, INTERVALO_RENOVACAO_MS } from '@/lib/instagram/token'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void | Promise<void>> = {
  'deveRenovar: nunca renovou → sim; há 1h → não; há 24h → sim; carimbo inválido → sim': () => {
    const agora = new Date('2026-09-23T12:00:00Z')
    assert.ok(deveRenovar(null, agora))
    assert.ok(deveRenovar(undefined, agora))
    assert.ok(!deveRenovar('2026-09-23T11:00:00Z', agora))
    assert.ok(deveRenovar(new Date(agora.getTime() - INTERVALO_RENOVACAO_MS).toISOString(), agora))
    assert.ok(deveRenovar('lixo', agora))
    assert.equal(INTERVALO_RENOVACAO_MS, 86_400_000, 'a Meta só renova token com mais de 24h')
  },
  'pedirRenovacao: chama refresh_access_token e devolve o token novo': async () => {
    let urlVista = ''
    const f = async (url: string) => { urlVista = url; return new Response(JSON.stringify({ access_token: 'NOVO', expires_in: 5184000 }), { status: 200 }) }
    const r = await pedirRenovacao('VELHO', f)
    assert.equal(r.token, 'NOVO'); assert.equal(r.expiraEmSegundos, 5184000)
    assert.ok(urlVista.startsWith('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=VELHO'))
  },
  'pedirRenovacao: erro da Meta lança com a mensagem dela (token vencido não renova)': async () => {
    const f = async () => new Response(JSON.stringify({ error: { message: 'Error validating access token: Session has expired' } }), { status: 400 })
    await assert.rejects(() => pedirRenovacao('VELHO', f), /Session has expired/)
  },
  'explicarErroDeToken: traduz o vencimento com a data e manda para o admin': () => {
    const m = explicarErroDeToken('Error validating access token: Session has expired on Thursday, 17-Sep-26 09:33:12 PDT. The current time is Wednesday, 23-Sep-26 12:25:04 PDT')
    assert.ok(m && m.includes('venceu em Thursday, 17-Sep-26 09:33:12 PDT'))
    assert.ok(m && m.includes('Admin → Configurações → Instagram'))
    assert.ok(explicarErroDeToken('Invalid OAuth access token')?.includes('recusado'))
    assert.equal(explicarErroDeToken('token_missing'), null, 'sem token não é erro de token vencido')
    assert.equal(explicarErroDeToken(undefined), null)
  },

  // ── Costuras ──────────────────────────────────────────────────────────────
  'ninguém lê IG_ACCESS_TOKEN fora do módulo de token': () => {
    const saida = execSync("grep -rln 'process.env.IG_ACCESS_TOKEN' src --exclude-dir=__tests__ || true", { cwd: RAIZ }).toString().trim().split('\n').filter(Boolean)
    assert.deepEqual(saida, ['src/lib/instagram/token.ts'], `lendo o token direto do ambiente: ${saida.join(', ')}`)
  },
  'o cliente da Instagram API usa o token do módulo (banco primeiro)': () => {
    const idx = ler('src/lib/instagram/index.ts')
    assert.ok(idx.includes("from './token'"))
    assert.ok(!idx.includes('${token()}'), 'token() síncrono do ambiente não pode ter sobrado')
    assert.ok((idx.match(/\$\{await token\(\)\}/g) ?? []).length >= 9)
    assert.ok(idx.includes('const t = await obterTokenInstagram()'), 'getConnectedAccount também')
  },
  'cron dos conteúdos renova antes de publicar': () => {
    const rota = ler('src/app/api/cron/publicar-instagram/route.ts')
    assert.ok(rota.includes('await renovarTokenSeNecessario()'))
    assert.ok(rota.indexOf('renovarTokenSeNecessario()') < rota.indexOf('rodadaDePublicacao('), 'renova ANTES de usar o token')
  },
  'admin: campo do token; salvar zera o carimbo e o cache': () => {
    const form = ler('src/app/admin/settings/settings-form.tsx')
    assert.ok(form.includes("handleSave(['ig_access_token'])"))
    assert.ok(form.includes('Instagram — token da conta'))
    const adm = ler('src/app/actions/admin.ts')
    assert.ok(adm.includes("if (key === 'ig_access_token')"))
    assert.ok(adm.includes(".eq('key', 'ig_token_renovado_em')"))
    assert.ok(adm.includes('limparCacheDoToken()'))
  },
  'renovação que falha NÃO grava nada — o token antigo segue até vencer': () => {
    const t = ler('src/lib/instagram/token.ts')
    const corpo = t.slice(t.indexOf('export async function renovarTokenSeNecessario'))
    const catchIdx = corpo.indexOf('} catch (err) {')
    assert.ok(catchIdx > 0)
    assert.ok(!corpo.slice(catchIdx).includes('upsert('), 'no catch não pode haver escrita')
  },
  'telas explicam o vencimento e apontam o caminho sem redeploy': () => {
    const ig = ler('src/app/(dashboard)/instagram/instagram-client.tsx')
    assert.ok(ig.includes('explicarErroDeToken(connection?.error)'))
    assert.ok(ig.includes('href="/admin/settings"'))
    assert.ok(!ig.includes('Faça <strong>Redeploy</strong>'), 'o caminho antigo exigia redeploy')
    const ct = ler('src/app/(dashboard)/conteudos/conteudos-client.tsx')
    assert.ok(ct.includes('explicarErroDeToken(conexao.error)'))
  },
  'migration cria as chaves do token no platform_settings': () => {
    const sql = ler('supabase/migrations/20260923010000_ig_token_settings.sql')
    assert.ok(sql.includes("('ig_access_token', null)"))
    assert.ok(sql.includes("('ig_token_renovado_em', null)"))
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
