import { notFound } from 'next/navigation'
import { getMindMap } from '@/app/actions/mindmaps'
import MindMapEditorClient from './mindmap-editor-client'

export const dynamic = 'force-dynamic'

export default async function MindMapEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { map } = await getMindMap(id)
  if (!map) notFound()
  return <MindMapEditorClient map={map} />
}
