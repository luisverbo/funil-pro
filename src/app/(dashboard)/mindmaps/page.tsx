import { listMindMaps } from '@/app/actions/mindmaps'
import MindMapsClient from './mindmaps-client'

export const dynamic = 'force-dynamic'

export default async function MindMapsPage() {
  const { maps } = await listMindMaps()
  return <MindMapsClient initialMaps={maps} />
}
