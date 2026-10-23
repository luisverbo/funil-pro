// ============================================================================
// Estúdio IA — executor da Ana: transforma as ações da máquina em envios e
// gravações. Chamado pela entrada do webhook (mensagem da cliente) e pelas
// cobranças (cron). Toda saída vai pelo número do estúdio (Cloud API).
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarMidiaCloud, enviarTextoCloud } from '@/lib/whatsapp-cloud'
import { BUCKET_CLIENTES, caminhosDaCliente, urlPublicaDoCatalogo } from '../catalogo'
import { extensaoDoMime } from '../chat'
import { avisarAparelhos } from '../push'
import { proximoPasso, idiomaDaMensagem, cobrancaDevida, type Acao, type Contexto, type Dados, type Etapa, type Preco } from './maquina'
import { texto as renderTexto, nomeDoTema, dinheiro, idiomaDaAna, type IdiomaAna } from './textos'
import { responderDuvida, conferirFoto, type ItemBase } from './ia'
import { linhasDoPix } from '../pix'
import { registrarUsoIa, pixDoTenant, processarComprovante } from '../pix-servidor'

export const PRAZO_MIN = 60
export const PRECOS_PADRAO_BR: Preco[] = [
  { pacote_qtd: 2, valor_cents: 1890, moeda: 'BRL' }, { pacote_qtd: 3, valor_cents: 2990, moeda: 'BRL' },
  { pacote_qtd: 5, valor_cents: 4990, moeda: 'BRL' }, { pacote_qtd: 10, valor_cents: 6990, moeda: 'BRL' },
  { pacote_qtd: 15, valor_cents: 9890, moeda: 'BRL' },
]
const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://funil-pro.vercel.app').replace(/\/+$/, '')

export interface Conexao { tenant_id: string; phone_number_id: string; access_token: string; whatsapp_avisos?: string | null }

interface Contato {
  id: string; tenant_id: string; wa_id: string; nome: string | null; pais: string | null; idioma: string | null
  etapa: string | null; dados: Dados | null; pedido_atual_id: string | null; idioma_fixo?: boolean
  nao_entendeu?: number; modo?: string
}

/** Tabela de preços em texto, na moeda do país (5 = 🔥 mais vendido). */
export function tabelaDePrecos(precos: Preco[], idioma: IdiomaAna): string {
  const fotos = idioma === 'en' ? 'photos' : 'fotos'
  const mais = { 'pt-BR': 'MAIS VENDIDO', 'pt-PT': 'MAIS VENDIDO', es: 'MÁS VENDIDO', en: 'BEST SELLER' }[idioma]
  return [...precos].sort((a, b) => a.pacote_qtd - b.pacote_qtd)
    .map((p, i) => `${i + 1}️⃣ ${p.pacote_qtd} ${fotos} — ${dinheiro(p.valor_cents, p.moeda, idioma)}${p.pacote_qtd === 5 ? ` 🔥 ${mais}` : ''}`).join('\n')
}

/** Preços do país; senão os de '*'; senão os do Brasil. */
export async function precosDoPais(admin: SupabaseClient, tenantId: string, pais: string | null): Promise<Preco[]> {
  const { data, error } = await admin.from('estudio_precos').select('pais, pacote_qtd, valor_cents, moeda').eq('tenant_id', tenantId)
  if (error || !data?.length) return PRECOS_PADRAO_BR
  const de = (p: string) => data.filter(x => x.pais === p).map(x => ({ pacote_qtd: x.pacote_qtd, valor_cents: x.valor_cents, moeda: x.moeda }))
  const lista = de(pais ?? 'BR')
  return lista.length ? lista : (de('*').length ? de('*') : (de('BR').length ? de('BR') : PRECOS_PADRAO_BR))
}

