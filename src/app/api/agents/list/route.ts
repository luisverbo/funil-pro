import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ agents: [] }, { status: 401 })

  const { data: ut } = await supabase
    .from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut) return NextResponse.json({ agents: [] })

  const { data } = await supabase
    .from('ai_agents')
    .select('id, name, objective, status')
    .eq('tenant_id', ut.tenant_id)
    .eq('status', 'active')
    .order('name')

  return NextResponse.json({ agents: data ?? [] })
}
