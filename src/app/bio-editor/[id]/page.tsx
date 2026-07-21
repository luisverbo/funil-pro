import { getPage, getBioClicks } from '@/app/actions/pages'
import BioEditorClient from './bio-editor-client'

export const dynamic = 'force-dynamic'

export default async function BioEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const page = await getPage(id)
  const clicks = await getBioClicks(id).catch(() => ({}))
  return <BioEditorClient page={page} clicks={clicks} />
}
