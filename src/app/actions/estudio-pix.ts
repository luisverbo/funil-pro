'use server'
// ============================================================================
// Estúdio IA — Fase 4: Pix do Luís (configurar, aprovar/recusar comprovante,
// lista diária, cancelar/estornar), base de conhecimento da Ana e custo de IA.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKET_CLIENTES } from '@/lib/estudio/catalogo'
import { marcarPago } from '@/lib/estudio/pix-servidor'
import { falarComCliente } from '@/lib/estudio/ana/executor'

async function getTenantId(): Promise<string> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

const aviso = (m: string) => /pix_|estudio_conhecimento|estudio_ia_uso|comprovante|forma_pagamento|column|does not exist|schema cache/i.test(m)
  ? 'Falta rodar o SQL da Fase 4 (20261028000000_estudio_ia_pix.sql) no Supabase.' : m
const TIPOS_CHAVE = ['cpf', 'cnpj', 'celular', 'email', 'aleatoria']

// ── Configuração do Pix ─────────────────────────────────────────────────────

export async function lerPixConfig(): Promise<{ chave: string; tipo: string; recebedor: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_config').select('pix_chave, pix_tipo, pix_recebedor').eq('tenant_id', tenantId).maybeSingle()
    if (error) return { chave: '', tipo: 'celular', recebedor: '', error: aviso(error.message) }
    return { chave: data?.pix_chave ?? '', tipo: data?.pix_tipo ?? 'celular', recebedor: data?.pix_recebedor ?? '' }
  } catch (e) { return { chave: '', tipo: 'celular', recebedor: '', error: String(e) } }
}

export async function salvarPixConfig(chave: string, tipo: string, recebedor: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!TIPOS_CHAVE.includes(tipo)) return { success: false, error: 'Tipo de chave inválido.' }
    const ch = String(chave ?? '').trim().slice(0, 140); const nome = String(recebedor ?? '').trim().slice(0, 140)
    if (ch && !nome) return { success: false, error: 'Informe o nome do recebedor como aparece no comprovante.' }
    const { error } = await createAdminClient().from('estudio_config').update({ pix_chave: ch || null, pix_tipo: tipo, pix_recebedor: nome || null }).eq('tenant_id', tenantId)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── Conferência e lista do dia ──────────────────────────────────────────────

export interface PedidoPix {
  id: string; contato_id: string | null; cliente_nome: string | null; wa_id: string | null; status: string
  valor_cents: number | null; valor_pago_cents: number | null; moeda: string; pago_em: string | null; criado_em: string
  pix_e2e_id: string | null; pago_por: string | null; conferencia_motivo: string | null
  comprovante_url: string | null; pagador: string | null; pacote_qtd: number | null; tema_slug: string | null
}

const CAMPOS = 'id, contato_id, cliente_nome, wa_id, status, valor_cents, valor_pago_cents, moeda, pago_em, criado_em, pix_e2e_id, pago_por, conferencia_motivo, comprovante_path, comprovante_dados, pacote_qtd, tema_slug'

async function comLinks(rows: Record<string, unknown>[]): Promise<PedidoPix[]> {
  const admin = createAdminClient()
  return Promise.all(rows.map(async r => {
    let url: string | null = null
    if (r.comprovante_path) url = (await admin.storage.from(BUCKET_CLIENTES).createSignedUrl(String(r.comprovante_path), 3600)).data?.signedUrl ?? null
    const dados = (r.comprovante_dados ?? {}) as { pagador_nome?: string | null }
    return {
      id: String(r.id), contato_id: (r.contato_id as string) ?? null, cliente_nome: (r.cliente_nome as string) ?? null, wa_id: (r.wa_id as string) ?? null,
      status: String(r.status), valor_cents: (r.valor_cents as number) ?? null, valor_pago_cents: (r.valor_pago_cents as number) ?? null,
      moeda: String(r.moeda ?? 'BRL'), pago_em: (r.pago_em as string) ?? null, criado_em: String(r.criado_em), pix_e2e_id: (r.pix_e2e_id as string) ?? null,
      pago_por: (r.pago_por as string) ?? null, conferencia_motivo: (r.conferencia_motivo as string) ?? null, comprovante_url: url,
      pagador: dados.pagador_nome ?? null, pacote_qtd: (r.pacote_qtd as number) ?? null, tema_slug: (r.tema_slug as string) ?? null,
    }
  }))
}

