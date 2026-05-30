import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props {
  params: Promise<{ funnelId: string }>
}

export default async function ThankYouPage({ params }: Props) {
  const { funnelId } = await params

  const admin = createAdminClient()
  const { data: funnel } = await admin
    .from('funnels')
    .select('id, name, page_template, page_config')
    .eq('id', funnelId)
    .single()

  if (!funnel) notFound()

  const config = ((funnel as unknown as Record<string, unknown>).page_config ?? {}) as Record<string, unknown>
  const template = ((funnel as unknown as Record<string, unknown>).page_template as string) ?? 'minimal'
  const thankYouMessage = (config.thank_you_message as string) || 'Obrigado! Verifique seu WhatsApp.'
  const redirectUrl = config.redirect_url as string | undefined
  const ctaColor = (config.cta_color as string) || '#6366f1'

  const content = (
    <div className="text-center max-w-md mx-auto">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
        <span className="text-green-600 text-4xl font-bold">✓</span>
      </div>
      <p className="text-xl font-semibold mb-6">{thankYouMessage}</p>
      {redirectUrl && (
        <Link
          href={redirectUrl}
          style={{ backgroundColor: ctaColor }}
          className="inline-block px-6 py-3 rounded-lg text-white font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Continuar →
        </Link>
      )}
    </div>
  )

  if (template === 'dark') {
    return (
      <div className="min-h-screen bg-[#0F0F0F] text-white flex items-center justify-center py-20 px-4">
        {content}
      </div>
    )
  }

  if (template === 'split') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center py-20 px-4">
        {content}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center py-20 px-4">
      {content}
    </div>
  )
}
