// Extrai contato do que o LEAD digitou, sem depender de o modelo devolver certinho.
// email/telefone por regex (confiável); nome por heurística: resposta curta logo
// após a Ana perguntar o nome. actionName (se o modelo mandou) tem prioridade no nome.
export function extractContact(
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

// Nome do lead deduzido do transcript da conversa (mesma heurística do motor).
// Serve de rede de segurança no painel: conversa que ficou sem lead ligado
// (ex.: insert de lead falhou) ainda mostra o nome que a pessoa digitou.
export function nomeNoTranscript(mensagens: { role: string; content: string }[]): string | null {
  const falas = mensagens.filter(m => m.role === 'lead').map(m => m.content)
  if (falas.length === 0) return null
  // currentMessage vazio: o transcript inteiro já vem em historyPairs
  return extractContact(falas, mensagens, '', null).name
}

// O que o agente JÁ sabe do lead (formulário da landing, conversa anterior).
// Sem isso no prompt ele pedia e-mail e WhatsApp de novo na hora de agendar —
// com o dado já salvo no cadastro. Pedir o que a pessoa já deu queima a venda.
export function contatoJaConhecido(lead: { name?: string | null; email?: string | null; phone?: string | null }): {
  jaSabemos: string[]
  faltaContato: string[]
  aviso: string
} {
  const nome = lead.name?.trim() || null
  const email = lead.email?.trim() || null
  const fone = lead.phone?.trim() || null
  const jaSabemos = [
    nome ? `nome: ${nome}` : null,
    email ? `e-mail: ${email}` : null,
    fone ? `WhatsApp: ${fone}` : null,
  ].filter((x): x is string => x !== null)
  const faltaContato = [
    nome ? null : 'nome',
    email ? null : 'e-mail',
    fone ? null : 'WhatsApp',
  ].filter((x): x is string => x !== null)
  const aviso = jaSabemos.length === 0 ? '' :
    `\nDados que o lead JÁ te deu (estão no cadastro dele) — ${jaSabemos.join(', ')}. NUNCA peça de novo um dado desta lista: pedir o que a pessoa já informou passa desatenção e é o jeito mais rápido de perder a venda. Se precisar confirmar, confirme mostrando o valor ("confirmo o convite no ${email ?? 'seu e-mail'}?"), nunca perguntando do zero.`
  return { jaSabemos, faltaContato, aviso }
}