/** Comprovantes esperando o Luís aprovar ou recusar. */
export async function listarConferenciasPix(): Promise<{ pedidos: PedidoPix[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_pedidos').select(CAMPOS)
      .eq('tenant_id', tenantId).eq('status', 'aguardando_conferencia').order('criado_em', { ascending: true }).limit(100)
    if (error) return { pedidos: [], error: aviso(error.message) }
    return { pedidos: await comLinks(data ?? []) }
  } catch (e) { return { pedidos: [], error: String(e) } }
}

/** "Pix por comprovante" de um dia (Brasília) — para bater com o extrato. */
export async function listarPixDoDia(dia: string): Promise<{ pedidos: PedidoPix[]; total_cents: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { pedidos: [], total_cents: 0, error: 'Dia inválido.' }
    const de = new Date(`${dia}T00:00:00-03:00`).toISOString(); const ate = new Date(new Date(de).getTime() + 86400e3).toISOString()
    const { data, error } = await createAdminClient().from('estudio_pedidos').select(CAMPOS)
      .eq('tenant_id', tenantId).eq('forma_pagamento', 'pix_comprovante').gte('pago_em', de).lt('pago_em', ate).order('pago_em', { ascending: true })
    if (error) return { pedidos: [], total_cents: 0, error: aviso(error.message) }
    const pedidos = await comLinks(data ?? [])
    return { pedidos, total_cents: pedidos.filter(p => p.status !== 'cancelado').reduce((s, p) => s + (p.valor_pago_cents ?? 0), 0) }
  } catch (e) { return { pedidos: [], total_cents: 0, error: String(e) } }
}

async function pedidoDoTenant(tenantId: string, pedidoId: string) {
  const { data } = await createAdminClient().from('estudio_pedidos').select('id, contato_id, status, valor_cents, moeda, forma_pagamento, comprovante_dados').eq('id', pedidoId).eq('tenant_id', tenantId).maybeSingle()
  if (!data) throw new Error('Pedido não encontrado.')
  return data
}

/** Luís conferiu no extrato e aprovou: pedido 'pago' (pago_por='manual') e a Ana avisa a cliente. */
export async function aprovarPagamentoPix(pedidoId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, pedidoId)
    if (!['aguardando_conferencia', 'aguardando_pagamento'].includes(p.status)) return { success: false, error: `Pedido está "${p.status}".` }
    const lido = (p.comprovante_dados ?? {}) as { valor_cents?: number | null; e2e_id?: string | null; data_hora?: string | null }
    const e2e = lido.e2e_id?.replace(/\s/g, '').toUpperCase() || null
    // Pedido da Hotmart que caiu na conferência: continua "hotmart" (sem comprovante de Pix).
    const hotmart = p.forma_pagamento === 'hotmart'
    const r = await marcarPago(createAdminClient(), pedidoId, {
      pago_por: 'manual', forma_pagamento: hotmart ? 'hotmart' : 'pix_comprovante', valor_pago_cents: hotmart ? p.valor_cents : (lido.valor_cents ?? p.valor_cents),
      moeda: p.moeda ?? null,
      pago_em: lido.data_hora && !Number.isNaN(new Date(lido.data_hora).getTime()) ? new Date(lido.data_hora).toISOString() : null,
      pix_e2e_id: e2e && e2e.length >= 10 ? e2e : null,
    })
    if (r.error) return { success: false, error: aviso(r.error) }
    if (p.contato_id) await falarComCliente(createAdminClient(), tenantId, p.contato_id, 'pago_ok', 'pago')
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

