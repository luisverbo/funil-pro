// ============================================================================
// Comando "/" — o dono cala o agente pela própria conversa
// ----------------------------------------------------------------------------
// Cena real: um amigo mandou DM e o agente respondeu. O dono precisa assumir
// SEM abrir painel: responde a conversa começando com "/" (pelo WhatsApp ou
// pelo app do Instagram) e o agente sai; "/on" devolve.
//
// Trancado aqui:
//   1. o parser do comando: "/" pausa, "/on|/voltar|/agente|/ia" retomam,
//      mensagem normal não é comando
//   2. os DOIS webhooks tratam o eco da mensagem do dono (fromMe / is_echo)
//   3. conversa assumida = silêncio TOTAL do motor (nem despedida)
//   4. o motor não abre conversa NOVA por cima de uma assumida
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { comandoDoDono, conversaAssumidaPeloDono, MARCA_ASSUMIDA } from '@/lib/agents/comando'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  'qualquer mensagem começando com / pausa o agente': () => {
    for (const t of ['/', '/off', '/para', '/EU ASSUMO', '  /pausa  ']) {
      assert.equal(comandoDoDono(t), 'pausar', t)
    }
  },
  'os comandos de volta devolvem a conversa ao agente': () => {
    for (const t of ['/on', '/ON', '/voltar', '/agente', '/ia']) {
      assert.equal(comandoDoDono(t), 'retomar', t)
    }
  },
  'mensagem normal do dono não é comando': () => {
    for (const t of ['oi, aqui é o Luís', 'te respondo já', '50/50 fechado?', '', null, undefined]) {
      assert.equal(comandoDoDono(t as string | null), null, String(t))
    }
  },
  'a marca de assumida é reconhecida (e a de handoff normal não)': () => {
    assert.ok(conversaAssumidaPeloDono(MARCA_ASSUMIDA))
    assert.ok(!conversaAssumidaPeloDono('Lead solicitou atendimento humano'))
    assert.ok(!conversaAssumidaPeloDono(null))
  },

  'webhook do WhatsApp trata o comando na mensagem fromMe': () => {
    const src = ler('src/app/api/webhooks/evolution/[instanceId]/route.ts')
    assert.ok(src.includes('comandoDoDono'), 'fromMe com "/" precisa virar comando')
    assert.ok(/fromMe[\s\S]{0,900}handed_to_human/.test(src), 'pausar deve marcar a conversa como assumida')
    assert.ok(src.includes("agent_active: false"), 'o motor de funil também precisa calar')
  },
  'webhook do Instagram trata o comando no eco (is_echo)': () => {
    const src = ler('src/app/api/webhooks/instagram/route.ts')
    assert.ok(/is_echo[\s\S]{0,600}comandoDoDono/.test(src), 'eco com "/" precisa virar comando')
    assert.ok(/human_mode: cmd === 'pausar'/.test(src), 'o comando é atalho do human_mode do inbox')
    assert.ok(/eco nunca vira resposta/.test(src), 'eco jamais pode ser processado como fala do lead')
  },

  'motor: conversa assumida = silêncio total, sem despedida': () => {
    const src = ler('src/lib/agents/chat.ts')
    assert.ok(/conversaAssumidaPeloDono\(convOutcome\)[\s\S]{0,400}reply: ''/.test(src),
      'assumida pelo dono não pode receber nem o fecho educado')
  },
  'motor: não abre conversa nova por cima de uma assumida': () => {
    const src = ler('src/lib/agents/chat.ts')
    assert.ok(/\.in\('status', \['active', 'handed_to_human'\]\)/.test(src),
      'a busca por conversa existente precisa enxergar a assumida — senão nasce uma nova e o agente volta a falar')
    assert.ok(/existing\.status === 'active' \|\| conversaAssumidaPeloDono\(existing\.outcome_summary\)/.test(src),
      'handoff normal (lead pediu humano) mantém o comportamento antigo')
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
