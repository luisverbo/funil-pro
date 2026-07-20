import { createAdminClient } from '@/lib/supabase/admin'
import { sendInstagramDM, sendInstagramActionButtons, sendPrivateReplyToComment, sendInstagramMedia } from '@/lib/instagram'
import { logOutbound } from '@/lib/instagram/inbox'

export interface DmButton {
  title: string
  url?: string
  // branch presente = botão de resposta que abre um fluxo próprio (SIM → estas mensagens)
  branch?: DmStep[]
}
export interface DmStep {
  delay_minutes?: number
  text?: string
  // url presente = botão de link; url vazio/ausente = botão de resposta rápida ("SIM")
  buttons?: DmButton[]
  media_url?: string
  media_type?: 'image' | 'video' | 'audio'
}

/** Passos da sequência de uma automação (compat: dm_message vira passo único) */
export function resolveSteps(auto: { dm_steps?: unknown; dm_message?: string | null }): DmStep[] {
  const steps = Array.isArray(auto.dm_steps) ? (auto.dm_steps as DmStep[]).filter(s => s && (s.text || s.media_url || (s.buttons?.length ?? 0) > 0)) : []
  if (steps.length > 0) return steps
  if (auto.dm_message) return [{ delay_minutes: 0, text: auto.dm_message }]
  return []
}

/** Dispara a sequência: passo imediato sai agora, os demais são agendados */
export async function startSequence(params: {
  tenantId: string
  automationId: string
  igUserId: string
  commentId?: string | null
  steps: DmStep[]
  admin: ReturnType<typeof createAdminClient>
}): Promise<void> {
  const { tenantId, automationId, igUserId, commentId, steps, admin } = params
  if (steps.length === 0) return

  let cumulativeMin = 0
  const jobs: { step_index: number; scheduled_for: string }[] = []

  for (let i = 0; i < steps.length; i++) {
    cumulativeMin += Math.max(0, steps[i].delay_minutes ?? 0)
    if (i === 0 && cumulativeMin === 0) {
      // 1º passo sem espera: envia já (private reply abre a conversa a partir do comentário)
      await sendStep(igUserId, commentId ?? null, steps[i]).catch(e => console.error('[ig-seq] passo 0', String(e)))
      await logOutbound(admin, tenantId, igUserId, steps[i].text || (steps[i].media_type ? `[${steps[i].media_type}]` : '(mensagem com botões)'), 'automation').catch(() => {})
      continue
    }
    jobs.push({ step_index: i, scheduled_for: new Date(Date.now() + cumulativeMin * 60_000).toISOString() })
  }

  if (jobs.length > 0) {
    await admin.from('ig_sequence_jobs').insert(jobs.map(j => ({
      tenant_id: tenantId, automation_id: automationId, ig_user_id: igUserId,
      comment_id: commentId ?? null, ...j,
    })))
  }
}

async function sendStep(igUserId: string, commentId: string | null, step: DmStep): Promise<void> {
  const text = step.text ?? ''
  const btns = (step.buttons ?? []).filter(b => b.title).map(b => ({ title: b.title, url: b.url }))

  // Mídia primeiro (imagem/vídeo/áudio), depois o texto/botões
  if (step.media_url && step.media_type) {
    await sendInstagramMedia(igUserId, step.media_url, step.media_type).catch(e => console.error('[ig-seq] media', String(e)))
    if (text) await sendInstagramDM(igUserId, text).catch(() => {})
    if (btns.length > 0) await sendInstagramActionButtons(igUserId, ' ', btns).catch(() => {})
    return
  }

  if (btns.length > 0) {
    // Botões full-width (link e/ou resposta) — todos com o MESMO visual do "Acessar"
    await sendInstagramActionButtons(igUserId, text || 'Toca no botão 👇', btns)
  } else if (commentId) {
    // private reply (via comentário) é o que garante a entrega da 1ª mensagem
    await sendPrivateReplyToComment(commentId, text).catch(async () => { await sendInstagramDM(igUserId, text) })
  } else {
    await sendInstagramDM(igUserId, text)
  }
}

/** Processa os passos agendados que venceram (chamado pelo cron a cada minuto) */
export async function processIgSequenceJobs(): Promise<{ sent: number }> {
  const admin = createAdminClient()
  const { data: jobs } = await admin
    .from('ig_sequence_jobs')
    .select('id, tenant_id, automation_id, ig_user_id, comment_id, step_index')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(20)
  if (!jobs || jobs.length === 0) return { sent: 0 }

  let sent = 0
  for (const job of jobs) {
    try {
      const { data: auto } = await admin
        .from('ig_automations').select('dm_steps, dm_message, status').eq('id', job.automation_id).single()
      if (!auto || auto.status !== 'active') {
        await admin.from('ig_sequence_jobs').update({ status: 'done' }).eq('id', job.id)
        continue
      }
      const steps = resolveSteps(auto)
      const step = steps[job.step_index]
      if (step) {
        // passos > 0 vão direto pra DM (a conversa já foi aberta pelo passo 0)
        await sendStep(job.ig_user_id, job.step_index === 0 ? job.comment_id : null, step)
        await logOutbound(admin, job.tenant_id, job.ig_user_id, step.text || (step.media_type ? `[${step.media_type}]` : '(mensagem com botões)'), 'automation').catch(() => {})
        sent++
      }
      await admin.from('ig_sequence_jobs').update({ status: 'done' }).eq('id', job.id)
    } catch (err) {
      console.error(`[ig-seq] job ${job.id} falhou: ${String(err)}`)
      await admin.from('ig_sequence_jobs').update({ status: 'failed', error: String(err).slice(0, 300) }).eq('id', job.id)
    }
  }
  return { sent }
}
