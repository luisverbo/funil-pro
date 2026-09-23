// ============================================================================
// Conteúdos Instagram — despachante HTTP das ações do painel
// ----------------------------------------------------------------------------
// Mesmo desenho de /api/painel-quiz: lista FECHADA de operações que importam
// as MESMAS funções das actions. Autenticação continua dentro de cada função
// (sessão + tenant pelos cookies). Nome fora da lista = 404.
// ============================================================================
import { NextResponse } from 'next/server'
import {
  listarConteudos, contagemPorStatus, conexaoInstagram,
  aprovarConteudo, aprovarTodosPendentes, descartarConteudo, voltarParaPendente,
  editarConteudo, tentarDeNovo, publicarAgora, proximaDataLivre,
} from '@/app/actions/conteudos-ig'

// Publicar agora espera a Meta processar vídeo — pode levar minutos.
export const maxDuration = 300

/* eslint-disable @typescript-eslint/no-explicit-any */
const OPERACOES: Record<string, (...args: any[]) => Promise<unknown>> = {
  listarConteudos, contagemPorStatus, conexaoInstagram,
  aprovarConteudo, aprovarTodosPendentes, descartarConteudo, voltarParaPendente,
  editarConteudo, tentarDeNovo, publicarAgora, proximaDataLivre,
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
    console.error(`[conteudos] ${corpo.op} falhou:`, String(err))
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
