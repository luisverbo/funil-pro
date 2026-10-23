// Resumo da notificação para o service worker (push sem conteúdo).
// Exige a sessão (cookie) — sem ela, o SW mostra o aviso genérico.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bandeira } from '@/lib/estudio/chat'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'sem sessão' }, { status: 401 })
  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut) return NextResponse.json({ error: 'sem tenant' }, { status: 401 })
  const admin = createAdminClient()
  const { data: humano } = await admin.from('estudio_contatos').select('id, nome, wa_id, pais')
    .eq('tenant_id', ut.tenant_id).eq('precisa_humano', true).order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle()
  if (humano) {
    return NextResponse.json({ titulo: '🙋 Passou para você', corpo: `${bandeira(humano.pais)} ${humano.nome || `+${humano.wa_id}`} precisa de atendimento`, url: `/estudio-ia?aba=conversas&c=${humano.id}`, tag: `h-${humano.id}` })
  }
  const { data: c } = await admin.from('estudio_contatos').select('id, nome, wa_id, pais, ultima_msg, nao_lidas')
    .eq('tenant_id', ut.tenant_id).gt('nao_lidas', 0).order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle()
  if (!c) return NextResponse.json({ titulo: 'Estúdio IA', corpo: 'Novidade no estúdio', url: '/estudio-ia?aba=conversas', tag: 'estudio' })
  return NextResponse.json({ titulo: `${bandeira(c.pais)} ${c.nome || `+${c.wa_id}`}`, corpo: c.ultima_msg ?? 'Nova mensagem', url: `/estudio-ia?aba=conversas&c=${c.id}`, tag: c.id })
}
