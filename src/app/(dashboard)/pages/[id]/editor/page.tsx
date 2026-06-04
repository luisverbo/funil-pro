import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import EditorClient from './editor-client'

export const dynamic = 'force-dynamic'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )
}

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!userTenant) redirect('/login')

  const { data: page } = await supabase
    .from('pages')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', userTenant.tenant_id)
    .single()

  if (!page) redirect('/pages')

  return <EditorClient page={page} />
}
