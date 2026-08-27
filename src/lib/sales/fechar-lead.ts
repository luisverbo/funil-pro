// ============================================================================
// Fechar (ou perder) um lead em TODOS os portais — a partir de uma venda
// ----------------------------------------------------------------------------
// Uma autoridade só para "a venda aconteceu": o webhook do Mercos e o
// Vendido do inbox de WhatsApp chamam a MESMA função. O banco filtra por
// contato (RPCs), o código decide (contato-match), e o desfecho cai em
// portal_lead_status (quiz) e portal_agent_status (agente) com o valor.
// ============================================================================

import type { createAdminClient } from '@/lib/supabase/admin'
import { ehOMesmoContato } from '@/lib/webhooks/contato-match'

type Admin = ReturnType<typeof createAdminClient>

export interface AlcanceDesfecho { quizzes: Set<string>; agentes: Set<string> }

export const ALCANCE_TOTAL: AlcanceDesfecho = { quizzes: new Set(), agentes: new Set() }

/** Fecha (ou perde) o lead em TODOS os portais que o contêm. */
export async function aplicarDesfecho(
  admin: Admin,
  tenantId: string,
  contato: { email: string | null; telefone: string | null },
  status: 'fechado' | 'perdido',
  valorCents: number | null,
  alcance: AlcanceDesfecho,
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

