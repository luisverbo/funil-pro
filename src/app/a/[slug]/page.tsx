import { notFound } from 'next/navigation'
import Script from 'next/script'
import { createAdminClient } from '@/lib/supabase/admin'
import ChatLanding from '@/components/agent-landing/chat-landing'
import type { LandingConfig } from '@/components/agent-landing/chat-landing'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('ai_agents')
    .select('name, landing_config, public_enabled')
    .eq('public_slug', slug)
    .maybeSingle()
  if (!agent || !agent.public_enabled) return { title: 'Indisponível' }
  const cfg = (agent.landing_config ?? {}) as LandingConfig
  return {
    title: cfg.headline || agent.name || 'Fale conosco',
    description: cfg.subheadline || undefined,
  }
}

export default async function AgentLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('ai_agents')
    .select('id, name, greeting_message, landing_config, public_enabled')
    .eq('public_slug', slug)
    .maybeSingle()

  if (!agent || !agent.public_enabled) notFound()

  const cfg = (agent.landing_config ?? {}) as LandingConfig
  const pixelId = cfg.pixel_id ?? null

  return (
    <>
      {pixelId && (
        <>
          <Script id="fb-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');fbq('track','PageView');
          `}} />
          <noscript>
            <img alt="" width={1} height={1} style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`} />
          </noscript>
        </>
      )}
      <ChatLanding
        slug={slug}
        agentName={agent.name}
        greeting={agent.greeting_message || cfg.headline || 'Olá! Como posso te ajudar?'}
        config={cfg}
      />
    </>
  )
}
