import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Script from 'next/script'
import CaptureForm from '@/components/public/capture-form'

export default async function PublicCapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const { id } = await params
  const sp = await searchParams

  const supabase = createAdminClient()

  const { data: funnel } = await supabase
    .from('funnels')
    .select('id, name, status, tenant_id')
    .eq('id', id)
    .single()

  if (!funnel || funnel.status !== 'published') notFound()

  // Get tenant to check for meta pixel
  const { data: tenant } = await supabase
    .from('tenants')
    .select('meta_ad_account_id')
    .eq('id', funnel.tenant_id)
    .single()

  const pixelId = (tenant as unknown as { pixel_meta_id?: string } | null)?.pixel_meta_id ?? null

  const utms = {
    utm_source: sp.utm_source,
    utm_campaign: sp.utm_campaign,
    utm_campaign_id: sp.utm_campaign_id,
    utm_adset_id: sp.utm_adset_id,
    utm_ad_id: sp.utm_ad_id,
    utm_content: sp.utm_content,
    referrer_url: sp.referrer_url,
    landing_url: sp.landing_url,
  }

  return (
    <>
      {pixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixelId}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}

      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-indigo-600">
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{funnel.name}</h1>
              <p className="text-gray-500 text-sm mt-2">Preencha seus dados para continuar</p>
            </div>

            <CaptureForm
              funnelId={id}
              funnelName={funnel.name}
              initialUtms={utms}
              pixelId={pixelId}
            />
          </div>
        </div>
      </div>
    </>
  )
}
