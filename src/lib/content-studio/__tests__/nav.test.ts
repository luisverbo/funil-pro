// ============================================================================
// Content Studio — botão da sidebar (visibilidade decidida no SERVIDOR)
// ----------------------------------------------------------------------------
// O que se prova: canShowContentStudioNav é default-deny e só aprova UUID
// presente em CONTENT_STUDIO_NAV_USER_IDS; a sidebar só rende o item quando a
// prop showContentStudio (vinda do layout server) é true; nenhuma allowlist,
// e-mail ou NEXT_PUBLIC_* chega ao cliente; a rota não virou pública.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { canShowContentStudioNav } from '../nav-access'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const ENV_KEY = 'CONTENT_STUDIO_NAV_USER_IDS'
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

/** Executa fn com a env fixada (inclusive AUSENTE) e restaura ao final. */
function comEnv(valor: string | undefined, fn: () => void) {
  const anterior = process.env[ENV_KEY]
  if (valor === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = valor
  try { fn() } finally {
    if (anterior === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = anterior
  }
}

// ─── Helper server-only ─────────────────────────────────────────────────────

test('env AUSENTE -> ninguém vê (default deny)', () => {
  comEnv(undefined, () => {
    assert.equal(canShowContentStudioNav(UUID_A), false)
  })
})

test('env vazia ou só espaços -> ninguém vê', () => {
  comEnv('', () => assert.equal(canShowContentStudioNav(UUID_A), false))
  comEnv('   ', () => assert.equal(canShowContentStudioNav(UUID_A), false))
  comEnv(',,, ,', () => assert.equal(canShowContentStudioNav(UUID_A), false))
})

test('UUID diferente do configurado -> false', () => {
  comEnv(UUID_A, () => {
    assert.equal(canShowContentStudioNav(UUID_B), false)
    // Prefixo/sufixo NÃO conta: igualdade exata, não substring.
    assert.equal(canShowContentStudioNav(UUID_A.slice(0, 12)), false)
  })
})

test('UUID presente na lista -> true', () => {
  comEnv(UUID_A, () => assert.equal(canShowContentStudioNav(UUID_A), true))
})

test('múltiplos UUIDs com espaços -> cada um casa após trim', () => {
  comEnv(` ${UUID_A} ,   ${UUID_B}`, () => {
    assert.equal(canShowContentStudioNav(UUID_A), true)
    assert.equal(canShowContentStudioNav(UUID_B), true)
    assert.equal(canShowContentStudioNav('33333333-3333-4333-8333-333333333333'), false)
  })
})

test('userId ausente/vazio -> false mesmo com env configurada', () => {
  comEnv(UUID_A, () => {
    assert.equal(canShowContentStudioNav(undefined), false)
    assert.equal(canShowContentStudioNav(null), false)
    assert.equal(canShowContentStudioNav(''), false)
    assert.equal(canShowContentStudioNav('   '), false)
  })
})

// ─── Fiação servidor -> sidebar (auditoria de fonte) ────────────────────────

test('layout do dashboard decide no servidor e passa a prop', () => {
  const fonte = ler('src/app/(dashboard)/layout.tsx')
  assert.ok(fonte.includes('canShowContentStudioNav(user.id)'), 'layout não usa o helper com user.id')
  assert.ok(fonte.includes('showContentStudio={showContentStudio}'), 'layout não passa a prop ao AppShell')
  // A decisão NUNCA usa displayName/e-mail/admin.
  assert.ok(!fonte.includes('canShowContentStudioNav(displayName'), 'decisão por displayName é proibida')
})

test('AppShell repassa a prop à Sidebar', () => {
  const fonte = ler('src/components/layout/app-shell.tsx')
  assert.ok(fonte.includes('showContentStudio?: boolean'))
  assert.ok(fonte.includes('showContentStudio={showContentStudio}'))
})

test('sidebar rende /content-studio SOMENTE sob a prop', () => {
  const fonte = ler('src/components/layout/sidebar.tsx')
  assert.ok(fonte.includes("href: '/content-studio'"), 'item não existe')
  assert.ok(fonte.includes("label: 'Content Studio'"))
  assert.ok(fonte.includes('Sparkles'), 'ícone lucide esperado')
  // O item é condicional (prop) e compartilha o MESMO caminho de render do NAV
  // (logo herda expandido/recolhido/mobile e estado ativo por startsWith).
  assert.ok(fonte.includes('showContentStudio ? [...NAV, CONTENT_STUDIO_ITEM] : NAV'),
    'item deve entrar apenas quando showContentStudio=true')
  // O NAV fixo NÃO contém o item — sem prop, nada de Content Studio no HTML.
  const navFixo = fonte.slice(fonte.indexOf('const NAV = ['), fonte.indexOf(']', fonte.indexOf('const NAV = [')))
  assert.ok(!navFixo.includes('/content-studio'), 'item não pode estar no NAV incondicional')
})

test('demais itens do menu permanecem intactos', () => {
  const fonte = ler('src/components/layout/sidebar.tsx')
  for (const href of ['/funnels', '/integrations', '/leads', '/templates', '/pages', '/mindmaps', '/agents', '/instagram', '/metrics', '/settings']) {
    assert.ok(fonte.includes(`'${href}'`), `item ${href} sumiu do NAV`)
  }
})

// ─── Proibições ─────────────────────────────────────────────────────────────

test('nenhuma allowlist/e-mail/UUID hardcoded chega ao cliente', () => {
  const fontes = [
    ler('src/components/layout/sidebar.tsx'),
    ler('src/components/layout/app-shell.tsx'),
    ler('src/app/(dashboard)/layout.tsx'),
    ler('src/lib/content-studio/nav-access.ts'),
  ]
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  for (const fonte of fontes) {
    assert.ok(!fonte.includes('NEXT_PUBLIC_CONTENT_STUDIO'), 'allowlist não pode ser NEXT_PUBLIC')
    assert.ok(!/NEXT_PUBLIC_[A-Z_]*USER_ID/.test(fonte), 'allowlist não pode ser NEXT_PUBLIC')
    assert.ok(!fonte.includes('@gmail.com'), 'e-mail pessoal hardcoded é proibido')
    assert.ok(!uuidRe.test(fonte), 'UUID hardcoded é proibido nas fontes de produção')
  }
})

test('rota /content-studio NÃO entrou em PUBLIC_PREFIXES', () => {
  const fonte = ler('src/proxy.ts')
  const bloco = fonte.slice(fonte.indexOf('PUBLIC_PREFIXES'), fonte.indexOf(']', fonte.indexOf('PUBLIC_PREFIXES')))
  assert.ok(!bloco.includes('content-studio'), 'a rota do painel não pode ser pública')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
