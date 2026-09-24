// ============================================================================
// Publicador — junta banco + Graph API para UM item
// ----------------------------------------------------------------------------
// Usado pelo cron (itens reservados) e pelo botão "Publicar agora" (modo de
// teste). O item já precisa estar em 'publicando' — quem reserva é quem chama.
//
// Sucesso: ig_media_id, permalink, publicado_em, status 'publicado'.
// Falha:   tentativas+1 e erro; volta para 'agendado' até a 3ª, depois 'erro'.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  publicarReel, publicarCarrossel, idDaContaConectada, type ClientePublicacao, type FetchLike,
} from '@/lib/instagram/publicar'
import { montarLegenda, resumirErro, statusAposFalha, validarParaPublicar, type Conteudo } from './regras'

export interface OpcoesPublicador {
  token: string
  fetchImpl?: FetchLike
  intervaloMs?: number
  tempoMaximoMs?: number
  /** ID já conhecido — evita a chamada /me a cada item. */
  igUserId?: string
}

export interface SaidaPublicacao {
  id: string
  ok: boolean
  status: Conteudo['status']
  mediaId?: string
  permalink?: string | null
  erro?: string
}

export async function publicarConteudo(
  admin: SupabaseClient,
  item: Conteudo,
  op: OpcoesPublicador,
): Promise<SaidaPublicacao> {
  const agora = new Date().toISOString()
  try {
    const invalido = validarParaPublicar(item)
    if (invalido) throw new Error(invalido)

    const igUserId = op.igUserId ?? item.conta_instagram_id ?? await idDaContaConectada(op.token, op.fetchImpl)
    const cliente: ClientePublicacao = {
      token: op.token, igUserId, fetchImpl: op.fetchImpl,
      intervaloMs: op.intervaloMs, tempoMaximoMs: op.tempoMaximoMs,
    }
    const caption = montarLegenda(item.descricao, item.hashtags)

    const r = item.tipo === 'reel'
      ? await publicarReel(cliente, { videoUrl: item.midia_urls[0], caption, coverUrl: item.capa_url })
      : await publicarCarrossel(cliente, { imagens: item.midia_urls, caption, altText: item.alt_text })

    await admin.from('conteudos_instagram').update({
      status: 'publicado',
      conta_instagram_id: igUserId,
      ig_container_id: r.containerId,
      ig_media_id: r.mediaId,
      ig_permalink: r.permalink,
      publicado_em: agora,
      erro: null,
      publicando_desde: null,
    }).eq('id', item.id)

    return { id: item.id, ok: true, status: 'publicado', mediaId: r.mediaId, permalink: r.permalink }
  } catch (err) {
    const erro = resumirErro(err)
    const { status, tentativas } = statusAposFalha(item.tentativas ?? 0)
    await admin.from('conteudos_instagram').update({ status, tentativas, erro, publicando_desde: null }).eq('id', item.id)
    return { id: item.id, ok: false, status, erro }
  }
}

/**
 * Rodada do cron: reserva (atômico, no banco) e publica em sequência. Em
 * sequência de propósito: a Meta limita publicações por hora, e dois vídeos
 * processando juntos só dobram o tempo de espera.
 */
export async function rodadaDePublicacao(
  admin: SupabaseClient,
  op: OpcoesPublicador,
  limite = 5,
): Promise<{ processados: number; publicados: number; falhas: number; detalhes: SaidaPublicacao[] }> {
  const { data, error } = await admin.rpc('reservar_conteudos_para_publicar', { p_limite: limite })
  if (error) throw new Error(`reserva falhou: ${error.message}`)
  const itens = (data ?? []) as Conteudo[]
  if (itens.length === 0) return { processados: 0, publicados: 0, falhas: 0, detalhes: [] }

  // Um /me por rodada, não por item.
  const igUserId = op.igUserId ?? await idDaContaConectada(op.token, op.fetchImpl).catch(() => undefined)

  const detalhes: SaidaPublicacao[] = []
  for (const item of itens) detalhes.push(await publicarConteudo(admin, item, { ...op, igUserId }))
  return {
    processados: detalhes.length,
    publicados: detalhes.filter(d => d.ok).length,
    falhas: detalhes.filter(d => !d.ok).length,
    detalhes,
  }
}
