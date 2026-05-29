import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage } from '../../evolution'
import { sendEmail } from '../../resend'

interface HandlerCtx {
  lead: { id: string; phone: string | null; email: string | null; name: string | null }
  block: { id: string; funnel_id: string; config: Record<string, unknown> }
  supabase: SupabaseClient
}

export async function handleMessage({ lead, block, supabase }: HandlerCtx): Promise<{ nextBlockId?: string; delayMs?: number }> {
  const config = block.config as { channel?: string; body?: string }
  const body = config.body ?? ''
  const channel = config.channel ?? 'whatsapp'

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
          await sendTextMessage(instance.instance_name, lead.phone, body)
        }
      } else {
        console.warn(`[message] Funil ${block.funnel_id} sem instância WA configurada`)
      }
    } else if (channel === 'email' && lead.email) {
      await sendEmail({
        from: 'FunilPro <funil@funil.pro>',
        to: lead.email,
        subject: 'Nova mensagem',
        html: `<p>${body}</p>`,
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
