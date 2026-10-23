// ============================================================================
// Estúdio IA — Fase 4: comprovante do Pix no servidor (Storage + banco)
// ----------------------------------------------------------------------------
// processarComprovante: guarda o arquivo em estudio-clientes/<pedido>/
// comprovante.*, lê com a IA, aplica a régua (pix.ts) e marca 'pago' ou
// 'aguardando_conferencia'. marcarPago também serve ao botão "Aprovar" do
// Luís e grava os dados de venda que o Painel (Fase 6) vai ler.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_CLIENTES } from './catalogo'
import { extensaoDoMime } from './chat'
import { decidirComprovante, dadosDeVenda, normalizarE2E, type LeituraComprovante, type PixDoLuis } from './pix'
import { lerComprovante, type UsoIa } from './ana/ia'

export async function registrarUsoIa(admin: SupabaseClient, r: {
  tenant_id: string; contato_id: string | null; pedido_id: string | null; finalidade: string; intencao?: string | null; uso: UsoIa
}) {
  const { error } = await admin.from('estudio_ia_uso').insert({
    tenant_id: r.tenant_id, contato_id: r.contato_id, pedido_id: r.pedido_id, finalidade: r.finalidade, intencao: r.intencao ?? null,
    modelo: r.uso.modelo, input_tokens: r.uso.input_tokens, output_tokens: r.uso.output_tokens,
    cache_read: r.uso.cache_read, cache_write: r.uso.cache_write, custo_usd: r.uso.custo_usd,
  })
  if (error) console.warn('[estudio] custo de IA não gravado (SQL da Fase 4?):', error.message)
}

export async function pixDoTenant(admin: SupabaseClient, tenantId: string): Promise<PixDoLuis> {
  const { data, error } = await admin.from('estudio_config').select('pix_chave, pix_tipo, pix_recebedor').eq('tenant_id', tenantId).maybeSingle()
  if (error || !data) return { chave: null, tipo: null, recebedor: null }
  return { chave: data.pix_chave ?? null, tipo: data.pix_tipo ?? null, recebedor: data.pix_recebedor ?? null }
}

export interface Pagamento {
  pago_por: 'comprovante' | 'manual' | 'hotmart'
  forma_pagamento: 'pix_comprovante' | 'hotmart'
  valor_pago_cents: number | null
  pago_em?: string | null
  pix_e2e_id?: string | null
}

/**
 * Marca o pedido como pago e grava o retrato da venda: valor, moeda, quando,
 * forma, pacote/tema/poses (já no pedido), país, idioma, origem + id do
 * anúncio, se veio de prévia e o custo de IA (conversa inteira até aqui).
 */
export async function marcarPago(admin: SupabaseClient, pedidoId: string, p: Pagamento): Promise<{ error?: string; duplicado?: boolean }> {
  const { data: ped } = await admin.from('estudio_pedidos').select('id, tenant_id, contato_id, valor_cents, status').eq('id', pedidoId).single()
  if (!ped) return { error: 'Pedido não encontrado.' }
  if (ped.status === 'cancelado') return { error: 'Pedido cancelado.' }
  const { data: contato } = ped.contato_id
    ? await admin.from('estudio_contatos').select('origem, referral, pais, idioma').eq('id', ped.contato_id).single()
    : { data: null }
  const { count: previas } = ped.contato_id
    ? await admin.from('estudio_pedidos').select('id', { count: 'exact', head: true }).eq('contato_id', ped.contato_id).eq('tipo', 'previa').neq('id', pedidoId)
    : { count: 0 }
  // A conversa antes do pedido também foi gasto para vender este pedido.
  if (ped.contato_id) await admin.from('estudio_ia_uso').update({ pedido_id: pedidoId }).eq('contato_id', ped.contato_id).is('pedido_id', null)
  const { data: usos } = await admin.from('estudio_ia_uso').select('custo_usd').eq('pedido_id', pedidoId)
  const custo = (usos ?? []).reduce((s, u) => s + Number(u.custo_usd ?? 0), 0)

  const { error } = await admin.from('estudio_pedidos').update({
    status: 'pago', pago_por: p.pago_por, forma_pagamento: p.forma_pagamento,
    valor_pago_cents: p.valor_pago_cents ?? ped.valor_cents, pago_em: p.pago_em ?? new Date().toISOString(),
    ...(p.pix_e2e_id ? { pix_e2e_id: p.pix_e2e_id } : {}), conferencia_motivo: null,
    ...dadosDeVenda(contato ?? {}, (previas ?? 0) > 0), custo_ia_usd: Math.round(custo * 1e6) / 1e6,
  }).eq('id', pedidoId)
  if (error) return /duplicate|unique|23505/i.test(error.message) ? { duplicado: true, error: 'Este comprovante já pagou outro pedido.' } : { error: error.message }
  await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'pago', detalhe: { pago_por: p.pago_por, valor_pago_cents: p.valor_pago_cents, e2e: p.pix_e2e_id ?? null } })
  // Fase 5: pago + fotos + poses + idade → fila de produção + aviso ao Luís.
  const { entrarNaFila } = await import('./producao-servidor')
  await entrarNaFila(admin, pedidoId).catch(err => console.error('[estudio] entrar na fila:', String(err).slice(0, 200)))
  return {}
}

