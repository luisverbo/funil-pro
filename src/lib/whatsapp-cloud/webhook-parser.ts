// ============================================================================
// Parser do webhook da Cloud API — puro e testável
// ----------------------------------------------------------------------------
// O envelope da Meta é estável: entry[].changes[].value com `messages`
// (entrada de lead) e `statuses` (sent/delivered/read das NOSSAS mensagens).
// Cada value carrega metadata.phone_number_id — é ele que roteia até a conta
// (e o tenant). A Meta REENVIA webhooks: o dedupe é pelo wamid, no banco.
// ============================================================================

export interface MensagemRecebida {
  phoneNumberId: string
  wamid: string
  de: string                 // telefone do lead, dígitos com DDI
  nome: string | null        // profiles[].name
  tipo: string               // text | image | audio | document | button | interactive | outro
  corpo: string              // texto, legenda, ou descrição do que chegou
  timestamp: number          // epoch segundos
}

export interface StatusEntrega {
  phoneNumberId: string
  wamid: string
  status: string             // sent | delivered | read | failed
  erro: string | null
}

export interface WebhookLido {
  mensagens: MensagemRecebida[]
  statuses: StatusEntrega[]
}

type Json = Record<string, unknown>

/** Texto humano do que chegou — mídia vira descrição, nunca campo vazio mudo. */
function corpoDaMensagem(m: Json): { tipo: string; corpo: string } {
  const tipo = String(m.type ?? 'outro')
  switch (tipo) {
    case 'text':
      return { tipo: 'texto', corpo: String((m.text as Json | undefined)?.body ?? '') }
    case 'button':
      return { tipo: 'texto', corpo: String((m.button as Json | undefined)?.text ?? '') }
    case 'interactive': {
      const i = m.interactive as Json | undefined
      const reply = (i?.button_reply ?? i?.list_reply) as Json | undefined
      return { tipo: 'texto', corpo: String(reply?.title ?? '') }
    }
    case 'image':
      return { tipo: 'imagem', corpo: String((m.image as Json | undefined)?.caption ?? '[📷 imagem]') }
    case 'audio':
      return { tipo: 'audio', corpo: '[🎙 áudio]' }
    case 'video':
      return { tipo: 'video', corpo: String((m.video as Json | undefined)?.caption ?? '[🎬 vídeo]') }
    case 'document':
      return { tipo: 'documento', corpo: `[📎 ${String((m.document as Json | undefined)?.filename ?? 'documento')}]` }
    case 'sticker':
      return { tipo: 'outro', corpo: '[figurinha]' }
    case 'location':
      return { tipo: 'outro', corpo: '[📍 localização]' }
    default:
      return { tipo: 'outro', corpo: `[${tipo}]` }
  }
}

export function lerWebhookCloud(payload: unknown): WebhookLido {
  const saida: WebhookLido = { mensagens: [], statuses: [] }
  const body = payload as { entry?: { changes?: { value?: Json }[] }[] } | null
  if (!body || body.entry === undefined) return saida

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue
      const phoneNumberId = String((value.metadata as Json | undefined)?.phone_number_id ?? '')
      if (!phoneNumberId) continue

      // Nome do perfil por telefone (contacts anda separado de messages)
      const nomes = new Map<string, string>()
      for (const c of (value.contacts as Json[] | undefined) ?? []) {
        const waId = String(c.wa_id ?? '')
        const nome = String((c.profile as Json | undefined)?.name ?? '')
        if (waId && nome) nomes.set(waId, nome)
      }

      for (const m of (value.messages as Json[] | undefined) ?? []) {
        const wamid = String(m.id ?? '')
        const de = String(m.from ?? '')
        if (!wamid || !de) continue
        const { tipo, corpo } = corpoDaMensagem(m)
        saida.mensagens.push({
          phoneNumberId,
          wamid,
          de,
          nome: nomes.get(de) ?? null,
          tipo,
          corpo,
          timestamp: Number(m.timestamp ?? 0) || 0,
        })
      }

      for (const st of (value.statuses as Json[] | undefined) ?? []) {
        const wamid = String(st.id ?? '')
        const status = String(st.status ?? '')
        if (!wamid || !status) continue
        const erros = st.errors as Json[] | undefined
        saida.statuses.push({
          phoneNumberId,
          wamid,
          status,
          erro: erros?.length ? String(erros[0]?.title ?? erros[0]?.message ?? 'erro') : null,
        })
      }
    }
  }
  return saida
}

/** A janela de 24h termina 24h após a mensagem do LEAD. */
export function novaJanela(timestampSegundos: number): string {
  return new Date(timestampSegundos * 1000 + 24 * 3600 * 1000).toISOString()
}

/** Ainda dá para mandar texto livre? (fora disso, só template) */
export function dentroDaJanela(janelaAte: string | null | undefined, agora: Date): boolean {
  if (!janelaAte) return false
  return new Date(janelaAte).getTime() > agora.getTime()
}
