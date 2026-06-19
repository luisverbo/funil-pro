import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import AgentsClient from './agents-client'
import { listAgents, listFunnels, listWhatsappInstances } from '@/app/actions/ai-agents'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
      },
    }
  )
}

export default async function AgentsPage() {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!userTenant) redirect('/login')

  const { data: tenant } = await supabase.from('tenants').select('plan').eq('id', userTenant.tenant_id).single()
  const plan = (tenant?.plan ?? 'starter') as string
  const isScale = plan === 'scale'

  const [{ agents }, funnels, instances] = await Promise.all([
    isScale ? listAgents() : Promise.resolve({ agents: [] }),
    isScale ? listFunnels() : Promise.resolve([]),
    isScale ? listWhatsappInstances() : Promise.resolve([]),
  ])

  return <AgentsClient agents={agents} funnels={funnels} instances={instances} isScale={isScale} />
}
