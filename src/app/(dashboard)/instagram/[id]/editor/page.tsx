import { notFound } from 'next/navigation'
import { getIgAutomation } from '@/app/actions/ig-automations'
import { listFunnels } from '@/app/actions/ai-agents'
import IgFlowEditor from './editor-client'

export default async function IgEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [{ automation }, funnels] = await Promise.all([getIgAutomation(id), listFunnels()])
  if (!automation) notFound()
  return <IgFlowEditor automation={automation} funnels={funnels} />
}
