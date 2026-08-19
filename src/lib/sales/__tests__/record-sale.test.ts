// ============================================================================
// Gestor de Tráfego — Fase 1: venda como entidade, com atribuição congelada
// ----------------------------------------------------------------------------
// Três defeitos reais que este módulo fecha:
//
//   1. Webhook reenviado duplicava receita (não havia id de transação).
//   2. Reembolso/chargeback não mudavam o estado da venda — o faturamento
//      nunca diminuía.
//   3. A atribuição era recalculada depois, então mudar a origem do lead
//      reescrevia o histórico financeiro.
//
// Sem rede e sem banco: o Supabase é substituído por um dublê que registra o
// que teria sido gravado.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  extrairIdExterno, registrarVenda, resolverAtribuicao, statusDoEvento,
} from '../record-sale'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Dublê do Supabase ──────────────────────────────────────────────────────

interface DubleOpts {
  origem?: Record<string, string | null> | null
  erroUpsert?: { code?: string; message?: string } | null
}

function duble(opts: DubleOpts = {}) {
  const gravado: { linha: Record<string, unknown>; conflito?: string }[] = []

  const client = {
    from(tabela: string) {
      if (tabela === 'lead_sources') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: opts.origem ?? null, error: null }),
        }
        return chain
      }
      if (tabela === 'sales') {
        return {
          upsert: async (linha: Record<string, unknown>, cfg?: { onConflict?: string }) => {
            if (opts.erroUpsert) return { error: opts.erroUpsert }
            gravado.push({ linha, conflito: cfg?.onConflict })
            return { error: null }
          },
        }
      }
      throw new Error(`tabela inesperada: ${tabela}`)
    },
  } as unknown as SupabaseClient

  return { client, gravado }
}

const VENDA = {
  tenantId: 't1',
  leadId: 'lead-1',
  platform: 'hotmart',
  externalId: 'TX-123',
  status: 'approved' as const,
  revenueCents: 9700,
  productName: 'Curso',
  buyerEmail: 'a@b.com',
  buyerPhone: '21999999999',
}

// ════════════════════════════════════════════════════════════════════════════

test('1) a atribuição é CONGELADA a partir da origem imutável do lead', async () => {
  const d = duble({
    origem: { utm_ad_id: '42', utm_adset_id: '7', utm_campaign_id: '3', utm_source: 'meta' },
  })
  await registrarVenda(d.client, VENDA)

  assert.equal(d.gravado.length, 1)
  const l = d.gravado[0].linha
  assert.equal(l.attr_ad_id, '42', 'a venda não guardou o anúncio de origem')
  assert.equal(l.attr_adset_id, '7')
  assert.equal(l.attr_campaign_id, '3')
  assert.equal(l.attr_utm_source, 'meta')
  assert.equal(l.attr_model, 'first_touch')
  assert.equal(l.revenue_cents, 9700)
})

test('2) dedupe pela TRANSAÇÃO: webhook reenviado não duplica receita', async () => {
  const d = duble({ origem: null })
  await registrarVenda(d.client, VENDA)
  assert.equal(d.gravado[0].conflito, 'tenant_id,platform,external_id',
    'sem chave de conflito, o mesmo webhook viraria duas vendas')
})

test('3) lead sem origem não inventa atribuição', async () => {
  const d = duble({ origem: null })
  await registrarVenda(d.client, VENDA)
  const l = d.gravado[0].linha
  assert.equal(l.attr_ad_id, null)
  assert.equal(l.attr_utm_source, null)
  // Mas a venda É registrada — faturamento não pode sumir por falta de origem.
  assert.equal(l.revenue_cents, 9700)
})

test('4) reembolso ATUALIZA a venda sem apagar de onde ela veio', async () => {
  const d = duble({ origem: { utm_ad_id: '42', utm_adset_id: null, utm_campaign_id: null, utm_source: 'meta' } })
  await registrarVenda(d.client, { ...VENDA, status: 'refunded' })

  const l = d.gravado[0].linha
  assert.equal(l.status, 'refunded')
  // Reembolso NÃO recalcula atribuição: mantém a linha original intocada nesse
  // campo (o upsert só sobrescreve o que envia).
  assert.ok(!('attr_ad_id' in l), 'o reembolso reescreveria a atribuição da venda')
  assert.equal(d.gravado[0].conflito, 'tenant_id,platform,external_id')
})

