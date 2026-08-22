// ============================================================================
// Painel compartilhado — a porta pública (POST com senha)
// ----------------------------------------------------------------------------
// Quem chama é o cliente do dono do quiz, sem conta. A autenticação é
// token do link + senha, e SÓ isso decide o acesso. Regras:
//
//   • A senha viaja no CORPO do POST, nunca na URL — URL vai para log de
//     servidor, histórico do navegador e cabeçalho Referer.
//   • Resposta de recusa é IDÊNTICA para link inexistente, desativado e senha
//     errada: não dá pista de qual dos três aconteceu.
//   • Senha errada espera ~1s antes de responder — chute em massa fica caro.
//   • A resposta só contém dados DAQUELE quiz; o tenant sai da própria linha
//     do link, nunca do chamador.
// ============================================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tokenShareValido, verificarSenhaShare } from '@/lib/quiz/share'
import {
  metricasDoQuiz, montarTabelaLeads, estruturaComContagens,
  type ExportPublico,
} from '@/lib/quiz/leads-core'

export const maxDuration = 60

const RECUSADO = { error: 'Link inválido ou senha incorreta' } as const

const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!tokenShareValido(token)) {
    await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  let corpo: { senha?: string; publico?: string; pageIds?: string[] }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json(RECUSADO, { status: 401 })
  }
  const senha = typeof corpo.senha === 'string' ? corpo.senha.trim() : ''
  if (!senha) {
    await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: link } = await admin
    .from('quiz_share_links')
    .select('tenant_id, page_id, password_hash, enabled')
    .eq('token', token)
    .maybeSingle()

  if (!link || !link.enabled || !verificarSenhaShare(senha, String(link.password_hash))) {
    await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  const quizId = String(link.page_id)
  const tenantId = String(link.tenant_id)

  try {
    const publico: ExportPublico =
      corpo.publico === 'concluidos' || corpo.publico === 'com_resposta' || corpo.publico === 'completos'
        ? corpo.publico : 'todos'
    const pageIds = Array.isArray(corpo.pageIds)
      ? corpo.pageIds.filter((x): x is string => typeof x === 'string').slice(0, 100)
      : undefined

    const [metricas, estrutura, tabela] = await Promise.all([
      metricasDoQuiz(admin, quizId, tenantId),
      estruturaComContagens(admin, quizId, tenantId),
      montarTabelaLeads(admin, quizId, tenantId, { publico, pageIds }),
    ])

    const { data: pagina } = await admin
      .from('pages').select('title').eq('id', quizId).single()

    // Contador de acesso: falhar aqui não pode negar o painel.
    await admin.rpc('increment_share_access', { p_token: token }).then(
      () => {}, () => {},
    )

    return NextResponse.json({
      titulo: String(pagina?.title ?? 'Quiz'),
      metricas,
      paginas: estrutura.paginas.map(p => ({ id: p.id, titulo: p.titulo })),
      tabela: 'error' in tabela ? null : tabela,
    })
  } catch (err) {
    console.error('[quiz-share] falha ao montar painel:', String(err))
    return NextResponse.json({ error: 'Não foi possível carregar o painel' }, { status: 500 })
  }
}
