'use server'

// ============================================================================
// Inbox WhatsApp oficial — actions do painel do dono
// ----------------------------------------------------------------------------
// Multiatendimento sobre a Cloud API: contas, conversas, envio (respeitando
// a janela de 24h), templates, tags, IA de plantão (assumir/devolver) e
// Vendido com valor — que fecha o lead nos portais pelo MESMO caminho do
// Mercos (src/lib/sales/fechar-lead.ts).
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { ... }`) — Turbopack
// mantém a re-exportação em runtime e o módulo inteiro morre mascarado.
// ============================================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarTextoCloud, enviarTemplateCloud, listarTemplatesCloud } from '@/lib/whatsapp-cloud'
import { dentroDaJanela } from '@/lib/whatsapp-cloud/webhook-parser'
import { aplicarDesfecho, ALCANCE_TOTAL } from '@/lib/sales/fechar-lead'
import { valorVendaValido } from '@/lib/quiz/valor-venda'

async function getTenantId(): Promise<string> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

// ─── Contas ─────────────────────────────────────────────────────────────────

export interface WaConta {
  id: string
  nome: string
  wabaId: string
  phoneNumberId: string
  displayNumber: string | null
  agentePlantaoId: string | null
  status: string
}

export async function listarWaContas(): Promise<{ contas: WaConta[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('wa_accounts')
      .select('id, nome, waba_id, phone_number_id, display_number, agente_plantao_id, status')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
    if (error) {
      const msg = error.code === '42P01' || error.code === 'PGRST205'
        ? 'Aplique a migration 20260905000000_whatsapp_cloud.sql no Supabase'
        : error.message
      return { contas: [], error: msg }
    }
    return {
      contas: (data ?? []).map(c => ({
        id: String(c.id), nome: String(c.nome ?? 'WhatsApp'), wabaId: String(c.waba_id),
        phoneNumberId: String(c.phone_number_id), displayNumber: c.display_number ?? null,
        agentePlantaoId: c.agente_plantao_id ?? null, status: String(c.status),
      })),
    }
  } catch (err) {
    return { contas: [], error: String(err) }
  }
}

export async function salvarWaConta(entrada: {
  id?: string
  nome: string
  wabaId: string
  phoneNumberId: string
  token?: string
  agentePlantaoId?: string | null
}): Promise<{ ok: true; id: string } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const nome = entrada.nome.trim().slice(0, 60) || 'WhatsApp'
    const wabaId = entrada.wabaId.trim()
    const phoneNumberId = entrada.phoneNumberId.trim()
    if (!wabaId || !phoneNumberId) return { error: 'Informe o WABA ID e o Phone Number ID' }

    if (entrada.id) {
      const { error } = await admin.from('wa_accounts').update({
        nome, waba_id: wabaId, phone_number_id: phoneNumberId,
        ...(entrada.token?.trim() ? { access_token: entrada.token.trim() } : {}),
        agente_plantao_id: entrada.agentePlantaoId ?? null,
      }).eq('id', entrada.id).eq('tenant_id', tenantId)
      if (error) return { error: error.message }
      return { ok: true, id: entrada.id }
    }
    if (!entrada.token?.trim()) return { error: 'Cole o token de acesso do sistema (Meta)' }
    const { data, error } = await admin.from('wa_accounts').insert({
      tenant_id: tenantId, nome, waba_id: wabaId, phone_number_id: phoneNumberId,
      access_token: entrada.token.trim(),
      agente_plantao_id: entrada.agentePlantaoId ?? null,
    }).select('id').single()
    if (error || !data) {
      if (error?.code === '23505') return { error: 'Este número já está conectado (em alguma conta)' }
      return { error: error?.message ?? 'Não foi possível salvar' }
    }
    return { ok: true, id: String(data.id) }
  } catch (err) {
    return { error: String(err) }
  }
}

// ─── Conversas ──────────────────────────────────────────────────────────────

export interface WaConversaResumo {
  id: string
  nome: string | null
  telefone: string
  ultimaMsg: string | null
  ultimaMsgAt: string | null
  naoLidas: number
  status: string
  modo: string
  tags: string[]
  vendidoCents: number | null
  janelaAte: string | null
  contaNome: string
}

export async function listarWaConversas(
  filtro: { status?: 'aberta' | 'resolvida'; busca?: string } = {},
): Promise<{ conversas: WaConversaResumo[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    let q = admin
      .from('wa_conversations')
      .select('id, nome, telefone, ultima_msg, ultima_msg_at, nao_lidas, status, modo, tags, vendido_cents, janela_ate, wa_accounts(nome)')
      .eq('tenant_id', tenantId)
      .order('ultima_msg_at', { ascending: false, nullsFirst: false })
      .range(0, 199)
    if (filtro.status) q = q.eq('status', filtro.status)
    const { data, error } = await q
    if (error) return { conversas: [], error: error.message }
    const busca = (filtro.busca ?? '').trim().toLowerCase()
    const conversas = (data ?? [])
      .map(c => ({
        id: String(c.id), nome: c.nome ?? null, telefone: String(c.telefone),
        ultimaMsg: c.ultima_msg ?? null, ultimaMsgAt: c.ultima_msg_at ?? null,
        naoLidas: Number(c.nao_lidas ?? 0), status: String(c.status), modo: String(c.modo),
        tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        vendidoCents: typeof c.vendido_cents === 'number' ? c.vendido_cents : null,
        janelaAte: c.janela_ate ?? null,
        contaNome: String((c.wa_accounts as { nome?: string } | null)?.nome ?? 'WhatsApp'),
      }))
      .filter(c => !busca
        || (c.nome ?? '').toLowerCase().includes(busca)
        || c.telefone.includes(busca)
        || (c.ultimaMsg ?? '').toLowerCase().includes(busca))
    return { conversas }
  } catch (err) {
    return { conversas: [], error: String(err) }
  }
}

export interface WaMensagem {
  id: string
  direcao: string
  autor: string
  autorNome: string | null
  tipo: string
  corpo: string | null
  templateName: string | null
  statusEntrega: string | null
  createdAt: string
}

export interface DossieLead {
  leadId: string | null
  nome: string | null
  email: string | null
  origem: string | null
  conversasAgente: { agente: string; situacao: string; quando: string | null }[]
  quizzes: { titulo: string; quando: string | null; concluiu: boolean }[]
}

/** Tudo de UMA conversa: mensagens + dossiê do lead (o diferencial do inbox). */
export async function getWaConversa(conversaId: string): Promise<{
  mensagens: WaMensagem[]
  dossie: DossieLead | null
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: conv } = await admin
      .from('wa_conversations').select('id, lead_id, telefone')
      .eq('id', conversaId).eq('tenant_id', tenantId).maybeSingle()
    if (!conv) return { mensagens: [], dossie: null, error: 'Conversa não encontrada' }

    // zera não-lidas ao abrir
    await admin.from('wa_conversations').update({ nao_lidas: 0 }).eq('id', conv.id)

    const { data: msgs } = await admin
      .from('wa_messages')
      .select('id, direcao, autor, autor_nome, tipo, corpo, template_name, status_entrega, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .range(0, 999)

    // ── Dossiê: o que o ecossistema já sabe deste telefone ───────────────────
    let dossie: DossieLead | null = null
    const { data: candidatos } = await admin.rpc('casar_quiz_leads_por_contato', {
      p_tenant: tenantId, p_email: null, p_fone: String(conv.telefone),
    })
    const quizLeadIds = ((candidatos ?? []) as { id: string; quiz_id: string }[])
    const quizzes: DossieLead['quizzes'] = []
    if (quizLeadIds.length > 0) {
      const { data: qls } = await admin
        .from('quiz_leads').select('id, quiz_id, status, started_at, pages(title)')
        .in('id', quizLeadIds.map(q => q.id)).range(0, 9)
      for (const q of qls ?? []) {
        quizzes.push({
          titulo: String((q.pages as { title?: string } | null)?.title ?? 'Quiz'),
          quando: q.started_at ?? null,
          concluiu: q.status === 'completed',
        })
      }
    }
    const conversasAgente: DossieLead['conversasAgente'] = []
    let leadInfo: { id: string; name: string | null; email: string | null } | null = null
    if (conv.lead_id) {
      const { data: lead } = await admin
        .from('leads').select('id, name, email').eq('id', conv.lead_id).maybeSingle()
      if (lead) leadInfo = { id: String(lead.id), name: lead.name ?? null, email: lead.email ?? null }
      const { data: convsAg } = await admin
        .from('agent_conversations').select('status, started_at, ai_agents(name)')
        .eq('lead_id', conv.lead_id).eq('tenant_id', tenantId)
        .order('started_at', { ascending: false }).range(0, 4)
      for (const c of convsAg ?? []) {
        conversasAgente.push({
          agente: String((c.ai_agents as { name?: string } | null)?.name ?? 'Agente'),
          situacao: String(c.status),
          quando: c.started_at ?? null,
        })
      }
    }
    dossie = {
      leadId: conv.lead_id ? String(conv.lead_id) : null,
      nome: leadInfo?.name ?? null,
      email: leadInfo?.email ?? null,
      origem: null,
      conversasAgente,
      quizzes,
    }

    return {
      mensagens: (msgs ?? []).map(m => ({
        id: String(m.id), direcao: String(m.direcao), autor: String(m.autor),
        autorNome: m.autor_nome ?? null, tipo: String(m.tipo), corpo: m.corpo ?? null,
        templateName: m.template_name ?? null, statusEntrega: m.status_entrega ?? null,
        createdAt: String(m.created_at),
      })),
      dossie,
    }
  } catch (err) {
    return { mensagens: [], dossie: null, error: String(err) }
  }
}

// ─── Envio ──────────────────────────────────────────────────────────────────

async function contaDaConversa(admin: ReturnType<typeof createAdminClient>, tenantId: string, conversaId: string) {
  const { data: conv } = await admin
    .from('wa_conversations')
    .select('id, telefone, janela_ate, wa_accounts(phone_number_id, access_token, waba_id)')
    .eq('id', conversaId).eq('tenant_id', tenantId).maybeSingle()
  if (!conv) return null
  const conta = conv.wa_accounts as { phone_number_id?: string; access_token?: string; waba_id?: string } | null
  if (!conta?.phone_number_id || !conta.access_token) return null
  return { conv, conta: { phone_number_id: conta.phone_number_id, access_token: conta.access_token, waba_id: conta.waba_id ?? '' } }
}

/** Texto livre — só dentro da janela de 24h (fora dela, use template). */
export async function enviarWaMensagem(
  conversaId: string,
  texto: string,
  atendenteNome?: string | null,
): Promise<{ ok: true } | { error: string; foraDaJanela?: boolean }> {
  try {
    const limpo = texto.trim().slice(0, 4000)
    if (!limpo) return { error: 'Escreva a mensagem' }
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const ctx = await contaDaConversa(admin, tenantId, conversaId)
    if (!ctx) return { error: 'Conversa não encontrada' }
    if (!dentroDaJanela(ctx.conv.janela_ate, new Date())) {
      return { error: 'Janela de 24h fechada — envie um template para reabrir a conversa', foraDaJanela: true }
    }
    const envio = await enviarTextoCloud(ctx.conta, String(ctx.conv.telefone), limpo)
    if (!envio.ok) return { error: `A Meta recusou o envio: ${envio.erro}` }
    await admin.from('wa_messages').insert({
      tenant_id: tenantId, conversation_id: conversaId, direcao: 'saida',
      autor: 'atendente', autor_nome: atendenteNome?.trim() || null,
      tipo: 'texto', corpo: limpo, wamid: envio.wamid, status_entrega: 'sent',
    })
    // Enviar manualmente ASSUME a conversa: a IA de plantão sai do caminho.
    await admin.from('wa_conversations').update({
      modo: 'humano', ultima_msg: limpo, ultima_msg_at: new Date().toISOString(), status: 'aberta',
    }).eq('id', conversaId)
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function enviarWaTemplate(
  conversaId: string,
  nome: string,
  idioma: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const ctx = await contaDaConversa(admin, tenantId, conversaId)
    if (!ctx) return { error: 'Conversa não encontrada' }
    const envio = await enviarTemplateCloud(ctx.conta, String(ctx.conv.telefone), nome, idioma)
    if (!envio.ok) return { error: `A Meta recusou o template: ${envio.erro}` }
    await admin.from('wa_messages').insert({
      tenant_id: tenantId, conversation_id: conversaId, direcao: 'saida',
      autor: 'atendente', tipo: 'template', corpo: `[template: ${nome}]`,
      template_name: nome, wamid: envio.wamid, status_entrega: 'sent',
    })
    await admin.from('wa_conversations').update({
      modo: 'humano', ultima_msg: `[template: ${nome}]`, ultima_msg_at: new Date().toISOString(), status: 'aberta',
    }).eq('id', conversaId)
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function listarWaTemplates(conversaId: string): Promise<{
  templates: { name: string; language: string; corpo: string }[]
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const ctx = await contaDaConversa(admin, tenantId, conversaId)
    if (!ctx) return { templates: [], error: 'Conversa não encontrada' }
    const r = await listarTemplatesCloud(ctx.conta.waba_id, ctx.conta.access_token)
    if (!r.ok) return { templates: [], error: r.erro }
    // Só os APROVADOS podem ser enviados — os demais nem aparecem.
    return { templates: r.templates.filter(t => t.status === 'APPROVED').map(t => ({ name: t.name, language: t.language, corpo: t.corpo })) }
  } catch (err) {
    return { templates: [], error: String(err) }
  }
}

// ─── Estado da conversa ─────────────────────────────────────────────────────

export async function setWaModoIa(conversaId: string, ia: boolean): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { error } = await admin.from('wa_conversations')
      .update({ modo: ia ? 'ia' : 'humano' })
      .eq('id', conversaId).eq('tenant_id', tenantId)
    if (error) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function setWaStatus(conversaId: string, status: 'aberta' | 'resolvida'): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { error } = await admin.from('wa_conversations')
      .update({ status }).eq('id', conversaId).eq('tenant_id', tenantId)
    if (error) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function setWaTags(conversaId: string, tags: string[]): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const limpas = tags.map(t => t.trim().slice(0, 30)).filter(Boolean).slice(0, 12)
    const { error } = await admin.from('wa_conversations')
      .update({ tags: limpas }).eq('id', conversaId).eq('tenant_id', tenantId)
    if (error) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * VENDIDO na própria conversa — e o lead fecha no kanban dos portais pelo
 * MESMO caminho do Mercos. valorCents null desfaz a marcação.
 */
export async function marcarWaVendido(
  conversaId: string,
  valorCents: number | null,
): Promise<{ ok: true; leadsFechados: number } | { error: string }> {
  try {
    if (valorCents !== null && !valorVendaValido(valorCents)) return { error: 'Valor inválido' }
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: conv } = await admin
      .from('wa_conversations').select('id, telefone, tags')
      .eq('id', conversaId).eq('tenant_id', tenantId).maybeSingle()
    if (!conv) return { error: 'Conversa não encontrada' }

    const tags = new Set(Array.isArray(conv.tags) ? (conv.tags as string[]) : [])
    if (valorCents !== null) tags.add('vendido')
    else tags.delete('vendido')

    const { error } = await admin.from('wa_conversations')
      .update({ vendido_cents: valorCents, tags: [...tags] })
      .eq('id', conversaId)
    if (error) return { error: error.message }

    // Kanban dos portais: mesma autoridade do Mercos.
    let leadsFechados = 0
    if (valorCents !== null) {
      const tocados = await aplicarDesfecho(
        admin, tenantId,
        { email: null, telefone: String(conv.telefone) },
        'fechado', valorCents, ALCANCE_TOTAL,
      )
      leadsFechados = tocados.length
    }
    return { ok: true, leadsFechados }
  } catch (err) {
    return { error: String(err) }
  }
}

// ─── Respostas rápidas ──────────────────────────────────────────────────────

export async function listarWaRespostasRapidas(): Promise<{ respostas: { id: string; atalho: string; texto: string }[] }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data } = await admin
      .from('wa_respostas_rapidas').select('id, atalho, texto')
      .eq('tenant_id', tenantId).order('atalho').range(0, 99)
    return { respostas: (data ?? []).map(r => ({ id: String(r.id), atalho: String(r.atalho), texto: String(r.texto) })) }
  } catch {
    return { respostas: [] }
  }
}

export async function salvarWaRespostaRapida(atalho: string, texto: string): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const a = atalho.trim().replace(/^\//, '').slice(0, 30)
    const t = texto.trim().slice(0, 2000)
    if (!a || !t) return { error: 'Informe o atalho e o texto' }
    const { error } = await admin.from('wa_respostas_rapidas').upsert(
      { tenant_id: tenantId, atalho: a, texto: t },
      { onConflict: 'tenant_id,atalho' },
    )
    if (error) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function excluirWaRespostaRapida(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    await admin.from('wa_respostas_rapidas').delete().eq('id', id).eq('tenant_id', tenantId)
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
