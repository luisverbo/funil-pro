import { createAdminClient } from '@/lib/supabase/admin'
import { getIgUserProfile } from '@/lib/instagram'

// Inbox do Instagram: toda DM (entrada/saída) vira mensagem numa thread por
// pessoa. O painel /instagram/inbox lê daqui; human_mode pausa IA/automações.

type Admin = ReturnType<typeof createAdminClient>

/** Garante a thread da pessoa; retorna { id, human_mode } */
export async function upsertThread(admin: Admin, tenantId: string, igUserId: string): Promise<{ id: string; human_mode: boolean } | null> {
  const { data: existing } = await admin.from('ig_threads')
    .select('id, human_mode, profile_pic').eq('tenant_id', tenantId).eq('ig_user_id', igUserId).maybeSingle()
  if (existing) {
    // Atualiza o perfil de vez em quando (foto expira no CDN da Meta)
    if (!existing.profile_pic) {
      const p = await getIgUserProfile(igUserId).catch(() => null)
      if (p?.username || p?.profilePic) {
        await admin.from('ig_threads').update({
          username: p.username ?? undefined, name: p.name ?? undefined, profile_pic: p.profilePic ?? undefined,
        }).eq('id', existing.id)
      }
    }
    return { id: existing.id, human_mode: existing.human_mode ?? false }
  }
  const p = await getIgUserProfile(igUserId).catch(() => null)
  const { data: created } = await admin.from('ig_threads').insert({
    tenant_id: tenantId, ig_user_id: igUserId,
    username: p?.username ?? null, name: p?.name ?? null, profile_pic: p?.profilePic ?? null,
  }).select('id').single()
  return created ? { id: created.id, human_mode: false } : null
}

/** Registra mensagem recebida do lead */
export async function logInbound(admin: Admin, tenantId: string, igUserId: string, text: string): Promise<{ threadId: string; humanMode: boolean } | null> {
  const thread = await upsertThread(admin, tenantId, igUserId)
  if (!thread) return null
  await admin.from('ig_dm_messages').insert({
    tenant_id: tenantId, thread_id: thread.id, direction: 'in', source: 'lead', text,
  })
  await admin.from('ig_threads').update({
    last_message_at: new Date().toISOString(), last_message_text: text.slice(0, 120), unread: true,
  }).eq('id', thread.id)
  return { threadId: thread.id, humanMode: thread.human_mode }
}

/** Registra mensagem enviada (agente/automação/humano/gate) */
export async function logOutbound(admin: Admin, tenantId: string, igUserId: string, text: string, source: 'agent' | 'automation' | 'human' | 'gate'): Promise<void> {
  const thread = await upsertThread(admin, tenantId, igUserId)
  if (!thread) return
  await admin.from('ig_dm_messages').insert({
    tenant_id: tenantId, thread_id: thread.id, direction: 'out', source, text,
  })
  await admin.from('ig_threads').update({
    last_message_at: new Date().toISOString(), last_message_text: text.slice(0, 120),
  }).eq('id', thread.id)
}
