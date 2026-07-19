import { listIgAutomations, getIgConnection } from '@/app/actions/ig-automations'
import { listFunnels } from '@/app/actions/ai-agents'
import InstagramClient from './instagram-client'

export default async function InstagramPage() {
  const [{ automations }, connection, funnels] = await Promise.all([
    listIgAutomations(),
    getIgConnection(),
    listFunnels(),
  ])
  return <InstagramClient initialAutomations={automations} connection={connection} funnels={funnels} />
}
