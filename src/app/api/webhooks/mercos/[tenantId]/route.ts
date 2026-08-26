// ============================================================================
// Webhook Mercos — venda faturada no ERP fecha o lead no portal, com valor
// ----------------------------------------------------------------------------
// Fluxo: o cliente do dono fatura um pedido no Mercos → o Mercos chama esta
// URL → o lead correspondente vai para "Fechado" no kanban do portal com o
// valor da venda — custo por venda e faturamento fecham sozinhos.
//
// Como o pedido do Mercos referencia o cliente por ID (sem contato), o
// casamento usa duas fontes:
//   1. contato achado no PRÓPRIO payload (varredura tolerante)
//   2. cadastro guardado dos eventos cliente.* (mercos_clientes)
//
// Todo evento fica em mercos_events com o resultado — quando "a venda não
// apareceu", a resposta está lá, não no achismo.
//
// ALCANCE: por padrão a venda procura o lead em TODOS os funis e agentes da
// conta. Isso é errado quando o Mercos é de UM cliente específico — a venda
// dele fecharia o lead de outro funil onde a mesma pessoa apareceu. Por isso
// a URL aceita o recorte:
//
//   .../api/webhooks/mercos/<tenant>?quiz=<pageId>
//   .../api/webhooks/mercos/<tenant>?quiz=<id1>,<id2>&agente=<id3>
//
// Com recorte, só os funis/agentes indicados são tocados. Cada cliente com
// Mercos próprio recebe a SUA URL, e as contas nunca se cruzam.
//
// Segurança: mesma família dos outros webhooks (tenants.webhook_tokens).
// Com chave configurada, a requisição precisa apresentá-la (header, query ou
// corpo); sem chave, aceita — igual Hotmart/Kiwify.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  destinoDoEvento, extrairClienteId, extrairContato, extrairEvento,
  extrairValorCents, tokenConfere,
} from '@/lib/webhooks/mercos'
import { ehOMesmoContato } from '@/lib/webhooks/contato-match'

export const maxDuration = 60

type Admin = ReturnType<typeof createAdminClient>

/** Fecha (ou perde) o lead em TODOS os portais que o contêm. */
async function aplicarDesfecho(
  admin: Admin,
  tenantId: string,
  contato: { email: string | null; telefone: string | null },
  status: 'fechado' | 'perdido',
  valorCents: number | null,
  alcance: { quizzes: Set<string>; agentes: Set<string> },
): Promise<string[]> {
  const tocados: string[] = []
  if (!contato.email && !contato.telefone) return tocados

  // O banco FILTRA (dígitos, tolerante a formatação e DDI); o código DECIDE
  // (DDD precisa bater) — marcar a venda no lead errado é pior que não marcar.
  const confere = (l: { email?: string | null; phone?: string | null }) =>
    ehOMesmoContato(l, { email: contato.email, telefone: contato.telefone })

  // Com recorte na URL, o que NÃO foi listado fica de fora por inteiro:
  // "?quiz=X" quer dizer "só esse funil" — nem os agentes entram.
  const temRecorte = alcance.quizzes.size > 0 || alcance.agentes.size > 0

  // ── Leads de QUIZ ─────────────────────────────────────────────────────────
  if (!temRecorte || alcance.quizzes.size > 0) {
  const { data: candidatosQuiz } = await admin.rpc('casar_quiz_leads_por_contato', {
    p_tenant: tenantId, p_email: contato.email, p_fone: contato.telefone,
  })
  const quizLeads = ((candidatosQuiz ?? []) as { id: string; quiz_id: string; email: string | null; phone: string | null }[])
    .filter(confere)
    // Recorte da URL: fora dele, o lead não é desta integração.
    .filter(l => alcance.quizzes.size === 0 || alcance.quizzes.has(String(l.quiz_id)))

  for (const l of quizLeads) {
    const { data: vinculos } = await admin
      .from('client_portal_quizzes').select('portal_id')
      .eq('tenant_id', tenantId).eq('page_id', l.quiz_id)
    for (const v of vinculos ?? []) {
      const { error } = await admin.from('portal_lead_status').upsert({
        tenant_id: tenantId, portal_id: v.portal_id, lead_id: l.id,
        status, sale_value_cents: status === 'fechado' ? valorCents : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'portal_id,lead_id' })
      if (!error) tocados.push(`quiz:${l.id}`)
    }
  }
  }

  // ── Leads de AGENTE (conversas) ───────────────────────────────────────────
  if (!temRecorte || alcance.agentes.size > 0) {
  const { data: candidatosLead } = await admin.rpc('casar_leads_por_contato', {
    p_tenant: tenantId, p_email: contato.email, p_fone: contato.telefone,
  })
  const leads = ((candidatosLead ?? []) as { id: string; email: string | null; phone: string | null }[])
    .filter(confere)

  for (const l of leads) {
    const { data: convs } = await admin
      .from('agent_conversations').select('id, agent_id')
      .eq('tenant_id', tenantId).eq('lead_id', l.id)
      .order('started_at', { ascending: false }).range(0, 9)
    for (const c of convs ?? []) {
      if (alcance.agentes.size > 0 && !alcance.agentes.has(String(c.agent_id))) continue
      const { data: vinculos } = await admin
        .from('client_portal_agents').select('portal_id')
        .eq('tenant_id', tenantId).eq('agent_id', c.agent_id)
      for (const v of vinculos ?? []) {
        const { error } = await admin.from('portal_agent_status').upsert({
          tenant_id: tenantId, portal_id: v.portal_id, conversation_id: c.id,
          status, sale_value_cents: status === 'fechado' ? valorCents : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'portal_id,conversation_id' })
        if (!error) tocados.push(`agente:${c.id}`)
      }
    }
  }
  }
  return tocados
}

