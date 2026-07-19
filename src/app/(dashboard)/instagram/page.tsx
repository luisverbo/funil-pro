import { listIgAutomations, getIgConnection } from '@/app/actions/ig-automations'
import InstagramClient from './instagram-client'

export default async function InstagramPage() {
  const [{ automations }, connection] = await Promise.all([
    listIgAutomations(),
    getIgConnection(),
  ])
  return <InstagramClient initialAutomations={automations} connection={connection} />
}