/** Recusou: volta para aguardando_pagamento e a Ana pede outro comprovante. */
export async function recusarPagamentoPix(pedidoId: string, motivo: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, pedidoId)
    if (p.status !== 'aguardando_conferencia') return { success: false, error: `Pedido está "${p.status}".` }
    const admin = createAdminClient()
    const { error } = await admin.from('estudio_pedidos').update({ status: 'aguardando_pagamento', conferencia_motivo: `recusado: ${String(motivo ?? '').slice(0, 300)}` }).eq('id', pedidoId)
    if (error) return { success: false, error: aviso(error.message) }
    await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'comprovante_recusado', detalhe: { motivo } })
    if (p.contato_id) await falarComCliente(admin, tenantId, p.contato_id, 'comprovante_recusado', 'aguardando_pagamento')
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

/** Comprovante falso descoberto depois / estorno: cancela (a cliente não é avisada automaticamente). */
export async function cancelarPedidoEstudio(pedidoId: string, motivo: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, pedidoId)
    if (p.status === 'cancelado') return { success: true }
    const admin = createAdminClient()
    const { error } = await admin.from('estudio_pedidos').update({ status: 'cancelado', cancelado_em: new Date().toISOString(), cancelado_motivo: String(motivo ?? '').slice(0, 300) || null }).eq('id', pedidoId)
    if (error) return { success: false, error: aviso(error.message) }
    await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'cancelado', detalhe: { motivo, status_anterior: p.status } })
    if (p.contato_id) await admin.from('estudio_contatos').update({ pedido_atual_id: null, etapa: 'pacote' }).eq('id', p.contato_id).eq('pedido_atual_id', pedidoId)
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── Base de conhecimento da Ana ─────────────────────────────────────────────

export interface ItemConhecimento { id: string; tipo: 'faq' | 'regra' | 'nao_dizer'; pergunta: string | null; resposta: string; ativo: boolean; ordem: number }

export async function listarConhecimento(): Promise<{ itens: ItemConhecimento[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_conhecimento').select('id, tipo, pergunta, resposta, ativo, ordem')
      .eq('tenant_id', tenantId).order('tipo').order('ordem').order('criado_em')
    if (error) return { itens: [], error: aviso(error.message) }
    return { itens: (data ?? []) as ItemConhecimento[] }
  } catch (e) { return { itens: [], error: String(e) } }
}

export async function salvarConhecimento(item: { id?: string | null; tipo: string; pergunta?: string | null; resposta: string; ativo?: boolean }): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!['faq', 'regra', 'nao_dizer'].includes(item.tipo)) return { success: false, error: 'Tipo inválido.' }
    const resposta = String(item.resposta ?? '').trim().slice(0, 2000)
    const pergunta = item.tipo === 'faq' ? String(item.pergunta ?? '').trim().slice(0, 500) : null
    if (!resposta || (item.tipo === 'faq' && !pergunta)) return { success: false, error: item.tipo === 'faq' ? 'Preencha a pergunta e a resposta.' : 'Escreva o texto.' }
    const admin = createAdminClient()
    const linha = { tipo: item.tipo, pergunta, resposta, ativo: item.ativo ?? true }
    if (item.id) {
      const { error } = await admin.from('estudio_conhecimento').update(linha).eq('id', item.id).eq('tenant_id', tenantId)
      return error ? { success: false, error: aviso(error.message) } : { success: true, id: item.id }
    }
    const { data, error } = await admin.from('estudio_conhecimento').insert({ tenant_id: tenantId, ...linha }).select('id').single()
    return error ? { success: false, error: aviso(error.message) } : { success: true, id: data.id }
  } catch (e) { return { success: false, error: String(e) } }
}