test('5) migration pendente não derruba o webhook', async () => {
  const d = duble({ erroUpsert: { code: '42P01', message: 'relation "sales" does not exist' } })
  const r = await registrarVenda(d.client, VENDA)
  assert.equal(r.gravado, false)
  assert.match(r.motivo ?? '', /migration/i, 'a causa deveria ser explícita')

  // E o erro comum continua sendo reportado como erro, não confundido com isso.
  const d2 = duble({ erroUpsert: { code: '23505', message: 'duplicate key' } })
  const r2 = await registrarVenda(d2.client, VENDA)
  assert.equal(r2.gravado, false)
  assert.ok(!/migration/i.test(r2.motivo ?? ''), 'erro comum virou "migration pendente"')
})

test('6) o id da transação é extraído de onde cada plataforma o coloca', () => {
  const base = { email: 'a@b.com', revenueCents: 9700, productName: 'X' }
  assert.equal(extrairIdExterno('hotmart', { data: { purchase: { transaction: 'HP123' } } }, base), 'HP123')
  assert.equal(extrairIdExterno('kiwify', { order: { id: 'KW9' } }, base), 'KW9')
  assert.equal(extrairIdExterno('yampi', { data: { id: 555 } }, base), '555')

  // Sem id nenhum: chave derivada e ESTÁVEL (mesma entrada, mesma chave).
  const a = extrairIdExterno('eduzz', {}, base)
  const b = extrairIdExterno('eduzz', {}, base)
  assert.equal(a, b, 'a chave derivada precisa ser estável')
  assert.ok(a.startsWith('derivado:'), 'a chave derivada deveria ser identificável')
  // Compradores diferentes não colidem.
  assert.notEqual(a, extrairIdExterno('eduzz', {}, { ...base, email: 'c@d.com' }))
})

test('7) tradução dos eventos do webhook', () => {
  assert.equal(statusDoEvento('purchased'), 'approved')
  assert.equal(statusDoEvento('refunded'), 'refunded')
  assert.equal(statusDoEvento('chargeback'), 'chargeback')
  assert.equal(statusDoEvento('canceled'), 'canceled')
  assert.equal(statusDoEvento('coisa_nova'), 'pending', 'evento desconhecido não pode virar venda aprovada')
})

test('8) sem lead, a atribuição é vazia — e não quebra', async () => {
  const d = duble({ origem: null })
  const attr = await resolverAtribuicao(d.client, null)
  assert.equal(attr.attr_ad_id, null)
  assert.equal(attr.attr_model, 'first_touch')
})

test('9) o webhook grava a venda ANTES de tocar o funil, e a órfã também conta', () => {
  const h = ler('src/lib/webhooks/purchase-handler.ts')
  assert.ok(h.includes('registrarVenda'), 'o webhook não registra venda')
  // Venda sem lead identificado também entra em `sales`.
  const orfa = h.slice(h.indexOf('Órfã: sem lead'))
  assert.ok(orfa.includes('leadId: null'), 'venda órfã ficaria fora do faturamento')
  assert.ok(orfa.indexOf('registrarVenda') < orfa.indexOf("from('orphan_purchases')"),
    'a venda órfã precisa ser registrada junto com o registro de órfã')
  // O lead_event continua: é dele que o motor do funil depende.
  assert.ok(h.includes("event_type: data.eventType === 'purchased' ? 'purchased'"),
    'o evento do funil foi removido')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  let passed = 0
  for (const r of results) {
    if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
    else console.log(` FALHA ${r.name}\n        → ${r.error}`)
  }
  console.log(`\n${passed}/${results.length} testes passaram`)
  if (passed !== results.length) process.exit(1)
}

void main()
