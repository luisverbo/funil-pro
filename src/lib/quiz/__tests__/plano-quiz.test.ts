// ============================================================================
// Plano QUIZ — vender só o quiz
// ----------------------------------------------------------------------------
// O dono anuncia o quiz como produto avulso (anúncios + YouTube). Quem compra
// entra num FunilPro enxuto: Páginas (só quiz) e Configurações. Aqui se
// tranca a régua de acesso e as costuras (menu, gate, login, cadastro,
// onboarding, admin) — o plano é UMA regra pura usada em todo lugar.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PLANOS, planoValido, rotuloPlano, rotaPermitida, homeDoPlano,
  tiposDePaginaDoPlano, planoDoLinkDeVenda,
} from '@/lib/planos/acesso'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  // ── A régua ───────────────────────────────────────────────────────────────
  'quiz é um plano válido; lixo não é': () => {
    assert.ok(PLANOS.includes('quiz'))
    assert.ok(planoValido('quiz'))
    assert.ok(!planoValido('enterprise'))
    assert.equal(rotuloPlano('quiz'), 'Quiz')
  },
  'plano quiz enxerga só Páginas, editor do quiz e Configurações': () => {
    for (const r of ['/pages', '/pages/x', '/quiz-editor/abc', '/settings']) {
      assert.ok(rotaPermitida('quiz', r), `${r} tinha que abrir`)
    }
    for (const r of ['/funnels', '/agents', '/whatsapp', '/leads', '/instagram', '/metrics', '/trafego', '/integrations', '/templates', '/mindmaps']) {
      assert.ok(!rotaPermitida('quiz', r), `${r} NÃO pode abrir no plano quiz`)
    }
  },
  'prefixo não vaza: /pagesX não é /pages': () => {
    assert.ok(!rotaPermitida('quiz', '/pagesfake'))
  },
  'planos completos veem tudo': () => {
    for (const p of ['starter', 'pro', 'scale', null, undefined]) {
      assert.ok(rotaPermitida(p, '/agents'))
      assert.ok(rotaPermitida(p, '/whatsapp'))
    }
  },
  'home do plano: quiz cai nas Páginas, os outros nos Funis': () => {
    assert.equal(homeDoPlano('quiz'), '/pages')
    assert.equal(homeDoPlano('starter'), '/funnels')
    assert.equal(homeDoPlano(undefined), '/funnels')
  },
  'plano quiz só cria quiz; os outros criam tudo': () => {
    assert.deepEqual(tiposDePaginaDoPlano('quiz'), ['interactive'])
    assert.equal(tiposDePaginaDoPlano('pro'), null)
  },
  'link de venda: só "quiz" é aceito — ninguém vira Scale por URL': () => {
    assert.equal(planoDoLinkDeVenda('quiz'), 'quiz')
    assert.equal(planoDoLinkDeVenda('scale'), null)
    assert.equal(planoDoLinkDeVenda('pro'), null)
    assert.equal(planoDoLinkDeVenda(undefined), null)
  },

  // ── Costuras ──────────────────────────────────────────────────────────────
  'banco aceita o plano quiz (migration versionada)': () => {
    const sql = ler('supabase/migrations/20260915000000_plano_quiz.sql')
    assert.ok(/CHECK \(plan IN \('starter', 'pro', 'scale', 'quiz'\)\)/.test(sql))
  },
  'layout lê o plano no servidor e o shell faz o gate de rota': () => {
    const layout = ler('src/app/(dashboard)/layout.tsx')
    assert.ok(layout.includes("select('plan')"), 'o plano vem do servidor, não do cliente')
    assert.ok(layout.includes('plan={plan}'))
    const shell = ler('src/components/layout/app-shell.tsx')
    assert.ok(shell.includes('rotaPermitida(plan, pathname)'), 'rota fora do plano precisa ser barrada')
    assert.ok(shell.includes('router.replace(homeDoPlano(plan))'), 'e devolvida para a home do plano')
    assert.ok(/permitida \? children/.test(shell), 'conteúdo fora do plano não pode nem piscar')
  },
  'sidebar mostra só o que o plano enxerga': () => {
    const sb = ler('src/components/layout/sidebar.tsx')
    assert.ok(sb.includes('NAV.filter(item => rotaPermitida(plan, item.href))'))
    assert.ok(sb.includes('[...navVisivel, CONTENT_STUDIO_ITEM] : navVisivel'), 'o render precisa usar a lista filtrada')
  },
  'login e onboarding levam à home do plano': () => {
    assert.ok(ler('src/app/actions/auth.ts').includes('redirect(homeDoPlano('))
    assert.ok(ler('src/app/actions/onboarding.ts').includes('redirect(homeDoPlano(plan))'))
  },
  'link de venda ?plano=quiz percorre cadastro → metadata → tenant no plano quiz': () => {
    assert.ok(ler('src/app/(auth)/register/page.tsx').includes("plano === 'quiz'"))
    assert.ok(ler('src/app/(auth)/register/register-form.tsx').includes('name="plano"'))
    const auth = ler('src/app/actions/auth.ts')
    assert.ok(auth.includes("planoDoLinkDeVenda(formData.get('plano'))"), 'só quiz passa')
    assert.ok(auth.includes('plano_desejado'))
    const onb = ler('src/app/actions/onboarding.ts')
    assert.ok(onb.includes('user_metadata?.plano_desejado'))
    assert.ok(/insert\(\{ name: businessName, slug, plan \}\)/.test(onb), 'o tenant nasce no plano pedido')
  },
  'admin troca para quiz e a action recusa plano inválido': () => {
    assert.ok(ler('src/app/admin/tenants/tenant-actions.tsx').includes("'quiz'"))
    assert.ok(ler('src/app/actions/admin.ts').includes('planoValido(plan)'))
  },
  'Páginas: no plano quiz só o tipo Quiz existe e o modal pula a escolha': () => {
    const pc = ler('src/app/(dashboard)/pages/pages-client.tsx')
    assert.ok(pc.includes('tiposDePaginaDoPlano(plan)'))
    assert.ok(pc.includes('tiposVisiveis.map('), 'o catálogo do modal precisa ser o filtrado')
    assert.ok(pc.includes("setStep(soQuiz ? 2 : 1)"), 'com um tipo só, escolher tipo é etapa vazia')
    assert.ok(ler('src/app/(dashboard)/pages/page.tsx').includes('plan={(tenant?.plan as string)'))
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
