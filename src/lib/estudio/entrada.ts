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
import { paisDoWaId, devolveParaAna, previaDaMensagem } from './chat'
import { guardarMidiaRecebida } from './midia'
import { avisarAparelhos } from './push'
import { marcarLidaDigitando, marcarLida, ehSoConfirmacao } from './envio'
import { Cronometro } from './tempos'
import { processarConversa } from './ana/fila'
import { pareceRobo } from './ana/robo'
import { encerrarConversa } from './encerrar'
import { anuncioDoReferral, atualizacaoDeOrigem } from './anuncios'

export interface ConfigEstudio {
  tenant_id: string
  phone_number_id: string
  access_token: string | null
  ativo: boolean
  resposta_teste: string | null
  app_secret?: string | null
  pausa_humano_horas?: number | null
  whatsapp_avisos?: string | null
}

/** Config do estúdio para este phone_number_id, ou null (não é o estúdio). */
export async function configDoNumero(admin: SupabaseClient, phoneNumberId: string): Promise<ConfigEstudio | null> {
  if (!phoneNumberId) return null
  const base = 'tenant_id, phone_number_id, access_token, ativo, resposta_teste, whatsapp_avisos'
  const extras = 'app_secret, pausa_humano_horas'
  let { data, error } = await admin.from('estudio_config')
    .select(`${base}, ${extras}`).eq('phone_number_id', phoneNumberId).maybeSingle()
  // Coluna app_secret ainda não criada (SQL da Fase 2b pendente): o número
  // continua sendo reconhecido como do estúdio, só sem a checagem extra.
  // Coluna nova ainda não criada: tenta mantendo o app_secret (checagem de
  // assinatura), e só por último sem nada extra.
  for (const sel of [`${base}, app_secret`, base]) {
    if (!error || !/app_secret|pausa_humano_horas/.test(error.message)) break
    ;({ data, error } = await admin.from('estudio_config').select(sel).eq('phone_number_id', phoneNumberId).maybeSingle())
  }
  if (error || !data) return null   // tabela ainda não criada = segue o inbox normal
  return data as ConfigEstudio
}

/** Erro de coluna que ainda não existe (SQL do chat pendente) — refaz sem ela. */
function faltaColuna(msg: string | undefined): boolean {
  return !!msg && /column|schema cache|could not find/i.test(msg)
}