export async function sobrescritas(admin: SupabaseClient, tenantId: string): Promise<{ textos: Map<string, string>; audios: Map<string, string> }> {
  const textos = new Map<string, string>(); const audios = new Map<string, string>()
  const { data } = await admin.from('estudio_textos').select('chave, idioma, texto, audio_path').eq('tenant_id', tenantId)
  for (const r of data ?? []) {
    if (r.texto?.trim()) textos.set(`${r.chave}|${r.idioma}`, r.texto)
    if (r.audio_path) audios.set(`${r.chave}|${r.idioma}`, r.audio_path)
  }
  return { textos, audios }
}

/** Arquivo público existe? (HEAD no Storage público) */
async function existe(url: string): Promise<boolean> {
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok } catch { return false }
}

async function registrar(admin: SupabaseClient, c: Contato, r: { ok: boolean; wamid?: string | null; erro?: string }, tipo: string, textoMsg: string | null, extras: Record<string, unknown> = {}) {
  await admin.from('estudio_mensagens').insert({
    tenant_id: c.tenant_id, contato_id: c.id, wamid: r.ok ? r.wamid ?? null : null, direcao: 'saida', autor: 'ana',
    tipo, texto: textoMsg, status_entrega: r.ok ? 'sent' : 'failed', erro: r.ok ? null : (r.erro ?? '').slice(0, 300), ...extras,
  })
}

/** Avisa o Luís: WhatsApp pessoal (se a janela permitir) + push no celular. */
export async function avisarLuis(admin: SupabaseClient, con: Conexao, mensagem: string) {
  if (con.whatsapp_avisos) {
    const r = await enviarTextoCloud(con, con.whatsapp_avisos, mensagem)
    if (!r.ok) console.warn('[estudio] aviso ao Luís pelo WhatsApp não saiu (janela 24h?):', r.erro)
  }
  await avisarAparelhos(admin, con.tenant_id)
}

export interface MensagemDaCliente { tipo: string; texto: string; media_path?: string | null; media_mime?: string | null }

/**
 * Roda a Ana para UMA mensagem recebida. Devolve a etapa nova.
 * Erro em uma ação não derruba as próximas (a conversa segue).
 */
