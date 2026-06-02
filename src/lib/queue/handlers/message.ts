import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage, sendMediaMessage } from '../../evolution'
import { sendEmail } from '../../resend'

interface HandlerCtx {
  lead: { id: string; phone: string | null; email: string | null; name: string | null }
  block: { id: string; funnel_id: string; config: Record<string, unknown> }
  supabase: SupabaseClient
}

type MediaType = 'none' | 'image' | 'video' | 'document'

function interpolate(
  text: string,
  lead: { name: string | null; phone: string | null; email: string | null }
): string {
  const firstName = lead.name?.split(' ')[0] ?? ''
  const now = new Date()
  return text
    .replace(/{nome}/g, lead.name ?? '')
    .replace(/{primeiro_nome}/g, firstName)
    .replace(/{email}/g, lead.email ?? '')
    .replace(/{telefone}/g, lead.phone ?? '')
    .replace(/{data}/g, now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
    .replace(/{hora}/g, now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))
}

export async function handleMessage({ lead, block, supabase }: HandlerCtx): Promise<{ nextBlockId?: string }> {
  const config = block.config as {
    channel?: string
    body?: string
    media_type?: MediaType
    media_url?: string
  }
  const rawBody = config.body ?? ''
  const body = interpolate(rawBody, lead)
  const channel = config.channel ?? 'whatsapp'
  const mediaType = config.media_type ?? 'none'
  const mediaUrl = config.media_url ?? ''

  try {
    if (channel === 'whatsapp' && lead.phone) {
      const { data: funnel } = await supabase
        .from('funnels')
        .select('whatsapp_instance_id')
        .eq('id', block.funnel_id)
        .single()

      if (funnel?.whatsapp_instance_id) {
        const { data: instance } = await supabase
          .from('whatsapp_instances')
          .select('instance_name')
          .eq('id', funnel.whatsapp_instance_id)
          .single()

        if (instance?.instance_name) {
          if (mediaType !== 'none' && mediaUrl) {
            await sendMediaMessage(
              instance.instance_name,
              lead.phone,
              mediaUrl,
              mediaType as 'image' | 'video' | 'document',
              body
            )
          } else {
            await sendTextMessage(instance.instance_name, lead.phone, body)
          }
        }
      } else {
        console.warn(`[message] Funil ${block.funnel_id} sem instância WA configurada`)
      }
    } else if (channel === 'email' && lead.email) {
      const htmlBody = mediaUrl && mediaType !== 'none'
        ? `<p>${body}</p><p><a href="${mediaUrl}" target="_blank">📎 Clique aqui para acessar o anexo</a></p>`
        : `<p>${body}</p>`

      await sendEmail({
        from: 'FunilPro <funil@funil.pro>',
        to: lead.email,
        subject: 'Nova mensagem',
        html: htmlBody,
      })
    }
  } catch (err) {
    console.error('[message] Erro ao enviar mensagem:', err)
  }

  const { data: edge } = await supabase
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', block.funnel_id)
    .eq('source_block_id', block.id)
    .limit(1)
    .single()

  return { nextBlockId: edge?.target_block_id ?? undefined }
}
