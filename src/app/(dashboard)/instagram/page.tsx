import { listIgAutomations } from '@/app/actions/ig-automations'
import InstagramClient from './instagram-client'

export default async function InstagramPage() {
  const { automations } = await listIgAutomations()
  return <InstagramClient initialAutomations={automations} />
}
