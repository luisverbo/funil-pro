// ============================================================================
// Webhook da Cloud API (WhatsApp oficial) — a porta de entrada do inbox
// ----------------------------------------------------------------------------
// UM endpoint para todas as contas: o payload traz metadata.phone_number_id,
// que resolve wa_accounts → tenant. Fluxo por mensagem recebida:
//
//   1. dedupe por wamid (a Meta REENVIA em timeout)
//   2. upsert da conversa (renova a janela de 24h, incrementa não-lidas)
//   3. casa o lead pelo telefone (contato-match, mesma autoridade do Mercos)
//   4. conversa em modo IA → o agente de plantão responde e envia pela
//      PRÓPRIA Cloud API (canal 'cloud' — o Evolution não entra)
//
// Segurança: GET de verificação usa APP_SECRET como verify token (o dono
// cola esse valor no campo "Verify token" do app Meta); POST validado com
// X-Hub-Signature-256 assinado pelo META_APP_SECRET, quando configurado.
// ============================================================================

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { lerWebhookCloud, novaJanela } from '@/lib/whatsapp-cloud/webhook-parser'
import { enviarTextoCloud } from '@/lib/whatsapp-cloud'
import { processAgentMessage } from '@/lib/agents/chat'
import { foneChave, foneBate } from '@/lib/webhooks/contato-match'
import { escolherAtendente, modoDistribuicaoValido } from '@/lib/whatsapp-cloud/distribuicao'

export const maxDuration = 60

// ── GET: handshake de verificação da Meta ───────────────────────────────────
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const esperado = process.env.APP_SECRET ?? ''
  if (modo === 'subscribe' && esperado && token === esperado && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'verificação recusada' }, { status: 403 })
}

function assinaturaValida(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) return true            // sem secret configurado, não bloqueia
  if (!header) return false
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(esperado))
  } catch {
    return false
  }
}

