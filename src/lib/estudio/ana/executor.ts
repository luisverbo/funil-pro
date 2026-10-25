// ============================================================================
// Estúdio IA — executor da Ana: transforma as ações da máquina em envios e
// gravações. Chamado pela entrada do webhook (mensagem da cliente) e pelas
// cobranças (cron). Toda saída vai pelo número do estúdio (Cloud API).
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarMidiaCloud, enviarTextoCloud } from '@/lib/whatsapp-cloud'
import { BUCKET_CATALOGO, BUCKET_CLIENTES, caminhosDaCliente, urlPublicaDoCatalogo, poseLevaIdade as poseLevaIdadeCena } from '../catalogo'
import { proximoPasso, lembreteDaEtapa, mensagensDaRetomada, preferenciasVencidas, idiomaDaMensagem, cobrancaDevida, proximaPreferencia, type Acao, type Contexto, type Dados, type Entrada, type Etapa, type Preco } from './maquina'
import { caminhoPdfIdioma, linkDoCatalogo, nomeDoPdf } from '../catalogo-idiomas'
import { texto as renderTexto, nomeDoTema, dinheiro, idiomaDaAna, type IdiomaAna } from './textos'
import { responderDuvida, classificarFoto, extrairPreferencias, type ItemBase } from './ia'
import { escolherFotos, resumoDasFotos, caixaDoRecorte, type FotoRecebida } from './fotos'
import { atrasoDeTexto, atrasoDeAudio, atrasoDeMidia, esperaRestante, marcarLidaDigitando, reagir, enviarVoz, ATRASO_MAX_PADRAO_MS } from '../envio'
import { Cronometro } from '../tempos'
import { avisarLuisRegistrado } from '../avisos'
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
  nao_entendeu?: number; modo?: string; fotos_recebidas?: FotoRecebida[]
  origem?: string | null; ad_id?: string | null; ctwa_clid?: string | null
}

/** Tabela de preços em texto, na moeda do país (5 = 🔥 mais vendido). */
export function tabelaDePrecos(precos: Preco[], idioma: IdiomaAna): string {
  const fotos = idioma === 'en' ? 'photos' : 'fotos'
  // Euro (Espanha): o valor já é o FINAL do checkout da Hotmart, com IVA.
  const iva = (m: string) => (m === 'EUR' ? ' (IVA incluido)' : '')
  return [...precos].sort((a, b) => a.pacote_qtd - b.pacote_qtd)
    .map((p, i) => `${i + 1}️⃣ ${p.pacote_qtd} ${fotos} — ${dinheiro(p.valor_cents, p.moeda, idioma)}${iva(p.moeda)}`).join('\n')
}