export async function rodarAna(admin: SupabaseClient, con: Conexao, contatoId: string, msg: MensagemDaCliente, primeiraMensagem: boolean): Promise<string> {
  const { data: bruto } = await admin.from('estudio_contatos').select('*').eq('id', contatoId).single()
  const c = bruto as Contato
  // Sem as colunas da Fase 3, a Ana não guardaria a etapa e repetiria as
  // boas-vindas a cada mensagem: melhor falhar e cair na resposta de teste.
  if (!c || !('dados' in (bruto as object)) || !('cobrancas' in (bruto as object))) throw new Error('SQL da Fase 3 (20261027000000_estudio_ia_ana.sql) pendente')
  let idioma = idiomaDaAna(c.idioma)
  let pedidoId = c.pedido_atual_id
  // 1ª mensagem claramente em outro idioma: segue o idioma da mensagem.
  if (primeiraMensagem && !c.idioma_fixo && msg.tipo === 'texto') {
    const detectado = idiomaDaMensagem(msg.texto)
    if (detectado && detectado !== idioma) { idioma = detectado; await admin.from('estudio_contatos').update({ idioma: detectado }).eq('id', c.id) }
  }

  const [precos, sob, temasQ, posesQ, pix, baseQ] = await Promise.all([
    precosDoPais(admin, c.tenant_id, c.pais),
    sobrescritas(admin, c.tenant_id),
    admin.from('estudio_temas').select('slug, nome').eq('tenant_id', c.tenant_id).eq('ativo', true).order('ordem'),
    admin.from('estudio_poses').select('tema_slug, numero').eq('tenant_id', c.tenant_id).eq('ativa', true).limit(5000),
    pixDoTenant(admin, c.tenant_id),
    admin.from('estudio_conhecimento').select('tipo, pergunta, resposta').eq('tenant_id', c.tenant_id).eq('ativo', true).order('ordem').limit(200),
  ])
  const base = (baseQ.data ?? []) as ItemBase[]
  const pixOk = !!linhasDoPix(pix)
  const usou = (finalidade: string, uso: Parameters<typeof registrarUsoIa>[1]['uso'] | undefined, intencao?: string | null) =>
    uso ? registrarUsoIa(admin, { tenant_id: c.tenant_id, contato_id: c.id, pedido_id: pedidoId, finalidade, intencao, uso }) : Promise.resolve()
  const temasAtivos = (temasQ.data ?? []).map(t => t.slug)
  const posesPorTema = new Map<string, string[]>()
  for (const p of posesQ.data ?? []) posesPorTema.set(p.tema_slug, [...(posesPorTema.get(p.tema_slug) ?? []), p.numero])

  let dados: Dados = (c.dados ?? {}) as Dados
  const etapaAtual = ((c.etapa as Etapa) || 'inicio')

  // Foto do rosto: confere ANTES (pessoa real, de frente, adulta, não é print).
  let foto: 'ok' | 'ruim' | 'recusada' | undefined
  if (msg.tipo === 'imagem' && ['fotos_poses', 'previa_fotos'].includes(etapaAtual) && !dados.tem_rosto && msg.media_path) {
    const { data: arq } = await admin.storage.from(BUCKET_CLIENTES).download(msg.media_path)
    if (arq) {
      const conf = await conferirFoto(new Uint8Array(await arq.arrayBuffer()), msg.media_mime ?? 'image/jpeg')
      foto = conf.motivo
      await usou('foto', conf.uso)
    }
  }

  // Pós-entrega: o que a cliente pode fazer com o pedido entregue (ajuste / +5 fotos).
  let ctxEntrega: Contexto['entrega']
  if (['entregue', 'ajuste_detalhe'].includes(etapaAtual) && pedidoId) {
    try {
      const [{ data: ped }, { configProducao }, { podeAjustar, valorComDesconto }] = await Promise.all([
        admin.from('estudio_pedidos').select('poses, entregue_em, ajustes_usados, status').eq('id', pedidoId).single(),
        import('../producao-servidor'), import('../producao'),
      ])
      const cfg = await configProducao(admin, c.tenant_id)
      const cheio = precos.find(x => x.pacote_qtd === cfg.upsell_qtd)
      ctxEntrega = {
        pode_ajustar: !!ped && podeAjustar(ped, cfg.ajustes_gratis), poses: ped?.poses ?? [],
        upsell_qtd: cfg.upsell_qtd, upsell_valor_cents: cheio ? valorComDesconto(cheio.valor_cents, cfg.upsell_desconto_pct) : 0, moeda: cheio?.moeda ?? 'BRL',
      }
    } catch (err) { console.error('[estudio/ana] pós-entrega:', String(err).slice(0, 300)) }   // sem isso a Ana responde pela IA
  }
  const r = proximoPasso(etapaAtual, dados, { tipo: msg.tipo, texto: msg.texto ?? '', foto }, {
    idioma, precos, temasAtivos, posesDoTema: slug => posesPorTema.get(slug) ?? [], pix: pixOk, entrega: ctxEntrega,
  })
  dados = r.dados
  let etapa: string = r.etapa === 'humano' ? etapaAtual : r.etapa   // humano pausa, não apaga a etapa
  let falou = false
  let naoEntendeu = Number(c.nao_entendeu ?? 0)
  let entendeu = true

  const vars = (extra: Record<string, string | number> = {}) => ({
    nome: dados.nome ?? c.nome ?? '', tema: nomeDoTema(dados.tema, idioma), qtd: dados.pacote_qtd ?? '',
    valor: dados.valor_cents !== undefined ? dinheiro(dados.valor_cents, dados.moeda ?? 'BRL', idioma) : '',
    poses: (dados.poses ?? []).join(', '), tabela: tabelaDePrecos(precos, idioma), prazo: PRAZO_MIN,
    link: dados.tema ? `${APP_URL()}/estudio/catalogo/${dados.tema}` : `${APP_URL()}/estudio/catalogo`, ...extra,
  })
  const enviarTexto = async (t: string) => {
    if (!t.trim()) return
    const s = await enviarTextoCloud(con, c.wa_id, t)
    await registrar(admin, c, s, 'texto', t)
    falou = true
  }
  const passarParaHumano = async (motivo: string) => {
    await admin.from('estudio_contatos').update({ modo: 'humano', precisa_humano: true, humano_fixo: true, humano_desde: new Date().toISOString() }).eq('id', c.id)
    await avisarLuis(admin, con, `🙋 ${dados.nome ?? c.nome ?? `+${c.wa_id}`} precisa de você no Estúdio IA.\nMotivo: ${motivo}\n${APP_URL()}/estudio-ia?aba=conversas&c=${c.id}`)
  }

  for (const a of r.acoes as Acao[]) {
    try {
      switch (a.t) {
        case 'idioma':
          idioma = a.idioma
          await admin.from('estudio_contatos').update({ idioma: a.idioma, idioma_fixo: true }).eq('id', c.id)
          break
        case 'texto':
          await enviarTexto(renderTexto(a.chave, idioma, vars(a.vars), sob.textos))
          break
        case 'audio': {
          const path = sob.audios.get(`${a.chave}|${idioma}`)
          const url = path ? urlPublicaDoCatalogo(path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : null
          if (url) {
            const s = await enviarMidiaCloud(con, c.wa_id, 'audio', url)
            await registrar(admin, c, s, 'audio', `[🎙 ${a.chave.toUpperCase()}]`, { media_mime: 'audio/ogg' })
            falou = true
          } else {
            await enviarTexto(renderTexto(a.chave, idioma, vars(), sob.textos))   // sem áudio no idioma → só texto
          }
          break
        }
        case 'menu_imagem': {
          const url = urlPublicaDoCatalogo('midias/menu.jpg', process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
          if (url && await existe(url)) {
            const s = await enviarMidiaCloud(con, c.wa_id, 'image', url)
            await registrar(admin, c, s, 'imagem', null, { media_mime: 'image/jpeg' })
          }
          break
        }
        case 'catalogo': {
          await enviarTexto(renderTexto('catalogo_link', idioma, vars(), sob.textos))
          const pdf = urlPublicaDoCatalogo(`${a.tema}/catalogo-${a.tema}.pdf`, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
          if (pdf && await existe(pdf)) {
            const nome = `Catálogo ${nomeDoTema(a.tema, idioma)}.pdf`
            const s = await enviarMidiaCloud(con, c.wa_id, 'document', pdf, undefined, nome)
            await registrar(admin, c, s, 'documento', null, { media_mime: 'application/pdf', media_nome: nome })
          }
          break
        }
        case 'criar_pedido': {
          const previa = a.tipo === 'previa'
          const { data: p } = await admin.from('estudio_pedidos').insert({
            tenant_id: c.tenant_id, contato_id: c.id, cliente_nome: dados.nome ?? c.nome, wa_id: c.wa_id,
            tema_slug: dados.tema ?? null, pacote_qtd: previa ? 1 : dados.pacote_qtd, valor_cents: previa ? 0 : dados.valor_cents,
            moeda: dados.moeda ?? 'BRL', idioma, pais: c.pais, status: 'novo', tipo: a.tipo, idade: dados.idade ?? null,
          }).select('id').single()
          if (p) {
            pedidoId = p.id
            if (previa) { dados.tem_rosto = false; dados.tem_corpo = false; dados.poses = [] }
            await admin.from('estudio_contatos').update({ pedido_atual_id: p.id }).eq('id', c.id)
            await admin.from('estudio_eventos').insert({ pedido_id: p.id, tipo: 'pedido_criado', detalhe: { tipo: a.tipo, pacote_qtd: previa ? 1 : dados.pacote_qtd } })
          }
          break
        }
        case 'guardar_foto': {
          if (!pedidoId || !msg.media_path) break
          const destinos = caminhosDaCliente(pedidoId)
          const destino = a.papel === 'rosto' ? destinos.rosto : a.papel === 'corpo' ? destinos.corpo
            : `${pedidoId}/extra-${Date.now()}.${extensaoDoMime(msg.media_mime)}`
          await admin.storage.from(BUCKET_CLIENTES).remove([destino]).catch(() => {})
          const { error } = await admin.storage.from(BUCKET_CLIENTES).copy(msg.media_path, destino)
          if (error) { console.error('[estudio/ana] copiar foto:', error.message); break }
          if (a.papel === 'extra') {
            const { data: p } = await admin.from('estudio_pedidos').select('fotos_extras_paths').eq('id', pedidoId).single()
            await admin.from('estudio_pedidos').update({ fotos_extras_paths: [...(p?.fotos_extras_paths ?? []), destino] }).eq('id', pedidoId)
          } else {
            await admin.from('estudio_pedidos').update(a.papel === 'rosto' ? { foto_rosto_path: destino } : { foto_corpo_path: destino }).eq('id', pedidoId)
          }
          break
        }
        case 'atualizar_pedido':
          if (pedidoId) await admin.from('estudio_pedidos').update({
            poses: dados.poses ?? [], idade: dados.idade ?? null, cabelo: dados.cabelo ?? null,
            preferencias: dados.preferencias ?? null, cliente_nome: dados.nome ?? c.nome, tema_slug: dados.tema ?? null,
          }).eq('id', pedidoId)
          break
        case 'fechar_pedido':
          if (!pedidoId) break
          if (a.tipo === 'previa') {
            await admin.from('estudio_pedidos').update({ status: 'pago', pago_em: new Date().toISOString(), valor_pago_cents: 0 }).eq('id', pedidoId)
            await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'previa_na_fila', detalhe: {} })
            const { entrarNaFila } = await import('../producao-servidor')
            await entrarNaFila(admin, pedidoId)
            // A prévia segue o próprio caminho; a conversa volta para onde estava.
            pedidoId = null
            await admin.from('estudio_contatos').update({ pedido_atual_id: null }).eq('id', c.id)
          } else {
            await admin.from('estudio_pedidos').update({ status: 'aguardando_pagamento' }).eq('id', pedidoId)
            await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'pedido_registrado', detalhe: { valor_cents: dados.valor_cents, poses: dados.poses } })
          }
          break
        case 'pix': {
          const l = linhasDoPix(pix)
          if (!l) break
          await enviarTexto(renderTexto('pix_dados', idioma, vars({ recebedor: l.recebedor }), sob.textos))
          await enviarTexto(l.chave)   // sozinha numa mensagem: a cliente toca e copia
          break
        }
        case 'comprovante': {
          if (!pedidoId || !msg.media_path) { await enviarTexto(renderTexto('pede_comprovante', idioma, vars(), sob.textos)); break }
          const res = await processarComprovante(admin, c, pedidoId, { path: msg.media_path, mime: msg.media_mime ?? 'image/jpeg' })
          const quem = dados.nome ?? c.nome ?? `+${c.wa_id}`
          const valor = vars().valor
          if (res.resultado === 'pago') {
            etapa = 'pago'
            await enviarTexto(renderTexto('pago_ok', idioma, vars(), sob.textos))   // o aviso "💰 Novo pedido para produzir" sai de entrarNaFila
          } else if (res.resultado === 'nao_e_comprovante') {
            await enviarTexto(renderTexto('pede_comprovante', idioma, vars(), sob.textos))
          } else {
            etapa = 'conferindo'
            await enviarTexto(renderTexto('conferindo', idioma, vars(), sob.textos))
            await admin.from('estudio_contatos').update({ precisa_humano: true }).eq('id', c.id)
            await avisarLuis(admin, con, `🧾 Comprovante para conferir: ${quem} · ${valor}\nMotivo: ${res.motivos.join('; ')}\nAprovar ou recusar: ${APP_URL()}/estudio-ia?aba=conversas&c=${c.id}`)
          }
          break
        }
        case 'ajuste': {
          if (!pedidoId) break
          const { registrarAjuste } = await import('../producao-servidor')
          const r2 = await registrarAjuste(admin, pedidoId, a.poses, a.obs)
          if (!r2.ok) console.error('[estudio/ana] ajuste:', r2.erro)
          break
        }
        case 'upsell': {
          if (!pedidoId || !ctxEntrega) break
          const { criarUpsell } = await import('../producao-servidor')
          const novo = await criarUpsell(admin, pedidoId, c.id, ctxEntrega.upsell_qtd, ctxEntrega.upsell_valor_cents, ctxEntrega.moeda)
          if (novo) { pedidoId = novo; await admin.from('estudio_contatos').update({ pedido_atual_id: novo }).eq('id', c.id) }
          break
        }
        case 'ia': {
          const { data: hist } = await admin.from('estudio_mensagens').select('direcao, texto').eq('contato_id', c.id).order('criado_em', { ascending: false }).limit(10)
          const out = await responderDuvida({
            idioma, objetivo: a.objetivo, tabelaPrecos: tabelaDePrecos(precos, idioma).replace(/\n/g, '; '), prazoMin: PRAZO_MIN,
            temas: temasAtivos.map(t => nomeDoTema(t, idioma)).join(', '),
            historico: [...(hist ?? [])].reverse().slice(0, -1).map(h => ({ de: h.direcao === 'entrada' ? 'cliente' as const : 'ana' as const, texto: h.texto ?? '' })),
            base,
          }, msg.texto)
          for (const u of out.usos) await usou('resposta', u, out.estruturada?.intencao)
          const resp = out.resposta
          if (resp.tipo === 'confirmar_equipe') {
            await enviarTexto(renderTexto('confirmar_equipe', idioma, vars(), sob.textos))
            await admin.from('estudio_contatos').update({ precisa_humano: true }).eq('id', c.id)
            await avisarLuis(admin, con, `❓ ${dados.nome ?? c.nome ?? `+${c.wa_id}`} perguntou algo fora da base da Ana: "${msg.texto.slice(0, 200)}"\n(${resp.motivo})\nResponda e, se quiser, cadastre na base (Atendente): ${APP_URL()}/estudio-ia?aba=conversas&c=${c.id}`)
          } else if (resp.tipo === 'texto') await enviarTexto(resp.texto)
          else if (resp.tipo === 'humano') { await enviarTexto(renderTexto('humano', idioma, vars(), sob.textos)); await passarParaHumano('a IA identificou reclamação/reembolso/fora das regras') }
          else {
            entendeu = false
            naoEntendeu++
            if (naoEntendeu >= 2) { await enviarTexto(renderTexto('humano', idioma, vars(), sob.textos)); await passarParaHumano('a Ana não entendeu 2 mensagens seguidas'); naoEntendeu = 0 }
            else await enviarTexto(renderTexto('nao_entendi', idioma, vars(), sob.textos))
          }
          break
        }
        case 'humano':
          await passarParaHumano(a.motivo)
          break
      }
    } catch (err) {
      console.error(`[estudio/ana] ação ${a.t} falhou:`, String(err).slice(0, 300))
    }
  }

  const agora = new Date().toISOString()
  if (falou) dados.aguardando_desde = agora
  await admin.from('estudio_contatos').update({
    etapa, dados, nao_entendeu: entendeu ? 0 : naoEntendeu, cobrancas: 0,
    ...(falou ? { ultima_ana_em: agora } : {}),
  }).eq('id', c.id)
  return etapa
}

