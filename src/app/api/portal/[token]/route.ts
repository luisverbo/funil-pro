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
  PORTAL_COOKIE, PORTAL_SESSAO_MS, criarSessaoPortal, lerSessaoPortal,
} from '@/lib/quiz/portal-session'
import { tokenShareValido, verificarSenhaShare } from '@/lib/quiz/share'
import {
  distribuirRodizio, identificarMembro, modoPortalValido, publicoPortalValido,
  statusPortalValido, temContato, type ModoPortal, type PublicoPortal,
} from '@/lib/quiz/portal'
import {
  COLUNAS_LEAD, metricasDoQuiz, montarTabelaLeads, leadsParaPortal, investimentosDoQuiz,
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
  memberId?: string | null
  /** Telefone digitado na entrada: identifica QUAL vendedor está entrando. */
  telefone?: string
  nome?: string
  whatsapp?: string
  msgWhatsapp?: string
  autoDistribuir?: boolean
}

interface Membro { id: string; nome: string; whatsapp: string | null }

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
    .select('*')
    .eq('token', token)
    .maybeSingle()

  const chave = String(portal?.password_hash ?? '')
  const porSenha = Boolean(portal?.enabled) && senha.length > 0 && verificarSenhaShare(senha, chave)
  const sessao = lerSessaoPortal(cookieSessao, token, chave)
  const porCookie = Boolean(portal?.enabled) && sessao.valida

  if (!portal || !portal.enabled || (!porSenha && !porCookie)) {
    // Espera só quando alguém TENTOU senha — cookie vencido é rotina, não ataque.
    if (senha) await espera(1000)
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  const tenantId = String(portal.tenant_id)
  const portalId = String(portal.id)

  /** Vendedores ativos do portal — [] quando a migration ainda não rodou. */
  const listarMembros = async (): Promise<Membro[]> => {
    const { data, error } = await admin
      .from('portal_members')
      .select('id, nome, whatsapp')
      .eq('portal_id', portalId)
      .eq('ativo', true)
      .order('created_at', { ascending: true })
      .range(0, 99)
    if (error || !data) return []
    return data.map(m => ({ id: String(m.id), nome: String(m.nome), whatsapp: m.whatsapp ?? null }))
  }

  const membrosDoPortal = await listarMembros()

  /**
   * QUEM está entrando. O telefone digitado identifica o vendedor (a senha
   * continua sendo a barreira); depois disso o id viaja ASSINADO no cookie.
   *
   * DEFEITO CORRIGIDO: telefone que não batia com nenhum vendedor caía em
   * modo GESTOR silenciosamente — quem digitava o número errado via a lista
   * inteira. Agora número informado e não encontrado é RECUSA explícita;
   * campo em branco (e só ele) é o gestor.
   */
  const telefoneInformado = String(corpo.telefone ?? '').trim()
  const membroAtual = porSenha
    ? identificarMembro(membrosDoPortal, telefoneInformado)
    : (sessao.membroId ? membrosDoPortal.find(m => m.id === sessao.membroId) ?? null : null)

  if (porSenha && telefoneInformado.length > 0 && !membroAtual) {
    return NextResponse.json({
      error: 'Este WhatsApp não está cadastrado na equipe. Confira o número com o gestor — ou deixe o campo em branco para entrar como gestor.',
    }, { status: 401 })
  }

  // Cookie de vendedor cujo cadastro foi removido: derruba a sessão em vez de
  // promover a pessoa a gestor sem querer.
  if (!porSenha && sessao.membroId && !membroAtual) {
    return NextResponse.json(RECUSADO, { status: 401 })
  }

  const ehGestor = membroAtual === null

  /** Renova o cookie de sessão a cada resposta autenticada. */
  const comSessao = (payload: unknown, status = 200) => {
    const resp = NextResponse.json(payload, { status })
    resp.cookies.set(PORTAL_COOKIE, criarSessaoPortal(token, chave, membroAtual?.id ?? null), {
      httpOnly: true,                 // JS da página não lê — nem o dele, nem o de terceiro
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(PORTAL_SESSAO_MS / 1000),
    })
    return resp
  }

  // Os funis DO PORTAL — tudo o que existe fora desta lista não existe para
  // o cliente, por mais que ele adivinhe ids.
  const rv = await admin
    .from('client_portal_quizzes')
    .select('page_id, publico, paginas, modo, desde, pages(title)')
    .eq('portal_id', portalId)
  let vinculos = rv.data
  if (rv.error) {
    const r2 = await admin
      .from('client_portal_quizzes')
      .select('page_id, publico, pages(title)')
      .eq('portal_id', portalId)
    vinculos = (r2.data ?? []).map(v => ({ ...v, paginas: [] as unknown[], modo: 'vendas', desde: null }))
  }

  const quizzes = (vinculos ?? []).map(v => ({
    id: String(v.page_id),
    titulo: String((v.pages as { title?: string } | null)?.title ?? 'Funil'),
    publico: (publicoPortalValido(v.publico) ? v.publico : 'concluidos') as PublicoPortal,
    paginas: Array.isArray((v as { paginas?: unknown }).paginas)
      ? ((v as { paginas: unknown[] }).paginas).filter((x): x is string => typeof x === 'string')
      : [],
    modo: (modoPortalValido((v as { modo?: unknown }).modo)
      ? (v as { modo: ModoPortal }).modo : 'vendas') as ModoPortal,
    desde: typeof (v as { desde?: unknown }).desde === 'string'
      ? (v as { desde: string }).desde : null,
  }))

  const acao = corpo.acao ?? 'abrir'

  const EQUIPE_MIGRATION = { error: 'Aplique a migration 20260828000000_portal_equipe.sql no Supabase para usar a equipe' }

  try {
    if (acao === 'sair') {
      // Sessão de 12h é ótima para o dia a dia, mas presa quando duas pessoas
      // usam o mesmo navegador. "Sair" apaga o cookie e devolve a tela de senha.
      const resp = NextResponse.json({ ok: true })
      resp.cookies.set(PORTAL_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
      return resp
    }

    if (acao === 'abrir') {
      // Conta acesso só quando a senha foi apresentada; F5 não inflaria o número.
      if (porSenha) {
        await admin.rpc('increment_portal_access', { p_token: token }).then(() => {}, () => {})
      }
      return comSessao({
        nome: String(portal.nome ?? 'Cliente'),
        // Quem entrou: vendedor identificado pelo telefone, ou o gestor.
        membroAtual: membroAtual ? { id: membroAtual.id, nome: membroAtual.nome } : null,
        ehGestor,
        temEquipe: membrosDoPortal.length > 0,
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
      const leads = await leadsParaPortal(admin, quiz.id, tenantId, quiz.publico, quiz.paginas, quiz.desde)

      const [statusRows, metricas, tabela, investimentos] = await Promise.all([
        admin.from('portal_lead_status')
          .select('lead_id, status').eq('portal_id', portalId).range(0, 9_999),
        portal.mostrar_metricas ? metricasDoQuiz(admin, quiz.id, tenantId) : Promise.resolve(null),
        // Só as páginas que o dono liberou viram colunas de resposta; lista
        // vazia = só os dados de contato do lead.
        montarTabelaLeads(admin, quiz.id, tenantId, {
          apenasIds: leads.map(l => l.id),
          ...(quiz.paginas.length > 0 ? { pageIds: quiz.paginas } : { columnKeys: COLUNAS_LEAD.map(c => c.chave) }),
        }),
        portal.mostrar_metricas ? investimentosDoQuiz(admin, quiz.id, tenantId) : Promise.resolve([]),
      ])

      // Páginas escolhidas que já não existem (quiz editado) derrubariam a
      // tabela — cai para a versão só-contato em vez de mostrar nada.
      const tabelaFinal = 'error' in tabela
        ? await montarTabelaLeads(admin, quiz.id, tenantId, {
            apenasIds: leads.map(l => l.id),
            columnKeys: COLUNAS_LEAD.map(c => c.chave),
          })
        : tabela

      const membros = membrosDoPortal

      // Responsável por lead: a coluna pode não existir ainda (migration).
      const respAtual: Record<string, string> = {}
      const { data: atribs } = await admin
        .from('portal_lead_status')
        .select('lead_id, assigned_member_id')
        .eq('portal_id', portalId)
        .not('assigned_member_id', 'is', null)
        .range(0, 9_999)
      for (const r of atribs ?? []) {
        if (r.assigned_member_id) respAtual[String(r.lead_id)] = String(r.assigned_member_id)
      }

      // Rodízio AUTOMÁTICO: lead visível sem dono é repartido na hora entre
      // os vendedores — quem tem menos recebe primeiro. Ligado pelo gestor.
      if (Boolean((portal as { auto_distribuir?: boolean }).auto_distribuir) && membros.length > 0) {
        const carga: Record<string, number> = {}
        for (const mid of Object.values(respAtual)) carga[mid] = (carga[mid] ?? 0) + 1
        const semDono = leads.filter(l => !respAtual[l.id]).map(l => l.id).slice(0, 200)
        const novos = distribuirRodizio(semDono, membros.map(m => m.id), carga)
        for (const n of novos) {
          const { error } = await admin.from('portal_lead_status').upsert({
            tenant_id: tenantId, portal_id: portalId, lead_id: n.leadId,
            assigned_member_id: n.memberId, updated_at: new Date().toISOString(),
          }, { onConflict: 'portal_id,lead_id' })
          if (error) break                     // migration pendente: sem drama
          respAtual[n.leadId] = n.memberId
        }
      }

      const statusPorLead: Record<string, string> = {}
      for (const r of statusRows.data ?? []) statusPorLead[String(r.lead_id)] = String(r.status)

      const m = metricas && portal.mostrar_metricas ? {
        ...metricas,
        ...(portal.mostrar_funil ? {} : { funil: [] }),
      } : null

      // O VENDEDOR só recebe a fila dele — filtrar no servidor é o que
      // garante que a lista dos outros não viaja pela rede.
      const visiveis = leads
        .map(l => ({
          ...l,
          statusCliente: statusPorLead[l.id] ?? 'novo',
          responsavelId: respAtual[l.id] ?? null,
        }))
        .filter(l => ehGestor || l.responsavelId === membroAtual!.id)

      // Metadados de TODOS os leads do funil (sem nome nem contato): é o que
      // permite à tela recalcular "entraram / chegaram ao final / conversão"
      // POR PERÍODO. Antes esses números vinham prontos do servidor, sobre
      // todo o histórico, e não mexiam quando o cliente trocava o filtro.
      const baseMetricas = portal.mostrar_metricas
        ? (ehGestor
            ? (await leadsParaPortal(admin, quiz.id, tenantId, 'todos', [], quiz.desde))
                .map(l => ({ data: l.data, concluiu: l.concluiu, temContato: l.quente }))
            // Vendedor: os números são os DELE — "112 entraram" no painel de
            // quem recebeu 8 leads seria confusão, não informação.
            : visiveis.map(l => ({ data: l.data, concluiu: l.concluiu, temContato: l.quente })))
        : []

      return comSessao({
        quiz: { id: quiz.id, titulo: quiz.titulo, publico: quiz.publico, modo: quiz.modo },
        leads: visiveis,
        membros,
        msgWhatsapp: String((portal as { msg_whatsapp?: string | null }).msg_whatsapp ?? ''),
        autoDistribuir: Boolean((portal as { auto_distribuir?: boolean }).auto_distribuir),
        metricas: m,
        baseMetricas,
        // Os lançamentos POR DIA vão para a tela: o custo é recalculado junto
        // com o filtro de período, em vez de ser um total fixo de todo o tempo.
        investimentos: portal.mostrar_metricas ? investimentos : [],
        tabela: 'error' in tabelaFinal ? null : tabelaFinal,
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
      // Para 'paginas' a regra precisa das respostas — a lista visível decide.
      const visiveis = quiz.publico === 'paginas'
        ? new Set((await leadsParaPortal(admin, quiz.id, tenantId, 'paginas', quiz.paginas, quiz.desde)).map(l => l.id))
        : null
      const foraDoPublico =
        (quiz.publico === 'concluidos' && lead.status !== 'completed')
        || (quiz.publico === 'com_contato' && !temContato({ email: lead.email, phone: lead.phone }))
        || (visiveis !== null && !visiveis.has(String(lead.id)))
      if (foraDoPublico) {
        return NextResponse.json({ error: 'Lead não encontrado neste portal' }, { status: 404 })
      }

      // Vendedor marca só o que é dele.
      if (!ehGestor) {
        const { data: dono } = await admin
          .from('portal_lead_status')
          .select('assigned_member_id')
          .eq('portal_id', portalId).eq('lead_id', leadId).maybeSingle()
        if (String(dono?.assigned_member_id ?? '') !== membroAtual!.id) {
          return NextResponse.json({ error: 'Lead não encontrado neste portal' }, { status: 404 })
        }
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

    // ── Equipe (gestor): tudo gateado pela mesma permissão de marcação ──────
    if (['equipe_salvar', 'equipe_remover', 'atribuir', 'equipe_config'].includes(acao)) {
      if (!portal.permitir_status) {
        return NextResponse.json({ error: 'A gestão de equipe está desativada neste portal' }, { status: 403 })
      }
      // Vendedor não gerencia equipe nem redistribui lead: ele TRABALHA a
      // fila dele. Sem isto, bastaria chamar a rota na mão para reatribuir.
      if (!ehGestor) {
        return NextResponse.json({ error: 'Apenas o gestor pode gerenciar a equipe' }, { status: 403 })
      }

      if (acao === 'equipe_salvar') {
        const nome = String(corpo.nome ?? '').trim().slice(0, 60)
        if (nome.length < 2) return NextResponse.json({ error: 'Informe o nome do vendedor' }, { status: 400 })
        const { error } = await admin.from('portal_members').insert({
          tenant_id: tenantId, portal_id: portalId, nome,
          whatsapp: String(corpo.whatsapp ?? '').trim().slice(0, 20) || null,
        })
        if (error) {
          if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json(EQUIPE_MIGRATION, { status: 400 })
          if (error.code === '23505') return NextResponse.json({ error: 'Já existe um vendedor com esse nome' }, { status: 400 })
          return NextResponse.json({ error: 'Não foi possível salvar' }, { status: 500 })
        }
        return comSessao({ ok: true, membros: await listarMembros() })
      }

      if (acao === 'equipe_remover') {
        // Desativa (não apaga): o histórico de quem fechou o quê permanece.
        await admin.from('portal_members')
          .update({ ativo: false })
          .eq('id', String(corpo.memberId ?? ''))
          .eq('portal_id', portalId)
        return comSessao({ ok: true, membros: await listarMembros() })
      }

      if (acao === 'equipe_config') {
        const { error } = await admin.from('client_portals').update({
          ...(corpo.msgWhatsapp !== undefined ? { msg_whatsapp: String(corpo.msgWhatsapp).slice(0, 300) || null } : {}),
          ...(corpo.autoDistribuir !== undefined ? { auto_distribuir: Boolean(corpo.autoDistribuir) } : {}),
          updated_at: new Date().toISOString(),
        }).eq('id', portalId)
        if (error) return NextResponse.json(EQUIPE_MIGRATION, { status: 400 })
        return comSessao({ ok: true })
      }

      // 'atribuir': responsável do lead — só lead dos funis do portal.
      const leadId = String(corpo.leadId ?? '')
      const { data: lead } = await admin
        .from('quiz_leads').select('id, quiz_id')
        .eq('id', leadId).eq('tenant_id', tenantId).maybeSingle()
      if (!lead || !quizzes.some(q => q.id === String(lead.quiz_id))) {
        return NextResponse.json({ error: 'Lead não encontrado neste portal' }, { status: 404 })
      }
      const memberId = corpo.memberId ? String(corpo.memberId) : null
      if (memberId) {
        const membros = await listarMembros()
        if (!membros.some(m => m.id === memberId)) {
          return NextResponse.json({ error: 'Vendedor não encontrado' }, { status: 404 })
        }
      }
      const { error } = await admin.from('portal_lead_status').upsert({
        tenant_id: tenantId, portal_id: portalId, lead_id: leadId,
        assigned_member_id: memberId, updated_at: new Date().toISOString(),
      }, { onConflict: 'portal_id,lead_id' })
      if (error) return NextResponse.json(EQUIPE_MIGRATION, { status: 400 })
      return comSessao({ ok: true })
    }

    return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  } catch (err) {
    console.error('[portal] falha:', String(err))
    return NextResponse.json({ error: 'Não foi possível carregar o portal' }, { status: 500 })
  }
}
