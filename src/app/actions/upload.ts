'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']

async function getTenantId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  return data?.tenant_id ?? null
}

export async function uploadQuizImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!tenantId) return { error: 'Não autenticado' }

    const file = formData.get('file') as File | null
    if (!file) return { error: 'Nenhum arquivo enviado' }
    if (file.size > MAX_SIZE) return { error: 'Imagem muito grande (máx 5MB)' }
    if (!ALLOWED_TYPES.includes(file.type)) return { error: 'Formato não suportado (use JPG, PNG, WebP, GIF ou SVG)' }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const admin = createAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error } = await admin.storage
      .from('quiz-assets')
      .upload(path, buffer, { contentType: file.type, upsert: false })

    if (error) return { error: `Falha no upload: ${error.message}` }

    const { data: pub } = admin.storage.from('quiz-assets').getPublicUrl(path)
    return { url: pub.publicUrl }
  } catch (err) {
    return { error: String(err) }
  }
}
