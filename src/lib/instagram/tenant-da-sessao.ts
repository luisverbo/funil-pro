import { createClient } from '@/lib/supabase/server'

/** Tenant do usuário logado, ou null. */
export async function tenantDaSessao(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  return data?.tenant_id ?? null
}
