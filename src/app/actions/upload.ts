'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
// #15: SVG removido — pode conter <script> e o bucket é público (stored XSS/phishing)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}

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
    if (!ALLOWED_TYPES.includes(file.type)) return { error: 'Formato não suportado (use JPG, PNG, WebP ou GIF)' }

    // #28: extensão derivada do tipo real, não do nome do arquivo
    const ext = EXT_BY_TYPE[file.type] ?? 'jpg'
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

const IG_MEDIA_MAX = 25 * 1024 * 1024 // 25MB
const IG_MEDIA_TYPES: Record<string, { kind: 'image' | 'video' | 'audio'; ext: string }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg' }, 'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' }, 'image/gif': { kind: 'image', ext: 'gif' },
  'video/mp4': { kind: 'video', ext: 'mp4' }, 'video/quicktime': { kind: 'video', ext: 'mov' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' }, 'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
}

/** Upload de mídia (imagem/vídeo/áudio) para o bucket público ig-media */
export async function uploadIgMedia(formData: FormData): Promise<{ url?: string; kind?: 'image' | 'video' | 'audio'; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!tenantId) return { error: 'Não autenticado' }
    const file = formData.get('file') as File | null
    if (!file) return { error: 'Nenhum arquivo enviado' }
    if (file.size > IG_MEDIA_MAX) return { error: 'Arquivo muito grande (máx 25MB)' }
    const meta = IG_MEDIA_TYPES[file.type]
    if (!meta) return { error: 'Formato não suportado (imagem, vídeo MP4 ou áudio)' }

    const path = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.ext}`
    const admin = createAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error } = await admin.storage.from('ig-media').upload(path, buffer, { contentType: file.type, upsert: false })
    if (error) return { error: `Falha no upload: ${error.message}` }
    const { data: pub } = admin.storage.from('ig-media').getPublicUrl(path)
    return { url: pub.publicUrl, kind: meta.kind }
  } catch (err) {
    return { error: String(err) }
  }
}
