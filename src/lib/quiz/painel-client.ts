// ============================================================================
// Cliente HTTP do painel do quiz — substitui as chamadas de server action
// ----------------------------------------------------------------------------
// Cada função aqui tem a MESMA assinatura da action original (o tipo vem de
// `typeof import(...)`, então divergência quebra o build). A diferença é o
// transporte: fetch para /api/painel-quiz, imune ao id de build que as
// actions embutem na página — a causa do painel mudo em produção.
// ============================================================================

type AcoesLeads = typeof import('@/app/actions/quiz-leads')
type AcoesQuiz = typeof import('@/app/actions/quiz-v2')
type Acoes = AcoesLeads & AcoesQuiz

async function chamar(op: string, args: unknown[]): Promise<unknown> {
  let resp: Response
  try {
    resp = await fetch('/api/painel-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, args }),
      cache: 'no-store',
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }

  const corpo = await resp.json().catch(() => null) as { resultado?: unknown; error?: string } | null
  if (resp.status === 401 || corpo?.error === 'sem_sessao') {
    // Sessão caiu: melhor levar ao login do que mostrar erro sem sentido.
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new Error('Sessão expirada')
  }
  if (!resp.ok || !corpo || corpo.error) {
    throw new Error(corpo?.error ?? `HTTP ${resp.status}`)
  }
  return corpo.resultado
}

function op<K extends keyof Acoes>(nome: K): Acoes[K] {
  return ((...args: unknown[]) => chamar(nome as string, args)) as Acoes[K]
}

// Painel de leads
export const getQuizLeads = op('getQuizLeads')
export const getQuizMetricas = op('getQuizMetricas')
export const getAnswerBreakdown = op('getAnswerBreakdown')
export const resetQuizLeads = op('resetQuizLeads')
export const getLeadDetail = op('getLeadDetail')
export const getExportStructure = op('getExportStructure')
export const exportLeadsTable = op('exportLeadsTable')

// Portal do cliente
export const getPortalDoQuiz = op('getPortalDoQuiz')
export const ativarPortal = op('ativarPortal')
export const atualizarPortalConfig = op('atualizarPortalConfig')
export const desativarPortal = op('desativarPortal')
export const listarQuizzesDoTenant = op('listarQuizzesDoTenant')

// Investimento manual
export const listarInvestimentos = op('listarInvestimentos')
export const salvarInvestimento = op('salvarInvestimento')
export const excluirInvestimento = op('excluirInvestimento')
export const getCustosDoQuiz = op('getCustosDoQuiz')

// Editor (salvar e publicar — mesmas falhas, mesma cura)
export const saveQuizV2 = op('saveQuizV2')
export const publishQuizV2 = op('publishQuizV2')
