// ============================================================================
// Estúdio IA — trava contra o 500 de 29/10 (pós-Fase 5): as rotas do painel
// (/api/estudio), do robô (/api/cron/estudio-producao) e do webhook do
// WhatsApp (/api/webhooks/meta-wa) NÃO podem quebrar ao carregar o módulo.
//  1) importam sem GEMINI_API_KEY no ambiente;
//  2) nenhum import ESTÁTICO a partir delas chega a um pacote nativo (sharp):
//     ele só pode entrar por import() dentro da função que trata imagem.
// ============================================================================
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const RAIZ = process.cwd()
const NATIVOS = ['sharp']

function resolver(de: string, alvo: string): string | null {
  const base = alvo.startsWith('@/') ? join(RAIZ, 'src', alvo.slice(2)) : alvo.startsWith('.') ? resolve(dirname(de), alvo) : null
  if (!base) return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c) && !c.endsWith('/')) { try { readFileSync(c); return c } catch { /* diretório */ } }
  return null
}

/** Pacotes alcançados só por `import … from` / `export … from` estáticos (ignora `import type` e `import()`). */
function pacotesEstaticos(entrada: string): { pacotes: Map<string, string>; arquivos: number } {
  const vistos = new Set<string>(); const pacotes = new Map<string, string>(); const fila = [entrada]
  while (fila.length) {
    const arq = fila.pop()!
    if (vistos.has(arq)) continue
    vistos.add(arq)
    const src = readFileSync(arq, 'utf8')
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      const alvo = m[1]
      const r = resolver(arq, alvo)
      if (r) fila.push(r)
      else if (!alvo.startsWith('.') && !alvo.startsWith('@/')) pacotes.set(alvo.split('/')[0].startsWith('@') ? alvo.split('/').slice(0, 2).join('/') : alvo.split('/')[0], arq.replace(RAIZ + '/', ''))
    }
  }
  return { pacotes, arquivos: vistos.size }
}

const ROTAS = ['src/app/api/estudio/route.ts', 'src/app/api/cron/estudio-producao/route.ts', 'src/app/api/webhooks/meta-wa/route.ts']

const tests: Record<string, () => void | Promise<void>> = {
  'nenhum pacote nativo no carregamento das rotas do estúdio (só por import() dentro da função)': () => {
    for (const rota of ROTAS) {
      const { pacotes, arquivos } = pacotesEstaticos(join(RAIZ, rota))
      assert.ok(arquivos > 1, `${rota}: varredura não seguiu os imports`)
      for (const n of NATIVOS) assert.ok(!pacotes.has(n), `${rota} carrega '${n}' no import (via ${pacotes.get(n)}) — use import() dentro da função`)
    }
  },
  'sharp continua disponível para a entrega, por import() sob demanda': () => {
    const sv = readFileSync(join(RAIZ, 'src/lib/estudio/producao-servidor.ts'), 'utf8')
    assert.ok(!/^import sharp/m.test(sv))
    assert.ok(sv.includes("await import('sharp')"))
    const cfg = readFileSync(join(RAIZ, 'next.config.ts'), 'utf8')
    assert.ok(cfg.includes("'/api/cron/estudio-producao'") && cfg.includes('@img/sharp-linux-x64'), 'binário Linux do sharp vai junto no deploy')
  },
  'pagamento não depende da fila carregar: entrarNaFila protegido por try/catch': () => {
    const px = readFileSync(join(RAIZ, 'src/lib/estudio/pix-servidor.ts'), 'utf8')
    const trecho = px.slice(px.indexOf("await import('./producao-servidor')") - 200, px.indexOf("await import('./producao-servidor')"))
    assert.ok(/try \{\s*$/.test(trecho.trimEnd()) || trecho.includes('try {'), 'import da fila dentro de try')
  },
  'rotas importam sem GEMINI_API_KEY (e sem chave da Anthropic)': async () => {
    const g = process.env.GEMINI_API_KEY, a = process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY
    try {
      const painel = await import('@/app/api/estudio/route')
      assert.equal(typeof painel.POST, 'function')
      const cron = await import('@/app/api/cron/estudio-producao/route')
      assert.equal(typeof cron.GET, 'function'); assert.equal(typeof cron.POST, 'function')
      const prod = await import('@/lib/estudio/producao-servidor')
      assert.equal(typeof prod.rodadaDeProducao, 'function')
    } finally {
      if (g !== undefined) process.env.GEMINI_API_KEY = g
      if (a !== undefined) process.env.ANTHROPIC_API_KEY = a
    }
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
