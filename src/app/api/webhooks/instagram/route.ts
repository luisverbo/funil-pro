import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { processAgentMessage, enrollInFunnel } from '@/lib/agents/chat'
import { sendInstagramDM, replyToComment, sendPrivateReplyToComment, sendInstagramActionButtons, getIgUserProfile } from '@/lib/instagram'
import { resolveSteps, startSequence, type DmStep } from '@/lib/instagram/sequence'
import { logInbound, logOutbound } from '@/lib/instagram/inbox'

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
      message?: { mid?: string; text?: string; is_echo?: boolean; reply_to?: { story?: { id?: string; url?: string } } }
      postback?: { mid?: string; title?: string; payload?: string }
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

// Acha ou cria o lead pelo IGSID — enriquecido com o perfil do Instagram
// (nome, @, foto, seguidores) via API
async function resolveLead(admin: ReturnType<typeof createAdminClient>, tenantId: string, igUserId: string, username?: string) {
  const { data: existing } = await admin.from('leads')
    .select('id, name, metadata').eq('tenant_id', tenantId).eq('metadata->>ig_user_id', igUserId).limit(1).maybeSingle()

  // Perfil (busca 1x; se o lead já tem foto no metadata, não repete a chamada)
  const meta = (existing?.metadata ?? {}) as Record<string, unknown>
  let profile: Awaited<ReturnType<typeof getIgUserProfile>> | null = null
  if (!existing || !meta.ig_profile_pic) {
    profile = await getIgUserProfile(igUserId).catch(() => null)
  }

  if (existing) {
    if (profile && (profile.username || profile.profilePic)) {
      await admin.from('leads').update({
        name: existing.name || profile.name || (profile.username ? `@${profile.username}` : null) || undefined,
        metadata: {
          ...meta,
          ig_username: profile.username ?? meta.ig_username,
          ig_profile_pic: profile.profilePic ?? meta.ig_profile_pic,
          ig_followers: profile.followers ?? meta.ig_followers,
        },
      }).eq('id', existing.id)
    }
    return existing.id
  }

  const displayName = profile?.name || (profile?.username ? `@${profile.username}` : null) || (username ? `@${username}` : null)
  const { data: created } = await admin.from('leads').insert({
    tenant_id: tenantId, funnel_id: null, status: 'active',
    name: displayName,
    metadata: {
      ig_user_id: igUserId, source: 'instagram',
      ig_username: profile?.username ?? username ?? null,
      ig_profile_pic: profile?.profilePic ?? null,
      ig_followers: profile?.followers ?? null,
    },
  }).select('id').single()
  return created?.id ?? null
}

