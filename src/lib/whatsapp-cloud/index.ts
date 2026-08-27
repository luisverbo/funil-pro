// ============================================================================
// WhatsApp Cloud API (oficial da Meta) — envio e leitura de templates
// ----------------------------------------------------------------------------
// Cada conta conectada tem o PRÓPRIO token (wa_accounts.access_token) — o
// custo por conversa é cobrado pela Meta direto na WABA do cliente; o
// FunilPro não intermedia dinheiro.
//
// Regra de ouro da Cloud API: fora da JANELA DE 24H (última mensagem do
// lead + 24h) só sai TEMPLATE aprovado. Quem decide isso é o chamador,
// olhando wa_conversations.janela_ate — aqui só se envia.
// ============================================================================

const GRAPH = 'https://graph.facebook.com/v21.0'

export interface ContaCloud {
  phone_number_id: string
  access_token: string
}

async function chamarGraph(
  conta: ContaCloud,
  corpo: Record<string, unknown>,
): Promise<{ ok: true; wamid: string | null } | { ok: false; erro: string }> {
  try {
    const resp = await fetch(`${GRAPH}/${conta.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conta.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    })
    const json = await resp.json().catch(() => null) as {
      messages?: { id?: string }[]
      error?: { message?: string; error_data?: { details?: string } }
    } | null
    if (!resp.ok) {
      const detalhe = json?.error?.error_data?.details ?? json?.error?.message ?? `HTTP ${resp.status}`
      return { ok: false, erro: detalhe }
    }
    return { ok: true, wamid: json?.messages?.[0]?.id ?? null }
  } catch (err) {
    return { ok: false, erro: String(err) }
  }
}

/** Texto livre — só funciona DENTRO da janela de 24h. */
export function enviarTextoCloud(conta: ContaCloud, para: string, texto: string) {
  return chamarGraph(conta, {
    to: para,
    type: 'text',
    text: { body: texto, preview_url: true },
  })
}

/** Template aprovado — o único envio permitido fora da janela. */
export function enviarTemplateCloud(
  conta: ContaCloud,
  para: string,
  nome: string,
  idioma: string,
  variaveis: string[] = [],
) {
  return chamarGraph(conta, {
    to: para,
    type: 'template',
    template: {
      name: nome,
      language: { code: idioma || 'pt_BR' },
      ...(variaveis.length > 0
        ? { components: [{ type: 'body', parameters: variaveis.map(v => ({ type: 'text', text: v })) }] }
        : {}),
    },
  })
}

export interface TemplateCloud {
  name: string
  language: string
  status: string       // APPROVED | PENDING | REJECTED
  category: string
  corpo: string        // texto do BODY, para pré-visualizar
}

/** Templates da WABA — o inbox só oferece os APROVADOS para envio. */
export async function listarTemplatesCloud(
  wabaId: string,
  accessToken: string,
): Promise<{ ok: true; templates: TemplateCloud[] } | { ok: false; erro: string }> {
  try {
    const resp = await fetch(
      `${GRAPH}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const json = await resp.json().catch(() => null) as {
      data?: { name?: string; language?: string; status?: string; category?: string; components?: { type?: string; text?: string }[] }[]
      error?: { message?: string }
    } | null
    if (!resp.ok) return { ok: false, erro: json?.error?.message ?? `HTTP ${resp.status}` }
    return {
      ok: true,
      templates: (json?.data ?? []).map(t => ({
        name: String(t.name ?? ''),
        language: String(t.language ?? 'pt_BR'),
        status: String(t.status ?? ''),
        category: String(t.category ?? ''),
        corpo: t.components?.find(c => c.type === 'BODY')?.text ?? '',
      })),
    }
  } catch (err) {
    return { ok: false, erro: String(err) }
  }
}

// ─── Mídia ──────────────────────────────────────────────────────────────────

export type TipoMidiaCloud = 'image' | 'video' | 'audio' | 'document'

/**
 * Envia mídia por LINK público (o Storage hospeda; a Meta busca).
 * Limites da Cloud API: imagem 5MB (jpeg/png/webp), vídeo 16MB (mp4/3gpp),
 * áudio 16MB (aac/mp3/ogg-opus/amr/mp4), documento 100MB.
 * Legenda vale para imagem/vídeo/documento; áudio não tem legenda.
 */
export function enviarMidiaCloud(
  conta: ContaCloud,
  para: string,
  tipo: TipoMidiaCloud,
  link: string,
  caption?: string,
  filename?: string,
) {
  const media: Record<string, unknown> = { link }
  if (caption && tipo !== 'audio') media.caption = caption
  if (filename && tipo === 'document') media.filename = filename
  return chamarGraph(conta, { to: para, type: tipo, [tipo]: media })
}
