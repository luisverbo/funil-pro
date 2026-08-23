// ============================================================================
// Painel do quiz — despachante HTTP para as ações (no lugar de server actions)
// ----------------------------------------------------------------------------
// POR QUE EXISTE: as server actions desta área passaram a falhar em produção
// com o erro MASCARADO do Next ("Server Components render... digest"). A carga
// do editor foi convertida para rota HTTP e VOLTOU a funcionar na hora — a
// prova de que o problema é a mecânica das actions (id de build embutido na
// página + dois deploys em paralelo por merge = janela dupla de
// dessincronização), não a lógica.
//
// Este arquivo NÃO duplica lógica nenhuma: importa as MESMAS funções das
// actions e as chama por nome, de uma lista fechada. A autenticação continua
// dentro de cada função (sessão + tenant via cookies — que chegam aqui do
// mesmo jeito). Uma operação fora da lista simplesmente não existe.
// ============================================================================

import { NextResponse } from 'next/server'
import {
  getQuizLeads, getQuizMetricas, getAnswerBreakdown, resetQuizLeads,
  getExportStructure, exportLeadsTable, getLeadDetail,
  getPortalDoQuiz, ativarPortal, atualizarPortalConfig, desativarPortal, listarQuizzesDoTenant,
  listarInvestimentos, salvarInvestimento, excluirInvestimento,
} from '@/app/actions/quiz-leads'
import { saveQuizV2, publishQuizV2 } from '@/app/actions/quiz-v2'

export const maxDuration = 60

/* eslint-disable @typescript-eslint/no-explicit-any */
// Lista FECHADA: só o que o painel usa. Nome fora daqui = 404.
const OPERACOES: Record<string, (...args: any[]) => Promise<unknown>> = {
  getQuizLeads, getQuizMetricas, getAnswerBreakdown, resetQuizLeads,
  getExportStructure, exportLeadsTable, getLeadDetail,
  getPortalDoQuiz, ativarPortal, atualizarPortalConfig, desativarPortal, listarQuizzesDoTenant,
  listarInvestimentos, salvarInvestimento, excluirInvestimento,
  saveQuizV2, publishQuizV2,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  let corpo: { op?: string; args?: unknown[] }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'corpo inválido' }, { status: 400 })
  }

  const fn = corpo.op ? OPERACOES[corpo.op] : undefined
  if (!fn) return NextResponse.json({ error: 'operação desconhecida' }, { status: 404 })

  const args = Array.isArray(corpo.args) ? corpo.args.slice(0, 6) : []

  try {
    const resultado = await fn(...args)
    return NextResponse.json({ resultado })
  } catch (err) {
    // redirect('/login') dentro de uma ação vira 401 aqui — a tela manda
    // a pessoa entrar de novo em vez de mostrar um erro sem sentido.
    const digest = (err as { digest?: string })?.digest ?? ''
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return NextResponse.json({ error: 'sem_sessao' }, { status: 401 })
    }
    console.error(`[painel-quiz] ${corpo.op} falhou:`, String(err))
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) },
      { status: 500 },
    )
  }
}
