import { notFound } from 'next/navigation'
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

  return (
    <ChatLanding
      slug={slug}
      agentName={agent.name}
      greeting={agent.greeting_message || cfg.headline || 'Olá! Como posso te ajudar?'}
      config={cfg}
    />
  )
}
