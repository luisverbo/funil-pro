import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/evolution'
import { isSchedulingEnabled, getAvailableSlots, bookMeeting, googleCalendarLink, slotLabel, type SchedulingConfig, type Slot } from '@/lib/agents/scheduling'

const ACTION_DELIM_RE = /\|\|\|ACTION:(\{[\s\S]*?\})\|\|\|/
// Sonnet por padrão: agente de vendas precisa de raciocínio de conversa muito melhor
// que o Haiku entrega. Pode voltar ao Haiku via env AGENT_MODEL para cortar custo.
const ANTHROPIC_MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-5'

interface AgentRow {
  id: string
  tenant_id: string
  name: string
  status: string
  objective: string
  product_name: string | null
  product_description: string | null
  product_price_cents: number | null
  product_prices: { id: string; label: string; value_cents: number }[] | null
  product_page_url: string | null
  tone_of_voice: string | null
  greeting_message: string | null
  qualification_rules: string | null
  objection_handling: string | null
  payment_link: string | null
  target_funnel_id: string | null
  max_messages_per_conversation: number | null
  handoff_to_human_keywords: string[] | null
  business_hours_only: boolean | null
  business_hours_start: string | null
  business_hours_end: string | null
  whatsapp_instance_id: string | null
  max_activations_per_month: number | null
  activations_used: number
  activations_reset_at: string | null
  scheduling_config: SchedulingConfig | null
}

export interface AgentChatResult {
  reply: string
  parts: string[]
  action: { type: string; data: Record<string, unknown> }
  conversationId: string
  choices?: string[]   // opções de resposta rápida (botões no chat web)
}

function objectiveInstructions(agent: AgentRow): string {
  const checkout = agent.payment_link ? `\nLink de pagamento (envie quando o lead demonstrar interesse em comprar): ${agent.payment_link}` : ''
  const page = agent.product_page_url ? `\nLink da página do produto (envie quando o lead pedir mais detalhes): ${agent.product_page_url}` : ''
  switch (agent.objective) {
    case 'sell_direct':
      return `VENDER o produto nesta conversa, no estilo de um vendedor consultivo de elite: você CONDUZ o lead até a compra fazendo perguntas certeiras e curtas — o lead fala, você guia. Quem fala demais perde a venda.

Roteiro de condução (um degrau por mensagem, nunca pule para o pitch completo):
1. SITUAÇÃO — descubra em 1 pergunta curta como o lead lida com o problema hoje. (ex: "hoje você faz isso na mão?")
2. DOR → NÚMERO — transforme a dor em custo concreto com UMA pergunta que faz o LEAD dizer o prejuízo. (ex: "quantos te pagam atrasado por mês?" / "quanto tempo isso te toma?"). Quando o lead verbaliza o custo, ele se convence sozinho.
3. SOLUÇÃO EM DOSE ÚNICA — responda com O benefício que resolve exatamente o que ele acabou de dizer, em 1-2 frases. NÃO liste todos os recursos; guarde os outros para as objeções. Termine puxando o próximo passo com pergunta curta. (ex: "quer ver quanto custa?")
4. PREÇO — direto, sem enrolar, ancorado no número que o LEAD falou no passo 2. (ex: "R$ X por mês — menos que 1 mensalidade que você recupera dos atrasados")
5. FECHAMENTO — pergunta de fechamento simples ("te mando o link?"). Lead topou → envie o link de pagamento IMEDIATAMENTE e nada mais.${checkout}${page}

Regras de ouro:
- CONDUZA COM PERGUNTAS: praticamente toda mensagem sua termina com UMA pergunta curta que puxa o lead um degrau adiante no roteiro. Pergunta que não avança a venda é proibida.
- FALE POUCO: sua mensagem deve ser MENOR que a fala de um vendedor no balcão. Se você escreveu 3 frases num balão, corte uma.
- UM benefício por mensagem, sempre amarrado ao que o lead ACABOU de dizer — nada de despejar a lista completa de recursos de uma vez.
- Use os números que o lead deu ("com seus 10 clientes...") — personalização vende.
- Se o lead pedir informação direta (preço, diferença de planos, como funciona), responda NA HORA de forma completa e curta, e termine com pergunta de avanço.
- Objeção = empatia (1 frase) + resposta (1 frase) + pergunta de fechamento.
- Depois que o lead disser SIM, pare de vender: link + 1 frase de apoio, nada mais.
- Quando o lead confirmar a compra ou disser que vai pagar, marque action "sell".

Sinais de compra — quando aparecerem, PULE direto para preço/fechamento (não volte ao roteiro):
"quanto custa", "como pago", "tem desconto", "aceita pix/cartão", "quero", "me manda o link", perguntas sobre prazo/garantia/entrega. Quem pergunta preço está comprando — responda o preço e feche.

Playbook de objeções (empatia 1 frase + resposta 1 frase + pergunta de fechamento):
- "tá caro" → nunca defenda o preço; volte ao custo que o LEAD falou e compare. "te custa mais ficar como está, né? quer começar pelo plano X?"
- "vou pensar" → destrave o medo real: "claro! só me diz: é o valor ou ficou alguma dúvida de como funciona?"
- "preciso falar com esposa/sócio" → concorde e facilite: "faz sentido. te mando um resumo pra você mostrar?"
- "depois eu vejo" → crie razão para agora (bônus, condição, agenda) SEM inventar escassez falsa.
- Objeção repetida 2x = não insista pela mesma porta; ofereça alternativa (plano menor, garantia, falar com humano).${agent.objection_handling ? `\n\nComo contornar objeções ESPECÍFICAS deste produto (prioridade sobre o playbook):\n${agent.objection_handling}` : ''}`
    case 'route_to_funnel':
      return `Entender rapidamente a necessidade do lead e encaminhá-lo ao funil certo — como uma recepcionista experiente que resolve na hora, não um menu de URA.

Método:
1. Se o lead pedir informação, entregue a informação primeiro — nunca responda pergunta com pergunta.
2. Identifique a necessidade dele em NO MÁXIMO 2 perguntas (uma por mensagem, sempre entregando valor junto).
3. Assim que entender o caso, confirme em uma frase natural ("ah, então seu caso é X") e encaminhe — marque action "route".
4. Se o lead claramente não é o público do produto, seja honesto e gentil — não empurre.
Não prolongue a conversa: seu sucesso é encaminhar rápido e bem, não conversar muito.${page}`
    case 'qualify':
    default:
      return `Qualificar o lead como um consultor de elite: ele deve terminar a conversa sentindo que GANHOU algo, sem perceber que foi qualificado.

Método:
1. Se o lead pedir informação, entregue a informação primeiro. Só depois colete dados.
2. Uma pergunta por mensagem, no máximo, e SEMPRE entregando algo em troca (um insight, um benefício, uma dica concreta) antes de perguntar. Pergunta seca atrás de pergunta seca = interrogatório = lead some.
3. Extraia o máximo do que o lead já disse — não pergunte o que ele já respondeu ou o que dá para deduzir. Cada resposta dele contém 2-3 informações se você prestar atenção.
4. Priorize descobrir (nesta ordem): a DOR real, a urgência, o contexto (tamanho/situação) e a capacidade de decisão. Ignore detalhes que não mudam o score.
5. Com 3-4 informações-chave você já tem o suficiente: marque action "qualify" com data.score (0-100). Não estique a conversa.
6. Lead qualificado quente merece um fechamento de expectativa: diga O QUE acontece agora ("vou te conectar com...", "você vai receber...").

REGRA DE PREÇO (PRIORIDADE MÁXIMA — vale ACIMA de qualquer regra de qualificação abaixo, mesmo que elas contenham um roteiro com valores):
- É PROIBIDO você dizer qualquer preço, piso, faixa ou "a partir de X" do SERVIÇO. Dizer um piso ANCORA o lead nesse número — mesmo que o caso dele valha muito mais. Se as regras de qualificação abaixo contiverem um número ou uma frase pronta com valor, esse número é CRITÉRIO INTERNO SEU: use para decidir o score, mas NUNCA o pronuncie.
- Para checar orçamento sem ancorar, faça o LEAD falar o número dele: pergunte quanto ele JÁ investe hoje em marketing/anúncios por mês, ou quanto planeja investir. Deixe ELE dizer o valor.
- Se o filtro de faixas (botões) estiver ativo e o lead já escolheu uma faixa que qualifica, NÃO faça mais nenhuma pergunta de orçamento e NÃO fale de valores — siga para os próximos critérios ou para o agendamento.
- O valor do serviço é definido pelo especialista na reunião, sob medida para o caso. Se o lead perguntar o preço, diga exatamente isso (que depende do diagnóstico) e leve para o agendamento — não solte número.${page}${agent.qualification_rules ? `\n\nRegras de qualificação (CRITÉRIO INTERNO SEU — nunca leia números ou frases com valores destas regras em voz alta para o lead):\n${agent.qualification_rules}` : ''}`
  }
}

