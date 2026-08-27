// ============================================================================
// Multiatendimento WhatsApp (API oficial) — Etapas W1+W2 do plano
// ----------------------------------------------------------------------------
// O que se tranca aqui:
//   1. o parser do webhook da Meta lê mensagens/status do envelope real
//   2. a janela de 24h: renova com a msg do LEAD e decide texto x template
//   3. o webhook roteia por phone_number_id, deduplica por wamid e a IA de
//      plantão responde pelo canal 'cloud' (Evolution NUNCA entra)
//   4. enviar manual ASSUME a conversa (modo humano)
//   5. Vendido no inbox fecha o lead nos portais pelo caminho do Mercos
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { lerWebhookCloud, novaJanela, dentroDaJanela } from '@/lib/whatsapp-cloud/webhook-parser'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

// Envelope REAL da Cloud API (formato documentado da Meta).
const ENVELOPE = {
  object: 'whatsapp_business_account',
  entry: [{
    id: '102290129340398',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '5521999990000', phone_number_id: '106540352242922' },
        contacts: [{ profile: { name: 'Lucas Lima' }, wa_id: '5521980120036' }],
        messages: [{
          from: '5521980120036',
          id: 'wamid.HBgLNTUyMTk4MDEyMDAzNhUCABIYFjNFQjBEMUZFQjNGRjk1RkE1NkZCRUEA',
          timestamp: '1756300000',
          type: 'text',
          text: { body: 'Oi, quero saber do serviço' },
        }],
      },
    }],
  }],
}

const tests: Record<string, () => void> = {
  'parser lê a mensagem do envelope real da Meta': () => {
    const r = lerWebhookCloud(ENVELOPE)
    assert.equal(r.mensagens.length, 1)
    const m = r.mensagens[0]
    assert.equal(m.phoneNumberId, '106540352242922')
    assert.equal(m.de, '5521980120036')
    assert.equal(m.nome, 'Lucas Lima')
    assert.equal(m.corpo, 'Oi, quero saber do serviço')
    assert.equal(m.tipo, 'texto')
  },
  'parser lê status de entrega (✓✓ de verdade)': () => {
    const r = lerWebhookCloud({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '106540352242922' },
        statuses: [{ id: 'wamid.X', status: 'read', timestamp: '1756300100' }],
      } }] }],
    })
    assert.equal(r.statuses.length, 1)
    assert.equal(r.statuses[0].status, 'read')
  },
  'mídia vira descrição legível, nunca corpo vazio mudo': () => {
    const r = lerWebhookCloud({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'x' },
        messages: [
          { from: '55219', id: 'w1', type: 'audio', audio: {} },
          { from: '55219', id: 'w2', type: 'document', document: { filename: 'orcamento.pdf' } },
        ],
      } }] }],
    })
    assert.equal(r.mensagens[0].corpo, '[🎙 áudio]')
    assert.ok(r.mensagens[1].corpo.includes('orcamento.pdf'))
  },
  'payload estranho não derruba nada': () => {
    assert.deepEqual(lerWebhookCloud(null), { mensagens: [], statuses: [] })
    assert.deepEqual(lerWebhookCloud({ object: 'x' }), { mensagens: [], statuses: [] })
  },

  'janela de 24h: nasce da mensagem do lead e decide texto x template': () => {
    const ts = 1_756_300_000
    const fim = novaJanela(ts)
    assert.equal(new Date(fim).getTime(), ts * 1000 + 24 * 3600 * 1000)
    assert.ok(dentroDaJanela(fim, new Date(ts * 1000 + 23 * 3600 * 1000)), '23h depois ainda dá texto')
    assert.ok(!dentroDaJanela(fim, new Date(ts * 1000 + 25 * 3600 * 1000)), '25h depois é só template')
    assert.ok(!dentroDaJanela(null, new Date()), 'sem janela nunca é texto livre')
  },

  'webhook: roteia por phone_number_id, deduplica por wamid, assina': () => {
    const src = ler('src/app/api/webhooks/meta-wa/route.ts')
    assert.ok(src.includes("eq('phone_number_id', m.phoneNumberId)"), 'o roteamento até o tenant é pelo número')
    assert.ok(src.includes("eq('wamid', m.wamid)"), 'a Meta REENVIA — sem dedupe, mensagem duplica')
    assert.ok(src.includes('x-hub-signature-256'), 'POST sem assinatura validada é porta aberta')
    assert.ok(src.includes("hub.verify_token"), 'sem o GET de verificação a Meta não aceita o webhook')
  },
  'IA de plantão responde pelo canal cloud — Evolution NUNCA entra': () => {
    const src = ler('src/app/api/webhooks/meta-wa/route.ts')
    assert.ok(src.includes("channel: 'cloud'"), 'canal errado dispararia o Evolution em dobro')
    assert.ok(src.includes('enviarTextoCloud'), 'a resposta da IA sai pela própria Cloud API')
    const motor = ler('src/lib/agents/chat.ts')
    assert.ok(motor.includes("| 'cloud'"), 'o motor precisa conhecer o canal cloud')
    assert.ok(/isWhatsapp = channel === 'whatsapp'/.test(motor),
      "cloud NÃO pode contar como isWhatsapp — é o que impede o envio duplo")
  },

  'enviar manual ASSUME a conversa e respeita a janela': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(/dentroDaJanela[\s\S]{0,200}foraDaJanela: true/.test(src),
      'fora da janela o erro precisa dizer que é caso de template')
    assert.ok(/modo: 'humano'/.test(src), 'responder na mão tira a IA do caminho')
  },
  'Vendido no inbox fecha o lead nos portais pelo caminho do Mercos': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(src.includes('aplicarDesfecho'), 'uma autoridade só para "a venda aconteceu"')
    assert.ok(src.includes('valorVendaValido'), 'valor da rede precisa da mesma validação')
    assert.ok(src.includes("tags.add('vendido')"), 'a tag vendido marca a conversa')
  },
  'inbox: janela vira UX (templates), "/" abre respostas rápidas, dossiê existe': () => {
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(ui.includes('Janela de 24h fechada'), 'fora da janela o composer troca para templates')
    assert.ok(ui.includes("texto.startsWith('/')"), 'o atalho "/" precisa abrir as respostas rápidas')
    assert.ok(ui.includes('Dossiê do lead'), 'o dossiê é o diferencial do inbox')
    assert.ok(ui.includes('Quizzes respondidos'), 'o dossiê mostra o quiz')
    assert.ok(ui.includes('Conversas com agente IA'), 'o dossiê mostra o agente')
  },
  'migration do inbox existe e a sidebar mostra o WhatsApp': () => {
    const sql = ler('supabase/migrations/20260905000000_whatsapp_cloud.sql').toLowerCase()
    for (const t of ['wa_accounts', 'wa_conversations', 'wa_messages', 'wa_respostas_rapidas']) {
      assert.ok(sql.includes(t), `falta a tabela ${t}`)
    }
    assert.ok(ler('src/components/layout/sidebar.tsx').includes("'/whatsapp'"))
  },
  'modo demonstração: dá para ver o inbox sem conectar a Meta, sem tocar o banco': () => {
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(ui.includes('Ver demonstração'), 'sem o botão, o dono só vê a ferramenta depois da burocracia da Meta')
    assert.ok(ui.includes('nada aqui é real e nada é salvo'), 'a faixa precisa avisar que é demonstração')
    assert.ok(/if \(demo\) return/.test(ui), 'ações em demo não podem chamar o servidor')
    assert.ok(/startsWith\('demo-'\)/.test(ui), 'conversa de demonstração não pode ir ao banco')
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
