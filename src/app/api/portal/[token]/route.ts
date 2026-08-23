// ============================================================================
// Portal do cliente — a porta pública (POST com senha, três ações)
// ----------------------------------------------------------------------------
// Quem chama é o CLIENTE do dono do tenant, sem conta. Regras herdadas do
// compartilhamento e mantidas aqui:
//
//   • senha no CORPO do POST, nunca na URL (log, histórico, Referer);
//   • recusa IDÊNTICA para link inexistente, desativado e senha errada, com
//     ~1s de espera — chute em massa fica caro e sem pista;
//   • o tenant sai da LINHA DO PORTAL, nunca do chamador;
//   • toda ação revalida a senha — não existe sessão para roubar.
//
// Ações: 'abrir' (lista de funis), 'quiz' (leads + métricas de UM funil que
// PERTENCE ao portal), 'status' (cliente marca o desfecho do lead — só se o
// dono permitiu, só status da lista fechada, só lead dos funis do portal).
// ============================================================================

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tokenShareValido, verificarSenhaShare } from '@/lib/quiz/share'
import { publicoPortalValido, statusPortalValido, type PublicoPortal } from '@/lib/quiz/portal'
import {
  metricasDoQuiz, montarTabelaLeads, leadsParaPortal,
} from '@/lib/quiz/leads-core'

export const maxDuration = 60

const RECUSADO = { error: 'Link inválido ou senha incorreta' } as const

const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Corpo {
  senha?: string
  acao?: string
  quizId?: string
  leadId?: string
  status?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!tokenShareValido(token)) {
    await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  let corpo: Corpo
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
  const { data: portal } = await admin
    .from('client_portals')
    .select('id, tenant_id, nome, password_hash, enabled, mostrar_metricas, mostrar_funil, permitir_status')
    .eq('token', token)
    .maybeSingle()

  if (!portal || !portal.enabled || !verificarSenhaShare(senha, String(portal.password_hash))) {
    await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  const tenantId = String(portal.tenant_id)
  const portalId = String(portal.id)

  // Os funis DO PORTAL — tudo o que existe fora desta lista não existe para
  // o cliente, por mais que ele adivinhe ids.
  const { data: vinculos } = await admin
    .from('client_portal_quizzes')
    .select('page_id, publico, pages(title)')
    .eq('portal_id', portalId)

  const quizzes = (vinculos ?? []).map(v => ({
    id: String(v.page_id),
    titulo: String((v.pages as { title?: string } | null)?.title ?? 'Funil'),
    publico: (publicoPortalValido(v.publico) ? v.publico : 'concluidos') as PublicoPortal,
  }))

  const acao = corpo.acao ?? 'abrir'

  try {
    if (acao === 'abrir') {
      await admin.rpc('increment_portal_access', { p_token: token }).then(() => {}, () => {})
      return NextResponse.json({
        nome: String(portal.nome ?? 'Cliente'),
        permitirStatus: Boolean(portal.permitir_status),
        mostrarMetricas: Boolean(portal.mostrar_metricas),
        mostrarFunil: Boolean(portal.mostrar_funil),
        quizzes: quizzes.map(q => ({ id: q.id, titulo: q.titulo })),
      })
    }

    if (acao === 'quiz') {
      const quiz = quizzes.find(q => q.id === corpo.quizId)
      if (!quiz) return NextResponse.json({ error: 'Funil não está neste portal' }, { status: 404 })

      const [leads, statusRows, metricas, tabela] = await Promise.all([
        leadsParaPortal(admin, quiz.id, tenantId, quiz.publico),
        admin.from('portal_lead_status')
          .select('lead_id, status').eq('portal_id', portalId).range(0, 9_999),
        portal.mostrar_metricas ? metricasDoQuiz(admin, quiz.id, tenantId) : Promise.resolve(null),
        montarTabelaLeads(admin, quiz.id, tenantId, {
          publico: quiz.publico === 'concluidos' ? 'concluidos' : quiz.publico,
        }),
      ])

      const statusPorLead: Record<string, string> = {}
      for (const r of statusRows.data ?? []) statusPorLead[String(r.lead_id)] = String(r.status)

      const m = metricas && portal.mostrar_metricas ? {
        ...metricas,
        ...(portal.mostrar_funil ? {} : { funil: [] }),
      } : null

      return NextResponse.json({
        quiz: { id: quiz.id, titulo: quiz.titulo, publico: quiz.publico },
        leads: leads.map(l => ({ ...l, statusCliente: statusPorLead[l.id] ?? 'novo' })),
        metricas: m,
        tabela: 'error' in tabela ? null : tabela,
      })
    }

    if (acao === 'status') {
      if (!portal.permitir_status) {
        return NextResponse.json({ error: 'A marcação de status está desativada neste portal' }, { status: 403 })
      }
      if (!statusPortalValido(corpo.status)) {
        return NextResponse.json({ error: 'Status inválido' }, { status: 400 })
      }
      const leadId = typeof corpo.leadId === 'string' ? corpo.leadId : ''

      // O lead precisa pertencer a um funil DO portal — e ao público liberado.
      const { data: lead } = await admin
        .from('quiz_leads')
        .select('id, quiz_id, status')
        .eq('id', leadId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const quiz = lead ? quizzes.find(q => q.id === String(lead.quiz_id)) : null
      if (!lead || !quiz) {
        return NextResponse.json({ error: 'Lead não encontrado neste portal' }, { status: 404 })
      }
      if (quiz.publico === 'concluidos' && lead.status !== 'completed') {
        return NextResponse.json({ error: 'Lead não encontrado neste portal' }, { status: 404 })
      }

      const { error } = await admin.from('portal_lead_status').upsert({
        tenant_id: tenantId,
        portal_id: portalId,
        lead_id: leadId,
        status: corpo.status,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'portal_id,lead_id' })
      if (error) return NextResponse.json({ error: 'Não foi possível salvar' }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  } catch (err) {
    console.error('[portal] falha:', String(err))
    return NextResponse.json({ error: 'Não foi possível carregar o portal' }, { status: 500 })
  }
}
