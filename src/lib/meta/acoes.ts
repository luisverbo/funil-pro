// ============================================================================
// Ações na Meta — pausar, ativar e mudar orçamento sem abrir o Gerenciador
// ----------------------------------------------------------------------------
// Pedido do dono (29/09): "quero tomar ação dali mesmo". A Marketing API
// aceita POST em /{id} com `status` e `daily_budget`. Precisa do token com
// `ads_management` (o `ads_read` só lê) — quem não tem recebe a instrução
// exata, não um erro genérico.
//
// Regras deliberadas:
//   • só dois status: ACTIVE e PAUSED. Nada de DELETED/ARCHIVED por aqui —
//     excluir é irreversível e fica no Gerenciador.
//   • orçamento tem piso e teto por chamada: nunca menos que R$ 1,00 nem
//     mais que 10× o atual (um zero a mais não queima a verba do mês).
//   • a Meta responde {success:true}; qualquer outra coisa é erro.
// ============================================================================
import { META_GRAPH_BASE, MetaApiError, classificarErroMeta } from './client'
import type { NivelAnuncio } from './sync-v2'

export type StatusAcao = 'ACTIVE' | 'PAUSED'
export const PERMISSAO_ACOES = 'ads_management'

export interface AcaoDeps { fetchFn?: typeof fetch }

interface RespostaMeta { success?: boolean; error?: { code?: number; error_subcode?: number; message?: string } }

async function postMeta(id: string, campos: Record<string, string>, token: string, deps: AcaoDeps = {}): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch
  const body = new URLSearchParams({ ...campos, access_token: token })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)
  let res: Response
  try {
    res = await fetchFn(`${META_GRAPH_BASE}/${encodeURIComponent(id)}`, {
      method: 'POST', body, cache: 'no-store', signal: controller.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  } catch (err) {
    throw new MetaApiError({ kind: 'instavel', httpStatus: 0, message: (err as Error)?.name === 'AbortError' ? 'meta: timeout' : 'meta: falha de rede' })
  } finally { clearTimeout(timer) }

  let corpo: RespostaMeta = {}
  try { corpo = (await res.json()) as RespostaMeta } catch { /* corpo ilegível */ }
  if (res.ok && corpo.success === true) return
  const kind = classificarErroMeta(res.status, corpo.error?.code, corpo.error?.error_subcode)
  throw new MetaApiError({
    kind, httpStatus: res.status, metaCode: corpo.error?.code, metaSubcode: corpo.error?.error_subcode,
    message: `meta: ${kind} status=${res.status} code=${corpo.error?.code ?? '-'}`,
  })
}

/** Liga ou pausa campanha, conjunto ou anúncio. */
export async function alterarStatus(id: string, status: StatusAcao, token: string, deps: AcaoDeps = {}): Promise<void> {
  if (status !== 'ACTIVE' && status !== 'PAUSED') throw new Error('status inválido')
  await postMeta(id, { status }, token, deps)
}

export const ORCAMENTO_MINIMO_CENTS = 100

/** Validação pura do novo orçamento diário (em centavos). */
export function validarOrcamento(novoCents: number, atualCents: number | null): { ok: true } | { ok: false; motivo: string } {
  if (!Number.isInteger(novoCents) || novoCents < ORCAMENTO_MINIMO_CENTS) return { ok: false, motivo: 'O orçamento mínimo é R$ 1,00 por dia.' }
  if (atualCents && atualCents > 0 && novoCents > atualCents * 10) {
    return { ok: false, motivo: 'Aumento acima de 10× o orçamento atual. Suba em etapas — a Meta reinicia o aprendizado com salto grande.' }
  }
  return { ok: true }
}

/** Muda o orçamento DIÁRIO de campanha (CBO) ou conjunto. Anúncio não tem orçamento. */
export async function alterarOrcamentoDiario(id: string, nivel: NivelAnuncio, novoCents: number, atualCents: number | null, token: string, deps: AcaoDeps = {}): Promise<void> {
  if (nivel === 'ad') throw new Error('Anúncio não tem orçamento próprio — mude no conjunto ou na campanha.')
  const v = validarOrcamento(novoCents, atualCents)
  if (!v.ok) throw new Error(v.motivo)
  // A Meta recebe o orçamento na menor unidade da moeda (centavos no BRL).
  await postMeta(id, { daily_budget: String(novoCents) }, token, deps)
}

/** Orçamento sugerido pela Mesa: +N% arredondado para o real cheio. */
export function orcamentoEscalado(atualCents: number, passoPct: number): number {
  return Math.round((atualCents * (1 + passoPct / 100)) / 100) * 100
}