// ── POST: mensagens e status ────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (!assinaturaValida(raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }

  let payload: unknown
  try { payload = JSON.parse(raw) } catch { return NextResponse.json({ received: true }) }

  const { mensagens, statuses } = lerWebhookCloud(payload)
  const admin = createAdminClient()

  // ── Status de entrega (✓✓ de verdade) ────────────────────────────────────
  for (const st of statuses) {
    await admin.from('wa_messages')
      .update({ status_entrega: st.erro ? 'failed' : st.status })
      .eq('wamid', st.wamid)
  }

  // ── Mensagens recebidas ───────────────────────────────────────────────────
  for (const m of mensagens) {
    try {
      const { data: conta } = await admin
        .from('wa_accounts')
        .select('id, tenant_id, access_token, phone_number_id, agente_plantao_id, status, departamento_padrao_id')
        .eq('phone_number_id', m.phoneNumberId)
        .maybeSingle()
      if (!conta || conta.status !== 'ativa') continue

      // Dedupe: a Meta REENVIA em timeout. O SELECT barra o grosso; o UNIQUE
      // do wamid barra a corrida que escapar.
      const { data: jaExiste } = await admin
        .from('wa_messages').select('id').eq('wamid', m.wamid).maybeSingle()
      if (jaExiste) continue

      // Conversa (upsert por conta+telefone) — renova a janela de 24h.
      const janela = novaJanela(m.timestamp || Math.floor(Date.now() / 1000))
      const { data: convExistente } = await admin
        .from('wa_conversations').select('id, modo, nao_lidas, lead_id')
        .eq('account_id', conta.id).eq('telefone', m.de).maybeSingle()

      let convId = convExistente?.id as string | undefined
      let modo = String(convExistente?.modo ?? '')
      let leadId = (convExistente?.lead_id as string | null) ?? null

      if (!convId) {
        // Lead pelo telefone — a MESMA régua do Mercos (DDD confere).
        const { data: candidatos } = await admin.rpc('casar_leads_por_contato', {
          p_tenant: conta.tenant_id, p_email: null, p_fone: m.de,
        })
        const lead = ((candidatos ?? []) as { id: string; phone: string | null }[])
          .find(l => foneBate(foneChave(l.phone), foneChave(m.de)))
        leadId = lead?.id ?? null
        // Conversa NOVA nasce em modo IA quando a conta tem agente de
        // plantão — o atendente assume quando quiser.
        modo = conta.agente_plantao_id ? 'ia' : 'humano'

        // ── Distribuição automática ─────────────────────────────────────────
        // Departamento padrão da conta → afinidade (quem já atendeu este
        // telefone) → menos ocupado/rodízio, conforme o modo do departamento.
        const deptoId = (conta as { departamento_padrao_id?: string | null }).departamento_padrao_id ?? null
        let atendenteId: string | null = null
        if (deptoId) {
          const [{ data: depto }, { data: time }, { data: anteriores }] = await Promise.all([
            admin.from('wa_departamentos').select('distribuicao').eq('id', deptoId).maybeSingle(),
            admin.from('wa_atendentes')
              .select('id, ativo, ultima_atribuicao_at')
              .eq('tenant_id', conta.tenant_id).eq('departamento_id', deptoId).eq('ativo', true).range(0, 49),
            admin.from('wa_conversations')
              .select('atendente_id')
              .eq('tenant_id', conta.tenant_id).eq('telefone', m.de)
              .not('atendente_id', 'is', null)
              .order('ultima_msg_at', { ascending: false }).limit(1),
          ])
          const modoDist = modoDistribuicaoValido(depto?.distribuicao) ? depto.distribuicao : 'menos_ocupado'
          const ids = (time ?? []).map(a => String(a.id))
          const cargas: Record<string, number> = {}
          if (ids.length > 0) {
            const { data: abertas } = await admin.from('wa_conversations')
              .select('atendente_id').eq('tenant_id', conta.tenant_id)
              .eq('status', 'aberta').in('atendente_id', ids).range(0, 999)
            for (const c of abertas ?? []) {
              const aid = String(c.atendente_id)
              cargas[aid] = (cargas[aid] ?? 0) + 1
            }
          }
          atendenteId = escolherAtendente(
            (time ?? []).map(a => ({
              id: String(a.id), ativo: Boolean(a.ativo),
              abertas: cargas[String(a.id)] ?? 0,
              ultimaAtribuicaoAt: a.ultima_atribuicao_at ?? null,
            })),
            modoDist,
            anteriores?.[0]?.atendente_id ? String(anteriores[0].atendente_id) : null,
          )
          if (atendenteId) {
            await admin.from('wa_atendentes')
              .update({ ultima_atribuicao_at: new Date().toISOString() }).eq('id', atendenteId)
          }
        }

        const { data: nova } = await admin.from('wa_conversations').insert({
          tenant_id: conta.tenant_id, account_id: conta.id, telefone: m.de,
          nome: m.nome, lead_id: leadId, modo,
          departamento_id: deptoId, atendente_id: atendenteId,
          janela_ate: janela, nao_lidas: 1, ultima_msg: m.corpo,
          ultima_msg_at: new Date().toISOString(), status: 'aberta',
        }).select('id').single()
        convId = nova?.id
      } else {
        await admin.from('wa_conversations').update({
          janela_ate: janela,
          nao_lidas: Number(convExistente?.nao_lidas ?? 0) + 1,
          ultima_msg: m.corpo,
          ultima_msg_at: new Date().toISOString(),
          status: 'aberta',
          ...(m.nome ? { nome: m.nome } : {}),
        }).eq('id', convId)
      }
      if (!convId) continue

      await admin.from('wa_messages').insert({
        tenant_id: conta.tenant_id, conversation_id: convId, direcao: 'entrada',
        autor: 'lead', tipo: m.tipo, corpo: m.corpo, wamid: m.wamid,
      })

      // ── IA de plantão ─────────────────────────────────────────────────────
      if (modo === 'ia' && conta.agente_plantao_id && m.tipo === 'texto' && m.corpo.trim()) {
        try {
          const resultado = await processAgentMessage(conta.agente_plantao_id, m.corpo, {
            leadId: leadId ?? undefined, channel: 'cloud',
          })
          const partes = resultado.parts?.length ? resultado.parts : (resultado.reply ? [resultado.reply] : [])
          for (const parte of partes) {
            const envio = await enviarTextoCloud(
              { phone_number_id: conta.phone_number_id, access_token: conta.access_token },
              m.de, parte,
            )
            await admin.from('wa_messages').insert({
              tenant_id: conta.tenant_id, conversation_id: convId, direcao: 'saida',
              autor: 'ia', tipo: 'texto', corpo: parte,
              wamid: envio.ok ? envio.wamid : null,
              status_entrega: envio.ok ? 'sent' : 'failed',
            })
          }
          if (partes.length > 0) {
            await admin.from('wa_conversations').update({
              ultima_msg: partes[partes.length - 1],
              ultima_msg_at: new Date().toISOString(),
            }).eq('id', convId)
          }
        } catch (e) {
          console.error('[meta-wa] IA de plantão falhou:', String(e))
        }
      }
    } catch (e) {
      console.error('[meta-wa] mensagem falhou:', String(e))
    }
  }

  return NextResponse.json({ received: true })
}
