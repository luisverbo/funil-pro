import { Suspense } from 'react'
import { listarWaContas } from '@/app/actions/wa-inbox'
import { listAgents } from '@/app/actions/ai-agents'
import WhatsappClient from './whatsapp-client'

export const dynamic = 'force-dynamic'

export default async function WhatsappPage() {
  const [{ contas, error }, { agents }] = await Promise.all([
    listarWaContas(),
    listAgents().catch(() => ({ agents: [] as { id: string; name: string }[] })),
  ])
  return (
    <Suspense>
      <WhatsappClient
        contas={contas}
        erroContas={error ?? null}
        agentes={(agents ?? []).map(a => ({ id: a.id, nome: a.name }))}
      />
    </Suspense>
  )
}