/** Recorte vindo da URL: ?quiz=id1,id2&agente=id3 (repetível). */
function lerAlcance(busca: URLSearchParams): { quizzes: Set<string>; agentes: Set<string> } {
  const juntar = (chaves: string[]) => {
    const fora = new Set<string>()
    for (const chave of chaves) {
      for (const bruto of busca.getAll(chave)) {
        for (const id of bruto.split(',')) {
          const limpo = id.trim()
          if (limpo) fora.add(limpo)
        }
      }
    }
    return fora
  }
  return {
    quizzes: juntar(['quiz', 'quizzes', 'funil']),
    agentes: juntar(['agente', 'agentes', 'agent']),
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'corpo inválido' }, { status: 400 })

    const admin = createAdminClient()
    const { data: tenant } = await admin
      .from('tenants').select('id, webhook_tokens').eq('id', tenantId).maybeSingle()
    if (!tenant) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const esperado = (tenant.webhook_tokens as Record<string, string> | null)?.mercos
    if (esperado && !tokenConfere(esperado, req.headers, new URL(req.url).searchParams, body)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const evento = extrairEvento(body)
    const destino = destinoDoEvento(evento)
    const registrar = (resultado: string, detalhe: string | null) =>
      admin.from('mercos_events').insert({
        tenant_id: tenantId, evento, payload: body, resultado, detalhe,
      }).then(() => {}, () => {})

    if (destino === 'cliente') {
      // Cadastro do cliente: é ELE que carrega o contato — guardamos para
      // resolver o pedido (que só traz cliente_id) quando chegar.
      const clienteId = extrairClienteId(body) ?? (() => {
        // cliente.* costuma trazer o próprio id em 'id' dentro de dados
        const dados = (body as { dados?: { id?: unknown } }).dados
        const v = dados?.id
        return typeof v === 'string' || typeof v === 'number' ? String(v) : null
      })()
      const contato = extrairContato(body)
      if (clienteId && (contato.email || contato.telefone || contato.nome)) {
        await admin.from('mercos_clientes').upsert({
          tenant_id: tenantId, cliente_id: clienteId,
          nome: contato.nome, email: contato.email, telefone: contato.telefone,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,cliente_id' })
        await registrar('cliente_salvo', `cliente ${clienteId}`)
      } else {
        await registrar('ignorado', 'cliente sem id ou sem contato no payload')
      }
      return NextResponse.json({ ok: true })
    }

    if (destino === 'ignorar') {
      await registrar('ignorado', 'evento fora do fluxo de venda')
      return NextResponse.json({ ok: true })
    }

    // ── pedido.gerado / faturado / cancelado / pagamento ─────────────────────
    let contato = extrairContato(body)
    if (!contato.email && !contato.telefone) {
      // O pedido só referencia o cliente por id: busca o cadastro guardado.
      const clienteId = extrairClienteId(body)
      if (clienteId) {
        const { data: cli } = await admin
          .from('mercos_clientes').select('nome, email, telefone')
          .eq('tenant_id', tenantId).eq('cliente_id', clienteId).maybeSingle()
        if (cli) contato = { nome: cli.nome, email: cli.email, telefone: cli.telefone }
      }
    }
    if (!contato.email && !contato.telefone) {
      await registrar('sem_correspondencia',
        'pedido sem contato: marque também os eventos cliente.cadastrado e cliente.atualizado no Mercos')
      return NextResponse.json({ ok: true })
    }

    const valorCents = extrairValorCents(body)
    const status = destino === 'perder' ? 'perdido' as const : 'fechado' as const
    const alcance = lerAlcance(new URL(req.url).searchParams)
    const tocados = await aplicarDesfecho(admin, tenantId, contato, status, valorCents, alcance)

    await registrar(
      tocados.length > 0 ? 'casado' : 'sem_correspondencia',
      tocados.length > 0
        ? `${tocados.length} lead(s) → ${status}${valorCents ? ` · R$ ${(valorCents / 100).toFixed(2)}` : ''}`
        : `nenhum lead com ${contato.email ?? ''} ${contato.telefone ?? ''}`.trim()
          + (alcance.quizzes.size + alcance.agentes.size > 0 ? ' (dentro do recorte da URL)' : ''),
    )
    return NextResponse.json({ ok: true, leads: tocados.length })
  } catch (err) {
    console.error('[mercos] falha:', String(err))
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
