// ============================================================================
// Multiatendimento: distribuição inteligente, departamentos e as travas
// ----------------------------------------------------------------------------
// Pedidos do dono, um a um:
//   1. distribuir por fila AUTOMATICAMENTE — e mais inteligente que rodízio:
//      afinidade (o lead volta para quem já o atendeu) vem antes de tudo
//   2. o atendente SÓ fecha a conversa com tag no lead (senão fica aberta)
//   3. departamentos (Vendas, Suporte, Financeiro…), cada um com seu modo
//   4. gestor interrompe/assume/atribui/transfere
//   5. jogar o lead numa automação específica (remarketing etc.)
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  escolherAtendente, modoDistribuicaoValido, podeResolver,
  type AtendenteFoto,
} from '@/lib/whatsapp-cloud/distribuicao'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const at = (id: string, abertas: number, ultima: string | null = null, ativo = true): AtendenteFoto =>
  ({ id, abertas, ultimaAtribuicaoAt: ultima, ativo })

const tests: Record<string, () => void> = {
  // ── A régua da distribuição ───────────────────────────────────────────────
  'AFINIDADE vence tudo: o lead volta para quem já o atendeu': () => {
    // Camila está lotada, mas o lead é dela — continuidade vende mais que fila justa.
    const escolhido = escolherAtendente(
      [at('camila', 9), at('rafael', 0)],
      'menos_ocupado',
      'camila',
    )
    assert.equal(escolhido, 'camila')
  },
  'afinidade com atendente que SAIU do time não vale': () => {
    const escolhido = escolherAtendente([at('rafael', 2)], 'menos_ocupado', 'camila')
    assert.equal(escolhido, 'rafael')
  },
  'menos_ocupado: quem tem menos conversas abertas recebe': () => {
    assert.equal(escolherAtendente([at('a', 5), at('b', 1), at('c', 3)], 'menos_ocupado'), 'b')
  },
  'menos_ocupado empatado desempata pelo rodízio': () => {
    const escolhido = escolherAtendente(
      [at('a', 2, '2026-08-27T10:00:00Z'), at('b', 2, '2026-08-27T08:00:00Z')],
      'menos_ocupado',
    )
    assert.equal(escolhido, 'b', 'quem recebeu há mais tempo é o próximo')
  },
  'rodízio: quem nunca recebeu é o primeiro da fila': () => {
    assert.equal(
      escolherAtendente([at('a', 0, '2026-08-27T10:00:00Z'), at('novato', 0, null)], 'rodizio'),
      'novato',
    )
  },
  'manual: ninguém recebe — o gestor distribui': () => {
    assert.equal(escolherAtendente([at('a', 0)], 'manual'), null)
  },
  'sem atendente ativo, ninguém recebe (fila do gestor)': () => {
    assert.equal(escolherAtendente([at('a', 0, null, false)], 'rodizio'), null)
    assert.equal(escolherAtendente([], 'rodizio'), null)
  },
  'modos válidos são a lista fechada': () => {
    for (const m of ['manual', 'rodizio', 'menos_ocupado']) assert.ok(modoDistribuicaoValido(m))
    assert.ok(!modoDistribuicaoValido('aleatorio'))
  },

  // ── Trava de tag ──────────────────────────────────────────────────────────
  'resolver sem tag é RECUSADO com recado': () => {
    const r = podeResolver([])
    assert.ok(!r.ok)
    assert.ok(!r.ok && /tag/i.test(r.motivo))
    const r2 = podeResolver(['  '])
    assert.ok(!r2.ok, 'tag em branco não classifica nada')
    assert.ok(podeResolver(['vendido']).ok)
  },
  'a trava vale no SERVIDOR, não só na tela': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(/status === 'resolvida'[\s\S]{0,400}podeResolver/.test(src),
      'sem a trava no servidor, bastaria chamar a action na mão')
  },

  // ── Departamentos + webhook ───────────────────────────────────────────────
  'migration: departamentos, papel de gestor e departamento padrão da conta': () => {
    const sql = ler('supabase/migrations/20260906000000_wa_departamentos.sql').toLowerCase()
    assert.ok(sql.includes('wa_departamentos'))
    assert.ok(sql.includes("papel text not null default 'atendente'"))
    assert.ok(sql.includes('departamento_padrao_id'))
    assert.ok(sql.includes('ultima_atribuicao_at'), 'sem a marca do rodízio a fila não gira')
  },
  'webhook distribui a conversa NOVA (afinidade + modo do departamento)': () => {
    const src = ler('src/app/api/webhooks/meta-wa/route.ts')
    assert.ok(src.includes('escolherAtendente'), 'a distribuição precisa usar a régua testada')
    assert.ok(src.includes('departamento_padrao_id'), 'a conversa nova cai no departamento padrão da conta')
    assert.ok(src.includes('ultima_atribuicao_at'), 'atribuir precisa girar o rodízio')
    assert.ok(/anteriores\?\.\[0\]\?\.atendente_id/.test(src), 'a afinidade lê quem já atendeu este telefone')
  },
  'gestor: atribuir, transferir (transferir devolve à fila) e automação': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(src.includes('atribuirWaConversa'))
    assert.ok(/transferirWaDepartamento[\s\S]{0,600}atendente_id: null/.test(src),
      'trocar de departamento tem que devolver à fila — o atendente antigo é de outro time')
    assert.ok(src.includes('enrollLeadsInFunnel'), 'a automação usa o MESMO motor dos leads')
    assert.ok(/enviarParaAutomacao[\s\S]{0,900}casar_leads_por_contato/.test(src),
      'antes de criar lead novo, casa pelo telefone — senão duplica')
  },
  'a tela tem os controles: quem sou eu, fila do atendente, ⚡ automação': () => {
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(ui.includes('👑 Gestor · vendo tudo'), 'sem o seletor, todo mundo vê tudo')
    assert.ok(/souGestor[\s\S]{0,300}atendenteId === euSou/.test(ui),
      'o atendente só pode ver a própria fila + as sem dono do departamento dele')
    assert.ok(ui.includes('Jogar em automação'), 'falta o modal de automação')
    assert.ok(ui.includes('Equipe e departamentos'), 'falta a gestão da equipe')
  },
  // ── Mídia, catálogo e a fila Esperando ────────────────────────────────────
  'mídia: só os formatos que a Cloud API aceita, com limite por tipo': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(src.includes("'image/jpeg'"), 'imagem jpeg precisa entrar')
    assert.ok(src.includes("'video/mp4'"), 'vídeo mp4 precisa entrar')
    assert.ok(src.includes("'audio/ogg'"), 'áudio ogg precisa entrar')
    assert.ok(src.includes("'application/pdf'"), 'documento pdf precisa entrar')
    assert.ok(src.includes('não é aceito pelo WhatsApp'), 'formato recusado precisa de recado claro')
    assert.ok(/enviarWaMidiaMsg[\s\S]{0,400}dentroDaJanela/.test(src),
      'mídia também respeita a janela de 24h')
  },
  'catálogo: visibilidade por departamento e envio com legenda pronta': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(src.includes('listarWaProdutos'))
    assert.ok(src.includes('departamento_id: entrada.departamentoId ?? null'),
      'NULL = toda a equipe; preenchido = só quem vende')
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(/pr\.departamentoId === eu\?\.departamentoId/.test(ui),
      'atendente só vê os produtos liberados para o departamento dele')
    assert.ok(ui.includes('enviarMidiaProduto'), 'a foto do produto sai com UM clique')
    assert.ok(/nome e preço na legenda/.test(ui), 'a legenda pronta é o valor da feature')
  },
  'composer: 📎 anexos e 📦 catálogo existem; bolha mostra a mídia': () => {
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(ui.includes('anexarEEnviar'), 'falta o envio de anexos')
    assert.ok(ui.includes("m.tipo === 'imagem'"), 'imagem precisa renderizar na bolha')
    assert.ok(ui.includes("m.tipo === 'audio'"), 'áudio precisa de player na bolha')
    assert.ok(ui.includes("m.tipo === 'documento'"), 'documento precisa de link na bolha')
  },
  'fila ⏳ Esperando: aberta, sem dono e sem IA cuidando': () => {
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(/\['esperando', '⏳/.test(ui), 'falta a aba de quem ninguém atendeu')
    assert.ok(/!c\.atendenteId && c\.modo !== 'ia'/.test(ui),
      'conversa com IA cuidando NÃO está esperando — o agente está atendendo')
  },
  'migration: media_url e catálogo wa_produtos': () => {
    const sql = ler('supabase/migrations/20260907000000_wa_midia_produtos.sql').toLowerCase()
    assert.ok(sql.includes('media_url'))
    assert.ok(sql.includes('wa_produtos'))
    assert.ok(sql.includes('departamento_id'), 'a visibilidade por departamento vive no banco')
  },
  // ── 🔥 Quentes: do funil direto para o chat ───────────────────────────────
  'leads quentes do quiz e do agente aparecem no inbox para atender': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(src.includes('listarLeadsQuentes'))
    assert.ok(/in\('status', \['qualified', 'scheduled', 'sold', 'routed_to_funnel'\]\)/.test(src),
      'do agente, só quem atingiu o objetivo é quente')
    assert.ok(src.includes('jaNoChat'), 'quem já está no chat não pode aparecer de novo')
    assert.ok(src.includes('foneParaMeta'), 'o telefone precisa sair no formato da Meta (DDI 55)')
  },
  'atender cria a conversa SEM janela — o composer cai nos templates': () => {
    const src = ler('src/app/actions/wa-inbox.ts')
    assert.ok(/iniciarWaConversa[\s\S]{0,2600}janela_ate: null/.test(src),
      'lead que nunca mandou mensagem só pode receber template — a Meta exige')
    assert.ok(/iniciarWaConversa[\s\S]{0,900}existente/.test(src),
      'conversa existente reabre em vez de duplicar')
    const ui = ler('src/app/(dashboard)/whatsapp/whatsapp-client.tsx')
    assert.ok(ui.includes("'🔥 Quentes'"), 'falta a aba de leads quentes')
    assert.ok(ui.includes('atenderQuente'), 'falta o botão Atender')
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
