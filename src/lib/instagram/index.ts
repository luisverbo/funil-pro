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

export interface IgButton { title: string; url: string }

/** Botões full-width no balão (como o "Acessar"): link (web_url) OU resposta (postback).
 *  Botão sem url vira postback — visualmente idêntico ao de link, e ao tocar
 *  manda um evento pro webhook (renova a janela de 24h, avança a sequência). */
export async function sendInstagramActionButtons(recipientId: string, text: string, buttons: { title: string; url?: string }[]): Promise<void> {
  const valid = buttons.filter(b => b.title).slice(0, 3)
  if (valid.length === 0) return sendInstagramDM(recipientId, text)
  const res = await fetch(`${GRAPH}/v21.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: (text || ' ').slice(0, 640),
            buttons: valid.map(b => b.url
              ? { type: 'web_url', url: b.url, title: b.title.slice(0, 20) }
              : { type: 'postback', title: b.title.slice(0, 20), payload: b.title.slice(0, 20) }),
          },
        },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`IG actionButtons ${res.status}: ${body}`)
    // Fallback: links no texto + resposta rápida pros de postback
    const links = valid.filter(b => b.url)
    const replies = valid.filter(b => !b.url).map(b => b.title)
    const withLinks = links.length > 0 ? `${text}\n\n${links.map(b => `${b.title}: ${b.url}`).join('\n')}` : text
    if (replies.length > 0) await sendInstagramQuickReplies(recipientId, withLinks, replies)
    else await sendInstagramDM(recipientId, withLinks)
  }
}

/** Envia DM com botões de link (button template); fallback: texto com os links */
export async function sendInstagramButtons(recipientId: string, text: string, buttons: IgButton[]): Promise<void> {
  const valid = buttons.filter(b => b.title && b.url).slice(0, 3)
  if (valid.length === 0) return sendInstagramDM(recipientId, text)
  const res = await fetch(`${GRAPH}/v21.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: text.slice(0, 640),
            buttons: valid.map(b => ({ type: 'web_url', url: b.url, title: b.title.slice(0, 20) })),
          },
        },
      },
    }),
  })
  if (!res.ok) {
    // Fallback: alguns tipos de conta não aceitam template — manda texto com links
    const fallback = `${text}\n\n${valid.map(b => `${b.title}: ${b.url}`).join('\n')}`
    await sendInstagramDM(recipientId, fallback)
  }
}

/** Envia DM com botões de resposta rápida (quick replies) — a pessoa toca e o
 *  texto vira resposta dela (renova a janela de 24h do Instagram) */
export async function sendInstagramQuickReplies(recipientId: string, text: string, options: string[]): Promise<void> {
  const valid = options.filter(Boolean).slice(0, 13)
  if (valid.length === 0) return sendInstagramDM(recipientId, text)
  const res = await fetch(`${GRAPH}/v21.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        text: text.slice(0, 1000),
        quick_replies: valid.map(o => ({ content_type: 'text', title: o.slice(0, 20), payload: o.slice(0, 20) })),
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`IG quickReplies ${res.status}: ${body}`)
    await sendInstagramDM(recipientId, `${text}\n\n(responde com: ${valid.join(' / ')})`)
  }
}

/** Perfil do usuário que interagiu — nome, @, foto, seguidores e se SEGUE a conta */
export async function getIgUserProfile(igsid: string): Promise<{
  name?: string; username?: string; profilePic?: string; followers?: number; follows: boolean | null
}> {
  try {
    const res = await fetch(`${GRAPH}/v21.0/${igsid}?fields=name,username,profile_pic,follower_count,is_user_follow_business`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
    const json = await res.json().catch(() => null) as {
      name?: string; username?: string; profile_pic?: string; follower_count?: number; is_user_follow_business?: boolean
    } | null
    if (!res.ok || !json) return { follows: null }
    return {
      name: json.name, username: json.username, profilePic: json.profile_pic,
      followers: json.follower_count, follows: json.is_user_follow_business ?? null,
    }
  } catch { return { follows: null } }
}
