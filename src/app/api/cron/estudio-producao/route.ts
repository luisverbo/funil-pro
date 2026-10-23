// ============================================================================
// Cron — produção do Estúdio IA (Fase 5): entrega automática, API e atrasos
// ----------------------------------------------------------------------------
// Chamado pelo pg_cron do Supabase a cada minuto, só com trabalho (20261029000000)
// com o header x-funilpro-cron — mesmo segredo do agendador dos Conteúdos.
// Reserva: Bearer CRON_SECRET (evaluateCronAuth).
// ============================================================================
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CRON_UNAUTHORIZED_BODY, evaluateCronAuth, logCronAuth } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
// Gerar por API leva ~30–60 s por foto: a rodada usa até ~4 min e o resto fica para a próxima.
export const maxDuration = 300

async function segredoDoBancoConfere(request: Request): Promise<boolean> {
  const recebido = request.headers.get('x-funilpro-cron')
  if (!recebido) return false
  const { data } = await createAdminClient().from('platform_settings').select('value').eq('key', 'conteudos_cron_secret').maybeSingle()
  const esperado = data?.value ?? ''
  if (!esperado || esperado.length !== recebido.length) return false
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))
}

async function executar(request: Request) {
  if (!(await segredoDoBancoConfere(request))) {
    const auth = evaluateCronAuth(request)
    if (!auth.allowed) { logCronAuth(auth, request, 401); return NextResponse.json(CRON_UNAUTHORIZED_BODY, { status: 401 }) }
    logCronAuth(auth, request, 200)
  }
  try {
    // Sob demanda: se o motor não carregar, a rota responde JSON com o motivo (e loga).
    const { rodadaDeProducao } = await import('@/lib/estudio/producao-servidor')
    const r = await rodadaDeProducao(createAdminClient())
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    const detalhe = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('[cron/estudio-producao]', detalhe.slice(0, 500))
    return NextResponse.json({ success: false, error: 'falhou', detalhe: detalhe.slice(0, 300) }, { status: 500 })
  }
}

export async function GET(request: Request) { return executar(request) }
export async function POST(request: Request) { return executar(request) }
