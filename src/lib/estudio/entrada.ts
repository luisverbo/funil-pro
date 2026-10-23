// ============================================================================
// Estúdio IA — mensagem recebida no número do estúdio (Fase 2)
// ----------------------------------------------------------------------------
// Chamado pelo webhook /api/webhooks/meta-wa ANTES do inbox: se o
// phone_number_id é o do estúdio, a mensagem fica só aqui (contato + log) e
// nunca entra em wa_conversations.
//
// Fase 2: responde com a mensagem de teste (no máximo 1 a cada 30 min por
// contato). Fase 3 troca isso pela máquina de estados da Ana.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MensagemRecebida } from '@/lib/whatsapp-cloud/webhook-parser'
import { enviarTextoCloud } from '@/lib/whatsapp-cloud'
import { origemDaMensagem, fimDaJanela, deveResponderTeste, RESPOSTA_TESTE_PADRAO, type Origem } from './whatsapp'

export interface ConfigEstudio {
  tenant_id: string
  phone_number_id: string
  access_token: string | null
  ativo: boolean
  resposta_teste: string | null
  app_secret?: string | null
}

/** Config do estúdio para este phone_number_id, ou null (não é o estúdio). */
export async function configDoNumero(admin: SupabaseClient, phoneNumberId: string): Promise<ConfigEstudio | null> {
  if (!phoneNumberId) return null
  const base = 'tenant_id, phone_number_id, access_token, ativo, resposta_teste'
  let { data, error } = await admin.from('estudio_config')
    .select(`${base}, app_secret`).eq('phone_number_id', phoneNumberId).maybeSingle()
  // Coluna app_secret ainda não criada (SQL da Fase 2b pendente): o número
  // continua sendo reconhecido como do estúdio, só sem a checagem extra.
  if (error && /app_secret/.test(error.message)) {
    ({ data, error } = await admin.from('estudio_config').select(base).eq('phone_number_id', phoneNumberId).maybeSingle())
  }
  if (error || !data) return null   // tabela ainda não criada = segue o inbox normal
  return data as ConfigEstudio
}

export async function processarEntradaEstudio(admin: SupabaseClient, cfg: ConfigEstudio, m: MensagemRecebida): Promise<void> {
  // Dedupe: a Meta REENVIA em timeout (o UNIQUE do wamid barra a corrida).
  const { data: ja } = await admin.from('estudio_mensagens').select('id').eq('wamid', m.wamid).maybeSingle()
  if (ja) return

  const agora = new Date().toISOString()
  const { data: existente } = await admin.from('estudio_contatos')
    .select('id, origem, nome').eq('tenant_id', cfg.tenant_id).eq('wa_id', m.de).maybeSingle()

  // Veio de anúncio uma vez → conversa inteira conta como anúncio (janela 72h).
  const origem: Origem = existente?.origem === 'anuncio' ? 'anuncio' : origemDaMensagem(m.referral)
  const janela = fimDaJanela(m.timestamp, origem)

  let contatoId = existente?.id as string | undefined
  if (contatoId) {
    await admin.from('estudio_contatos').update({
      ultima_msg_em: agora, janela_ate: janela, origem,
      ...(m.nome && !existente?.nome ? { nome: m.nome } : {}),
      ...(m.referral && origem === 'anuncio' ? { referral: m.referral } : {}),
    }).eq('id', contatoId)
  } else {
    const { data: novo, error } = await admin.from('estudio_contatos').insert({
      tenant_id: cfg.tenant_id, wa_id: m.de, nome: m.nome, origem,
      referral: m.referral ?? null, janela_ate: janela, primeira_msg_em: agora, ultima_msg_em: agora,
    }).select('id').single()
    if (error || !novo) { console.error('[estudio] contato não criado:', error?.message); return }
    contatoId = novo.id as string
  }

  const { error: eMsg } = await admin.from('estudio_mensagens').insert({
    tenant_id: cfg.tenant_id, contato_id: contatoId, wamid: m.wamid, direcao: 'entrada',
    tipo: m.tipo, texto: m.corpo, media_id: m.mediaId ?? null,
  })
  if (eMsg) return   // wamid repetido na corrida: outra execução já tratou

  if (!cfg.ativo || !cfg.access_token) return   // conectado mas desligado: só registra

  // ── Fase 2: resposta de teste ──────────────────────────────────────────────
  const { data: ultSaida } = await admin.from('estudio_mensagens').select('criado_em')
    .eq('contato_id', contatoId).eq('direcao', 'saida').order('criado_em', { ascending: false }).limit(1).maybeSingle()
  if (!deveResponderTeste(ultSaida?.criado_em ?? null)) return

  await enviarEstudio(admin, cfg, contatoId, m.de, (cfg.resposta_teste ?? '').trim() || RESPOSTA_TESTE_PADRAO)
}

/** Envia texto pelo número do estúdio e registra no histórico. */
export async function enviarEstudio(
  admin: SupabaseClient, cfg: Pick<ConfigEstudio, 'tenant_id' | 'phone_number_id' | 'access_token'>,
  contatoId: string | null, para: string, texto: string,
): Promise<{ ok: boolean; erro?: string }> {
  if (!cfg.access_token) return { ok: false, erro: 'sem token' }
  const r = await enviarTextoCloud({ phone_number_id: cfg.phone_number_id, access_token: cfg.access_token }, para, texto)
  if (contatoId) {
    await admin.from('estudio_mensagens').insert({
      tenant_id: cfg.tenant_id, contato_id: contatoId, wamid: r.ok ? r.wamid : null, direcao: 'saida',
      tipo: 'texto', texto, status_entrega: r.ok ? 'sent' : 'failed',
    })
  }
  if (!r.ok) console.error('[estudio] envio falhou:', r.erro)
  return r.ok ? { ok: true } : { ok: false, erro: r.erro }
}