// Registra o contato que entrou numa automação (aparece no card "ver contatos")
async function recordAutomationContact(admin: ReturnType<typeof createAdminClient>, tenantId: string, automationId: string, igUserId: string) {
  try {
    const p = await getIgUserProfile(igUserId).catch(() => null)
    await admin.from('ig_automation_contacts').upsert({
      tenant_id: tenantId, automation_id: automationId, ig_user_id: igUserId,
      name: p?.name ?? null, username: p?.username ?? null, profile_pic: p?.profilePic ?? null,
      last_at: new Date().toISOString(),
    }, { onConflict: 'automation_id,ig_user_id' })
  } catch (e) { console.error('[ig] recordContact', String(e)) }
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
      // Toque em botão (postback) conta como resposta: usa o payload/título como texto
      const text = (m.message?.text ?? m.postback?.payload ?? m.postback?.title ?? '').trim()
      if (!senderId || !text) continue
      try {
        // INBOX: registra a mensagem recebida na thread. Se você ASSUMIU a conversa
        // (human_mode), IA e automações ficam de fora — só registra e segue.
        let inboxTenant: string | null = null
        {
          const { data: th } = await admin.from('ig_threads')
            .select('tenant_id').eq('ig_user_id', senderId).limit(1).maybeSingle()
          inboxTenant = th?.tenant_id ?? null
          if (!inboxTenant) {
            const ag = await findInstagramAgent(admin, igAccountId)
            inboxTenant = ag?.tenant_id ?? null
          }
          if (!inboxTenant) {
            const { data: au } = await admin.from('ig_automations').select('tenant_id').eq('status', 'active').limit(1).maybeSingle()
            inboxTenant = au?.tenant_id ?? null
          }
        }
        if (inboxTenant) {
          const logged = await logInbound(admin, inboxTenant, senderId, text).catch(() => null)
          if (logged?.humanMode) {
            console.log('[ig] thread em modo humano — automações/IA pausadas')
            continue
          }
        }

        // FOLLOW GATE pendente? Pessoa respondeu — checa se agora está seguindo
        const { data: gated } = await admin
          .from('ig_sequence_jobs')
          .select('id, tenant_id, automation_id, comment_id')
          .eq('ig_user_id', senderId).eq('status', 'gated')
          .order('created_at', { ascending: false }).limit(1)
        if (gated && gated.length > 0) {
          const profile = await getIgUserProfile(senderId)
          if (profile.follows) {
            // seguiu → libera a sequência completa
            await admin.from('ig_sequence_jobs').update({ status: 'done' })
              .eq('ig_user_id', senderId).eq('status', 'gated')
            const { data: auto } = await admin
              .from('ig_automations').select('tenant_id, dm_steps, dm_message').eq('id', gated[0].automation_id).single()
            if (auto) {
              await startSequence({
                tenantId: auto.tenant_id, automationId: gated[0].automation_id,
                igUserId: senderId, commentId: null, steps: resolveSteps(auto), admin,
              }).catch(e => console.error('[ig] gate release', String(e)))
            }
            console.log('[ig] follow gate liberado — sequência iniciada')
          } else {
            await sendInstagramActionButtons(senderId,
              'Ainda não achei seu follow 🥲 Me segue no perfil e toca de novo 👇', [{ title: 'JÁ SIGO ✅' }]).catch(() => {})
            await logOutbound(admin, gated[0].tenant_id, senderId, 'Ainda não achei seu follow 🥲 Me segue no perfil e toca de novo 👇', 'gate').catch(() => {})
          }
          continue   // gate resolve a interação; agente não entra aqui
        }

        // Pessoa respondeu na DM. Duas situações:
        // a) tocou num BOTÃO DE RESPOSTA da sequência (ex: "SIM") → renova a janela
        //    de 24h e ADIANTA o próximo passo pra agora (a sequência continua)
        // b) resposta livre → pausa os passos agendados e o agente IA assume
        const { data: pendingJobs } = await admin
          .from('ig_sequence_jobs')
          .select('id, automation_id, step_index, scheduled_for')
          .eq('ig_user_id', senderId).eq('status', 'pending')
          .order('scheduled_for', { ascending: true })

        if (pendingJobs && pendingJobs.length > 0) {
          const { data: auto } = await admin
            .from('ig_automations').select('tenant_id, dm_steps').eq('id', pendingJobs[0].automation_id).single()
          type Btn = { title?: string; url?: string; branch?: DmStep[] }
          type St = { buttons?: Btn[] }
          // Achata TODOS os botões da árvore (passos + ramificações aninhadas)
          const flatten = (chain: St[]): Btn[] => (chain ?? []).flatMap(s =>
            (s.buttons ?? []).flatMap(b => [b, ...(b.branch ? flatten(b.branch as St[]) : [])]))
          const allBtns = Array.isArray(auto?.dm_steps) ? flatten(auto.dm_steps as St[]) : []
          const norm = text.toLowerCase().trim()
          const matchedBtn = allBtns.find(b => !b.url && b.title && b.title.toLowerCase().trim() === norm)

          if (matchedBtn) {
            // RAMIFICAÇÃO: botão de resposta abre um fluxo próprio → cancela a sequência
            // atual e dispara o fluxo do botão (SIM tem um caminho, NÃO outro)
            if (matchedBtn.branch && matchedBtn.branch.length > 0) {
              await admin.from('ig_sequence_jobs').update({ status: 'cancelled' }).eq('ig_user_id', senderId).eq('status', 'pending')
              await startSequence({
                tenantId: auto!.tenant_id, automationId: pendingJobs[0].automation_id, igUserId: senderId,
                commentId: null, steps: matchedBtn.branch, admin,
              }).catch(e => console.error('[ig] branch', String(e)))
              console.log(`[ig] ramificação "${text}" → fluxo próprio (${matchedBtn.branch.length} msg) iniciado`)
              continue
            }
            // sem branch: só adianta o próximo passo (comportamento antigo)
            await admin.from('ig_sequence_jobs').update({ scheduled_for: new Date().toISOString() }).eq('id', pendingJobs[0].id)
            console.log(`[ig] quick reply "${text}" — próximo passo adiantado`)
            continue
          }

          await admin.from('ig_sequence_jobs').update({ status: 'cancelled' })
            .eq('ig_user_id', senderId).eq('status', 'pending')
          console.log(`[ig] ${pendingJobs.length} passo(s) cancelados — lead respondeu livre, agente assume`)
        }
        // GATILHOS DE DM (estilo ManyChat): palavra-chave na DM ou resposta a Story
        const isStoryReply = !!m.message?.reply_to?.story
        const { data: dmAutos } = await admin
          .from('ig_automations')
          .select('id, tenant_id, keywords, dm_message, dm_steps, funnel_id, lead_tag, trigger_type')
          .eq('status', 'active')
          .in('trigger_type', ['dm', 'story_reply'])
        const lowerDm = text.toLowerCase()
        const dmMatch = (dmAutos ?? []).find(a => {
          if (a.trigger_type === 'story_reply' && !isStoryReply) return false
          if (a.trigger_type === 'dm' && isStoryReply) return false
          const kws: string[] = a.keywords ?? []
          if (kws.length === 0) return a.trigger_type === 'story_reply'   // DM sem keyword só p/ story (senão dispara em tudo)
          return kws.some(k => k && lowerDm.includes(k.toLowerCase()))
        })
        if (dmMatch) {
          console.log(`[ig] gatilho de ${dmMatch.trigger_type === 'story_reply' ? 'story' : 'DM'} disparado: ${dmMatch.id}`)
          const leadId = await resolveLead(admin, dmMatch.tenant_id, senderId)
          if (leadId && dmMatch.lead_tag) {
            const { data: l } = await admin.from('leads').select('tags').eq('id', leadId).single()
            const tags: string[] = Array.isArray(l?.tags) ? l.tags : []
            if (!tags.includes(dmMatch.lead_tag)) await admin.from('leads').update({ tags: [...tags, dmMatch.lead_tag] }).eq('id', leadId)
          }
          if (leadId && dmMatch.funnel_id) {
            await enrollInFunnel(leadId, dmMatch.funnel_id, dmMatch.tenant_id, admin).catch(() => {})
          }
          await startSequence({
            tenantId: dmMatch.tenant_id, automationId: dmMatch.id, igUserId: senderId,
            commentId: null, steps: resolveSteps(dmMatch), admin,
          }).catch(e => console.error('[ig] dm startSequence', String(e)))
          await admin.rpc('increment_ig_automation_triggers', { p_id: dmMatch.id }).then(() => {}, () => {})
          await recordAutomationContact(admin, dmMatch.tenant_id, dmMatch.id, senderId)
          continue
        }

        const agent = await findInstagramAgent(admin, igAccountId)
        if (!agent) continue
        const leadId = await resolveLead(admin, agent.tenant_id, senderId)
        const parts = await dispatchToAgent(agent.id, leadId, text)
        for (const p of parts) {
          await sendInstagramDM(senderId, p).catch(e => console.error('[ig] sendDM', String(e)))
          await logOutbound(admin, agent.tenant_id, senderId, p, 'agent').catch(() => {})
        }
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
        console.log(`[ig] comentário recebido: media=${mediaId} from=${fromId} texto="${text.slice(0, 60)}"`)

        // 1º: AUTOMAÇÕES (estilo ManyChat) — independem de agente IA configurado.
        // O tenant vem da própria automação (a conta conectada é única por instalação).
        const { data: autos } = await admin
          .from('ig_automations')
          .select('id, tenant_id, media_id, keywords, comment_replies, dm_message, dm_steps, dm_use_agent, funnel_id, lead_tag, follow_gate, follow_gate_message')
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
        console.log(`[ig] automações ativas=${autos?.length ?? 0} match=${auto?.id ?? 'nenhum'}`)

        if (auto) {
          // Captura o LEAD (estilo ManyChat): cria/acha pelo IGSID, aplica tag e matricula no funil
          let leadId: string | null = null
          if (fromId) {
            leadId = await resolveLead(admin, auto.tenant_id, fromId, c.value?.from?.username)
            if (leadId && auto.lead_tag) {
              const { data: l } = await admin.from('leads').select('tags').eq('id', leadId).single()
              const tags: string[] = Array.isArray(l?.tags) ? l.tags : []
              if (!tags.includes(auto.lead_tag)) {
                await admin.from('leads').update({ tags: [...tags, auto.lead_tag] }).eq('id', leadId)
              }
            }
            if (leadId && auto.funnel_id) {
              await enrollInFunnel(leadId, auto.funnel_id, auto.tenant_id, admin)
                .catch(e => console.error('[ig] enrollInFunnel', String(e)))
            }
          }

          const replies: string[] = (auto.comment_replies ?? []).filter(Boolean)
          if (replies.length > 0) {
            // rotaciona por comentário para não parecer robô
            const pick = replies[Math.abs(commentId.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % replies.length]
            await replyToComment(commentId, pick.slice(0, 300)).catch(e => console.error('[ig] replyComment', String(e)))
          }
          // FOLLOW GATE: exige seguir o perfil antes de liberar a sequência
          if (fromId && auto.follow_gate) {
            const profile = await getIgUserProfile(fromId)
            if (profile.follows === false) {
              const gateMsg = auto.follow_gate_message?.trim() ||
                'Opa! 🔒 Esse conteúdo é exclusivo pra quem me segue. Me segue lá no perfil e toca no botão abaixo que eu libero na hora 👇'
              await sendPrivateReplyToComment(commentId, gateMsg).catch(e => console.error('[ig] gate privateReply', String(e)))
              await logOutbound(admin, auto.tenant_id, fromId, gateMsg, 'gate').catch(() => {})
              await sendInstagramActionButtons(fromId, 'Quando seguir, me avisa 👇', [{ title: 'JÁ SIGO ✅' }]).catch(() => {})
              // marcador: quando a pessoa responder e estiver seguindo, a sequência libera
              await admin.from('ig_sequence_jobs').insert({
                tenant_id: auto.tenant_id, automation_id: auto.id, ig_user_id: fromId,
                comment_id: commentId, step_index: -1, scheduled_for: new Date().toISOString(), status: 'gated',
              })
              await admin.rpc('increment_ig_automation_triggers', { p_id: auto.id }).then(() => {}, () => {})
              continue
            }
          }

          // Sequência de DMs: passo 0 pode sair já ou com espera; os demais são agendados
          if (fromId) {
            const steps = resolveSteps(auto)
            await startSequence({
              tenantId: auto.tenant_id, automationId: auto.id, igUserId: fromId,
              commentId, steps, admin,
            }).catch(e => console.error('[ig] startSequence', String(e)))
          }
          await admin.rpc('increment_ig_automation_triggers', { p_id: auto.id }).then(() => {}, () => {})
          if (fromId) await recordAutomationContact(admin, auto.tenant_id, auto.id, fromId)
          continue
        }

        // 2º: fallback — agente IA responde o comentário (se houver agente com canal IG)
        const agent = await findInstagramAgent(admin, igAccountId)
        if (!agent) { console.log('[ig] sem automação e sem agente IG — ignorando'); continue }
        const leadId = fromId ? await resolveLead(admin, agent.tenant_id, fromId, c.value?.from?.username) : null
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
