// ============================================================================
// Atendimento ao vivo — o dono assume o chat web (e responde de lá)
// ----------------------------------------------------------------------------
// Pedido: "um painel onde eu posso atender se eu quiser ou interromper uma
// conversa e assumir no lugar do agente". O drawer de conversas ganhou
// Assumir/Devolver + campo de resposta; o navegador do visitante busca as
// mensagens do humano por polling (GET no endpoint público).
//
// Trancado aqui:
//   1. o GET público NUNCA entrega mensagens fora do modo humano (as
//      respostas do agente já chegam no POST — duplicar viraria eco)
//   2. assumir usa a MESMA marca do comando "/" — um estado só
//   3. devolver/responder exigem conversa assumida (não mexem em handoff
//      normal do lead)
//   4. entrega por canal: WhatsApp/Instagram saem na hora; web é só gravar
//   5. a landing só apende mensagem inédita (dedupe por id + cursor)
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { conversaAssumidaPeloDono, MARCA_ASSUMIDA, MARCA_ASSUMIDA_PAINEL } from '@/lib/agents/comando'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  'as duas marcas (comando / e painel) são o MESMO estado': () => {
    assert.ok(conversaAssumidaPeloDono(MARCA_ASSUMIDA))
    assert.ok(conversaAssumidaPeloDono(MARCA_ASSUMIDA_PAINEL))
    assert.ok(!conversaAssumidaPeloDono('Lead solicitou atendimento humano'))
  },

  'GET público só entrega mensagens no modo humano': () => {
    const src = ler('src/app/api/agents/public/[slug]/chat/route.ts')
    assert.ok(/humano = conv\.status === 'handed_to_human' && conversaAssumidaPeloDono/.test(src),
      'o modo humano precisa das duas condições')
    assert.ok(/if \(!humano\) return NextResponse\.json\(\{ humano: false, mensagens: \[\] \}\)/.test(src),
      'fora do modo humano a lista TEM que ser vazia — senão as respostas do agente duplicam na tela')
    assert.ok(/\.eq\('agent_id', agent\.id\)/.test(src),
      'a conversa precisa pertencer ao agente do slug — id de fora não abre')
  },

  'responder e devolver exigem conversa assumida pelo dono': () => {
    const src = ler('src/app/actions/ai-agents.ts')
    assert.ok(/devolverConversa[\s\S]{0,600}conversaAssumidaPeloDono/.test(src),
      'devolver não pode reativar um handoff que o LEAD pediu')
    assert.ok(/enviarMensagemHumana[\s\S]{0,900}Assuma a conversa antes/.test(src),
      'responder sem assumir deixaria dono e agente falando juntos')
  },

  'entrega por canal: WhatsApp e Instagram saem na hora': () => {
    const src = ler('src/app/actions/ai-agents.ts')
    assert.ok(/canal === 'whatsapp'[\s\S]{0,400}sendPartsViaWhatsApp/.test(src))
    assert.ok(/canal === 'instagram'[\s\S]{0,400}sendInstagramDM/.test(src))
  },

  'assumir também cala o motor de funil (agent_active=false)': () => {
    const src = ler('src/app/actions/ai-agents.ts')
    assert.ok(/assumirConversa[\s\S]{0,900}agent_active: false/.test(src))
  },

  'landing: polling com dedupe por id e cursor de tempo': () => {
    const src = ler('src/components/agent-landing/chat-landing.tsx')
    assert.ok(src.includes('vistosRef.current.has(m.id)'), 'sem dedupe a mesma mensagem aparece duas vezes')
    assert.ok(src.includes('cursorRef.current = new Date().toISOString()'),
      'o cursor começa no agora — o histórico já está na tela')
    assert.ok(/if \(parts\.length > 0\) await revealParts/.test(src),
      'POST vazio (modo humano) não pode virar balão em branco')
  },

  'drawer do dono: assumir, devolver e responder existem': () => {
    const src = ler('src/app/(dashboard)/agents/[id]/conversations/conversations-client.tsx')
    assert.ok(src.includes('Assumir conversa'))
    assert.ok(src.includes('Devolver ao agente'))
    assert.ok(src.includes('responderComoHumano'))
    assert.ok(/setInterval[\s\S]{0,400}getConversation/.test(src),
      'sem atualização automática o atendimento ao vivo não é ao vivo')
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
