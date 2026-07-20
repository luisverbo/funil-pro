import { listIgThreads } from '@/app/actions/ig-inbox'
import InboxClient from './inbox-client'

export default async function IgInboxPage() {
  const { threads } = await listIgThreads()
  return <InboxClient initialThreads={threads} />
}