/** Preços do país; senão os de '*'; senão os do Brasil. */
export async function precosDoPais(admin: SupabaseClient, tenantId: string, pais: string | null): Promise<Preco[]> {
  type Linha = { pais: string; pacote_qtd: number; valor_cents: number; moeda: string; link_pagamento?: string | null }
  const { data, error } = await admin.from('estudio_precos').select('pais, pacote_qtd, valor_cents, moeda, link_pagamento').eq('tenant_id', tenantId)
  const linhas = (data ?? []) as Linha[]
  if (error || !linhas.length) return PRECOS_PADRAO_BR
  const de = (p: string) => linhas.filter(x => x.pais === p).map(x => ({ pacote_qtd: x.pacote_qtd, valor_cents: x.valor_cents, moeda: x.moeda, link_pagamento: x.link_pagamento ?? null }))
  // Brasil: BRL + Pix. Fora do Brasil (DDI ≠ +55): o país, senão 'INT' (Hotmart, USD).
  const ehBrasil = (pais ?? 'BR') === 'BR'
  const ordem = ehBrasil ? ['BR', '*'] : [pais ?? '', 'INT', '*', 'BR']
  for (const p of ordem) { const l = p ? de(p) : []; if (l.length) return l }
  return PRECOS_PADRAO_BR
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

/**
 * PDF do catálogo no idioma da conversa. Português: o PDF do PC
 * (catalogo-<tema>.pdf), senão o gerado. Espanhol/inglês: só o do idioma
 * (gera na hora se ainda não existe) — nunca manda o PDF em português.
 */
async function pdfDoCatalogo(admin: SupabaseClient, tema: string, idioma: IdiomaAna): Promise<string | null> {
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (idioma === 'pt-BR' || idioma === 'pt-PT') {
    const doPc = urlPublicaDoCatalogo(`${tema}/catalogo-${tema}.pdf`, supa)
    if (doPc && await existe(doPc)) return doPc
  }
  const pronto = urlPublicaDoCatalogo(caminhoPdfIdioma(tema, idioma), supa)
  if (pronto && await existe(pronto)) return pronto
  try {
    const { gerarPdfCatalogo } = await import('../pdf-catalogo')
    const r = await gerarPdfCatalogo(admin, tema, idioma)
    if (r.erro) console.warn('[estudio/ana] PDF do catálogo:', r.erro)
    return r.url
  } catch (err) { console.warn('[estudio/ana] PDF do catálogo:', String(err).slice(0, 200)); return null }
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

/**
 * Avisa o Luís: WhatsApp de avisos (SEMPRE — mesmo se for o número da cliente
 * no teste) → se recusar, modelo aprovado "novo_pedido" → e push no celular.
 * Cada tentativa fica registrada em estudio_avisos (Painel).
 */
export async function avisarLuis(admin: SupabaseClient, con: Conexao, mensagem: string, pedidoId?: string | null) {
  await avisarLuisRegistrado(admin, con, mensagem, pedidoId ?? null)
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface MensagemDaCliente {
  tipo: string; texto: string; media_path?: string | null; media_mime?: string | null
  /** wamid da mensagem da cliente (marca lida + "digitando…" e recebe a reação). */
  wamid?: string | null
  /** Fotos chegadas juntas (2 webhooks quase ao mesmo tempo) — tratadas de uma vez. */
  fotos?: { path: string; mime: string; wamid?: string | null }[]
  cronometro?: Cronometro
}

/** Lembretes que a máquina põe depois da IA (pulados se a IA já perguntou). */
const LEMBRETES_DA_IA = new Set(['lembrete_nome', 'lembrete_tema', 'pacote_de_novo', 'lembrete_fotos', 'pede_poses', 'poses_faltam', 'falta_foto', 'pede_comprovante', 'hotmart_lembrete'])

/** Lembretes da etapa: nunca saem duas vezes seguidas iguais. */
const LEMBRETES = new Set(['pacote_de_novo', 'lembrete_nome', 'lembrete_tema', 'lembrete_fotos', 'pede_poses', 'poses_faltam', 'falta_foto', 'pede_comprovante', 'hotmart_lembrete', 'pede_nome', 'tabela_precos'])

/** Textos de informação: não repetir em menos de 30 min. */
const INFO_SEM_REPETIR = new Set(['pedido_pago_duvida', 'pago_ok', 'conferindo', 'previa_na_fila', 'aguardando_pagamento', 'entrega_ajuste'])

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
    if (detectado && detectado !== idioma && !(detectado === 'es' && idioma === 'es-ES')) { idioma = detectado; await admin.from('estudio_contatos').update({ idioma: detectado }).eq('id', c.id) }
  }

  const [precos, sob, temasQ, posesQ, pix, baseQ] = await Promise.all([
    precosDoPais(admin, c.tenant_id, c.pais),
    sobrescritas(admin, c.tenant_id),
    admin.from('estudio_temas').select('slug, nome').eq('tenant_id', c.tenant_id).eq('ativo', true).order('ordem'),
    admin.from('estudio_poses').select('tema_slug, numero, cena').eq('tenant_id', c.tenant_id).eq('ativa', true).limit(5000),
    pixDoTenant(admin, c.tenant_id),
    admin.from('estudio_conhecimento').select('tipo, pergunta, resposta').eq('tenant_id', c.tenant_id).eq('ativo', true).order('ordem').limit(200),
  ])
  const base = (baseQ.data ?? []) as ItemBase[]
  const pixOk = !!linhasDoPix(pix)
  const usou = (finalidade: string, uso: Parameters<typeof registrarUsoIa>[1]['uso'] | undefined, intencao?: string | null) =>
    uso ? registrarUsoIa(admin, { tenant_id: c.tenant_id, contato_id: c.id, pedido_id: pedidoId, finalidade, intencao, uso }) : Promise.resolve()
  const temasAtivos = (temasQ.data ?? []).map(t => t.slug)
  const posesPorTema = new Map<string, string[]>()
  // A Ana "conhece" cada foto: a cena de cada pose (o que tem nela) por tema.
  const cenas = new Map<string, string>()
  for (const p of posesQ.data ?? []) {
    posesPorTema.set(p.tema_slug, [...(posesPorTema.get(p.tema_slug) ?? []), p.numero])
    cenas.set(`${p.tema_slug}|${p.numero}`, String((p as { cena?: string | null }).cena ?? ''))
  }
  const poseLevaIdade = (slug: string, numero: string) => poseLevaIdadeCena(cenas.get(`${slug}|${numero}`))

  let dados: Dados = (c.dados ?? {}) as Dados
  const etapaAtual = ((c.etapa as Etapa) || 'inicio')
  const crono = msg.cronometro ?? new Cronometro()

  // ── Envio humanizado: "digitando…" + atraso que conta da chegada ─────────
  const { data: cfgH } = await admin.from('estudio_config').select('humanizar, atraso_max_s').eq('tenant_id', c.tenant_id).maybeSingle()
    .then(r => r, () => ({ data: null }))
  const humanizar = (cfgH as { humanizar?: boolean } | null)?.humanizar !== false
  const atrasoMax = Math.max(1.5, Number((cfgH as { atraso_max_s?: number } | null)?.atraso_max_s ?? 6)) * 1000 || ATRASO_MAX_PADRAO_MS
  let marco = crono.inicio
  let primeiroEnvio = true
  const pausar = async (alvoMs: number) => {
    if (!humanizar) { marco = Date.now(); return }
    if (!primeiroEnvio && msg.wamid) void marcarLidaDigitando(con, msg.wamid)   // liga o "digitando…" de novo
    const espera = esperaRestante(alvoMs, Date.now() - marco)
    if (espera > 0) { crono.somar('espera', espera); await dormir(espera) }
  }
  const depoisDeEnviar = () => { marco = Date.now(); primeiroEnvio = false; crono.respondeu() }

  // ── Fotos: guarda TODAS, classifica (Haiku, visão) e escolhe rosto/corpo ─
  // Cada foto vai para a lista do contato por RPC atômica (nunca sobrescreve
  // a anterior). A escolha de rosto.jpg/corpo.jpg é feita sobre a lista toda.
  let fotosLista: FotoRecebida[] = Array.isArray(c.fotos_recebidas) ? c.fotos_recebidas : []
  let fotosEntrada: Entrada['fotos']
  // Na espera do comprovante, imagem é comprovante — não entra na lista de fotos do ensaio.
  const etapaDeComprovante = ['aguardando_pagamento', 'conferindo'].includes(etapaAtual)
  const novas = etapaDeComprovante ? [] : msg.fotos?.length ? msg.fotos
    : (msg.tipo === 'imagem' && msg.media_path ? [{ path: msg.media_path, mime: msg.media_mime ?? 'image/jpeg', wamid: msg.wamid ?? null }] : [])
  if (novas.length) {
    const classificadas = await Promise.all(novas.map(async f => {
      const arq = await crono.medir('midia', async () => (await admin.storage.from(BUCKET_CLIENTES).download(f.path)).data)
      if (!arq) return null
      const bytes = new Uint8Array(await arq.arrayBuffer())
      const { classe, uso } = await crono.medir('ia', () => classificarFoto(bytes, f.mime))
      await usou('foto', uso)
      const foto: FotoRecebida = { path: f.path, mime: f.mime, wamid: f.wamid ?? null, em: new Date().toISOString(), tipo: classe.tipo, motivo: classe.motivo, recusada: classe.recusada, fracao_corpo: classe.fracao_corpo, rosto_caixa: classe.rosto_caixa, cabelo: classe.cabelo }
      return foto
    }))
    for (const foto of classificadas) {
      if (!foto) continue
      const { data: lista, error } = await admin.rpc('estudio_add_foto', { p_contato: c.id, p_foto: foto })
      if (error) { console.warn('[estudio/ana] estudio_add_foto (SQL pendente?):', error.message); if (!fotosLista.some(x => x.path === foto.path)) fotosLista = [...fotosLista, foto] }
      else if (Array.isArray(lista)) fotosLista = lista as FotoRecebida[]
    }
    const validas = classificadas.filter((x): x is FotoRecebida => !!x)
    fotosEntrada = {
      novas: validas.length,
      recusada: validas.some(x => x.recusada),
      invalida: validas.length && validas.every(x => x.tipo === 'invalida') ? (validas[0].motivo ?? 'não deu para usar') : null,
    }
  }
  const ctxFotos = resumoDasFotos(fotosLista)

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

  const vars = (extra: Record<string, string | number> = {}) => {
    const { valor_cents: vc, ...resto } = extra
    return {
      nome: dados.nome ?? c.nome ?? '', tema: nomeDoTema(dados.tema, idioma), qtd: dados.pacote_qtd ?? '',
      valor: vc !== undefined ? dinheiro(Number(vc), dados.moeda ?? precos[0]?.moeda ?? 'BRL', idioma)
        : dados.valor_cents !== undefined ? dinheiro(dados.valor_cents, dados.moeda ?? 'BRL', idioma) : '',
      poses: (dados.poses ?? []).join(', '), tabela: tabelaDePrecos(precos, idioma), prazo: PRAZO_MIN,
      link: linkDoCatalogo(APP_URL(), dados.tema, idioma),
      pagar: dados.hotmart_link ?? dados.pagar_link ?? '', ...resto,
    }
  }

  // Preferências: a resposta pode trazer várias coisas ("42 loiros sem decote").
  let prefs: Entrada['prefs'] = null
  if (etapaAtual === 'idade_prefs' && msg.tipo === 'texto' && msg.texto.trim().split(/\s+/).length >= 2) {
    const pergunta = proximaPreferencia(dados)
    const r0 = await crono.medir('ia', () => extrairPreferencias(msg.texto, pergunta ? renderTexto(pergunta, idioma, vars(), sob.textos) : '', undefined))
    prefs = r0.prefs
    await usou('preferencias', r0.uso)
  }

  // Pagou antes de mandar tudo? (Pix aprovado / Hotmart confirmada no meio da coleta.)
  let pedidoPago = false
  if (pedidoId && ['fotos_poses', 'idade_prefs'].includes(etapaAtual)) {
    const { data: st } = await admin.from('estudio_pedidos').select('status').eq('id', pedidoId).maybeSingle()
    pedidoPago = ['pago', 'aguardando_fotos'].includes(String(st?.status ?? ''))
  }
  const ctxAna = { poseLevaIdade, nomePerfil: c.nome ?? null, idioma, precos, temasAtivos, posesDoTema: (slug: string) => posesPorTema.get(slug) ?? [], pix: pixOk, entrega: ctxEntrega, fotos: ctxFotos, pago: pedidoPago }
  const r = proximoPasso(etapaAtual, dados, { tipo: msg.tipo, texto: msg.texto ?? '', fotos: fotosEntrada, prefs }, ctxAna)
  dados = r.dados
  let etapa: string = r.etapa === 'humano' ? etapaAtual : r.etapa   // humano pausa, não apaga a etapa
  let falou = false
  let iaPerguntou = false
  let naoEntendeu = Number(c.nao_entendeu ?? 0)
  let entendeu = true

  /** Nunca manda o mesmo texto 2× seguidas (60 s; informação: 30 min). */
  const repetido = async (t: string, chave?: string) => {
    const janelaMin = chave && INFO_SEM_REPETIR.has(chave) ? 30 : 1
    const { data } = await admin.from('estudio_mensagens').select('id').eq('contato_id', c.id).eq('direcao', 'saida').eq('texto', t)
      .gte('criado_em', new Date(Date.now() - janelaMin * 60e3).toISOString()).limit(1)
    return (data ?? []).length > 0
  }
  const enviarTexto = async (t: string, chave?: string) => {
    if (!t.trim()) return
    if (await repetido(t, chave)) return
    // Lembrete igual à ÚLTIMA mensagem da Ana: não manda de novo (sem eco robótico).
    if (chave && LEMBRETES.has(chave)) {
      const { data: ult } = await admin.from('estudio_mensagens').select('texto').eq('contato_id', c.id).eq('direcao', 'saida').order('criado_em', { ascending: false }).limit(1)
      if (ult?.[0]?.texto === t) return
    }
    await pausar(atrasoDeTexto(t, atrasoMax))
    const s = await crono.medir('envio', () => enviarTextoCloud(con, c.wa_id, t))
    await registrar(admin, c, s, 'texto', t)
    depoisDeEnviar()
    falou = true
  }
  /**
   * Só reclamação, reembolso, pedido explícito de pessoa ou menor de idade.
   * Pausa NÃO fixa: a Ana volta sozinha depois das horas de pausa (Configurações),
   * para a conversa nunca ficar parada esperando. Menor de idade é fixo.
   */
  const passarParaHumano = async (motivo: string, fixo = false) => {
    await admin.from('estudio_contatos').update({ modo: 'humano', precisa_humano: true, humano_fixo: fixo, humano_desde: new Date().toISOString() }).eq('id', c.id)
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
          // Idade quando a pose escolhida mostra o número: a pergunta diz por quê.
          if (a.chave === 'pref_idade' && dados.tema && (dados.poses ?? []).some(n => poseLevaIdade(dados.tema!, n))) {
            await enviarTexto(renderTexto('pref_idade_numero', idioma, vars({ poses: (dados.poses ?? []).filter(n => poseLevaIdade(dados.tema!, n)).join(', ') }), sob.textos), 'pref_idade_numero')
            break
          }
          // A IA já terminou com uma pergunta: o lembrete da etapa seria a 2ª pergunta seguida.
          if (iaPerguntou && LEMBRETES_DA_IA.has(a.chave)) break
          await enviarTexto(renderTexto(a.chave, idioma, vars(a.vars), sob.textos), a.chave)
          break
        case 'audio': {
          const path = sob.audios.get(`${a.chave}|${idioma}`) ?? (idioma === 'es-ES' ? sob.audios.get(`${a.chave}|es`) : undefined)
          const url = path ? urlPublicaDoCatalogo(path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : null
          if (path && url) {
            // Mensagem de VOZ (bolinha de play + onda), não arquivo: media_id em cache + voice:true.
            await pausar(atrasoDeAudio())
            const s = await crono.medir('envio', () => enviarVoz(admin, c.tenant_id, con, c.wa_id, {
              chave: `${BUCKET_CATALOGO}/${path}`, link: url,
              baixar: async () => { const { data } = await admin.storage.from(BUCKET_CATALOGO).download(path); return data ? { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || 'audio/ogg' } : null },
            }))
            await registrar(admin, c, s, 'audio', `[🎙 ${a.chave.toUpperCase()}]`, { media_mime: 'audio/ogg', media_path: `catalogo:${path}` })
            depoisDeEnviar()
            falou = true
          } else {
            await enviarTexto(renderTexto(a.chave, idioma, vars(), sob.textos))   // sem áudio no idioma → só texto
          }
          break
        }
        case 'menu_imagem': {
          const url = urlPublicaDoCatalogo('midias/menu.jpg', process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
          if (url && await existe(url)) {
            await pausar(atrasoDeMidia())
            const s = await crono.medir('envio', () => enviarMidiaCloud(con, c.wa_id, 'image', url))
            await registrar(admin, c, s, 'imagem', null, { media_mime: 'image/jpeg' })
            depoisDeEnviar()
          }
          break
        }
        case 'catalogo': {
          await enviarTexto(renderTexto('catalogo_link', idioma, vars(), sob.textos), 'catalogo_link')
          const pdf = await pdfDoCatalogo(admin, a.tema, idioma)
          if (pdf) {
            const nome = nomeDoPdf(nomeDoTema(a.tema, idioma), idioma)
            await pausar(atrasoDeMidia())
            const s = await crono.medir('envio', () => enviarMidiaCloud(con, c.wa_id, 'document', pdf, undefined, nome))
            await registrar(admin, c, s, 'documento', null, { media_mime: 'application/pdf', media_nome: nome })
            depoisDeEnviar()
          }
          break
        }
        case 'criar_pedido': {
          const previa = a.tipo === 'previa'
          const basePedido = {
            tenant_id: c.tenant_id, contato_id: c.id, cliente_nome: dados.nome ?? c.nome, wa_id: c.wa_id,
            tema_slug: dados.tema ?? null, pacote_qtd: previa ? 1 : dados.pacote_qtd, valor_cents: previa ? 0 : dados.valor_cents,
            moeda: dados.moeda ?? 'BRL', idioma, pais: c.pais, status: 'novo', tipo: a.tipo, idade: dados.idade ?? null,
          }
          // De onde veio (anúncio → clique), para o painel e para o evento da Meta.
          const primeira = await admin.from('estudio_pedidos').insert({
            ...basePedido, origem: c.ad_id ? 'anuncio' : (c.origem ?? 'organico'), ad_id: c.ad_id ?? null, ctwa_clid: c.ctwa_clid ?? null,
          }).select('id').single()
          let p = primeira.data
          // SQL do rastreio ainda não rodou: cria o pedido mesmo assim (sem a origem).
          if (primeira.error && /ctwa_clid|ad_id|origem|column|schema cache/i.test(primeira.error.message)) p = (await admin.from('estudio_pedidos').insert(basePedido).select('id').single()).data
          if (p) {
            // Prévia no meio da venda: guarda o pedido do pacote para voltar a ele depois.
            if (previa) dados.pedido_antes_previa = pedidoId ?? null
            pedidoId = p.id
            if (previa) dados.poses = []   // as fotos que ela já mandou continuam valendo
            await admin.from('estudio_contatos').update({ pedido_atual_id: p.id }).eq('id', c.id)
            await admin.from('estudio_eventos').insert({ pedido_id: p.id, tipo: 'pedido_criado', detalhe: { tipo: a.tipo, pacote_qtd: previa ? 1 : dados.pacote_qtd } })
          }
          break
        }
        case 'fotos_escolher':
          if (pedidoId) await aplicarEscolhaDeFotos(admin, pedidoId, fotosLista, dados)
          break
        case 'reagir':
          if (msg.wamid) await crono.medir('envio', () => reagir(con, c.wa_id, msg.wamid!, a.emoji))
          break
        case 'atualizar_pedido':
          if (pedidoId) await admin.from('estudio_pedidos').update({
            poses: a.poses ?? dados.poses ?? [], idade: dados.idade ?? null, cabelo: dados.cabelo ?? null,
            preferencias: dados.preferencias ?? null, cliente_nome: dados.nome ?? c.nome, tema_slug: dados.tema ?? null,
            maquiagem: dados.maquiagem ?? null, decote: dados.decote ?? null, cores_acessorios: dados.cores ?? null,
          }).eq('id', pedidoId).then(async res => {
            // SQL da rodada humanizada pendente: grava ao menos o que já existia.
            if (res.error && /maquiagem|decote|cores_acessorios|column/i.test(res.error.message)) await admin.from('estudio_pedidos').update({
              poses: a.poses ?? dados.poses ?? [], idade: dados.idade ?? null, cabelo: dados.cabelo ?? null, preferencias: dados.preferencias ?? null,
            }).eq('id', pedidoId!)
          })
          break
        case 'fechar_pedido':
          if (!pedidoId) break
          if (a.tipo === 'previa') {
            await admin.from('estudio_pedidos').update({ status: 'pago', pago_em: new Date().toISOString(), valor_pago_cents: 0 }).eq('id', pedidoId)
            await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'previa_na_fila', detalhe: {} })
            const { entrarNaFila } = await import('../producao-servidor')
            await entrarNaFila(admin, pedidoId)
            // A prévia segue o próprio caminho; a conversa volta para onde estava (e para o pedido do pacote, se havia).
            pedidoId = dados.pedido_antes_previa ?? null
            dados.pedido_antes_previa = undefined
            await admin.from('estudio_contatos').update({ pedido_atual_id: pedidoId }).eq('id', c.id)
          } else {
            await admin.from('estudio_pedidos').update({ status: 'aguardando_pagamento' }).eq('id', pedidoId)
            await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'pedido_registrado', detalhe: { valor_cents: dados.valor_cents, poses: dados.poses } })
            // Meta: LeadSubmitted (só se veio de anúncio; nunca 2×). Falha não atrapalha a conversa.
            const pid = pedidoId
            await import('../anuncios-servidor').then(x => x.enviarEventoPedido(admin, pid, 'LeadSubmitted')).catch(err => console.warn('[estudio] LeadSubmitted:', String(err).slice(0, 200)))
          }
          break
        case 'pix': {
          const l = linhasDoPix(pix)
          if (!l) break
          await enviarTexto(renderTexto('pix_dados', idioma, vars({ recebedor: l.recebedor }), sob.textos))
          await enviarTexto(l.chave)   // sozinha numa mensagem: a cliente toca e copia
          break
        }
        case 'hotmart': {
          // Link da oferta do pacote + o pedido no sck (a Hotmart devolve no webhook).
          if (!pedidoId || !dados.pagar_link) break
          const { linkComPedido } = await import('../hotmart')
          dados.hotmart_link = linkComPedido(dados.pagar_link, pedidoId)
          await admin.from('estudio_pedidos').update({ forma_pagamento: 'hotmart', moeda: dados.moeda ?? 'USD' }).eq('id', pedidoId)
          await enviarTexto(renderTexto(a.chave ?? 'hotmart_link', idioma, vars(), sob.textos), a.chave ?? 'hotmart_link')
          break
        }
        case 'comprovante': {
          if (!pedidoId || !msg.media_path) { await enviarTexto(renderTexto('pede_comprovante', idioma, vars(), sob.textos)); break }
          const res = await processarComprovante(admin, c, pedidoId, { path: msg.media_path, mime: msg.media_mime ?? 'image/jpeg' })
          const quem = dados.nome ?? c.nome ?? `+${c.wa_id}`
          const valor = vars().valor
          const coletando = ['fotos_poses', 'idade_prefs'].includes(etapaAtual)
          if (res.resultado === 'pago' && coletando) {
            // Pagou antes de mandar tudo: confirma e segue pedindo o que falta.
            await enviarTexto(renderTexto('pago_ok_coleta', idioma, vars(), sob.textos))
            for (const l of lembreteDaEtapa(etapaAtual, dados, { ...ctxAna, pago: true })) if (l.t === 'texto') await enviarTexto(renderTexto(l.chave, idioma, vars(l.vars), sob.textos), l.chave)
          } else if (res.resultado === 'pago') {
            etapa = 'pago'
            await enviarTexto(renderTexto('pago_ok', idioma, vars(), sob.textos))   // o aviso "💰 Novo pedido para produzir" sai de entrarNaFila
          } else if (res.resultado === 'nao_e_comprovante') {
            await enviarTexto(renderTexto('pede_comprovante', idioma, vars(), sob.textos))
          } else {
            if (!coletando) etapa = 'conferindo'
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
        case 'trocar_pacote': {
          // Escolheu mais poses que o pacote e aceitou o pacote maior.
          if (!pedidoId) break
          await admin.from('estudio_pedidos').update({ pacote_qtd: dados.pacote_qtd, valor_cents: dados.valor_cents, moeda: dados.moeda ?? 'BRL', poses: dados.poses ?? [] }).eq('id', pedidoId)
          await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'pacote_trocado', detalhe: { pacote_qtd: dados.pacote_qtd, valor_cents: dados.valor_cents } })
          dados.hotmart_link = null
          break
        }
        case 'fila': {
          if (!pedidoId) break
          const { entrarNaFila } = await import('../producao-servidor')
          await entrarNaFila(admin, pedidoId, { forcar: true })   // a conversa terminou agora
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
            poses: dados.tema ? (posesPorTema.get(dados.tema) ?? []).map(n => `${n}: ${cenas.get(`${dados.tema}|${n}`) ?? ''}${poseLevaIdade(dados.tema!, n) ? ' [leva o NÚMERO da idade]' : ''}`).join('\n') : undefined,
            pagamento: (c.pais && c.pais !== 'BR') || (precos[0]?.moeda ?? 'BRL') !== 'BRL'
              ? `cartão de crédito/débito pelo link seguro da Hotmart, em ${precos[0]?.moeda ?? 'USD'} (a Hotmart converte para a moeda dela); a confirmação chega sozinha`
              : 'Pix (Brasil) para a chave do estúdio, conferido pelo comprovante',
            ajusteUsado: await (async () => {
              if (!pedidoId) return false
              const { data: pd } = await admin.from('estudio_pedidos').select('ajustes_usados, ajuste_em').eq('id', pedidoId).maybeSingle().then(r => r, () => ({ data: null }))
              return !!pd && ((pd.ajustes_usados ?? 0) >= 1 || !!pd.ajuste_em)
            })(),
          }, msg.texto)
          for (const u of out.usos) await usou('resposta', u, out.estruturada?.intencao)
          const resp = out.resposta
          // Nunca "vou confirmar com a equipe": a Ana responde com o que existe e segue a venda.
          // (O lembrete da etapa sai logo depois, pela própria máquina.)
          if (resp.tipo === 'confirmar_equipe') {
            await enviarTexto(renderTexto('resposta_segura', idioma, vars(), sob.textos))
            await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: 'ia_resposta_bloqueada', detalhe: { motivo: resp.motivo, mensagem: msg.texto.slice(0, 300) } }).then(() => {}, () => {})
          } else if (resp.tipo === 'texto') { await enviarTexto(resp.texto); if (/\?\s*\S{0,3}\s*$/.test(resp.texto.trim())) iaPerguntou = true }
          else if (resp.tipo === 'humano') { await enviarTexto(renderTexto('humano', idioma, vars(), sob.textos)); await passarParaHumano('reclamação, reembolso ou pediu para falar com uma pessoa') }
          else {
            // Não entendeu: pede de outro jeito e repete a pergunta da etapa (nunca para a conversa).
            entendeu = false
            naoEntendeu++
            await enviarTexto(renderTexto('nao_entendi', idioma, vars(), sob.textos))
          }
          break
        }
        case 'humano':
          await passarParaHumano(a.motivo, /idade/.test(a.motivo))
          break
      }
    } catch (err) {
      console.error(`[estudio/ana] ação ${a.t} falhou:`, String(err).slice(0, 300))
    }
  }

  const agora = new Date().toISOString()
  if (falou) dados.aguardando_desde = agora
  // A cliente respondeu: o ciclo de retomadas recomeça (sem lembrar das antigas).
  dados.retomadas = undefined
  // "Depois te falo": a 1ª retomada só depois do tempo pedido (não 10 min).
  if (dados.adiar_retomada_min) {
    dados.aguardando_desde = new Date(Date.now() + (dados.adiar_retomada_min - 10) * 60e3).toISOString()
    dados.adiar_retomada_min = undefined
  }
  await admin.from('estudio_contatos').update({
    etapa, dados, nao_entendeu: entendeu ? 0 : naoEntendeu, cobrancas: 0,
    ...(falou ? { ultima_ana_em: agora } : {}),
  }).eq('id', c.id)
  return etapa
}