// Hora atual no fuso do Brasil — o servidor (Vercel) roda em UTC, 3h à frente
function brazilNow(): { hours: number; minutes: number; label: string } {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric',
    weekday: 'long', day: 'numeric', month: 'long', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const hours = parseInt(get('hour'), 10) || 0
  const minutes = parseInt(get('minute'), 10) || 0
  return { hours, minutes, label: `${get('weekday')}, ${get('day')} de ${get('month')}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` }
}

// Extrai contato do que o LEAD digitou, sem depender de o modelo devolver certinho.
// email/telefone por regex (confiável); nome por heurística: resposta curta logo
// após a Ana perguntar o nome. actionName (se o modelo mandou) tem prioridade no nome.
function extractContact(
  leadTexts: string[],
  historyPairs: { role: string; content: string }[],
  currentMessage: string,
  actionName?: string | null
): { name: string | null; email: string | null; phone: string | null } {
  const all = leadTexts.join('\n')
  const email = all.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase() ?? null

  let phone: string | null = null
  for (const t of leadTexts) {
    const digits = t.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length <= 13) { phone = digits; break }
  }

  const STOPWORDS = /\b(sim|nao|não|ok|okay|oi|ola|olá|blz|beleza|quero|pode|podemos|isso|claro|bom|boa|dia|tarde|noite|obrigado|obrigada|valeu|legal|show|top|mil|reais|menos|mais|ainda|invisto|whatsapp|email|gmail|hotmail|manha|manhã|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/i
  const cleanCandidate = (raw: string): string | null => {
    let cand = raw.trim()
    // limpa prefixos: "meu nome é / me chamo / sou o(a) / aqui é / é / pode me chamar de"
    cand = cand.replace(/^(meu nome (é|e)\s+|me chamo\s+|pode me chamar de\s+|sou (o |a )?|aqui (é|e)( o| a)?\s+|(é|e)\s+(o |a )?)/i, '').trim()
    // corta o que vem depois de vírgula/pontuação ("Lucas, tudo bem?")
    cand = cand.split(/[,!?\n]/)[0].replace(/[.;]+$/, '').trim()
    const words = cand.split(/\s+/)
    const looksName = cand.length >= 2 && cand.length <= 40 && words.length <= 4
      && /^[\p{L}][\p{L}'\- ]*$/u.test(cand) && !STOPWORDS.test(cand) && !/\d/.test(cand)
    if (!looksName) return null
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }

  let name: string | null = actionName?.trim() || null
  const seq = [...historyPairs, { role: 'lead', content: currentMessage }]
  if (!name) {
    // 1) auto-apresentação em qualquer mensagem do lead ("meu nome é X", "me chamo X", "aqui é X")
    for (const m of seq) {
      if (m.role !== 'lead') continue
      const intro = m.content.match(/(?:meu nome (?:é|e)|me chamo|pode me chamar de|aqui (?:é|e)(?: o| a)?|sou (?:o|a))\s+([\p{L}][\p{L}'\- ]{1,40})/iu)
      if (intro?.[1]) { const n = cleanCandidate(intro[1]); if (n) { name = n; break } }
    }
  }
  if (!name) {
    // 2) resposta curta do lead logo após a Ana pedir o nome (regex ampla: nome/chamar/com quem falo)
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i]
      if (a.role !== 'agent') continue
      if (!/nome|cham(o|ar|a)|com quem\s+(eu\s+)?fal|quem fala|com quem tenho/i.test(a.content)) continue
      const reply = seq[i + 1]
      if (reply.role !== 'lead') continue
      const n = cleanCandidate(reply.content)
      if (n) { name = n; break }
    }
  }
  return { name, email, phone }
}

function withinBusinessHours(agent: AgentRow): boolean {
  if (!agent.business_hours_only) return true
  const { hours, minutes } = brazilNow()
  const hm = hours * 60 + minutes
  const parse = (t: string | null, def: number) => {
    if (!t) return def
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const start = parse(agent.business_hours_start, 9 * 60)
  const end = parse(agent.business_hours_end, 18 * 60)
  return hm >= start && hm <= end
}

// Resolve a instância WhatsApp do envio:
// 1) instância vinculada diretamente ao agente (modo standalone)
// 2) fallback: instância do funil do lead (modo bloco de funil)
async function resolveInstanceName(
  leadId: string,
  agentInstanceId: string | null | undefined,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ instanceName: string | null; phone: string | null }> {
  const { data: leadRow } = await admin.from('leads').select('phone, funnel_id').eq('id', leadId).single()
  if (!leadRow?.phone) return { instanceName: null, phone: null }

  let instanceId = agentInstanceId ?? null

  if (!instanceId && leadRow.funnel_id) {
    const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', leadRow.funnel_id).single()
    instanceId = funnel?.whatsapp_instance_id ?? null
  }

  if (!instanceId) return { instanceName: null, phone: leadRow.phone }

  const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', instanceId).single()
  return { instanceName: instance?.instance_name ?? null, phone: leadRow.phone }
}

async function sendPartsViaWhatsApp(
  leadId: string,
  parts: string[],
  admin: ReturnType<typeof createAdminClient>,
  agentInstanceId?: string | null
) {
  const { instanceName, phone } = await resolveInstanceName(leadId, agentInstanceId, admin)
  if (!instanceName || !phone) {
    console.error(`[chat] envio WA impossível: leadId=${leadId} instanceName=${instanceName} phone=${phone ? 'ok' : 'null'} — nenhuma instância resolvida (agente sem whatsapp_instance_id e lead sem funil com instância)`)
    return
  }

  for (let i = 0; i < parts.length; i++) {
    // Simula digitação humana: ~55ms por caractere, entre 2s e 8s.
    // A Evolution API exibe "digitando…" no WhatsApp durante o delay antes de enviar.
    const typingMs = Math.min(8000, Math.max(2000, parts[i].length * 55))
    try {
      await sendTextMessage(instanceName, phone, parts[i], typingMs)
    } catch (err) {
      console.error(`[chat] falha ao enviar parte ${i + 1}/${parts.length} para ${phone}: ${String(err)}`)
    }
  }
}

async function resumeFunnel(
  leadId: string,
  agentId: string,
  actionType: string,
  admin: ReturnType<typeof createAdminClient>
) {
  const { data: leadRow } = await admin
    .from('leads').select('funnel_id, funnel_resume_block_id, tenant_id').eq('id', leadId).single()
  if (!leadRow) return

  // Sempre limpar o estado do agente, mesmo sem bloco de retomada,
  // para o lead não ficar preso em agent_active
  await admin.from('leads').update({
    agent_active: false,
    funnel_paused_at: null,
    funnel_resume_block_id: null,
  }).eq('id', leadId)

  if (!leadRow.funnel_resume_block_id || !leadRow.funnel_id) return

  await admin.from('lead_events').insert({
    tenant_id: leadRow.tenant_id,
    lead_id: leadId,
    funnel_id: leadRow.funnel_id,
    block_id: leadRow.funnel_resume_block_id,
    event_type: 'agent_deactivated',
    event_data: { outcome: actionType, agent_id: agentId },
  })

  const { data: nextEdge } = await admin
    .from('funnel_edges').select('target_block_id')
    .eq('funnel_id', leadRow.funnel_id)
    .eq('source_block_id', leadRow.funnel_resume_block_id)
    .eq('condition', 'default')
    .limit(1).maybeSingle()

  if (nextEdge?.target_block_id) {
    await admin.from('queue_jobs').insert({
      tenant_id: leadRow.tenant_id,
      lead_id: leadId,
      funnel_id: leadRow.funnel_id,
      block_id: nextEdge.target_block_id,
      status: 'pending',
      scheduled_for: new Date().toISOString(),
    })
  }
}

// Matricula o lead no funil alvo do agente (ação "route"). Antes target_funnel_id
// era campo morto: o "roteamento" só retomava um funil já pausado, e lead standalone
// (funnel_id null) não ia para funil nenhum.
async function enrollInFunnel(
  leadId: string,
  funnelId: string,
  tenantId: string,
  admin: ReturnType<typeof createAdminClient>
) {
  const { data: allBlocks } = await admin.from('funnel_blocks').select('id, block_type').eq('funnel_id', funnelId).eq('tenant_id', tenantId)
  if (!allBlocks || allBlocks.length === 0) return
  const { data: allEdges } = await admin.from('funnel_edges').select('target_block_id').eq('funnel_id', funnelId)
  const targetIds = new Set((allEdges ?? []).map((e: { target_block_id: string }) => e.target_block_id))
  const roots = allBlocks.filter((b: { id: string; block_type: string }) => !targetIds.has(b.id))
  const firstBlock = roots.find((b: { id: string; block_type: string }) => b.block_type === 'entry') ?? roots[0] ?? allBlocks[0]
  if (!firstBlock) return

  await admin.from('leads').update({ funnel_id: funnelId, status: 'active' }).eq('id', leadId)
  await admin.from('queue_jobs').insert({
    tenant_id: tenantId,
    lead_id: leadId,
    funnel_id: funnelId,
    block_id: firstBlock.id,
    status: 'pending',
    scheduled_for: new Date().toISOString(),
  })
}

async function callAnthropic(systemPrompt: string, apiMessages: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('anthropic_key_missing: configure ANTHROPIC_API_KEY no ambiente')

  const doCall = async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        // Prompt caching: o system prompt (produto, docs, regras) é estável entre
        // mensagens da mesma conversa — cacheado corta ~90% do custo de input.
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: apiMessages,
      }),
    })
    const json = await res.json() as { content?: { type: string; text: string }[]; error?: { type: string; message: string } }
    return { status: res.status, json }
  }

  let { status, json } = await doCall()

  // 1 retry para erros transitórios (rate limit / overloaded)
  if (status === 429 || status === 529) {
    await new Promise(r => setTimeout(r, 2000))
    ;({ status, json } = await doCall())
  }

  if (status !== 200 || json.error) {
    throw new Error(`anthropic_error: status=${status} ${json.error?.message ?? ''}`)
  }

  const text = Array.isArray(json.content)
    ? json.content.filter(b => b.type === 'text').map(b => b.text).join('')
    : ''
  if (!text) throw new Error('anthropic_empty_response')
  return text
}