export async function excluirConhecimento(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { error } = await createAdminClient().from('estudio_conhecimento').delete().eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── Custo de IA ─────────────────────────────────────────────────────────────

export interface CustoIa { total_usd: number; chamadas: number; por_modelo: { modelo: string; chamadas: number; custo_usd: number; tokens: number }[] }

function somar(rows: { modelo: string; custo_usd: number | string; input_tokens: number; output_tokens: number }[]): CustoIa {
  const mapa = new Map<string, { modelo: string; chamadas: number; custo_usd: number; tokens: number }>()
  for (const r of rows) {
    const m = mapa.get(r.modelo) ?? { modelo: r.modelo, chamadas: 0, custo_usd: 0, tokens: 0 }
    m.chamadas++; m.custo_usd += Number(r.custo_usd ?? 0); m.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
    mapa.set(r.modelo, m)
  }
  const por_modelo = [...mapa.values()]
  return { total_usd: por_modelo.reduce((s, m) => s + m.custo_usd, 0), chamadas: rows.length, por_modelo }
}

/** Gasto de IA de UMA conversa (aparece ao lado do chat). */
export async function custoIaDaConversa(contatoId: string): Promise<CustoIa & { error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_ia_uso').select('modelo, custo_usd, input_tokens, output_tokens')
      .eq('tenant_id', tenantId).eq('contato_id', contatoId).limit(5000)
    if (error) return { total_usd: 0, chamadas: 0, por_modelo: [], error: aviso(error.message) }
    return somar(data ?? [])
  } catch (e) { return { total_usd: 0, chamadas: 0, por_modelo: [], error: String(e) } }
}

/** Gasto de IA de um dia (Brasília). */
export async function custoIaDoDia(dia: string): Promise<CustoIa & { error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { total_usd: 0, chamadas: 0, por_modelo: [], error: 'Dia inválido.' }
    const de = new Date(`${dia}T00:00:00-03:00`).toISOString(); const ate = new Date(new Date(de).getTime() + 86400e3).toISOString()
    const { data, error } = await createAdminClient().from('estudio_ia_uso').select('modelo, custo_usd, input_tokens, output_tokens')
      .eq('tenant_id', tenantId).gte('criado_em', de).lt('criado_em', ate).limit(20000)
    if (error) return { total_usd: 0, chamadas: 0, por_modelo: [], error: aviso(error.message) }
    return somar(data ?? [])
  } catch (e) { return { total_usd: 0, chamadas: 0, por_modelo: [], error: String(e) } }
}

// ── Hotmart (pagamento internacional) ───────────────────────────────────────

export async function lerHotmartConfig(): Promise<{ tem_hottok: boolean; produto_id: string; url_webhook: string; error?: string }> {
  const url = `${(process.env.NEXT_PUBLIC_APP_URL || 'https://funil-pro.vercel.app').replace(/\/+$/, '')}/api/webhooks/hotmart`
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_config').select('hotmart_hottok, hotmart_produto_id').eq('tenant_id', tenantId).maybeSingle()
    if (error) return { tem_hottok: false, produto_id: '8794754', url_webhook: url, error: /hotmart/i.test(error.message) ? 'Falta rodar o SQL da Fase 7 (20261031000000_estudio_ia_hotmart.sql) no Supabase.' : error.message }
    return { tem_hottok: !!data?.hotmart_hottok, produto_id: data?.hotmart_produto_id ?? '8794754', url_webhook: url }
  } catch (e) { return { tem_hottok: false, produto_id: '8794754', url_webhook: url, error: String(e) } }
}