/** Rodada das cobranças (cron a cada 5 min). Devolve quantas saíram. */
export async function rodadaDeCobrancas(admin: SupabaseClient, agora: Date = new Date()): Promise<number> {
  const { data: contatos } = await admin.from('estudio_contatos')
    .select('id, tenant_id, wa_id, nome, idioma, pais, etapa, dados, modo, cobrancas, janela_ate, ultima_cliente_em')
    .eq('modo', 'ana').lt('cobrancas', 3).gt('janela_ate', agora.toISOString()).limit(200)
  let enviadas = 0
  const conexoes = new Map<string, Conexao | null>()
  for (const c of contatos ?? []) {
    const d = (c.dados ?? {}) as Dados
    const chave = cobrancaDevida({
      etapa: (c.etapa as Etapa) || 'inicio', modo: c.modo, cobrancas: c.cobrancas, janela_ate: c.janela_ate,
      aguardando_desde: d.aguardando_desde ?? null, ultima_cliente_em: c.ultima_cliente_em, tema: d.tema, previa_feita: d.previa_feita, aguardando_previa: d.aguardando_previa,
    }, agora)
    if (!chave) continue
    if (!conexoes.has(c.tenant_id)) {
      const { data: cfg } = await admin.from('estudio_config').select('tenant_id, phone_number_id, access_token, whatsapp_avisos, ativo').eq('tenant_id', c.tenant_id).maybeSingle()
      conexoes.set(c.tenant_id, cfg?.ativo && cfg.access_token ? cfg as Conexao : null)
    }
    const con = conexoes.get(c.tenant_id)
    if (!con) continue
    const { textos } = await sobrescritas(admin, c.tenant_id)
    // A retomada fala do ponto onde a conversa parou (catálogo, pagamento, prévia…).
    const idioma = idiomaDaAna(c.idioma)
    const plano = mensagensDaRetomada(chave, (c.etapa as Etapa) || 'inicio', d, { semPrevia: c.pais === 'ES' })
    const v = {
      nome: d.nome ?? c.nome ?? '', link: linkDoCatalogo(APP_URL(), d.tema, idioma), pagar: d.hotmart_link ?? d.pagar_link ?? '',
      valor: d.valor_cents !== undefined ? dinheiro(d.valor_cents, d.moeda ?? 'BRL', idioma) : '',
    }
    let s: { ok: boolean; wamid?: string | null; erro?: string } = { ok: false }
    let t = ''
    for (const k of plano.chaves) {
      const texto = renderTexto(k, idioma, v, textos)
      if (!texto.trim()) continue
      const r = await enviarTextoCloud(con, c.wa_id, texto)
      await admin.from('estudio_mensagens').insert({
        tenant_id: c.tenant_id, contato_id: c.id, wamid: r.ok ? r.wamid ?? null : null, direcao: 'saida', autor: 'ana',
        tipo: 'texto', texto, status_entrega: r.ok ? 'sent' : 'failed', erro: r.ok ? null : (r.erro ?? '').slice(0, 300),
      })
      if (!t) { s = r; t = texto }
      if (!r.ok) break
    }
    if (plano.oferecePrevia) d.previa_oferecida = true
    d.retomadas = [...new Set([...(d.retomadas ?? []), ...plano.chaves])]
    if (plano.encerrar) d.pausa_longa = false
    await admin.from('estudio_contatos').update({
      cobrancas: chave === 'cobranca_3' || plano.encerrar ? 3 : c.cobrancas + 1, dados: d, ultima_ana_em: agora.toISOString(), ultima_msg: t.slice(0, 120),
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
  const { data: c } = await admin.from('estudio_contatos').select('id, tenant_id, wa_id, nome, idioma, dados, etapa').eq('id', contatoId).eq('tenant_id', tenantId).maybeSingle()
  if (!c) return { ok: false, erro: 'Conversa não encontrada.' }
  // Pagou (Hotmart / aprovado na tela) enquanto ainda manda fotos e poses: a conversa
  // continua na coleta; o pedido entra na fila quando ela completar.
  if (chave === 'pago_ok' && ['fotos_poses', 'idade_prefs'].includes(String(c.etapa))) { chave = 'pago_ok_coleta'; novaEtapa = undefined }
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

/**
 * Copia a melhor foto de rosto e a de corpo (pela classificação, nunca pela
 * ordem de chegada) para <pedido>/rosto.jpg e corpo.jpg (nomes do producao.py).
 * Nunca o mesmo arquivo nos dois: só com a de corpo, o rosto é RECORTADO dela
 * e o pedido fica marcado "rosto recortado — pedir close".
 */
export async function aplicarEscolhaDeFotos(admin: SupabaseClient, pedidoId: string, lista: FotoRecebida[], dados?: Dados): Promise<void> {
  const { data: ped } = await admin.from('estudio_pedidos').select('rosto_origem, corpo_origem').eq('id', pedidoId).maybeSingle()
  const e = escolherFotos(lista, { rosto: (ped as { rosto_origem?: string } | null)?.rosto_origem ?? null, corpo: (ped as { corpo_origem?: string } | null)?.corpo_origem ?? null })
  const destinos = caminhosDaCliente(pedidoId)
  const salvarJpeg = async (origem: string, destino: string, recorte?: FotoRecebida['rosto_caixa'] | 'topo' | null) => {
    const { data: arq } = await admin.storage.from(BUCKET_CLIENTES).download(origem)
    if (!arq) return false
    let bytes: Buffer = Buffer.from(await arq.arrayBuffer())
    try {
      const sharp = (await import('sharp')).default
      let img = sharp(bytes).rotate()
      if (recorte) {
        const meta = await img.metadata()
        const cx = caixaDoRecorte(meta.width ?? 1000, meta.height ?? 1000, recorte)
        img = sharp(await img.toBuffer()).extract(cx)
      }
      bytes = await img.jpeg({ quality: 92 }).toBuffer()
    } catch (err) { console.warn('[estudio/ana] conversão da foto (segue o original):', String(err).slice(0, 160)) }
    await admin.storage.from(BUCKET_CLIENTES).upload(destino, bytes, { contentType: 'image/jpeg', upsert: true })
    return true
  }
  const upd: Record<string, unknown> = { fotos_recebidas: lista }
  if (e.corpo && await salvarJpeg(e.corpo, destinos.corpo)) { upd.foto_corpo_path = destinos.corpo; upd.corpo_origem = e.corpo }
  if (e.rosto && await salvarJpeg(e.rosto.path, destinos.rosto, e.rosto.recorte)) { upd.foto_rosto_path = destinos.rosto; upd.rosto_origem = e.rosto.path }
  upd.rosto_recortado = e.rosto_recortado
  if (e.cabelo) upd.cabelo = e.cabelo
  if (dados && e.cabelo && !dados.cabelo) dados.cabelo = e.cabelo
  const { error } = await admin.from('estudio_pedidos').update(upd).eq('id', pedidoId)
  if (error && /fotos_recebidas|rosto_origem|corpo_origem|rosto_recortado|column/i.test(error.message)) {
    await admin.from('estudio_pedidos').update({ ...(upd.foto_rosto_path ? { foto_rosto_path: upd.foto_rosto_path } : {}), ...(upd.foto_corpo_path ? { foto_corpo_path: upd.foto_corpo_path } : {}) }).eq('id', pedidoId)
  }
}

/**
 * A produção viu que falta foto: em vez de avisar o Luís, a Ana pede para a
 * CLIENTE e abre a etapa certa — a foto que chegar completa o mesmo pedido
 * (prévia: `previa_fotos`; pacote: `fotos_poses`). Devolve false se não deu
 * (conversa com humano, sem número, etc.), e aí o aviso ao Luís continua.
 */
export async function pedirFotoQueFalta(admin: SupabaseClient, pedidoId: string, falta: string[]): Promise<boolean> {
  const fotos = falta.filter(f => /foto/.test(f))
  const { data: p } = await admin.from('estudio_pedidos').select('tenant_id, contato_id, tipo, poses, tema_slug').eq('id', pedidoId).maybeSingle()
  if (!p?.contato_id) return false
  // Prévia sem a pose: a Ana pede a pose para a cliente (e não avisa o Luís).
  if (p.tipo === 'previa' && !fotos.length && falta.includes('poses')) {
    const { data: c0 } = await admin.from('estudio_contatos').select('modo, etapa, dados, idioma, pedido_atual_id').eq('id', p.contato_id).maybeSingle()
    if (!c0 || c0.modo === 'humano') return false
    const d0 = (c0.dados ?? {}) as Dados
    if (c0.etapa !== 'previa_fotos') { d0.etapa_antes_previa = (c0.etapa as Etapa) || 'pacote'; d0.poses_antes_previa = d0.poses ?? []; d0.pedido_antes_previa = c0.pedido_atual_id ?? null }
    d0.poses = []; d0.tem_rosto = true; d0.tem_corpo = true; d0.previa_feita = false; d0.aguardando_previa = false
    await admin.from('estudio_contatos').update({ dados: d0, pedido_atual_id: pedidoId, etapa: 'previa_fotos' }).eq('id', p.contato_id)
    const idioma0 = idiomaDaAna(c0.idioma)
    const r0 = await falarComCliente(admin, p.tenant_id, p.contato_id, 'previa_pede_pose', undefined, { link: linkDoCatalogo(APP_URL(), p.tema_slug, idioma0) })
    return r0.ok
  }
  if (!fotos.length || fotos.length !== falta.filter(f => f !== 'idade').length) return false
  const { data: c } = await admin.from('estudio_contatos').select('modo, etapa, dados, idioma, pedido_atual_id').eq('id', p.contato_id).maybeSingle()
  if (!c || c.modo === 'humano') return false
  const idioma = idiomaDaAna(c.idioma)
  const F: Record<IdiomaAna, { rosto: string; corpo: string }> = {
    'pt-BR': { rosto: '1 foto do seu ROSTO, de frente e nítida (tipo selfie)', corpo: '1 foto de corpo inteiro' },
    'pt-PT': { rosto: '1 foto do teu ROSTO, de frente e nítida (tipo selfie)', corpo: '1 foto de corpo inteiro' },
    es: { rosto: '1 foto de tu CARA, de frente y nítida (tipo selfie)', corpo: '1 foto de cuerpo entero' },
    'es-ES': { rosto: '1 foto de tu CARA, de frente y nítida (tipo selfie)', corpo: '1 foto de cuerpo entero' },
    en: { rosto: '1 FACE photo, from the front and sharp (like a selfie)', corpo: '1 full-body photo' },
  }
  const faltam = fotos.map(f => (/rosto/.test(f) ? F[idioma].rosto : F[idioma].corpo)).join(' + ')
  const d = (c.dados ?? {}) as Dados
  const previa = p.tipo === 'previa'
  const etapaAtual = (c.etapa as Etapa) || 'pacote'
  if (previa && etapaAtual !== 'previa_fotos') {
    d.etapa_antes_previa = etapaAtual; d.poses_antes_previa = d.poses ?? []; d.pedido_antes_previa = c.pedido_atual_id ?? null
    d.poses = (p.poses ?? []) as string[]; d.previa_feita = false
  }
  d.tem_rosto = !fotos.some(f => /rosto/.test(f)); d.tem_corpo = !fotos.some(f => /corpo/.test(f))
  await admin.from('estudio_contatos').update({ dados: d, pedido_atual_id: pedidoId, ...(previa ? { etapa: 'previa_fotos' } : { etapa: 'fotos_poses' }) }).eq('id', p.contato_id)
  const r = await falarComCliente(admin, p.tenant_id, p.contato_id, 'falta_foto_cliente', undefined, { faltam })
  return r.ok
}

/**
 * Cron (5 min): quem já PAGOU e parou de responder as preferências há 10 min
 * → a Ana completa com o padrão, avisa a cliente e manda para a produção.
 */
export async function fecharPreferenciasVencidas(admin: SupabaseClient, agora: Date = new Date()): Promise<number> {
  const { data: contatos } = await admin.from('estudio_contatos')
    .select('id, tenant_id, etapa, dados, modo, pedido_atual_id').eq('modo', 'ana').eq('etapa', 'idade_prefs').not('pedido_atual_id', 'is', null).limit(100)
  let fechados = 0
  for (const c of contatos ?? []) {
    try {
      const { data: p } = await admin.from('estudio_pedidos').select('status').eq('id', c.pedido_atual_id).maybeSingle()
      const pago = ['pago', 'aguardando_fotos'].includes(String(p?.status ?? ''))
      const r = preferenciasVencidas((c.dados ?? {}) as Dados, 'idade_prefs', pago, agora.getTime())
      if (!r) continue
      await admin.from('estudio_pedidos').update({ preferencias: r.dados.preferencias ?? null, cores_acessorios: r.dados.cores ?? null }).eq('id', c.pedido_atual_id)
      await admin.from('estudio_contatos').update({ dados: r.dados, etapa: 'pago' }).eq('id', c.id)
      await falarComCliente(admin, c.tenant_id, c.id, 'prefs_padrao', 'pago').catch(() => {})
      const { entrarNaFila } = await import('../producao-servidor')
      await entrarNaFila(admin, c.pedido_atual_id!, { forcar: true, semIdade: true })
      await admin.from('estudio_eventos').insert({ pedido_id: c.pedido_atual_id, tipo: 'preferencias_padrao', detalhe: { padrao: r.padrao } })
      fechados++
    } catch (err) { console.error('[estudio/ana] preferências vencidas:', String(err).slice(0, 200)) }
  }
  return fechados
}

