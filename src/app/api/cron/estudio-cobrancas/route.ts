// ============================================================================
// Cron — cobranças da Ana (seção 5): 10 min, 30 min, 3 h; máx. 3; só na janela
// ----------------------------------------------------------------------------
// Chamado pelo pg_cron do Supabase a cada 5 min (migration 20261027000000)
// com o header x-funilpro-cron — mesmo segredo do agendador dos Conteúdos.
// Reserva: Bearer CRON_SECRET (evaluateCronAuth).
// ============================================================================
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CRON_UNAUTHORIZED_BODY, evaluateCronAuth, logCronAuth } from '@/lib/security/cron-auth'
import { rodadaDeCobrancas } from '@/lib/estudio/ana/executor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    const enviadas = await rodadaDeCobrancas(createAdminClient())
    return NextResponse.json({ success: true, enviadas })
  } catch (err) {
    console.error('[cron/estudio-cobrancas]', String(err).slice(0, 300))
    return NextResponse.json({ success: false, error: 'falhou' }, { status: 500 })
  }
}

export async function GET(request: Request) { return executar(request) }
export async function POST(request: Request) { return executar(request) }
