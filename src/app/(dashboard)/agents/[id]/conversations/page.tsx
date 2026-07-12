import { redirect, notFound } from 'next/navigation'
import { getAgent, listConversations, getAgentFunnel } from '@/app/actions/ai-agents'
import ConversationsClient from './conversations-client'

export default async function ConversationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { agent, error } = await getAgent(id)
  if (error === 'not_found' || !agent) notFound()
  if (!agent) redirect('/agents')

  const [{ conversations, total }, funnel] = await Promise.all([
    listConversations(id, { page: 0, pageSize: 20 }),
    getAgentFunnel(id),
  ])

  return (
    <ConversationsClient
      agentId={id}
      agentName={agent.name}
      initialConversations={conversations}
      total={total}
      funnel={funnel}
    />
  )
}