export async function processarEntradaEstudio(admin: SupabaseClient, cfg: ConfigEstudio, m: MensagemRecebida, recebidaEm = Date.now()): Promise<void> {
  const crono = new Cronometro(recebidaEm)
  // "digitando…" JÁ (antes de banco, mídia e IA): meta < 1 s. Reação não liga.
  // "ok"/👍/figurinha podem não ter resposta: aí só marca como lida (sem "digitando" no vazio).
  const conta = cfg.access_token ? { phone_number_id: cfg.phone_number_id, access_token: cfg.access_token } : null
  const talvezSemResposta = m.tipoBruto === 'sticker' || ehSoConfirmacao(m.corpo)
  const digitando = cfg.ativo && conta && m.tipoBruto !== 'reaction'
    ? (talvezSemResposta ? marcarLida(conta, m.wamid) : marcarLidaDigitando(conta, m.wamid).then(r => { if (r.ok) crono.digitou(); return r })).then(() => {}, () => {})
    : Promise.resolve()

  // Dedupe: a Meta REENVIA em timeout (o UNIQUE do wamid barra a corrida).
  const { data: ja } = await admin.from('estudio_mensagens').select('id').eq('wamid', m.wamid).maybeSingle()
  if (ja) { await digitando; return }

  const agora = new Date()
  const agoraIso = agora.toISOString()
  const { data: existente } = await admin.from('estudio_contatos')
    .select('*').eq('tenant_id', cfg.tenant_id).eq('wa_id', m.de).maybeSingle()

  // Veio de anúncio uma vez → conversa inteira conta como anúncio (janela 72h).
  const origem: Origem = existente?.origem === 'anuncio' ? 'anuncio' : origemDaMensagem(m.referral)
  const janela = fimDaJanela(m.timestamp, origem)
  const tipo = m.tipoBruto === 'sticker' ? 'figurinha' : m.tipoBruto === 'location' ? 'localizacao' : m.tipoBruto === 'reaction' ? 'reacao' : m.tipo
  const texto = m.localizacao
    ? `📍 ${m.localizacao.nome ? `${m.localizacao.nome} · ` : ''}https://maps.google.com/?q=${m.localizacao.lat},${m.localizacao.lng}`
    : m.corpo
  const previa = previaDaMensagem(tipo, texto)

  // A Ana volta sozinha após N horas sem mensagem manual do Luís.
  const devolver = existente && devolveParaAna(
    { modo: existente.modo ?? 'ana', humano_desde: existente.humano_desde ?? null, humano_fixo: !!existente.humano_fixo },
    Number(cfg.pausa_humano_horas ?? 2), agora,
  )

  let contatoId = existente?.id as string | undefined
  if (contatoId) {
    const base = {
      ultima_msg_em: agoraIso, janela_ate: janela, origem,
      ...(m.nome && !existente?.nome ? { nome: m.nome } : {}),
      ...(m.referral && origem === 'anuncio' ? { referral: m.referral } : {}),
    }
    const { error } = await admin.from('estudio_contatos').update({
      ...base, ultima_msg: previa, nao_lidas: Number(existente?.nao_lidas ?? 0) + 1, ultima_cliente_em: agoraIso,
      ...(devolver ? { modo: 'ana', humano_desde: null } : {}),
    }).eq('id', contatoId)
    if (faltaColuna(error?.message)) await admin.from('estudio_contatos').update(base).eq('id', contatoId)
  } else {
    const { pais, idioma } = paisDoWaId(m.de)
    const base = {
      tenant_id: cfg.tenant_id, wa_id: m.de, nome: m.nome, origem,
      referral: m.referral ?? null, janela_ate: janela, primeira_msg_em: agoraIso, ultima_msg_em: agoraIso,
    }
    let { data: novo, error } = await admin.from('estudio_contatos')
      .insert({ ...base, pais, idioma, ultima_msg: previa, nao_lidas: 1, ultima_cliente_em: agoraIso }).select('id').single()
    if (faltaColuna(error?.message)) ({ data: novo, error } = await admin.from('estudio_contatos').insert(base).select('id').single())
    if (error || !novo) { console.error('[estudio] contato não criado:', error?.message); return }
    contatoId = novo.id as string
  }

  // Origem por anúncio (Click-to-WhatsApp): último clique ganha, o primeiro fica
  // guardado; mensagem orgânica nunca apaga. Update à parte: SQL pendente não quebra.
  const anuncio = anuncioDoReferral(m.referral)
  const origemNova = atualizacaoDeOrigem(existente ?? null, anuncio, agoraIso)
  if (origemNova) {
    const { error: eOrig } = await admin.from('estudio_contatos').update(origemNova).eq('id', contatoId)
    if (eOrig) console.warn('[estudio] origem do anúncio não gravada (SQL pendente?):', eOrig.message)
  }

  // Mídia: baixa AGORA (a URL da Meta expira) e guarda no bucket privado.
  let midia: { path: string; mime: string } | null = null
  let erroMidia: string | null = null
  if (m.mediaId && cfg.access_token) {
    try { midia = await crono.medir('midia', () => guardarMidiaRecebida(admin, contatoId!, m.wamid, m.mediaId!, cfg.access_token!, m.mediaNome)) }
    catch (err) { erroMidia = String(err).slice(0, 300); console.error('[estudio] mídia não baixada:', erroMidia) }
  }

  const baseMsg = {
    tenant_id: cfg.tenant_id, contato_id: contatoId, wamid: m.wamid, direcao: 'entrada',
    tipo, texto, media_id: m.mediaId ?? null,
  }
  const completa = { ...baseMsg, autor: 'cliente', media_path: midia?.path ?? null, media_mime: midia?.mime ?? m.mediaMime ?? null, media_nome: m.mediaNome ?? null, erro: erroMidia }
  // processada_em = null → entra na fila da conversa (ana/fila.ts).
  let { error: eMsg } = await admin.from('estudio_mensagens').insert({ ...completa, processada_em: null })
  if (faltaColuna(eMsg?.message)) ({ error: eMsg } = await admin.from('estudio_mensagens').insert(completa))
  if (faltaColuna(eMsg?.message)) ({ error: eMsg } = await admin.from('estudio_mensagens').insert(baseMsg))
  await digitando
  if (eMsg) return   // wamid repetido na corrida: outra execução já tratou

  const fechar = () => admin.from('estudio_mensagens').update({ processada_em: new Date().toISOString() }).eq('wamid', m.wamid).then(() => {}, () => {})
  if (!cfg.ativo || !cfg.access_token) { await fechar(); return }   // conectado mas desligado: só registra

  // Encerrada (à mão ou robô): só registra — sem push, sem Ana, sem IA.
  if (existente?.encerrada_em) { await fechar(); return }

  // Push no celular do Luís (app fechado também) — mensagem nova (reação não).
  if (tipo !== 'reacao') void avisarAparelhos(admin, cfg.tenant_id)

  // Luís atendendo: a Ana fica quieta.
  const modo = devolver ? 'ana' : (existente?.modo ?? 'ana')
  if (modo === 'humano') { await fechar(); return }

  // Robô do outro lado (atendente automático de empresa): encerra antes de gastar IA.
  // Nunca em quem já pagou / está em produção.
  if (tipo === 'texto' && !['pago', 'entregue', 'ajuste_detalhe', 'conferindo'].includes(String(existente?.etapa ?? ''))) {
    const { data: ultimas } = await admin.from('estudio_mensagens').select('texto')
      .eq('contato_id', contatoId).eq('direcao', 'entrada').eq('tipo', 'texto').order('criado_em', { ascending: false }).limit(8)
    const v = pareceRobo((ultimas ?? []).map(u => u.texto as string).reverse())
    if (v.robo) {
      await encerrarConversa(admin, contatoId, `robô: ${v.motivo}`).catch(err => console.error('[estudio] encerrar:', String(err).slice(0, 200)))
      console.warn('[estudio] conversa encerrada — robô do outro lado:', v.motivo)
      await fechar(); return
    }
  }

  // ── A Ana, pela fila da conversa (uma execução por vez, fotos juntas) ────
  try {
    await processarConversa(admin, {
      tenant_id: cfg.tenant_id, phone_number_id: cfg.phone_number_id, access_token: cfg.access_token,
      whatsapp_avisos: cfg.whatsapp_avisos ?? null,
    }, contatoId, { cronometro: crono, wamid: m.wamid, primeira: !existente })
    // Nome do anúncio/conjunto/campanha em cache (depois da resposta: não atrasa a Ana).
    if (anuncio) await import('./anuncios-servidor').then(x => x.buscarAnuncio(admin, cfg.tenant_id, anuncio.ad_id, anuncio.headline)).catch(err => console.warn('[estudio] nome do anúncio:', String(err).slice(0, 200)))
  } catch (err) {
    // Sem o SQL da Fase 3 (colunas da Ana): cai na resposta de teste da Fase 2.
    console.error('[estudio] Ana falhou, usando resposta de teste:', String(err).slice(0, 300))
    const { data: ultSaida } = await admin.from('estudio_mensagens').select('criado_em')
      .eq('contato_id', contatoId).eq('direcao', 'saida').order('criado_em', { ascending: false }).limit(1).maybeSingle()
    if (!deveResponderTeste(ultSaida?.criado_em ?? null)) return
    await enviarEstudio(admin, cfg, contatoId, m.de, (cfg.resposta_teste ?? '').trim() || RESPOSTA_TESTE_PADRAO, 'ana')
  }
}

