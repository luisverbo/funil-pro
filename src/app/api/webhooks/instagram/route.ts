import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { processAgentMessage } from '@/lib/agents/chat'
import { sendInstagramDM, replyToComment, sendPrivateReplyToComment } from '@/lib/instagram'

export const maxDuration = 60

// ─── GET: verificação do webhook (handshake da Meta) ────────────────────────
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const mode = sp.get('hub.mode')
  const token = sp.get('hub.verify_token')
  const challenge = sp.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.IG_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('forbidden', { status: 403 })
}

// Confere a assinatura X-Hub-Signature-256 (garante que veio da Meta)
function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.IG_APP_SECRET
  if (!secret) return true // sem secret configurado, não bloqueia (dev)
  if (!header) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header)) } catch { return false }
}

interface IgWebhook {
  object?: string
  entry?: Array<{
    id?: string
    messaging?: Array<{
      sender?: { id?: string }
      recipient?: { id?: string }
      message?: { mid?: string; text?: string; is_echo?: boolean }
    }>
    changes?: Array<{
      field?: string
      value?: {
        id?: string           // comment id
        text?: string
        from?: { id?: string; username?: string }
        media?: { id?: string }
      }
    }>
  }>
}

// Acha o agente que atende o Instagram deste tenant (channel 'instagram', ativo)
async function findInstagramAgent(admin: ReturnType<typeof createAdminClient>, igAccountId: string) {
  // Match por ig_account_id salvo no agente; senão, primeiro agente ativo com canal instagram
  const { data: byId } = await admin.from('ai_agents')
    .select('id, tenant_id').eq('status', 'active').eq('ig_account_id', igAccountId).limit(1).maybeSingle()
  if (byId) return byId
  const { data: any } = await admin.from('ai_agents')
    .select('id, tenant_id, channels').eq('status', 'active').contains('channels', ['instagram']).limit(1).maybeSingle()
  return any ?? null
}

// Acha ou cria o lead pelo IGSID (guardado em metadata.ig_user_id)
async function resolveLead(admin: ReturnType<typeof createAdminClient>, tenantId: string, igUserId: string, username?: string) {
  const { data: existing } = await admin.from('leads')
    .select('id').eq('tenant_id', tenantId).eq('metadata->>ig_user_id', igUserId).limit(1).maybeSingle()
  if (existing) return existing.id
  const { data: created } = await admin.from('leads').insert({
    tenant_id: tenantId, funnel_id: null, status: 'active',
    name: username ? `@${username}` : null,
    metadata: { ig_user_id: igUserId, source: 'instagram' },
  }).select('id').single()
  return created?.id ?? null
}

async function dispatchToAgent(agentId: string, leadId: string | null, text: string): Promise<string[]> {
  const result = await processAgentMessage(agentId, text, { leadId: leadId ?? undefined, channel: 'instagram' })
  return result.parts?.length ? result.parts : (result.reply ? [result.reply] : [])
}

// ─── POST: eventos (DM e comentários) ────────────────────────────────────────
export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (!validSignature(raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let body: IgWebhook
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ received: true }) }
  if (body.object !== 'instagram') return NextResponse.json({ received: true })

  const admin = createAdminClient()

  for (const entry of body.entry ?? []) {
    const igAccountId = entry.id ?? ''

    // DMs recebidas
    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue          // ignora ecos das próprias mensagens
      const senderId = m.sender?.id
      const text = m.message?.text?.trim()
      if (!senderId || !text) continue
      try {
        const agent = await findInstagramAgent(admin, igAccountId)
        if (!agent) continue
        const leadId = await resolveLead(admin, agent.tenant_id, senderId)
        const parts = await dispatchToAgent(agent.id, leadId, text)
        for (const p of parts) await sendInstagramDM(senderId, p).catch(e => console.error('[ig] sendDM', String(e)))
      } catch (err) {
        console.error('[ig] DM erro:', String(err))
      }
    }

    // Comentários novos em posts/reels
    for (const c of entry.changes ?? []) {
      if (c.field !== 'comments') continue
      const commentId = c.value?.id
      const text = c.value?.text?.trim()
      const fromId = c.value?.from?.id
      const mediaId = c.value?.media?.id
      if (!commentId || !text) continue
      // Não responde aos próprios comentários (quando o dono responde)
      if (fromId && fromId === igAccountId) continue
      try {
        const agent = await findInstagramAgent(admin, igAccountId)
        if (!agent) continue
        const leadId = fromId ? await resolveLead(admin, agent.tenant_id, fromId, c.value?.from?.username) : null

        // 1º: AUTOMAÇÕES (estilo ManyChat) — post + palavra-chave → resposta + DM
        const { data: autos } = await admin
          .from('ig_automations')
          .select('id, media_id, keywords, comment_replies, dm_message, dm_use_agent')
          .eq('tenant_id', agent.tenant_id)
          .eq('status', 'active')
        const lower = text.toLowerCase()
        const matches = (autos ?? []).filter(a => {
          if (a.media_id && a.media_id !== mediaId) return false
          const kws: string[] = a.keywords ?? []
          if (kws.length === 0) return true
          return kws.some(k => k && lower.includes(k.toLowerCase()))
        })
        // Mais específica vence: automação com post definido > automação geral
        const auto = matches.find(a => a.media_id) ?? matches[0]

        if (auto) {
          const replies: string[] = (auto.comment_replies ?? []).filter(Boolean)
          if (replies.length > 0) {
            // rotaciona por comentário para não parecer robô
            const pick = replies[Math.abs(commentId.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % replies.length]
            await replyToComment(commentId, pick.slice(0, 300)).catch(e => console.error('[ig] replyComment', String(e)))
          }
          if (auto.dm_message) {
            await sendPrivateReplyToComment(commentId, auto.dm_message).catch(e => console.error('[ig] privateReply', String(e)))
          }
          await admin.rpc('increment_ig_automation_triggers', { p_id: auto.id }).then(() => {}, () => {})
          continue
        }

        // 2º: fallback — agente IA responde o comentário (comportamento anterior)
        const parts = await dispatchToAgent(agent.id, leadId, text)
        const reply = parts.join(' ').slice(0, 260)
        if (reply) {
          await replyToComment(commentId, reply).catch(e => console.error('[ig] replyComment', String(e)))
          if (parts.length > 1) {
            await sendPrivateReplyToComment(commentId, parts.join('\n')).catch(() => {})
          }
        }
      } catch (err) {
        console.error('[ig] comment erro:', String(err))
      }
    }
  }

  return NextResponse.json({ received: true })
}