/** O hottok é só de escrita: nunca volta para a tela. */
export async function salvarHotmartConfig(hottok: string | null, produtoId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const linha: Record<string, unknown> = { hotmart_produto_id: String(produtoId ?? '').replace(/\D/g, '').slice(0, 20) || '8794754' }
    const t = String(hottok ?? '').trim()
    if (t) linha.hotmart_hottok = t.slice(0, 200)
    const { error } = await createAdminClient().from('estudio_config').update(linha).eq('tenant_id', tenantId)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

export interface LinhaPreco { id: string; pais: string; moeda: string; pacote_qtd: number; valor_cents: number; link_pagamento: string | null }

export async function listarPrecosEstudio(): Promise<{ precos: LinhaPreco[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_precos').select('id, pais, moeda, pacote_qtd, valor_cents, link_pagamento').eq('tenant_id', tenantId).order('pais').order('pacote_qtd')
    if (error) return { precos: [], error: aviso(error.message) }
    return { precos: (data ?? []) as LinhaPreco[] }
  } catch (e) { return { precos: [], error: String(e) } }
}

export async function salvarPrecoEstudio(l: { id?: string | null; pais: string; moeda: string; pacote_qtd: number; valor_cents: number; link_pagamento?: string | null }): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const pais = String(l.pais ?? '').trim().toUpperCase()
    const moeda = String(l.moeda ?? '').trim().toUpperCase()
    const qtd = Math.round(Number(l.pacote_qtd)), valor = Math.round(Number(l.valor_cents))
    if (!/^([A-Z]{2}|INT|\*)$/.test(pais)) return { success: false, error: 'País: 2 letras (BR, PT, US…), INT (todo país ≠ BR) ou *.' }
    if (!/^[A-Z]{3}$/.test(moeda)) return { success: false, error: 'Moeda com 3 letras (BRL, USD, EUR).' }
    if (!(qtd > 0 && qtd <= 100) || !(valor > 0)) return { success: false, error: 'Quantidade e valor precisam ser maiores que zero.' }
    const link = String(l.link_pagamento ?? '').trim() || null
    if (link && !/^https:\/\/pay\.hotmart\.com\//.test(link)) return { success: false, error: 'O link de pagamento tem que ser da Hotmart (https://pay.hotmart.com/...).' }
    const admin = createAdminClient()
    const linha = { tenant_id: tenantId, pais, moeda, pacote_qtd: qtd, valor_cents: valor, link_pagamento: link }
    const { error } = l.id
      ? await admin.from('estudio_precos').update(linha).eq('id', l.id).eq('tenant_id', tenantId)
      : await admin.from('estudio_precos').upsert(linha, { onConflict: 'tenant_id,pais,pacote_qtd' })
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

export async function excluirPrecoEstudio(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { error } = await createAdminClient().from('estudio_precos').delete().eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── Faturamento por moeda (nunca soma moedas diferentes) ────────────────────

export interface Faturamento { periodo: string; por_moeda: { moeda: string; total_cents: number; vendas: number }[]; total_brl_cents: number; cotacoes: Record<string, number> }

export async function resumoFaturamento(): Promise<{ periodos: Faturamento[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const agora = Date.now()
    const inicioDia = new Date(`${new Date(agora - 3 * 3600e3).toISOString().slice(0, 10)}T00:00:00-03:00`).getTime()
    const mes = new Date(agora - 3 * 3600e3).toISOString().slice(0, 7)
    const janelas: [string, number][] = [['Hoje', inicioDia], ['7 dias', inicioDia - 6 * 86400e3], ['Mês', new Date(`${mes}-01T00:00:00-03:00`).getTime()]]
    const desde = new Date(Math.min(...janelas.map(j => j[1]))).toISOString()
    const [{ data, error }, { data: cfg }] = await Promise.all([
      admin.from('estudio_pedidos').select('valor_pago_cents, moeda, pago_em, status').eq('tenant_id', tenantId).gte('pago_em', desde).not('status', 'in', '(cancelado,reembolsado)').limit(10000),
      admin.from('estudio_config').select('cotacoes').eq('tenant_id', tenantId).maybeSingle(),
    ])
    if (error) return { periodos: [], error: aviso(error.message) }
    const cot: Record<string, number> = { BRL: 1, USD: 5.5, EUR: 6, ...((cfg?.cotacoes ?? {}) as Record<string, number>) }
    const periodos = janelas.map(([periodo, ini]) => {
      const mapa = new Map<string, { moeda: string; total_cents: number; vendas: number }>()
      for (const p of data ?? []) {
        if (!p.pago_em || new Date(p.pago_em).getTime() < ini || !p.valor_pago_cents) continue
        const m = String(p.moeda ?? 'BRL').toUpperCase()
        const x = mapa.get(m) ?? { moeda: m, total_cents: 0, vendas: 0 }
        x.total_cents += p.valor_pago_cents; x.vendas++
        mapa.set(m, x)
      }
      const por_moeda = [...mapa.values()].sort((a, b) => a.moeda.localeCompare(b.moeda))
      return { periodo, por_moeda, total_brl_cents: Math.round(por_moeda.reduce((s, x) => s + x.total_cents * (Number(cot[x.moeda]) || 0), 0)), cotacoes: cot }
    })
    return { periodos }
  } catch (e) { return { periodos: [], error: String(e) } }
}
