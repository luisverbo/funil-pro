// ============================================================================
// platform_settings fechada — segredos nunca legíveis pela chave pública
// ----------------------------------------------------------------------------
// A tabela nasceu sem RLS ("admin-only access via service role"), mas com os
// GRANTs padrão do Supabase o papel anon tinha SELECT: token do Instagram,
// chaves da Stripe e segredo do cron legíveis com a chave pública do site.
// Aqui se tranca a migration e a regra de que só a service role lê a tabela.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  'migration liga RLS, revoga anon/authenticated e troca o segredo exposto': () => {
    const sql = ler('supabase/migrations/20260925000000_fechar_platform_settings.sql')
    assert.ok(sql.includes('ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY'))
    assert.ok(sql.includes('REVOKE ALL ON platform_settings FROM anon, authenticated'))
    assert.ok(/UPDATE platform_settings\s+SET value = encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/.test(sql))
    assert.ok(!/CREATE POLICY[^;]*platform_settings/i.test(sql), 'nenhuma política: só a service role entra')
  },
  'todo arquivo que lê platform_settings usa a service role': () => {
    const arquivos = execSync("grep -rl \"from('platform_settings')\" src --exclude-dir=__tests__ || true", { cwd: RAIZ })
      .toString().trim().split('\n').filter(Boolean)
    assert.ok(arquivos.length >= 5, `esperava vários leitores, achei ${arquivos.length}`)
    for (const f of arquivos) {
      const src = ler(f)
      assert.ok(src.includes('createAdminClient'), `${f} lê platform_settings sem service role — com RLS isso volta vazio`)
    }
  },
}

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
