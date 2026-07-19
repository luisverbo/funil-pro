// Cliente da Instagram API (com login do Instagram). Envio de DM e resposta a
// comentários usando o token de acesso da conta profissional.

const GRAPH = 'https://graph.instagram.com'

function token(): string {
  const t = process.env.IG_ACCESS_TOKEN
  if (!t) throw new Error('IG_ACCESS_TOKEN ausente')
  return t
}

/** Envia uma DM para um usuário do Instagram (recipientId = IGSID do lead) */
export async function sendInstagramDM(recipientId: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH}/v21.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG sendDM ${res.status}: ${body}`)
  }
}

/** Responde publicamente a um comentário */
export async function replyToComment(commentId: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH}/v21.0/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ message: text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG replyComment ${res.status}: ${body}`)
  }
}

/** Manda DM privada para quem comentou (padrão ManyChat: comentou → cai na DM) */
export async function sendPrivateReplyToComment(commentId: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH}/v21.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG privateReply ${res.status}: ${body}`)
  }
}

export interface IgMedia {
  id: string
  caption?: string
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  permalink?: string
  timestamp?: string
}

/** Lista os posts recentes da conta conectada (para o seletor de post) */
export async function listRecentMedia(limit = 24): Promise<IgMedia[]> {
  const res = await fetch(
    `${GRAPH}/v21.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token()}` } }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG listMedia ${res.status}: ${body}`)
  }
  const json = await res.json() as { data?: IgMedia[] }
  return json.data ?? []
}

/** Verifica a conexão: retorna o @ da conta se o token estiver válido */
export async function getConnectedAccount(): Promise<{ connected: boolean; username?: string; accountId?: string; error?: string }> {
  const t = process.env.IG_ACCESS_TOKEN
  if (!t) return { connected: false, error: 'token_missing' }
  try {
    const res = await fetch(`${GRAPH}/v21.0/me?fields=user_id,username`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    const json = await res.json().catch(() => null) as { user_id?: string; id?: string; username?: string; error?: { message?: string } } | null
    if (!res.ok || !json || json.error) return { connected: false, error: json?.error?.message ?? `status ${res.status}` }
    return { connected: true, username: json.username, accountId: json.user_id ?? json.id }
  } catch (err) {
    return { connected: false, error: String(err) }
  }
}
