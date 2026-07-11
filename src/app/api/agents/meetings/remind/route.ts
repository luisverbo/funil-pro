import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/evolution'
import { sendEmail } from '@/lib/resend'

export const maxDuration = 60

// Rótulo pt-BR de um horário (fuso Brasil)
function fmtBR(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

async function run() {
  const admin = createAdminClient()
  const now = Date.now()
  // Janela: reuniões que começam entre agora e daqui a 65 min, ainda sem lembrete.
  // O cron roda de tempos em tempos; a janela larga garante que ninguém escape.
  const windowEnd = new Date(now + 65 * 60_000).toISOString()
  const nowIso = new Date(now).toISOString()

  const { data: meetings, error } = await admin
    .from('agent_meetings')
    .select('id, agent_id, tenant_id, scheduled_at, duration_minutes, topic, lead_name, lead_email, lead_phone, meeting_url')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gte('scheduled_at', nowIso)
    .lte('scheduled_at', windowEnd)
    .limit(50)

  if (error) return { sent: 0, error: error.message }
  if (!meetings || meetings.length === 0) return { sent: 0 }

  let sent = 0
  for (const m of meetings) {
    try {
      const when = fmtBR(m.scheduled_at)
      const firstName = (m.lead_name ?? '').split(' ')[0] || ''
      const link = m.meeting_url ? `\nLink da reunião: ${m.meeting_url}` : ''

      // Dados do agente para envio (nome + instância WA + resend key do tenant)
      const { data: agent } = await admin
        .from('ai_agents').select('name, whatsapp_instance_id, tenant_id').eq('id', m.agent_id).single()
      const agentName = agent?.name ?? 'Equipe'

      // WhatsApp (se houver telefone + instância do agente)
      if (m.lead_phone && agent?.whatsapp_instance_id) {
        const { data: inst } = await admin
          .from('whatsapp_instances').select('instance_name').eq('id', agent.whatsapp_instance_id).single()
        if (inst?.instance_name) {
          const msg = `Oi${firstName ? ` ${firstName}` : ''}! 👋 Passando pra lembrar da nossa reunião ${when}.${link}\nQualquer imprevisto é só me avisar por aqui.`
          await sendTextMessage(inst.instance_name, m.lead_phone, msg).catch(err =>
            console.error(`[remind] WA falhou meeting=${m.id}: ${String(err)}`))
        }
      }

      // E-mail (se houver e-mail + Resend configurado no tenant)
      if (m.lead_email) {
        const { data: tenant } = await admin
          .from('tenants').select('resend_api_key').eq('id', m.tenant_id).single()
        const apiKey = tenant?.resend_api_key || process.env.RESEND_API_KEY
        if (apiKey) {
          const html = `<div style="font-family:sans-serif;font-size:15px;color:#111">
            <p>Oi${firstName ? ` ${firstName}` : ''}! 👋</p>
            <p>Passando pra lembrar da nossa reunião <strong>${when}</strong>.</p>
            ${m.meeting_url ? `<p>Link da reunião: <a href="${m.meeting_url}">${m.meeting_url}</a></p>` : ''}
            <p>Até já!<br/>${agentName}</p>
          </div>`
          await sendEmail({
            apiKey, from: 'lembrete@funil.pro', to: m.lead_email,
            subject: `Lembrete: nossa reunião ${when}`, html,
          }).catch(err => console.error(`[remind] email falhou meeting=${m.id}: ${String(err)}`))
        }
      }

      await admin.from('agent_meetings').update({ reminder_sent_at: new Date().toISOString() }).eq('id', m.id)
      sent++
    } catch (err) {
      console.error(`[remind] erro no meeting ${m.id}: ${String(err)}`)
    }
  }
  return { sent }
}

export async function GET() {
  const result = await run()
  return NextResponse.json(result)
}

export async function POST() {
  const result = await run()
  return NextResponse.json(result)
}
