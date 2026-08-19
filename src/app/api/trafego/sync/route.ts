// ============================================================================
// Sincronização recorrente do Gestor de Tráfego (Fase 1, item 1.11)
// ----------------------------------------------------------------------------
// Endpoint PRÓPRIO, e não uma carona em /api/queue/process, por dois motivos:
//
//   • aquela rota roda a cada minuto e tem 60s de teto; a leitura da Meta
//     pagina várias contas e precisa de muito mais que isso — enfiá-la lá
//     derrubaria filas de funil, DMs e lembretes junto;
//   • um erro da Meta aqui não pode ter chance nenhuma de parar o motor do
//     funil, que é o que efetivamente fala com o cliente.
//
// A autenticação reaproveita o MESMO contrato do cron existente
// (`evaluateCronAuth`): enquanto CRON_AUTH_ENFORCE não for "true", a chamada
// passa e fica registrada; quando for, só passa com o segredo.
// ============================================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CRON_UNAUTHORIZED_BODY, evaluateCronAuth, logCronAuth } from '@/lib/security/cron-auth'
import { sincronizarPendentes } from '@/lib/meta/scheduler'

// Fluid Compute: o mesmo teto usado pela geração de imagem do Content Studio.
export const maxDuration = 300

async function executar(request: Request) {
  const auth = evaluateCronAuth(request)
  if (!auth.allowed) {
    logCronAuth(auth, request, 401)
    return NextResponse.json(CRON_UNAUTHORIZED_BODY, { status: 401 })
  }
  logCronAuth(auth, request, 200)

  const admin = createAdminClient()

  try {
    const r = await sincronizarPendentes(admin)
    if (r.falhas > 0) {
      // Falha some se não for registrada: o painel mostraria dado velho como
      // se fosse atual. O motivo já fica gravado em `ad_accounts.last_error`.
      console.warn(`[trafego/sync] ${r.falhas} conta(s) falharam:`, JSON.stringify(r.detalhes))
    }
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    console.error('[trafego/sync] erro na rodada:', String(err))
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'erro' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) { return executar(request) }
export async function POST(request: Request) { return executar(request) }
