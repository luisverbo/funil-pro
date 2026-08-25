// ============================================================================
// Agente: o lead deixa de ser "Anônimo"
// ----------------------------------------------------------------------------
// Defeito relatado: em toda conversa a pessoa digita o nome quando a Ana
// pergunta, e mesmo assim o painel de conversas mostra "Anônimo".
//
// Causa raiz (confirmada no banco): `leads.funnel_id` era NOT NULL, mas o
// agente standalone (e o quiz, e o Instagram) cria lead SEM funil — mandava
// `funnel_id: null`. O insert falhava, o erro era engolido, a conversa ficava
// com `lead_id` nulo e o painel caía no rótulo "Anônimo". Nenhuma conversa do
// banco tinha lead ligado, nem as em que o nome estava escrito na tela.
//
// Este teste tranca as duas pontas:
//   1. a migration que solta o NOT NULL existe (sem ela o insert volta a falhar)
//   2. o nome é deduzido do transcript — rede de segurança do painel, que
//      também recupera as conversas antigas já gravadas sem lead
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { nomeNoTranscript, extractContact } from '@/lib/agents/contato'

const RAIZ = process.cwd()

const tests: Record<string, () => void> = {
  'migration solta o NOT NULL de leads.funnel_id': () => {
    const dir = join(RAIZ, 'supabase/migrations')
    const sql = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(join(dir, f), 'utf8'))
      .join('\n')
      .toLowerCase()
    const soltou = /alter\s+column\s+funnel_id\s+drop\s+not\s+null/.test(sql)
    assert.ok(soltou, 'nenhuma migration solta o NOT NULL de leads.funnel_id — lead sem funil volta a falhar calado')
  },

  'insert de lead sem funil nunca engole o erro': () => {
    const src = readFileSync(join(RAIZ, 'src/lib/agents/chat.ts'), 'utf8')
    const inserts = src.split("from('leads').insert(").slice(1)
    assert.ok(inserts.length >= 2, 'esperava os inserts de lead do agente')
    for (const trecho of inserts) {
      const cabeca = src.slice(0, src.indexOf(trecho))
      const linha = cabeca.slice(cabeca.lastIndexOf('const'))
      assert.ok(/error:/.test(linha), 'insert de lead sem checar erro: falha volta a ser invisível')
    }
  },

  'nome digitado depois da pergunta vira o nome do lead': () => {
    const nome = nomeNoTranscript([
      { role: 'lead', content: 'Sim' },
      { role: 'agent', content: 'Show!\nAntes de mais nada, com quem eu falo? Como é seu nome?' },
      { role: 'lead', content: 'Rodrigo' },
      { role: 'agent', content: 'Prazer, Rodrigo! Que empresa é a sua?' },
      { role: 'lead', content: 'Clínica odontológica' },
    ])
    assert.equal(nome, 'Rodrigo')
  },

  'auto-apresentação no meio da conversa também conta': () => {
    const nome = nomeNoTranscript([
      { role: 'agent', content: 'Oi! Como posso ajudar?' },
      { role: 'lead', content: 'meu nome é luis carlos, quero saber do tráfego' },
    ])
    assert.equal(nome, 'Luis Carlos')
  },

  'sem nenhuma fala do lead não inventa nome': () => {
    assert.equal(nomeNoTranscript([{ role: 'agent', content: 'Com quem eu falo?' }]), null)
  },

  'resposta que não é nome não vira nome': () => {
    const nome = nomeNoTranscript([
      { role: 'agent', content: 'Com quem eu falo?' },
      { role: 'lead', content: 'menos de 5 mil' },
    ])
    assert.equal(nome, null)
  },

  'telefone e e-mail continuam saindo do que o lead digitou': () => {
    const c = extractContact(
      ['pode me chamar no 11 98888-7777', 'meu email é Luis@Empresa.com.br'],
      [],
      '',
      null,
    )
    assert.equal(c.phone, '11988887777')
    assert.equal(c.email, 'luis@empresa.com.br')
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
