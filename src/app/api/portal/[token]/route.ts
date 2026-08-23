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
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PORTAL_COOKIE, PORTAL_SESSAO_MS, criarSessaoPortal, sessaoPortalValida,
} from '@/lib/quiz/portal-session'
import { tokenShareValido, verificarSenhaShare } from '@/lib/quiz/share'
import {
  publicoPortalValido, statusPortalValido, temContato, type PublicoPortal,
} from '@/lib/quiz/portal'
import {
  metricasDoQuiz, montarTabelaLeads, leadsParaPortal, investimentoDoQuiz,
} from '@/lib/quiz/leads-core'
import { custoPorLead } from '@/lib/quiz/portal'

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
  const cookieSessao = (await cookies()).get(PORTAL_COOKIE)?.value

  // Sem senha E sem cookie não há o que conferir.
  if (!senha && !cookieSessao) {
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: portal } = await admin
    .from('client_portals')
    .select('id, tenant_id, nome, password_hash, enabled, mostrar_metricas, mostrar_funil, permitir_status')
    .eq('token', token)
    .maybeSingle()

  const chave = String(portal?.password_hash ?? '')
  const porSenha = Boolean(portal?.enabled) && senha.length > 0 && verificarSenhaShare(senha, chave)
  const porCookie = Boolean(portal?.enabled) && sessaoPortalValida(cookieSessao, token, chave)

  if (!portal || !portal.enabled || (!porSenha && !porCookie)) {
    // Espera só quando alguém TENTOU senha — cookie vencido é rotina, não ataque.
    if (senha) await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  /** Renova o cookie de sessão a cada resposta autenticada. */
  const comSessao = (payload: unknown, status = 200) => {
    const resp = NextResponse.json(payload, { status })
    resp.cookies.set(PORTAL_COOKIE, criarSessaoPortal(token, chave), {
      httpOnly: true,                 // JS da página não lê — nem o dele, nem o de terceiro
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(PORTAL_SESSAO_MS / 1000),
    })
    return resp
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
      // Conta acesso só quando a senha foi apresentada; F5 não inflaria o número.
      if (porSenha) {
        await admin.rpc('increment_portal_access', { p_token: token }).then(() => {}, () => {})
      }
      return comSessao({
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

      // Os leads primeiro: a tabela do CSV é montada com EXATAMENTE os mesmos
      // ids, para arquivo e tela nunca divergirem.
      const leads = await leadsParaPortal(admin, quiz.id, tenantId, quiz.publico)

      const [statusRows, metricas, tabela, gastoCents] = await Promise.all([
        admin.from('portal_lead_status')
          .select('lead_id, status').eq('portal_id', portalId).range(0, 9_999),
        portal.mostrar_metricas ? metricasDoQuiz(admin, quiz.id, tenantId) : Promise.resolve(null),
        montarTabelaLeads(admin, quiz.id, tenantId, { apenasIds: leads.map(l => l.id) }),
        portal.mostrar_metricas ? investimentoDoQuiz(admin, quiz.id, tenantId) : Promise.resolve(0),
      ])

      const statusPorLead: Record<string, string> = {}
      for (const r of statusRows.data ?? []) statusPorLead[String(r.lead_id)] = String(r.status)

      const m = metricas && portal.mostrar_metricas ? {
        ...metricas,
        ...(portal.mostrar_funil ? {} : { funil: [] }),
      } : null

      // Custo calculado sobre TODOS que entraram (métrica), não só sobre o
      // público liberado — o gasto trouxe todo mundo, não só os quentes.
      const custos = m && gastoCents > 0 ? {
        investidoCents: gastoCents,
        cplCents: custoPorLead(gastoCents, m.total),
        // "Quente" é quem dá para atender (deixou contato) — é esse o lead
        // que o cliente compra, não quem clicou no botão final.
        cplQuenteCents: custoPorLead(gastoCents, m.comContato),
      } : null

      return comSessao({
        quiz: { id: quiz.id, titulo: quiz.titulo, publico: quiz.publico },
        leads: leads.map(l => ({ ...l, statusCliente: statusPorLead[l.id] ?? 'novo' })),
        metricas: m,
        custos,
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
        .select('id, quiz_id, status, email, phone')
        .eq('id', leadId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const quiz = lead ? quizzes.find(q => q.id === String(lead.quiz_id)) : null
      if (!lead || !quiz) {
        return NextResponse.json({ error: 'Lead não encontrado neste portal' }, { status: 404 })
      }
      // Lead fora do público liberado é invisível também para ESCRITA.
      const foraDoPublico =
        (quiz.publico === 'concluidos' && lead.status !== 'completed')
        || (quiz.publico === 'com_contato' && !temContato({ email: lead.email, phone: lead.phone }))
      if (foraDoPublico) {
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
      return comSessao({ ok: true })
    }

    return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  } catch (err) {
    console.error('[portal] falha:', String(err))
    return NextResponse.json({ error: 'Não foi possível carregar o portal' }, { status: 500 })
  }
}
