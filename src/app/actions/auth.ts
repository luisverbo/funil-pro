'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { planoDoLinkDeVenda, homeDoPlano } from '@/lib/planos/acesso'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('id, tenant_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!userTenant) {
    redirect('/onboarding')
  }
  // Cada plano tem sua porta de entrada: quem só tem o quiz cai nas Páginas.
  const { data: tenant } = await supabase.from('tenants').select('plan').eq('id', userTenant.tenant_id).maybeSingle()
  redirect(homeDoPlano(tenant?.plan as string | undefined))
}

export async function register(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const name = formData.get('name') as string
  // Plano pedido no link de venda viaja no metadata do usuário até o onboarding
  // criar o tenant. Só 'quiz' é aceito — ninguém vira Scale por URL.
  const planoDesejado = planoDoLinkDeVenda(formData.get('plano'))

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name, ...(planoDesejado ? { plano_desejado: planoDesejado } : {}) } },
  })
  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`)
  }
  redirect('/onboarding')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
