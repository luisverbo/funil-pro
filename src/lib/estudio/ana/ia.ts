// ============================================================================
// Estúdio IA — a IA da Ana: só responde dúvida livre e confere a foto
// ----------------------------------------------------------------------------
// A máquina de estados decide a venda; aqui a IA:
//   1) responde uma pergunta livre DENTRO da etapa, curta, no idioma da
//      cliente, sem inventar preço/prazo (vêm no prompt) — ou devolve
//      [NAO_ENTENDI] / [HUMANO];
//   2) confere a foto do rosto (pessoa real, de frente, nítida, adulta, não é
//      famosa/print) — seção 7 do projeto.
// `fetchFn` injetável: os testes nunca chamam a API de verdade.
// ============================================================================
import type { IdiomaAna } from './textos'

const MODELO = process.env.ESTUDIO_MODEL ?? process.env.AGENT_MODEL ?? 'claude-sonnet-5'
type Fetch = typeof fetch

const NOME_IDIOMA: Record<IdiomaAna, string> = {
  'pt-BR': 'português do Brasil (informal, carinhoso, "amiga")',
  'pt-PT': 'português de Portugal (tratamento por "tu", sem gírias brasileiras)',
  es: 'espanhol neutro (cercano, cariñoso)',
  en: 'English (warm, friendly)',
}

export interface ContextoIa {
  idioma: IdiomaAna
  objetivo: string            // o que a etapa precisa (ex.: "escolher um pacote")
  tabelaPrecos: string        // texto pronto (moeda do país)
  prazoMin: number
  temas: string               // "Aniversário, Corporativo, Casual, Sensual"
  historico: { de: 'cliente' | 'ana'; texto: string }[]
}

export function promptDaAna(c: ContextoIa): string {
  return `Você é a Ana, assistente virtual do Estúdio (ensaio fotográfico feito com IA, vendido pelo WhatsApp).
Responda SEMPRE em ${NOME_IDIOMA[c.idioma]}. Frases curtas, no máximo 3 linhas, emojis com moderação.

FATOS (use só estes, nunca invente):
- O ensaio é 100% on-line: a cliente manda 2 fotos (rosto de frente e corpo inteiro), escolhe tema e poses num catálogo numerado e recebe as fotos prontas.
- Temas disponíveis: ${c.temas}. Outros temas: "em breve".
- Preços: ${c.tabelaPrecos}
- Prazo: até ${c.prazoMin} minutos após o pagamento e as fotos, no horário de produção.
- 1 ajuste grátis por pacote, em até 24 h após a entrega.
- Sensual: só maiores de 18 e sem nudez. Só fotos da própria cliente.
- As imagens são geradas por IA; uma pessoa da equipe revisa todas.
- Não tem currículo, depoimentos ou anos de experiência para contar: nunca invente nada disso.

AGORA a etapa precisa de: ${c.objetivo}.
Responda a dúvida da cliente e, no fim, lembre com carinho o que falta para seguir.

Regras de saída:
- Se não der para entender o que ela quis dizer, responda exatamente: [NAO_ENTENDI]
- Se for reclamação, pedido de reembolso, ameaça ou algo fora destas regras, responda exatamente: [HUMANO]`
}

export type RespostaIa = { tipo: 'texto'; texto: string } | { tipo: 'nao_entendi' } | { tipo: 'humano' }

export function lerRespostaIa(bruto: string): RespostaIa {
  const t = (bruto ?? '').trim()
  if (!t || /\[NAO_ENTENDI\]/i.test(t)) return { tipo: 'nao_entendi' }
  if (/\[HUMANO\]/i.test(t)) return { tipo: 'humano' }
  return { tipo: 'texto', texto: t.slice(0, 900) }
}

async function chamarClaude(body: Record<string, unknown>, f: Fetch): Promise<string> {
  const chave = process.env.ANTHROPIC_API_KEY
  if (!chave) throw new Error('ANTHROPIC_API_KEY ausente')
  const r = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, ...body }),
  })
  const j = await r.json().catch(() => null) as { content?: { type: string; text?: string }[]; error?: { message?: string } } | null
  if (!r.ok || !j) throw new Error(j?.error?.message ?? `Anthropic HTTP ${r.status}`)
  return (j.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

export async function responderDuvida(c: ContextoIa, mensagem: string, f: Fetch = fetch): Promise<RespostaIa> {
  const msgs = [...c.historico.slice(-8), { de: 'cliente' as const, texto: mensagem }]
    .map(m => ({ role: m.de === 'cliente' ? 'user' : 'assistant', content: m.texto || '…' }))
  // A API exige começar por 'user' e alternar papéis.
  const alternadas: { role: string; content: string }[] = []
  for (const m of msgs) {
    if (alternadas.length === 0 && m.role !== 'user') continue
    const ult = alternadas[alternadas.length - 1]
    if (ult && ult.role === m.role) ult.content += `\n${m.content}`
    else alternadas.push({ ...m })
  }
  try {
    return lerRespostaIa(await chamarClaude({ max_tokens: 300, system: promptDaAna(c), messages: alternadas }, f))
  } catch (err) {
    console.error('[estudio/ana] IA falhou:', String(err).slice(0, 200))
    return { tipo: 'nao_entendi' }
  }
}

// ── Conferência da foto do rosto ────────────────────────────────────────────

export interface ConferenciaFoto { ok: boolean; motivo: 'ok' | 'ruim' | 'recusada' }

export function lerConferencia(bruto: string): ConferenciaFoto {
  const m = (bruto ?? '').match(/\{[\s\S]*\}/)
  if (!m) return { ok: true, motivo: 'ok' }   // sem resposta legível: não trava a venda
  try {
    const j = JSON.parse(m[0]) as { pessoa?: boolean; rosto_visivel?: boolean; nitida?: boolean; parece_menor?: boolean; famosa_ou_print?: boolean }
    if (j.parece_menor || j.famosa_ou_print || j.pessoa === false) return { ok: false, motivo: 'recusada' }
    if (j.rosto_visivel === false || j.nitida === false) return { ok: false, motivo: 'ruim' }
    return { ok: true, motivo: 'ok' }
  } catch { return { ok: true, motivo: 'ok' } }
}

/** Confere a foto; sem chave da IA ou com erro, ACEITA (o Luís revisa depois). */
export async function conferirFoto(bytes: Uint8Array, mime: string, f: Fetch = fetch): Promise<ConferenciaFoto> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, motivo: 'ok' }
  const tipo = /png/.test(mime) ? 'image/png' : /webp/.test(mime) ? 'image/webp' : 'image/jpeg'
  try {
    const bruto = await chamarClaude({
      max_tokens: 120,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: tipo, data: Buffer.from(bytes).toString('base64') } },
        { type: 'text', text: 'Esta foto será usada como referência do ROSTO para um ensaio fotográfico. Responda só um JSON: {"pessoa":bool,"rosto_visivel":bool,"nitida":bool,"parece_menor":bool,"famosa_ou_print":bool}. rosto_visivel = rosto de frente e inteiro; famosa_ou_print = celebridade, foto de revista, print de rede social de outra pessoa ou desenho.' },
      ] }],
    }, f)
    return lerConferencia(bruto)
  } catch (err) {
    console.error('[estudio/ana] conferência de foto falhou:', String(err).slice(0, 200))
    return { ok: true, motivo: 'ok' }
  }
}