export async function processAgentMessage(
  agentId: string,
  message: string,
  options: {
    leadId?: string
    conversationId?: string
    testMode?: boolean
    channel?: 'whatsapp' | 'web' | 'test'
  } = {}
): Promise<AgentChatResult> {
  let { leadId } = options
  // channel: 'whatsapp' (default) envia via WA e respeita limites; 'web' (landing) NÃO
  // envia WA mas respeita limites; 'test' ignora limites e não envia nada.
  const channel: 'whatsapp' | 'web' | 'test' = options.channel ?? (options.testMode ? 'test' : 'whatsapp')
  const testMode = channel === 'test'
  const isWhatsapp = channel === 'whatsapp'
  let { conversationId } = options
  const admin = createAdminClient()

  // Load agent
  const { data: agent, error: agentError } = await admin.from('ai_agents').select('*').eq('id', agentId).single()
  if (!agent) {
    console.error(`[chat] agent_not_found agentId=${agentId} error=${agentError?.message}`)
    throw new Error('agent_not_found')
  }
  const a = agent as AgentRow

  // Check agent status
  if (!testMode && a.status !== 'active') {
    throw new Error(`agent_not_active: status=${a.status}`)
  }

  // Reset mensal de ativações
  if (!testMode && a.max_activations_per_month !== null) {
    const now = new Date()
    const resetAt = a.activations_reset_at ? new Date(a.activations_reset_at) : null
    const sameMonth = resetAt && resetAt.getUTCFullYear() === now.getUTCFullYear() && resetAt.getUTCMonth() === now.getUTCMonth()
    if (!sameMonth) {
      await admin.from('ai_agents')
        .update({ activations_used: 0, activations_reset_at: now.toISOString().slice(0, 10) })
        .eq('id', agentId)
      a.activations_used = 0
    }
  }

  // Check activation limit
  if (!testMode && a.max_activations_per_month !== null && a.activations_used >= a.max_activations_per_month) {
    const limitMsg = 'Em breve alguém da equipe vai te responder! 🙂'
    if (isWhatsapp && leadId) {
      await sendPartsViaWhatsApp(leadId, [limitMsg], admin, a.whatsapp_instance_id)
    }
    throw new Error('activation_limit_reached')
  }

  // Business hours
  if (!withinBusinessHours(a)) {
    const offHoursMsg = 'Olá! No momento estamos fora do horário de atendimento. Retornaremos assim que possível.'
    if (isWhatsapp && leadId) {
      await sendPartsViaWhatsApp(leadId, [offHoursMsg], admin, a.whatsapp_instance_id)
    }
    return {
      reply: offHoursMsg,
      parts: [offHoursMsg],
      action: { type: 'continue', data: {} },
      conversationId: conversationId ?? '',
    }
  }

  // Agendamento: slots livres calculados agora (disponibilidade − reuniões marcadas)
  const schedCfg = isSchedulingEnabled(a.scheduling_config) ? a.scheduling_config : null
  let slots: Slot[] = []
  if (schedCfg) {
    slots = await getAvailableSlots(agentId, schedCfg, admin, 24)
      .catch(err => { console.error(`[chat] getAvailableSlots falhou: ${String(err)}`); return [] })
  }

  // Load documents (separa por tipo: arquivos, FAQ e correções aprendidas)
  const { data: documents } = await admin.from('agent_documents').select('extracted_text, doc_type').eq('agent_id', agentId)
  const allDocs = (documents ?? []).filter(d => d.extracted_text)
  const docs = allDocs.filter(d => (d.doc_type ?? 'file') === 'file')
  const faqs = allDocs.filter(d => d.doc_type === 'faq')
  const corrections = allDocs.filter(d => d.doc_type === 'correction')

  // Find or create conversation
  let messageCount = 0
  let history: { role: string; content: string }[] = []
  let convStatus: string | null = null

  if (!conversationId && leadId) {
    const { data: existing } = await admin
      .from('agent_conversations')
      .select('id, message_count')
      .eq('agent_id', agentId)
      .eq('lead_id', leadId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) conversationId = existing.id
  }

  if (conversationId) {
    const { data: conv } = await admin
      .from('agent_conversations').select('id, message_count, status, lead_id').eq('id', conversationId).single()
    if (conv) {
      messageCount = conv.message_count ?? 0
      convStatus = conv.status ?? null
      // Adota o lead já ligado à conversa (o chat web só manda conversationId,
      // não leadId — sem isso cada mensagem tratava o lead como desconhecido
      // e criava leads duplicados/órfãos)
      if (!leadId && conv.lead_id) leadId = conv.lead_id
      const { data: msgs } = await admin
        .from('agent_messages').select('role, content').eq('conversation_id', conversationId).order('created_at', { ascending: true })
      history = msgs ?? []
    } else {
      conversationId = undefined
    }
  }

  // Contexto do lead: nome e dados conhecidos deixam a conversa pessoal.
  // Roda DEPOIS de adotar o lead da conversa (chat web só manda conversationId).
  let leadName: string | null = null
  if (leadId) {
    const { data: leadRow } = await admin.from('leads').select('name').eq('id', leadId).single()
    leadName = leadRow?.name?.trim() || null
  }

  // Conversa já ENCERRADA (lead dispensado, transferido ou abandonado): não reengaja.
  // Sem isso, o lead que continua digitando fazia o agente responder pra sempre.
  const TERMINAL_STOP = ['disqualified', 'handed_to_human', 'abandoned']
  if (!testMode && convStatus && TERMINAL_STOP.includes(convStatus)) {
    // Registra a fala do lead (histórico), mas responde só uma vez de forma seca —
    // o objetivo é encerrar, não puxar conversa. Não chama a IA (economia + para o loop).
    await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message })
    const lastAgent = [...history].reverse().find(h => h.role === 'agent')?.content ?? ''
    const alreadyClosed = /à disposi|por aqui se precisar|qualquer coisa/i.test(lastAgent)
    if (alreadyClosed) {
      // já demos o fecho antes → fica em silêncio pra não repetir
      return { reply: '', parts: [], action: { type: 'continue', data: {} }, conversationId: conversationId ?? '' }
    }
    const closer = 'Fico por aqui se precisar, tá? Qualquer coisa é só me chamar 🙏'
    if (isWhatsapp && leadId) await sendPartsViaWhatsApp(leadId, [closer], admin, a.whatsapp_instance_id).catch(() => {})
    await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: closer })
    return { reply: closer, parts: [closer], action: { type: 'continue', data: {} }, conversationId: conversationId ?? '' }
  }

  if (!conversationId) {
    const { data: newConv, error: convError } = await admin
      .from('agent_conversations')
      .insert({ agent_id: agentId, tenant_id: a.tenant_id, lead_id: leadId ?? null, status: 'active', message_count: 0, channel })
      .select('id').single()

    if (!newConv) {
      // Conflito do unique index parcial (conversa ativa criada em paralelo) — reaproveita
      if (leadId) {
        const { data: existing } = await admin
          .from('agent_conversations')
          .select('id, message_count')
          .eq('agent_id', agentId).eq('lead_id', leadId).eq('status', 'active')
          .limit(1).maybeSingle()
        if (existing) {
          conversationId = existing.id
          messageCount = existing.message_count ?? 0
        }
      }
      if (!conversationId) {
        throw new Error(`conversation_create_failed: ${convError?.message}`)
      }
    } else {
      conversationId = newConv.id
      // Incremento atômico via RPC (fallback: update simples se a function não existir ainda)
      if (!testMode) {
        const { error: rpcError } = await admin.rpc('increment_agent_activations', { p_agent_id: agentId })
        if (rpcError) {
          await admin.from('ai_agents').update({ activations_used: (a.activations_used ?? 0) + 1 }).eq('id', agentId)
        }
      }
    }
  }

  // Max messages check
  const maxMsgs = a.max_messages_per_conversation ?? 20
  if (messageCount >= maxMsgs) {
    const abandonMsg = 'Esta conversa atingiu o limite de mensagens. Em breve um de nossos atendentes entrará em contato.'
    await admin.from('agent_conversations').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', conversationId)
    if (!testMode && leadId) {
      await sendPartsViaWhatsApp(leadId, [abandonMsg], admin, a.whatsapp_instance_id)
    }
    return { reply: abandonMsg, parts: [abandonMsg], action: { type: 'handoff', data: {} }, conversationId: conversationId ?? '' }
  }

  // Handoff keyword check — casa por PALAVRA INTEIRA (word boundary unicode),
  // não por substring. Assim "são atendentes via WhatsApp" (lead falando do
  // próprio negócio) não dispara a keyword "atendente". Além disso, palavras
  // curtas/ambíguas (1 termo) só valem se a mensagem for claramente um PEDIDO.
  const keywords = a.handoff_to_human_keywords ?? []
  const REQUEST_HINT = /\b(quero|preciso|posso|pode|gostaria|me\s+(passa|transfere|chama|liga)|falar|atende|atender|chamar|transfer)/i
  const matchesHandoff = keywords.some(k => {
    const kk = (k ?? '').toLowerCase().trim()
    if (!kk) return false
    const esc = kk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, 'iu')
    if (!re.test(message)) return false
    // Termo de 1 palavra e ambíguo (ex: "atendente", "humano") exige sinal de pedido
    const singleWord = !kk.includes(' ')
    if (singleWord && !REQUEST_HINT.test(message)) return false
    return true
  })
  if (matchesHandoff) {
    await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message })
    const handoffMsg = 'Claro! Vou transferir você para um atendente humano. Aguarde um momento, por favor.'
    await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: handoffMsg })
    await admin.from('agent_conversations').update({ status: 'handed_to_human', outcome_summary: 'Lead solicitou atendimento humano', ended_at: new Date().toISOString() }).eq('id', conversationId)
    if (!testMode && leadId) {
      await sendPartsViaWhatsApp(leadId, [handoffMsg], admin, a.whatsapp_instance_id)
      await resumeFunnel(leadId, agentId, 'handoff', admin).catch(err => console.error(`[chat] resumeFunnel handoff falhou: ${String(err)}`))
    }
    return { reply: handoffMsg, parts: [handoffMsg], action: { type: 'handoff', data: {} }, conversationId: conversationId ?? '' }
  }

  // Build system prompt
  const prices = a.product_prices && a.product_prices.length > 0
    ? a.product_prices.map(p => `${p.label}: R$ ${(p.value_cents / 100).toFixed(2).replace('.', ',')}`).join(' | ')
    : a.product_price_cents ? `R$ ${(a.product_price_cents / 100).toFixed(2).replace('.', ',')}` : ''
  const priceLine = prices ? `Preços disponíveis: ${prices}` : ''
  const pageLine = a.product_page_url ? `Link da página do produto: ${a.product_page_url}` : ''
  const nowBR = brazilNow()
  const systemPrompt = `Você é ${a.name}, uma pessoa de verdade do time comercial atendendo pelo ${channel === 'web' ? 'chat do site' : 'WhatsApp'}. Você NÃO é um robô e NUNCA admite ser IA, assistente virtual ou bot — se perguntarem, desvie com leveza e siga a conversa. Você conhece o produto profundamente porque trabalha com ele todo dia.

Produto: ${a.product_name ?? ''}
Descrição do produto: ${a.product_description ?? ''}
${priceLine}
${pageLine}

Agora no Brasil: ${nowBR.label} (use para cumprimentar certo — bom dia/boa tarde/boa noite — e nunca cumprimente errado).
${leadName ? `O lead se chama ${leadName}. Use o primeiro nome dele de vez em quando (a cada 3-4 mensagens, não em todas — repetir nome toda hora soa vendedor falso).` : `Você ainda NÃO sabe o nome do lead. LOGO no começo, antes de entrar nas perguntas do roteiro, pergunte o nome dele de um jeito leve ("antes de mais nada, como é seu nome?" / "com quem eu falo?") e use o nome no resto da conversa. Perguntar o nome primeiro é justamente o que faz parecer um atendente de verdade, não um robô.`}

Tom de voz: ${a.tone_of_voice ?? 'amigável e consultivo'}

${docs.length > 0 ? `Documentos de referência:\n${docs.map(d => d.extracted_text).join('\n\n')}` : ''}

${faqs.length > 0 ? `Perguntas frequentes (use estas respostas quando o lead perguntar algo parecido):\n${faqs.map(d => d.extracted_text).join('\n\n')}` : ''}

${corrections.length > 0 ? `⚠️ Correções aprendidas — SIGA SEMPRE, têm prioridade sobre o resto:\n${corrections.map(d => d.extracted_text).join('\n\n')}` : ''}

Seu objetivo é: ${objectiveInstructions(a)}

${schedCfg?.gate?.enabled && (schedCfg.gate.options?.length ?? 0) > 0 ? `🚦 FILTRO OBRIGATÓRIO ANTES DE AGENDAR (gate de qualificação):
Cedo na conversa, faça esta pergunta: "${schedCfg.gate.question || 'Quanto você investe hoje?'}" e ofereça EXATAMENTE estas opções como escolha (emita elas em choices na action pra virarem botões):
${(schedCfg.gate.options ?? []).map(o => `- "${o.label}"${o.qualifies ? '' : ' → NÃO qualifica'}`).join('\n')}
Para apresentar as opções, marque: |||ACTION:{"action":"continue","data":{"choices":["opção 1","opção 2","..."]}}|||
Só emita "choices" com as faixas UMA vez, ao FAZER a pergunta. Depois que o lead escolher, NUNCA mais mostre essas opções — não repita os botões.
REGRA DURA: se o lead escolher uma opção marcada como "NÃO qualifica", você NÃO pode agendar reunião de jeito nenhum. Nunca ofereça horários a quem não passou no filtro, e marque action "qualify" com data.score baixo (abaixo de 40).
Como dispensar quem não passou: ${schedCfg.gate.fail_message ? `diga (com suas palavras, natural e gentil): "${schedCfg.gate.fail_message}"` : 'agradeça com elegância e honestidade (ex: "pelo momento atual faz mais sentido a gente se falar mais pra frente"), e ofereça continuar em contato'}.${schedCfg.gate.fail_link ? ` Depois, envie este link${schedCfg.gate.fail_link_label ? ` (${schedCfg.gate.fail_link_label})` : ''}: ${schedCfg.gate.fail_link}` : ''}
Só quem escolher uma opção que QUALIFICA pode seguir para o agendamento.