/** Envia texto pelo número do estúdio e registra no histórico. */
export async function enviarEstudio(
  admin: SupabaseClient, cfg: Pick<ConfigEstudio, 'tenant_id' | 'phone_number_id' | 'access_token'>,
  contatoId: string | null, para: string, texto: string, autor: 'ana' | 'luis' | 'sistema' = 'sistema',
): Promise<{ ok: boolean; erro?: string }> {
  if (!cfg.access_token) return { ok: false, erro: 'sem token' }
  const r = await enviarTextoCloud({ phone_number_id: cfg.phone_number_id, access_token: cfg.access_token }, para, texto)
  if (contatoId) {
    const base = {
      tenant_id: cfg.tenant_id, contato_id: contatoId, wamid: r.ok ? r.wamid : null, direcao: 'saida',
      tipo: 'texto', texto, status_entrega: r.ok ? 'sent' : 'failed',
    }
    const { error } = await admin.from('estudio_mensagens').insert({ ...base, autor, erro: r.ok ? null : (r.erro ?? '').slice(0, 300) })
    if (faltaColuna(error?.message)) await admin.from('estudio_mensagens').insert(base)
    await admin.from('estudio_contatos').update({ ultima_msg: texto.slice(0, 120) }).eq('id', contatoId).then(() => {}, () => {})
  }
  if (!r.ok) console.error('[estudio] envio falhou:', r.erro)
  return r.ok ? { ok: true } : { ok: false, erro: r.erro }
}
