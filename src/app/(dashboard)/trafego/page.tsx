// ============================================================================
// Painel do Gestor de Tráfego (Fase 1, itens 1.13 e 1.15)
// ----------------------------------------------------------------------------
// A tela antiga (/metrics/ads) lia `ad_metrics`, onde a receita era um número
// recalculado a cada sincronização — reembolso continuava contando e o
// histórico se reescrevia sozinho. Aqui o número vem de `ad_insights` (gasto)
// contra `sales` (venda com atribuição congelada).
//
// Três decisões que esta tela toma de propósito, todas contra "parecer bom":
//
//   • ZERO NUNCA É MOSTRADO COMO RESPOSTA. Se a migration não foi aplicada, se
//     a conta não sincronizou ainda ou se o token caiu, a tela DIZ isso. Um
//     painel zerado é indistinguível de "não vendeu nada" — e foi assim que o
//     agente mudo passou dias sem ninguém entender o motivo.
//   • VENDA SEM ANÚNCIO DE ORIGEM APARECE. É o número que denuncia link de
//     anúncio sem `utm_ad_id`; escondê-lo inflaria o ROAS do resto.
//   • TOKEN VENCENDO É AVISO, não erro silencioso (item 1.15).
// ============================================================================

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularRoasReal } from '@/lib/trafego/roas'
import { intervaloPadrao } from '@/lib/meta/sync-v2'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'

export const dynamic = 'force-dynamic'

const NIVEIS: { chave: NivelAnuncio; label: string }[] = [
  { chave: 'campaign', label: 'Campanhas' },
  { chave: 'adset', label: 'Conjuntos' },
  { chave: 'ad', label: 'Anúncios' },
]

const PERIODOS = [7, 14, 30]

function brl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function corDoRoas(roas: number | null): string {
  if (roas === null) return 'bg-slate-100 text-slate-600'
  if (roas >= 3) return 'bg-emerald-50 text-emerald-700'
  if (roas >= 1) return 'bg-yellow-50 text-yellow-700'
  return 'bg-red-50 text-red-700'
}