/** Rodada das cobranças (cron a cada 5 min). Devolve quantas saíram. */
export async function rodadaDeCobrancas(admin: SupabaseClient, agora: Date = new Date()): Promise<number> {
  const { data: contatos } = await admin.from('estudio_contatos')
    .select('id, tenant_id, wa_id, nome, idioma, etapa, dados, modo, cobrancas, janela_ate, ultima_cliente_em')
    .eq('modo', 'ana').lt('cobrancas', 3).gt('janela_ate', agora.toISOString()).limit(200)
  let enviadas = 0
  const conexoes = new Map<string, Conexao | null>()
  for (const c of contatos ?? []) {
    const d = (c.dados ?? {}) as Dados
    const chave = cobrancaDevida({
      etapa: (c.etapa as Etapa) || 'inicio', modo: c.modo, cobrancas: c.cobrancas, janela_ate: c.janela_ate,
      aguardando_desde: d.aguardando_desde ?? null, ultima_cliente_em: c.ultima_cliente_em, tema: d.tema, previa_feita: d.previa_feita,
    }, agora)
    if (!chave) continue
    if (!conexoes.has(c.tenant_id)) {
      const { data: cfg } = await admin.from('estudio_config').select('tenant_id, phone_number_id, access_token, whatsapp_avisos, ativo').eq('tenant_id', c.tenant_id).maybeSingle()
      conexoes.set(c.tenant_id, cfg?.ativo && cfg.access_token ? cfg as Conexao : null)
    }
    const con = conexoes.get(c.tenant_id)
    if (!con) continue
    const { textos } = await sobrescritas(admin, c.tenant_id)
    const t = renderTexto(chave, idiomaDaAna(c.idioma), { nome: d.nome ?? c.nome ?? '' }, textos)
    const s = await enviarTextoCloud(con, c.wa_id, t)
    await admin.from('estudio_mensagens').insert({
      tenant_id: c.tenant_id, contato_id: c.id, wamid: s.ok ? s.wamid ?? null : null, direcao: 'saida', autor: 'ana',
      tipo: 'texto', texto: t, status_entrega: s.ok ? 'sent' : 'failed', erro: s.ok ? null : (s.erro ?? '').slice(0, 300),
    })
    if (chave === 'cobranca_2') d.previa_oferecida = true
    await admin.from('estudio_contatos').update({
      cobrancas: chave === 'cobranca_3' ? 3 : c.cobrancas + 1, dados: d, ultima_ana_em: agora.toISOString(), ultima_msg: t.slice(0, 120),
    }).eq('id', c.id)
    if (s.ok) enviadas++
  }
  return enviadas
}

