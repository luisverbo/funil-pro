import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import type { FunnelBlock, FunnelEdge, Funnel } from '@/types'
import FunnelBuilderWrapper from '@/components/builder/funnel-builder-wrapper'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/login')

  const { data: funnel } = await supabase
    .from('funnels')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', userTenant.tenant_id)
    .single()

  if (!funnel) notFound()

  const { data: blocks } = await supabase
    .from('funnel_blocks')
    .select('*')
    .eq('funnel_id', id)

  const { data: edges } = await supabase
    .from('funnel_edges')
    .select('*')
    .eq('funnel_id', id)

  return (
    <FunnelBuilderWrapper
      funnel={funnel as Funnel}
      initialBlocks={(blocks ?? []) as FunnelBlock[]}
      initialEdges={(edges ?? []) as FunnelEdge[]}
    />
  )
}
