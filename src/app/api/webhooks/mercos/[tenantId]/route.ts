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

export const maxDuration = 60

type Admin = ReturnType<typeof createAdminClient>

/** Fecha (ou perde) o lead em TODOS os portais que o contêm. */
async function aplicarDesfecho(
  admin: Admin,
  tenantId: string,
  contato: { email: string | null; telefone: string | null },
  status: 'fechado' | 'perdido',
  valorCents: number | null,
): Promise<string[]> {
  const tocados: string[] = []
  const fone8 = contato.telefone ? contato.telefone.slice(-8) : null

  // ── Leads de QUIZ ─────────────────────────────────────────────────────────
  let qq = admin.from('quiz_leads').select('id, quiz_id').eq('tenant_id', tenantId)
  if (contato.email && fone8) qq = qq.or(`email.ilike.${contato.email},phone.like.%${fone8}`)
  else if (contato.email) qq = qq.ilike('email', contato.email)
  else if (fone8) qq = qq.like('phone', `%${fone8}`)
  else return tocados
  const { data: quizLeads } = await qq.range(0, 49)

  for (const l of quizLeads ?? []) {
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

  // ── Leads de AGENTE (conversas) ───────────────────────────────────────────
  let ql = admin.from('leads').select('id').eq('tenant_id', tenantId)
  if (contato.email && fone8) ql = ql.or(`email.ilike.${contato.email},phone.like.%${fone8}`)
  else if (contato.email) ql = ql.ilike('email', contato.email)
  else ql = ql.like('phone', `%${fone8}`)
  const { data: leads } = await ql.range(0, 49)

  for (const l of leads ?? []) {
    const { data: convs } = await admin
      .from('agent_conversations').select('id, agent_id')
      .eq('tenant_id', tenantId).eq('lead_id', l.id)
      .order('started_at', { ascending: false }).range(0, 9)
    for (const c of convs ?? []) {
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
  return tocados
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
    const tocados = await aplicarDesfecho(admin, tenantId, contato, status, valorCents)

    await registrar(
      tocados.length > 0 ? 'casado' : 'sem_correspondencia',
      tocados.length > 0
        ? `${tocados.length} lead(s) → ${status}${valorCents ? ` · R$ ${(valorCents / 100).toFixed(2)}` : ''}`
        : `nenhum lead com ${contato.email ?? ''} ${contato.telefone ?? ''}`.trim(),
    )
    return NextResponse.json({ ok: true, leads: tocados.length })
  } catch (err) {
    console.error('[mercos] falha:', String(err))
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