/** Quanto tempo faz, em palavras — "nunca" é informação, não vazio. */
function desde(iso: string | null): string {
  if (!iso) return 'nunca'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 2) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)} dia(s)`
}

/** Autorização vencendo dentro de 7 dias — aviso do item 1.15. */
function venceEmBreve(iso: string | null, agora = Date.now()): boolean {
  if (!iso) return false
  const dias = (new Date(iso).getTime() - agora) / 86_400_000
  return dias > 0 && dias <= 7
}

interface ContaLinha {
  id: string; external_id: string; name: string | null
  status: string; last_sync_at: string | null; last_error: string | null
  token_expires_at: string | null
}

function Cartao({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{valor}</p>
      {nota && <p className="mt-1 text-xs text-slate-500">{nota}</p>}
    </div>
  )
}

export default async function TrafegoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const nivel = (NIVEIS.find(n => n.chave === sp.nivel)?.chave ?? 'campaign') as NivelAnuncio
  const dias = PERIODOS.includes(Number(sp.dias)) ? Number(sp.dias) : 7

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ut } = await supabase
    .from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut) redirect('/onboarding')

  const admin = createAdminClient()
  const tenantId = ut.tenant_id as string
  const periodo = intervaloPadrao(dias)

  const { data: contasRaw, error: erroContas } = await admin
    .from('ad_accounts')
    .select('id, external_id, name, status, last_sync_at, last_error, token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('provider', 'meta')
    .order('created_at', { ascending: true })

  const migrationPendente = Boolean(erroContas)
  const contas = (contasRaw ?? []) as ContaLinha[]

  const { resumo, indisponivel } = migrationPendente
    ? { resumo: null, indisponivel: true }
    : await calcularRoasReal(admin, tenantId, periodo, nivel)

  const nuncaSincronizou = contas.length > 0 && contas.every(c => !c.last_sync_at)
  const comProblema = contas.filter(c => c.status !== 'active' || c.last_error)
  const vencendo = contas.filter(c => venceEmBreve(c.token_expires_at))

  const t = resumo?.totais
  const semAtr = resumo?.semAtribuicao

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Gestor de Tráfego</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gasto lido da Meta contra venda confirmada. Reembolso sai do faturamento —
          o ROAS aqui é o que sobrou de verdade.
        </p>
      </header>

      {/* ─── Filtros ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {NIVEIS.map(n => (
            <Link
              key={n.chave}
              href={`/trafego?nivel=${n.chave}&dias=${dias}`}
              className={`rounded-md px-3 py-1.5 text-sm ${
                n.chave === nivel ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {PERIODOS.map(d => (
            <Link
              key={d}
              href={`/trafego?nivel=${nivel}&dias=${d}`}
              className={`rounded-md px-3 py-1.5 text-sm ${
                d === dias ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {d} dias
            </Link>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {periodo.desde} até {periodo.ate}
        </span>
      </div>

      {/* ─── Estados que NÃO podem virar zero na tela ────────────────────── */}
      {migrationPendente && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Banco ainda não preparado.</strong> As tabelas da Fase 1 não existem neste
          projeto, então não há o que mostrar — e um painel zerado aqui seria mentira. Aplique a
          migration <code>20260818000000_trafego_fase1.sql</code> no Supabase.
        </div>
      )}

      {!migrationPendente && contas.length === 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          <strong className="text-slate-900">Nenhuma conta de anúncio conectada.</strong>
          <p className="mt-1">
            Conecte a conta da Meta em <Link href="/integrations" className="text-blue-600 underline">Integrações</Link>.
            Enquanto não houver conta, não há gasto para comparar com as vendas.
          </p>
        </div>
      )}

      {nuncaSincronizou && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <strong>Aguardando a primeira leitura.</strong> A sincronização roda de hora em hora.
          Os números aparecem na próxima rodada — isto aqui não é &quot;zero vendas&quot;.
        </div>
      )}

      {comProblema.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <strong>Conta com problema — os números abaixo estão parados no tempo.</strong>
          <ul className="mt-2 space-y-1">
            {comProblema.map(c => (
              <li key={c.id}>
                <span className="font-medium">{c.name ?? `Conta ${c.external_id}`}</span>{' '}
                — {c.status === 'token_expired'
                  ? 'a autorização caiu; reconecte a conta para voltar a ler.'
                  : (c.last_error ?? 'erro na última leitura.')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vencendo.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Autorização vencendo em menos de 7 dias.</strong> Reconecte antes de vencer:
          quando ela cai, a leitura para e o painel congela sem avisar de outro jeito.
          <ul className="mt-2 space-y-1">
            {vencendo.map(c => (
              <li key={c.id}>{c.name ?? `Conta ${c.external_id}`}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Totais ──────────────────────────────────────────────────────── */}
      {resumo && !indisponivel && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Cartao titulo="Investido" valor={brl(t!.gastoCents)} />
            <Cartao titulo="Faturado" valor={brl(t!.receitaCents)} nota={`${t!.vendas} venda(s)`} />
            <Cartao
              titulo="ROAS real"
              valor={t!.roas === null ? '—' : `${t!.roas.toFixed(2)}x`}
              nota={t!.roas === null ? 'sem gasto no período' : undefined}
            />
            <Cartao titulo="Estornado" valor={brl(t!.estornadoCents)} nota="já fora do faturado" />
            <Cartao
              titulo="Sem origem"
              valor={brl(semAtr!.receitaCents)}
              nota={`${semAtr!.vendas} venda(s) sem anúncio`}
            />
          </div>

          {semAtr!.vendas > 0 && (
            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <strong className="text-slate-900">
                {semAtr!.vendas} venda(s) sem anúncio de origem.
              </strong>{' '}
              Elas ficam FORA das linhas abaixo de propósito — somá-las inflaria o ROAS de
              anúncios que não as geraram. A causa quase sempre é link de anúncio sem{' '}
              <code>utm_ad_id</code>: gere o link de novo pelo funil, na aba de links.
            </div>
          )}

          {/* ─── Tabela ────────────────────────────────────────────────── */}
          {resumo.linhas.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Nenhum gasto nem venda atribuída neste período.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{NIVEIS.find(n => n.chave === nivel)!.label}</th>
                    <th className="px-4 py-3 text-right">Investido</th>
                    <th className="px-4 py-3 text-right">Faturado</th>
                    <th className="px-4 py-3 text-right">Vendas</th>
                    <th className="px-4 py-3 text-right">CPA</th>
                    <th className="px-4 py-3 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resumo.linhas.map(l => (
                    <tr key={l.externalId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{l.nome ?? l.externalId}</p>
                        {l.nome && <p className="text-xs text-slate-400">{l.externalId}</p>}
                        {l.estornadoCents > 0 && (
                          <p className="text-xs text-red-600">
                            {brl(l.estornadoCents)} estornado
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{brl(l.gastoCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{brl(l.receitaCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{l.vendas}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {l.cpaCents === null ? '—' : brl(l.cpaCents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${corDoRoas(l.roas)}`}>
                          {l.roas === null ? '—' : `${l.roas.toFixed(2)}x`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── Rodapé: estado das contas ───────────────────────────────────── */}
      {contas.length > 0 && (
        <div className="mt-6 text-xs text-slate-500">
          {contas.map(c => (
            <p key={c.id}>
              {c.name ?? `Conta ${c.external_id}`} · última leitura {desde(c.last_sync_at)}
              {c.status !== 'active' && ` · ${c.status}`}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
