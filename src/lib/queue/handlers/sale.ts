import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage } from '../../evolution'
import { sendEmail } from '../../resend'

interface HandlerCtx {
  lead: { id: string; phone: string | null; email: string | null; name: string | null }
  block: { id: string; funnel_id: string; config: Record<string, unknown> }
  supabase: SupabaseClient
}

export async function handleSale({ lead, block, supabase }: HandlerCtx): Promise<{ nextBlockId?: string }> {
  const config = block.config as { payment_link?: string; product_name?: string }
  const productName = config.product_name ?? 'nosso produto'
  const paymentLink = config.payment_link ?? ''
  const firstName = lead.name?.split(' ')[0] ?? 'Olá'

  const message = `Olá ${firstName}! Aqui está o link para adquirir ${productName}: ${paymentLink}`

  try {
    if (lead.phone) {
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
          await sendTextMessage(instance.instance_name, lead.phone, message)
        }
      }
    } else if (lead.email) {
      await sendEmail({
        from: 'FunilPro <funil@funil.pro>',
        to: lead.email,
        subject: `Seu link para ${productName}`,
        html: `<p>${message}</p>`,
      })
    }
  } catch (err) {
    console.error('[sale] Erro ao enviar link de venda:', err)
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
