// ============================================================================
// Conectar contas de anúncio — escolhendo da lista, nunca digitando o ID
// ----------------------------------------------------------------------------
// CAUSA RAIZ do "a aba de anúncios nunca mostrou um número" (29/09): a conexão
// era por COPIAR E COLAR o ID da conta e o token. O ID foi salvo como o
// e-mail do dono ("luisverbo@gmail.com"), toda leitura falhou, e o token
// venceu em agosto sem ninguém perceber.
//
// Agora o dono cola SÓ o token. O servidor pergunta à Meta quais contas esse
// token enxerga (/me/adaccounts) e devolve a lista com nome, moeda e
// situação. O dono marca as que quer. O ID gravado é sempre o que a própria
// Meta devolveu.
//
// Se o app da Meta estiver configurado (App ID + App Secret no Admin), o
// token curto do Explorador é trocado por um de 60 dias antes de salvar.
// ============================================================================
import { metaFetch, metaFetchPaginado, urlGraph, META_GRAPH_BASE, type MetaFetchDeps } from './client'

/** A Meta devolve account_status como número. */
export const SITUACAO_CONTA: Record<number, { rotulo: string; ok: boolean }> = {
  1: { rotulo: 'Ativa', ok: true },
  2: { rotulo: 'Desativada', ok: false },
  3: { rotulo: 'Pagamento pendente', ok: false },
  7: { rotulo: 'Em análise de risco', ok: false },
  8: { rotulo: 'Pagamento em processamento', ok: false },
  9: { rotulo: 'Em período de carência', ok: false },
  100: { rotulo: 'Encerramento pendente', ok: false },
  101: { rotulo: 'Encerrada', ok: false },
  201: { rotulo: 'Ativa (qualquer)', ok: true },
  202: { rotulo: 'Encerrada (qualquer)', ok: false },
}

export function situacaoDaConta(codigo: number | null | undefined): { rotulo: string; ok: boolean } {
  if (codigo === null || codigo === undefined) return { rotulo: 'Desconhecida', ok: false }
  return SITUACAO_CONTA[codigo] ?? { rotulo: `Situação ${codigo}`, ok: false }
}

export interface ContaDisponivel {
  /** ID numérico, sem "act_", exatamente como a Meta devolveu. */
  id: string
  nome: string
  moeda: string | null
  fuso: string | null
  situacao: string
  podeAnunciar: boolean
  gastoTotalCents: number | null
  empresa: string | null
}

interface ContaGraph {
  id?: string            // "act_123"
  account_id?: string    // "123"
  name?: string
  currency?: string
  timezone_name?: string
  account_status?: number
  amount_spent?: string  // em centavos da moeda, como string
  business?: { name?: string }
}

/** Só dígitos: o ID de conta de anúncio nunca é e-mail nem texto. */
export function idDeContaValido(v: unknown): v is string {
  return typeof v === 'string' && /^\d{5,25}$/.test(v)
}

/** Converte a resposta da Meta na lista que a tela mostra (pura). */
export function paraContasDisponiveis(itens: ContaGraph[]): ContaDisponivel[] {
  return itens
    .map(c => {
      const id = String(c.account_id ?? (c.id ?? '').replace(/^act_/, ''))
      const sit = situacaoDaConta(c.account_status)
      const gasto = c.amount_spent !== undefined ? Number(c.amount_spent) : NaN
      return {
        id,
        nome: c.name?.trim() || `Conta ${id}`,
        moeda: c.currency ?? null,
        fuso: c.timezone_name ?? null,
        situacao: sit.rotulo,
        podeAnunciar: sit.ok,
        gastoTotalCents: Number.isFinite(gasto) ? gasto : null,
        empresa: c.business?.name ?? null,
      }
    })
    .filter(c => idDeContaValido(c.id))
    // Ativas primeiro, depois as que mais gastaram (as que importam).
    .sort((a, b) => Number(b.podeAnunciar) - Number(a.podeAnunciar) || (b.gastoTotalCents ?? 0) - (a.gastoTotalCents ?? 0))
}

/** Quais contas de anúncio este token enxerga. */
export async function listarContasDoToken(token: string, deps: MetaFetchDeps = {}): Promise<ContaDisponivel[]> {
  const url = urlGraph('/me/adaccounts', {
    fields: 'id,account_id,name,currency,timezone_name,account_status,amount_spent,business{name}',
    limit: 100,
  }, token)
  const { itens } = await metaFetchPaginado<ContaGraph>(url, deps)
  return paraContasDisponiveis(itens)
}

/** Permissões concedidas ao token — para dizer exatamente o que falta. */
export async function permissoesDoToken(token: string, deps: MetaFetchDeps = {}): Promise<string[]> {
  const url = urlGraph('/me/permissions', {}, token)
  const { dados } = await metaFetch<{ data?: { permission: string; status: string }[] }>(url, deps)
  return (dados.data ?? []).filter(p => p.status === 'granted').map(p => p.permission)
}

export const PERMISSOES_NECESSARIAS = ['ads_read'] as const

/** O que falta no token para ler anúncios (pura). */
export function permissoesFaltando(concedidas: readonly string[]): string[] {
  return PERMISSOES_NECESSARIAS.filter(p => !concedidas.includes(p))
}

/**
 * Troca o token curto (1–2h, do Explorador) por um de ~60 dias. Precisa do
 * App ID e App Secret do app da Meta. Sem eles, devolve o token como veio.
 */
export async function tokenDeLongaDuracao(
  token: string,
  app: { id?: string | null; secret?: string | null },
  deps: MetaFetchDeps = {},
): Promise<{ token: string; expiraEm: string | null; trocado: boolean }> {
  if (!app.id?.trim() || !app.secret?.trim()) return { token, expiraEm: null, trocado: false }
  const qs = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: app.id.trim(),
    client_secret: app.secret.trim(),
    fb_exchange_token: token,
  })
  try {
    const { dados } = await metaFetch<{ access_token?: string; expires_in?: number }>(
      `${META_GRAPH_BASE}/oauth/access_token?${qs.toString()}`, deps,
    )
    if (!dados.access_token) return { token, expiraEm: null, trocado: false }
    const expiraEm = dados.expires_in ? new Date(Date.now() + dados.expires_in * 1000).toISOString() : null
    return { token: dados.access_token, expiraEm, trocado: true }
  } catch {
    // Troca falhou (app sem permissão, secret errado): segue com o original.
    return { token, expiraEm: null, trocado: false }
  }
}
