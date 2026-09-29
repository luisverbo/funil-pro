// ============================================================================
// Tráfego — despachante HTTP das ações da aba (mesmo desenho de /api/conteudos)
// ----------------------------------------------------------------------------
// Lista FECHADA de operações. Autenticação dentro de cada função.
// ============================================================================
import { NextResponse } from 'next/server'
import {
  buscarContasDoToken, conectarContas, listarContasConectadas, desconectarConta,
  sincronizarAgora, painelTrafego, parecerDoChefe, executarAcao,
} from '@/app/actions/trafego-conexao'

// Sincronizar agora lê a Meta conta por conta.
export const maxDuration = 300

/* eslint-disable @typescript-eslint/no-explicit-any */
const OPERACOES: Record<string, (...args: any[]) => Promise<unknown>> = {
  buscarContasDoToken, conectarContas, listarContasConectadas, desconectarConta,
  sincronizarAgora, painelTrafego, parecerDoChefe, executarAcao,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  let corpo: { op?: string; args?: unknown[] }
  try { corpo = await request.json() } catch { return NextResponse.json({ error: 'corpo inválido' }, { status: 400 }) }

  const fn = corpo.op ? OPERACOES[corpo.op] : undefined
  if (!fn) return NextResponse.json({ error: 'operação desconhecida' }, { status: 404 })

  const args = Array.isArray(corpo.args) ? corpo.args.slice(0, 4) : []
  try {
    return NextResponse.json({ resultado: await fn(...args) })
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? ''
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return NextResponse.json({ error: 'sem_sessao' }, { status: 401 })
    }
    // Nunca ecoa o corpo: ele pode conter o token.
    console.error(`[trafego] ${corpo.op} falhou`)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
