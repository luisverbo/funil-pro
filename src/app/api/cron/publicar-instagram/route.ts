// ============================================================================
// Cron — publica os conteúdos agendados cujo horário chegou
// ----------------------------------------------------------------------------
// Chamado pelo GitHub Actions a cada 10 minutos (workflow
// publicar-instagram.yml) com `Authorization: Bearer CRON_SECRET`, validado
// por `evaluateCronAuth` — o mesmo mecanismo do tráfego e da fila.
//
// A reserva é atômica no banco (`reservar_conteudos_para_publicar`, FOR
// UPDATE SKIP LOCKED): duas rodadas em paralelo nunca publicam o mesmo item.
// ============================================================================
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CRON_UNAUTHORIZED_BODY, evaluateCronAuth, logCronAuth } from '@/lib/security/cron-auth'
import { rodadaDePublicacao } from '@/lib/conteudos-ig/publicador'

export const dynamic = 'force-dynamic'
// Vídeo pode levar minutos para a Meta processar.
export const maxDuration = 300

async function executar(request: Request) {
  const auth = evaluateCronAuth(request)
  if (!auth.allowed) {
    logCronAuth(auth, request, 401)
    return NextResponse.json(CRON_UNAUTHORIZED_BODY, { status: 401 })
  }
  logCronAuth(auth, request, 200)

  const token = process.env.IG_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ success: false, error: 'IG_ACCESS_TOKEN ausente' }, { status: 503 })
  }

  try {
    const r = await rodadaDePublicacao(createAdminClient(), { token })
    if (r.falhas > 0) console.warn('[cron/publicar-instagram] falhas:', JSON.stringify(r.detalhes.filter(d => !d.ok)))
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    console.error('[cron/publicar-instagram] erro na rodada:', String(err))
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'erro' }, { status: 500 })
  }
}

export async function GET(request: Request) { return executar(request) }
export async function POST(request: Request) { return executar(request) }
