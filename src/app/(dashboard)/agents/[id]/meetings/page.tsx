import { redirect, notFound } from 'next/navigation'
import { getAgent, listMeetings } from '@/app/actions/ai-agents'
import MeetingsClient from './meetings-client'

export default async function MeetingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { agent, error } = await getAgent(id)
  if (error === 'not_found' || !agent) notFound()
  if (!agent) redirect('/agents')

  const { meetings } = await listMeetings(id)
  const sched = ((agent as unknown as { scheduling_config?: Record<string, unknown> }).scheduling_config ?? {}) as Record<string, unknown>

  return (
    <MeetingsClient
      agentId={id}
      agentName={agent.name}
      initialMeetings={meetings}
      meetingTitle={String(sched.meeting_title ?? '') || `Reunião — ${agent.name}`}
      meetingLocation={String(sched.meeting_location ?? '')}
    />
  )
}
