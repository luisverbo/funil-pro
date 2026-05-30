import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import CaptureFormV2 from '@/components/public/capture-form-v2'

interface Props {
  params: Promise<{ funnelId: string }>
}

export default async function CapturePage({ params }: Props) {
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
  const headline = (config.headline as string) || funnel.name
  const subheadline = (config.subheadline as string) || 'Preencha seus dados e receba acesso imediato.'
  const ctaText = (config.cta_text as string) || 'Quero acesso agora'
  const ctaColor = (config.cta_color as string) || '#6366f1'
  const logoUrl = config.logo_url as string | undefined
  const bgImageUrl = config.bg_image_url as string | undefined
  const fieldsEnabled = (config.fields_enabled as Record<string, boolean>) ?? { name: true, phone: true, email: false }
  const thankYouPath = `/p/${funnelId}/obrigado`

  if (template === 'dark') {
    const benefits = (config.benefits as string[]) ?? []
    return (
      <div className="min-h-screen bg-[#0F0F0F] text-white flex items-center justify-center py-20 px-4">
        <div className="w-full max-w-lg mx-auto text-center">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="h-12 mx-auto mb-8 object-contain" />
          )}
          <h1 className="text-4xl font-bold mb-4 leading-tight">{headline}</h1>
          {benefits.length > 0 && (
            <ul className="mb-6 space-y-2 text-left inline-block">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-center gap-2 text-green-400 text-sm">
                  <span>✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {!benefits.length && (
            <p className="text-gray-400 mb-8">{subheadline}</p>
          )}
          <CaptureFormV2
            funnelId={funnelId}
            ctaText={ctaText}
            ctaColor={ctaColor}
            fieldsEnabled={fieldsEnabled}
            inputClassName="bg-[#1a1a1a] border-[#333] text-white placeholder-gray-500"
            thankYouPath={thankYouPath}
          />
        </div>
      </div>
    )
  }

  if (template === 'split') {
    return (
      <div className="lg:flex lg:min-h-screen">
        {/* Left */}
        <div
          className="lg:w-1/2 relative bg-gray-900 flex items-center justify-center p-12 min-h-64"
          style={bgImageUrl ? {
            backgroundImage: `url(${bgImageUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}}
        >
          {bgImageUrl && <div className="absolute inset-0 bg-black/60" />}
          <div className="relative z-10 text-white text-center lg:text-left max-w-md">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo" className="h-10 mb-6 object-contain" />
            )}
            <h1 className="text-3xl font-bold mb-4 leading-tight">{headline}</h1>
            <p className="text-white/70">{subheadline}</p>
          </div>
        </div>
        {/* Right */}
        <div className="lg:w-1/2 bg-white flex items-center justify-center p-12">
          <div className="w-full max-w-sm">
            <CaptureFormV2
              funnelId={funnelId}
              ctaText={ctaText}
              ctaColor={ctaColor}
              fieldsEnabled={fieldsEnabled}
              inputClassName="border-gray-300"
              thankYouPath={thankYouPath}
            />
          </div>
        </div>
      </div>
    )
  }

  // minimal (default)
  return (
    <div className="min-h-screen bg-white flex items-center justify-center py-20 px-4">
      <div className="w-full max-w-lg mx-auto text-center">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="h-12 mx-auto mb-8 object-contain" />
        )}
        <h1 className="text-4xl font-bold text-gray-900 mb-4 leading-tight">{headline}</h1>
        <p className="text-gray-500 mb-8">{subheadline}</p>
        <CaptureFormV2
          funnelId={funnelId}
          ctaText={ctaText}
          ctaColor={ctaColor}
          fieldsEnabled={fieldsEnabled}
          inputClassName="border-gray-300"
          thankYouPath={thankYouPath}
        />
      </div>
    </div>
  )
}