export type ResultadoComprovante =
  | { resultado: 'pago' }
  | { resultado: 'conferencia'; motivos: string[] }
  | { resultado: 'nao_e_comprovante' }

export async function processarComprovante(admin: SupabaseClient, c: { tenant_id: string; id: string }, pedidoId: string, media: { path: string; mime: string }, agora = new Date()): Promise<ResultadoComprovante> {
  const { data: ped } = await admin.from('estudio_pedidos').select('id, valor_cents, status').eq('id', pedidoId).single()
  if (!ped) return { resultado: 'conferencia', motivos: ['pedido não encontrado'] }

  // 1) Guarda o comprovante no bucket privado, ao lado das fotos do pedido.
  const destino = `${pedidoId}/comprovante.${extensaoDoMime(media.mime)}`
  await admin.storage.from(BUCKET_CLIENTES).remove([destino]).catch(() => {})
  const { error: eCopia } = await admin.storage.from(BUCKET_CLIENTES).copy(media.path, destino)
  const caminho = eCopia ? media.path : destino

  // 2) Lê com a IA de visão (Sonnet). Falha/sem chave → leitura vazia.
  const { data: arq } = await admin.storage.from(BUCKET_CLIENTES).download(media.path)
  const { leitura, uso, falhou } = arq ? await lerComprovanteSeguro(new Uint8Array(await arq.arrayBuffer()), media.mime) : { leitura: null, uso: undefined, falhou: true }
  if (uso) await registrarUsoIa(admin, { tenant_id: c.tenant_id, contato_id: c.id, pedido_id: pedidoId, finalidade: 'comprovante', uso })

  // Foto qualquer (selfie, print de conversa) enquanto espera o Pix: só pede o comprovante.
  if (leitura && !falhou && !leitura.e_comprovante && leitura.legivel) {
    await admin.from('estudio_pedidos').update({ comprovante_dados: leitura }).eq('id', pedidoId)
    return { resultado: 'nao_e_comprovante' }
  }

  // 3) Régua.
  const pix = await pixDoTenant(admin, c.tenant_id)
  const e2e = normalizarE2E(leitura?.e2e_id ?? null)
  let usado = false
  if (e2e) {
    const { count } = await admin.from('estudio_pedidos').select('id', { count: 'exact', head: true }).eq('pix_e2e_id', e2e).neq('id', pedidoId)
    usado = (count ?? 0) > 0
  }
  const decisao = leitura && !falhou
    ? decidirComprovante(leitura, { valor_cents: ped.valor_cents ?? 0, pix }, agora, usado)
    : { aprovar: false as const, motivos: ['não consegui ler o comprovante automaticamente'] }

  await admin.from('estudio_pedidos').update({ comprovante_path: caminho, comprovante_dados: leitura }).eq('id', pedidoId)

  let motivos = decisao.aprovar ? [] : decisao.motivos
  if (decisao.aprovar && leitura) {
    const r = await marcarPago(admin, pedidoId, {
      pago_por: 'comprovante', forma_pagamento: 'pix_comprovante', valor_pago_cents: leitura.valor_cents,
      pago_em: leitura.data_hora ? new Date(leitura.data_hora).toISOString() : null, pix_e2e_id: e2e,
    })
    if (!r.error) return { resultado: 'pago' }
    motivos = [r.duplicado ? 'este comprovante já foi usado em outro pedido' : `erro ao gravar: ${r.error}`]
  }
  await admin.from('estudio_pedidos').update({ status: 'aguardando_conferencia', conferencia_motivo: motivos.join('; ').slice(0, 500) }).eq('id', pedidoId)
  await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'comprovante_em_conferencia', detalhe: { motivos } })
  return { resultado: 'conferencia', motivos }
}

async function lerComprovanteSeguro(bytes: Uint8Array, mime: string): Promise<{ leitura: LeituraComprovante | null; uso?: UsoIa; falhou: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) return { leitura: null, falhou: true }
  const r = await lerComprovante(bytes, mime)
  // Leitura vazia de verdade (erro da API) não tem uso: trata como falha.
  return { leitura: r.leitura, uso: r.uso, falhou: !r.uso }
}
