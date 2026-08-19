// ============================================================================
// Sincronização recorrente das contas de anúncio (Fase 1, item 1.11)
// ----------------------------------------------------------------------------
// O `sync.ts` antigo só rodava quando alguém abria a tela e clicava. Isso
// significa que o painel mostrava o que existia na última visita — e um
// anúncio queimando orçamento passava dias sem aparecer em lugar nenhum.
//
// Três regras que este módulo existe para garantir:
//
//   1. UMA CONTA POR VEZ, com ORÇAMENTO DE TEMPO. A requisição tem limite; se
//      o laço não conferir quanto sobrou ANTES de começar a próxima conta, a
//      função morre no meio e a conta fica com `last_sync_at` desatualizado
//      sem ninguém saber por quê (foi exatamente assim que os passos do
//      Content Studio ficaram órfãos em `running`).
//   2. QUEM ESTÁ MAIS ATRASADO PRIMEIRO. Ordenar por `last_sync_at` com os
//      nulos na frente impede que uma conta nunca sincronizada fique para
//      sempre atrás das que já rodaram.
//   3. NADA É ENGOLIDO. Conta que falha é contada e devolvida com o motivo; o
//      status dela vira `token_expired`/`error` em `ad_accounts`.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MetaFetchDeps } from './client'
import { normalizarIdConta, type ContaDeAnuncio } from './accounts'
import { intervaloPadrao, sincronizarConta, type ResultadoSync } from './sync-v2'

/** De quanto em quanto tempo cada conta é relida. */
export const SYNC_INTERVALO_MS = 60 * 60 * 1000        // 1 hora

/** Teto do que a rota pode gastar antes de a plataforma cortar. */
export const SYNC_ROUTE_MAX_DURATION_MS = 300_000

/** Orçamento do laço — folga para responder antes do corte. */
export const SYNC_BUDGET_MS = 240_000

/** Tempo mínimo reservado para uma conta: abaixo disso, nem começa. */
export const SYNC_MIN_CONTA_MS = 45_000

/** Quantas contas uma execução pode olhar. */
export const SYNC_MAX_CONTAS = 20

// INVARIANTE conferido no import: se alguém aumentar o orçamento sem aumentar
// o teto da rota, a execução volta a morrer no meio — que é o defeito que este
// módulo existe para evitar. Melhor quebrar no build do que em produção.
if (SYNC_BUDGET_MS + SYNC_MIN_CONTA_MS > SYNC_ROUTE_MAX_DURATION_MS) {
  throw new Error(
    `[meta/scheduler] orçamento inválido: ${SYNC_BUDGET_MS}ms + ${SYNC_MIN_CONTA_MS}ms ` +
    `passa do teto da rota (${SYNC_ROUTE_MAX_DURATION_MS}ms)`,
  )
}

interface LinhaConta {
  id: string; tenant_id: string; external_id: string; access_token: string | null
  name: string | null; currency: string | null; timezone_name: string | null; status: string
}

function paraConta(linha: LinhaConta): ContaDeAnuncio {
  return {
    id: String(linha.id),
    tenantId: String(linha.tenant_id),
    externalId: normalizarIdConta(String(linha.external_id)),
    accessToken: String(linha.access_token ?? ''),
    name: linha.name ?? null,
    currency: linha.currency ?? null,
    timezone: linha.timezone_name ?? null,
    status: String(linha.status),
    origem: 'ad_accounts',
  }
}

/**
 * Contas ativas que já passaram do intervalo — as mais atrasadas primeiro.
 *
 * Conta com `status` diferente de `active` (token expirado, erro) NÃO entra:
 * repetir a chamada não conserta e só queima cota da Meta. Ela volta sozinha
 * quando a tela reconecta e devolve o status para `active`.
 */
export async function contasVencidas(
  admin: SupabaseClient,
  opcoes: { agora?: Date; intervaloMs?: number; limite?: number } = {},
): Promise<ContaDeAnuncio[]> {
  const agora = opcoes.agora ?? new Date()
  const corte = new Date(agora.getTime() - (opcoes.intervaloMs ?? SYNC_INTERVALO_MS)).toISOString()

  const { data, error } = await admin
    .from('ad_accounts')
    .select('id, tenant_id, external_id, access_token, name, currency, timezone_name, status')
    .eq('provider', 'meta')
    .eq('status', 'active')
    .or(`last_sync_at.is.null,last_sync_at.lt.${corte}`)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(opcoes.limite ?? SYNC_MAX_CONTAS)

  if (error || !data) return []
  return (data as LinhaConta[])
    .filter(l => typeof l.access_token === 'string' && l.access_token.length > 0)
    .map(paraConta)
}

export interface ResultadoRodada {
  contas: number
  ok: number
  falhas: number
  entidades: number
  insights: number
  /** true quando o orçamento acabou antes de as contas vencidas terminarem. */
  incompleto: boolean
  detalhes: { contaId: string; tenantId: string; ok: boolean; erro?: string; tipoErro?: string }[]
}

/**
 * Roda uma volta da sincronização, dentro do orçamento de tempo.
 *
 * O que sobrar fica para a próxima execução: `last_sync_at` só é atualizado em
 * quem realmente rodou, então a fila anda sozinha sem estado extra.
 */
export async function sincronizarPendentes(
  admin: SupabaseClient,
  opcoes: {
    agora?: Date
    dias?: number
    budgetMs?: number
    relogio?: () => number
    deps?: MetaFetchDeps
    sincronizar?: (conta: ContaDeAnuncio) => Promise<ResultadoSync>
  } = {},
): Promise<ResultadoRodada> {
  const relogio = opcoes.relogio ?? (() => Date.now())
  const inicio = relogio()
  const budget = opcoes.budgetMs ?? SYNC_BUDGET_MS
  const intervalo = intervaloPadrao(opcoes.dias ?? 7, opcoes.agora ?? new Date())

  const contas = await contasVencidas(admin, { agora: opcoes.agora })
  const rodar = opcoes.sincronizar
    ?? ((c: ContaDeAnuncio) => sincronizarConta(admin, c, intervalo, opcoes.deps ?? {}))

  const r: ResultadoRodada = {
    contas: 0, ok: 0, falhas: 0, entidades: 0, insights: 0,
    incompleto: false, detalhes: [],
  }

  for (const conta of contas) {
    // Confere ANTES de começar: entrar numa conta sem tempo para terminá-la é
    // o que produz execução morta no meio.
    if (relogio() - inicio > budget - SYNC_MIN_CONTA_MS) {
      r.incompleto = true
      break
    }

    const res = await rodar(conta)
    r.contas++
    r.entidades += res.entidades
    r.insights += res.insights
    if (res.ok) r.ok++
    else r.falhas++
    r.detalhes.push({
      contaId: conta.id ?? conta.externalId,
      tenantId: conta.tenantId,
      ok: res.ok,
      ...(res.erro ? { erro: res.erro } : {}),
      ...(res.tipoErro ? { tipoErro: res.tipoErro } : {}),
    })
  }

  if (contas.length > r.contas) r.incompleto = true
  return r
}