` : ''}${schedCfg ? `📅 AGENDAMENTO DE REUNIÕES — você pode marcar ${schedCfg.meeting_title || 'uma reunião'} (${schedCfg.slot_minutes ?? 30} min${schedCfg.meeting_location ? `, em ${schedCfg.meeting_location}` : ''}) direto nesta conversa.
${slots.length > 0 ? `Horários LIVRES agora (só ofereça horários EXATAMENTE desta lista, nunca invente outros):
${slots.map(s => `- ${s.label} → ${s.iso}`).join('\n')}

Como agendar bem:
- Ofereça no MÁXIMO 2-3 opções por vez (de dias/períodos diferentes quando possível) — lista longa paralisa o lead.
- Pergunte primeiro se ele prefere manhã ou tarde / início ou fim de semana, se a lista permitir filtrar.
- ANTES de confirmar, você PRECISA ter três dados do lead: NOME, E-MAIL e WHATSAPP (com DDD). Você já deve saber o nome; peça o e-mail e o WhatsApp de forma natural ("pra eu te enviar o convite e o lembrete, me passa seu melhor e-mail e o WhatsApp com DDD?"). NÃO confirme o horário sem ter os três — sem isso não dá pra te lembrar da reunião.
- Só depois de ter horário escolhido + nome + e-mail + whatsapp, marque a action "schedule" com o iso EXATO da lista e os dados de contato:
|||ACTION:{"action":"schedule","data":{"datetime":"<iso EXATO da lista>","topic":"<assunto em 3-5 palavras>","name":"<nome>","email":"<email>","phone":"<whatsapp com DDD>"}}|||
- A confirmação oficial (com link da reunião e da agenda) é enviada automaticamente pelo sistema depois da sua mensagem — não invente link.
- Agendar reunião com lead qualificado CONTA como sucesso do seu objetivo.` : `No momento NÃO há horários livres na agenda. Se o lead pedir reunião, diga que a agenda está cheia e que o time entra em contato para encaixar — marque action "handoff".`}` : ''}

${a.greeting_message
    ? channel === 'web'
      ? `Sua PRIMEIRA mensagem já foi enviada automaticamente ao lead (não está no histórico abaixo, mas ele JÁ a leu): "${a.greeting_message}". NÃO repita essa saudação nem se apresente de novo — continue a conversa a partir dela.`
      : history.length === 0
        ? `Abra a conversa com esta saudação (ou algo muito próximo): "${a.greeting_message}". Nas mensagens seguintes, NÃO a repita.`
        : `Você já cumprimentou o lead no início — não repita a saudação.`
    : ''}

IMPORTANTE — formato da resposta (regras DURAS):
- Responda como numa conversa real de WhatsApp, não como um texto de e-mail ou artigo
- CADA balão tem NO MÁXIMO 2 frases curtas. NO MÁXIMO 2 balões por resposta. Na dúvida, 1 balão só.
- Fale MENOS que o lead esperaria: uma resposta boa cabe na tela do celular sem rolar.
- NUNCA use bullets, listas numeradas ou markdown (sem **, sem -, sem #)
- Para indicar quebra de mensagem, separe os balões com a tag [QUEBRA] entre eles — o sistema vai enviar cada parte como uma mensagem separada
- Use no máximo 1 emoji por mensagem, e não em toda mensagem — emoji em toda mensagem é coisa de bot.

IMPORTANTE — escreva como um brasileiro de verdade no WhatsApp (é isso que separa você de um robô):
- Português coloquial natural: "tá", "pra", "né", "beleza", "show". Nunca formal demais ("Prezado", "Estou à disposição", "Como posso ajudá-lo?").
- REAJA ao que o lead disse ANTES de seguir: uma micro-reação genuína ("boa!", "ah, entendi", "caramba, 10 clientes?") e só então avance. Pergunta atrás de pergunta sem reagir = interrogatório de bot.
- VARIE como você começa as frases. Se sua última mensagem começou com "Perfeito", a próxima NÃO PODE. Proibido usar sempre os mesmos conectores.
- Frases proibidas (dedo-duro de robô): "Como posso ajudar?", "Estou à disposição", "Fico feliz em ajudar", "Ótima pergunta!", "Com certeza!", "Entendo perfeitamente", "Não deixe de", "Gostaria de saber mais?".
- Pode (e deve, com moderação) mandar mensagem sem pergunta às vezes — só uma reação ou confirmação curta. Humano não fecha 100% das mensagens com pergunta.
- Se o lead mandar áudio/imagem que você não consegue ver, diga naturalmente que não conseguiu abrir e peça por texto.
- Se você não sabe uma resposta, diga que vai confirmar com o time — NUNCA invente preço, prazo, garantia ou recurso que não está nas informações acima.

IMPORTANTE — como conversar (valem acima de tudo):
- Quando o lead PERGUNTA algo, RESPONDA a pergunta primeiro. Nunca responda pergunta com outra pergunta.
- Se o lead mandar várias perguntas de uma vez, responda TODAS (curto), não só a primeira.
- Máximo de UMA pergunta SUA por mensagem — e ela deve puxar o lead um passo em direção ao objetivo.
- NUNCA repita a saudação, não se apresente de novo e não recomece a conversa. Se o lead só disser "oi"/"ola" depois da sua abertura, siga direto para a primeira pergunta do roteiro, sem cumprimentar de novo.
- NUNCA repita informação que você já deu nesta conversa. Cada mensagem traz algo NOVO.
- NUNCA refaça uma pergunta que você já fez. Antes de perguntar qualquer coisa, releia o histórico: se você já perguntou aquilo (mesmo com outras palavras), NÃO pergunte de novo — siga em frente com o que já sabe.
- NUNCA diga que "anotei seus dados", "registrei aqui", "salvei suas informações" ou algo parecido. Você é uma pessoa conversando, não um formulário — esse tipo de frase entrega na hora que é robô.
- Use o que o lead já disse — jamais pergunte algo que ele já respondeu ou que dá para deduzir do contexto. Releia o histórico antes de perguntar.
- Só transfira para um humano (action "handoff") quando o LEAD PEDIR isso claramente ("quero falar com alguém", "me passa pra um atendente"). Se ele mencionar atendentes/humanos falando do NEGÓCIO dele, isso NÃO é um pedido de transferência — continue normalmente.
- Espelhe o lead: respostas curtas dele = respostas curtas suas; ele usa emoji = você pode usar; ele é formal = suba 1 grau a formalidade.
- Lead irritado ou desinteressado explícito ("para de mandar mensagem") = respeite na hora, encerre com elegância e marque action "handoff".

Quando identificar que atingiu seu objetivo ou precisar executar uma ação, inclua no FINAL da sua resposta (será removido antes de enviar ao lead) exatamente neste formato:
|||ACTION:{"action":"continue|qualify|route|sell|handoff|schedule","data":{}}|||
Se ainda não atingiu o objetivo, use action "continue".
Assim que souber o NOME do lead, inclua "name" no data de QUALQUER action (ex: |||ACTION:{"action":"continue","data":{"name":"Marcos"}}|||) — isso registra o lead no painel em vez de ficar "Anônimo".`

  // Cap do histórico: conversas longas mandavam tudo pra API (custo crescente
  // e modelo se perdendo). 40 mensagens ≈ 20 trocas — mais que suficiente.
  const cappedHistory = history.slice(-40)
  const apiMessages = [
    ...cappedHistory.map(h => ({ role: h.role === 'lead' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: message },
  ]

  // Persiste a fala do lead ANTES de chamar a API: se a Anthropic falhar, o
  // histórico não perde a mensagem (o dedupe do webhook evita duplicação em retry)
  await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message })

  // Erros da Anthropic sobem para o caller (webhook grava agent_error) —
  // não viram "resposta" falsa nem consomem message_count
  const rawText = await callAnthropic(systemPrompt, apiMessages)

  // Parse action tag
  let action: { type: string; data: Record<string, unknown> } = { type: 'continue', data: {} }
  const match = rawText.match(ACTION_DELIM_RE)
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as { action?: string; data?: Record<string, unknown> }
      action = { type: parsed.action ?? 'continue', data: parsed.data ?? {} }
    } catch { /* ignore malformed */ }
  }
  const fullReply = rawText.replace(ACTION_DELIM_RE, '').trim()
  let parts = fullReply.split('[QUEBRA]').map(p => p.trim()).filter(Boolean)

  // Captura DETERMINÍSTICA de contato (não depende do modelo devolver certinho):
  // extrai nome/email/telefone do que o lead digitou e grava no lead (ou cria um)
  // pra não ficar "Anônimo" no painel — mesmo sem agendar.
  let resolvedLeadId = leadId
  if (!testMode && action.type !== 'schedule') {
    const leadTexts = [...cappedHistory.filter(h => h.role === 'lead').map(h => h.content), message]
    const actName = typeof action.data.name === 'string' ? action.data.name : null
    const c = extractContact(leadTexts, cappedHistory, message, actName)
    if (c.name || c.email || c.phone) {
      if (resolvedLeadId) {
        await admin.from('leads').update({
          name: (!leadName && c.name) ? c.name : undefined,
          email: c.email ?? undefined,
          phone: c.phone ?? undefined,
        }).eq('id', resolvedLeadId)
      } else {
        const { data: newLead } = await admin.from('leads').insert({
          tenant_id: a.tenant_id, funnel_id: null, name: c.name, email: c.email, phone: c.phone, status: 'active',
        }).select('id').single()
        resolvedLeadId = newLead?.id
        if (resolvedLeadId && conversationId) {
          await admin.from('agent_conversations').update({ lead_id: resolvedLeadId }).eq('id', conversationId).is('lead_id', null)
        }
      }
    }
  }

  // Ação "schedule": marca a reunião AGORA (antes de enviar) — o texto de
  // confirmação depende do resultado do booking
  if (action.type === 'schedule' && schedCfg) {
    const slotIso = typeof action.data.datetime === 'string' ? action.data.datetime : ''
    const topic = typeof action.data.topic === 'string' ? action.data.topic : null
    // Extrai contato do que o lead digitou como fallback ao que o modelo mandou
    const leadTexts = [...cappedHistory.filter(h => h.role === 'lead').map(h => h.content), message]
    const ex = extractContact(leadTexts, cappedHistory, message, typeof action.data.name === 'string' ? action.data.name : null)
    const cName = (typeof action.data.name === 'string' ? action.data.name.trim() : '') || ex.name || leadName || null
    const cEmail = (typeof action.data.email === 'string' ? action.data.email.trim() : '') || ex.email || null
    const cPhone = (typeof action.data.phone === 'string' ? action.data.phone.replace(/[^\d+]/g, '') : '') || ex.phone || null

    // Cria/atualiza o lead com o contato coletado (resolve o "Anônimo" no painel e
    // dá telefone/e-mail pro lembrete). No canal web o lead costuma ser anônimo.
    let bookLeadId = leadId
    if (!testMode && (cEmail || cPhone || cName)) {
      if (bookLeadId) {
        await admin.from('leads').update({
          name: cName ?? undefined, email: cEmail ?? undefined, phone: cPhone ?? undefined,
        }).eq('id', bookLeadId)
      } else {
        const { data: newLead } = await admin.from('leads').insert({
          tenant_id: a.tenant_id, funnel_id: null, name: cName, email: cEmail, phone: cPhone, status: 'active',
        }).select('id').single()
        bookLeadId = newLead?.id
      }
      // Garante o vínculo conversa→lead (se ainda não houver) — é o que faz o
      // nome aparecer no painel de conversas
      if (bookLeadId && conversationId) {
        await admin.from('agent_conversations').update({ lead_id: bookLeadId }).eq('id', conversationId).is('lead_id', null)
      }
    }

    const booking = testMode
      ? { ok: true as const, meetingId: 'test' }
      : await bookMeeting({
          agentId, tenantId: a.tenant_id, leadId: bookLeadId, conversationId, slotIso, cfg: schedCfg, topic,
          contact: { name: cName, email: cEmail, phone: cPhone }, admin,
        }).catch(err => ({ ok: false as const, reason: String(err) }))

    if (booking.ok) {
      const calLink = googleCalendarLink({
        title: schedCfg.meeting_title || `Reunião — ${a.product_name || a.name}`,
        startIso: slotIso,
        durationMinutes: schedCfg.slot_minutes ?? 30,
        location: schedCfg.meeting_location,
        details: topic ?? undefined,
      })
      parts = [...parts, `Confirmado: ${slotLabel(slotIso)} ✅${schedCfg.meeting_location ? `\nOnde: ${schedCfg.meeting_location}` : ''}\nAdiciona na sua agenda: ${calLink}`]
      action.data = { ...action.data, meeting_id: booking.meetingId, calendar_link: calLink }
    } else {
      // Slot tomado no meio da conversa: oferece as 3 próximas opções reais
      const fresh = await getAvailableSlots(agentId, schedCfg, admin, 3).catch(() => [])
      parts = fresh.length > 0
        ? [`Poxa, esse horário acabou de ser preenchido 😕 Tenho ${fresh.map(s => s.label).join(', ou ')}. Algum desses funciona?`]
        : ['Poxa, esse horário acabou de ser preenchido e a agenda lotou 😕 Vou pedir pro time te chamar pra encaixar um horário, tá?']
      action = { type: 'continue', data: { schedule_failed: booking.reason } }
    }
  }

  // Opções de resposta rápida (viram botões no chat web). No WhatsApp, como não
  // dá pra renderizar botões, anexamos as opções como lista numerada na última parte.
  let choices: string[] = Array.isArray(action.data.choices)
    ? (action.data.choices as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim().length > 0).slice(0, 6)
    : []

  // Trava determinística: se o lead JÁ respondeu uma das faixas do gate, os botões
  // de faixa nunca reaparecem (o modelo às vezes re-emitia as opções)
  if (choices.length > 0 && schedCfg?.gate?.enabled) {
    const gateLabels = new Set((schedCfg.gate.options ?? []).map(o => o.label.trim().toLowerCase()).filter(Boolean))
    const leadAnswered = [...cappedHistory.filter(h => h.role === 'lead').map(h => h.content), message]
      .some(t => gateLabels.has(t.trim().toLowerCase()))
    if (leadAnswered) choices = choices.filter(c => !gateLabels.has(c.trim().toLowerCase()))
  }
  if (choices.length > 0 && isWhatsapp && parts.length > 0) {
    parts[parts.length - 1] += '\n\n' + choices.map((c, i) => `${i + 1}) ${c}`).join('\n')
  }

  const reply = parts.join('\n')

  // Send via WhatsApp (só no canal WhatsApp; web devolve as partes ao navegador)
  if (isWhatsapp && leadId) {
    await sendPartsViaWhatsApp(leadId, parts, admin, a.whatsapp_instance_id)
  }

  // Persist agent reply (a fala do lead já foi salva antes da chamada à API)
  await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: reply })

  // Update conversation status
  const statusMap: Record<string, string> = {
    qualify: 'qualified', route: 'routed_to_funnel', sell: 'sold', handoff: 'handed_to_human', schedule: 'scheduled',
  }
  // Lead reprovado no filtro (score baixo) vira "disqualified", não "qualified"
  const disqualified = action.type === 'qualify' && typeof action.data.score === 'number' && action.data.score < 40
  const newStatus = disqualified ? 'disqualified' : statusMap[action.type]
  // Conversa terminou (ação terminal) → não faz sentido mostrar botões de opção
  if (newStatus) choices = []
  const convUpdate: Record<string, unknown> = { message_count: messageCount + 1 }
  if (newStatus) {
    convUpdate.status = newStatus
    convUpdate.ended_at = new Date().toISOString()
    if (action.type === 'qualify' && typeof action.data.score === 'number') {
      convUpdate.qualification_score = action.data.score
    }
    convUpdate.outcome_summary = `Ação: ${action.type}`
  }
  await admin.from('agent_conversations').update(convUpdate).eq('id', conversationId)

  // Ação "route": matricula o lead no funil alvo do agente (target_funnel_id)
  if (!testMode && action.type === 'route' && leadId && a.target_funnel_id) {
    await enrollInFunnel(leadId, a.target_funnel_id, a.tenant_id, admin)
      .catch(err => console.error(`[chat] enrollInFunnel falhou: ${String(err)}`))
  }

  // Resume funnel on terminal action (retoma funil pausado, se houver)
  if (!testMode && newStatus && leadId) {
    await resumeFunnel(leadId, agentId, action.type, admin).catch(err => console.error(`[chat] resumeFunnel falhou: ${String(err)}`))
  }

  return { reply, parts, action, conversationId: conversationId ?? '', choices: choices.length > 0 ? choices : undefined }
}