/**
 * Mensagem fixa da Ana disparada pelo PAINEL (Luís aprovou/recusou o Pix):
 * texto no idioma da cliente, registrado no chat, e etapa nova da conversa.
 */
export async function falarComCliente(admin: SupabaseClient, tenantId: string, contatoId: string, chave: string, novaEtapa?: Etapa, extra: Record<string, string | number> = {}): Promise<{ ok: boolean; erro?: string }> {
  const { data: c } = await admin.from('estudio_contatos').select('id, tenant_id, wa_id, nome, idioma, dados').eq('id', contatoId).eq('tenant_id', tenantId).maybeSingle()
  if (!c) return { ok: false, erro: 'Conversa não encontrada.' }
  const { data: cfg } = await admin.from('estudio_config').select('tenant_id, phone_number_id, access_token').eq('tenant_id', tenantId).maybeSingle()
  if (!cfg?.access_token) return { ok: false, erro: 'Número do estúdio não conectado.' }
  const d = (c.dados ?? {}) as Dados
  const idioma = idiomaDaAna(c.idioma)
  const { textos } = await sobrescritas(admin, tenantId)
  const t = renderTexto(chave, idioma, {
    nome: d.nome ?? c.nome ?? '', prazo: PRAZO_MIN, qtd: d.pacote_qtd ?? '',
    valor: d.valor_cents !== undefined ? dinheiro(d.valor_cents, d.moeda ?? 'BRL', idioma) : '', ...extra,
  }, textos)
  const s = await enviarTextoCloud(cfg as Conexao, c.wa_id, t)
  await registrar(admin, c as Contato, s, 'texto', t)
  const agora = new Date().toISOString()
  if (s.ok) d.aguardando_desde = agora
  await admin.from('estudio_contatos').update({
    ...(novaEtapa ? { etapa: novaEtapa } : {}), dados: d, ultima_ana_em: agora, cobrancas: 0, precisa_humano: false, ultima_msg: t.slice(0, 120),
  }).eq('id', c.id)
  return s.ok ? { ok: true } : { ok: false, erro: s.erro }
}
