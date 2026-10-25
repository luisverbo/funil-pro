// ============================================================================
// Estúdio IA — Fase 5: fila de produção, motor por API, ENTREGA AUTOMÁTICA,
// ajuste grátis e aviso de atraso (servidor: banco + Storage + WhatsApp)
// ----------------------------------------------------------------------------
// Ponte com o PC (producao.py) — nomes da seção 4, sem mudança:
//   aguardando_producao/ajuste → (PC --baixar) gerando → (PC --subir) pronto
//   estudio-entregas/<pedido>/<numero>.png + estudio_entregas 'aprovada'
// Daqui: entrarNaFila (aviso ao Luís), gerarPorApi (Gemini), entregarPedido
// (fotos uma a uma + A6 + ajuste + oferta), registrarAjuste, atrasos.
// ============================================================================
// sharp é nativo: carregado SÓ quando há imagem para tratar. No topo, uma
// falha do binário no runtime derrubaria no import TODAS as rotas que tocam
// este módulo (painel /api/estudio e o cron) — foi o 500 de 29/10.
async function carregarSharp() { return (await import('sharp')).default }
import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarMidiaCloud, enviarTextoCloud } from '@/lib/whatsapp-cloud'
import { BUCKET_CLIENTES, BUCKET_ENTREGAS, preencherPrompt, urlPublicaDoCatalogo } from './catalogo'
import {
  faltaParaFila, mensagemNovoPedido, atrasado, melhorTentativa, precisaRefazer, posesPendentes,
  valorComDesconto, svgMarcaDagua, PRECO_FOTO_GEMINI_USD, PRECO_NOTA_ROSTO_USD, type PedidoFila,
} from './producao'
import { gerarFotoGemini, notaDoRosto, MODELO_IMAGEM, MODELO_NOTA, type Imagem } from './gemini'
import { avisarLuis, sobrescritas, precosDoPais, tabelaDePrecos, falarComCliente, type Conexao } from './ana/executor'
import { texto as renderTexto, nomeDoTema, dinheiro, idiomaDaAna } from './ana/textos'
import { dentroDaJanela } from './whatsapp'

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://funil-pro.vercel.app').replace(/\/+$/, '')

export interface ConfigProducao {
  con: Conexao | null
  motor: 'chatgpt_site' | 'api_gemini'
  aprovacao_manual: boolean
  gemini_key: string | null
  prazo_min: number
  ajustes_gratis: number
  upsell_qtd: number
  upsell_desconto_pct: number
}

export async function configProducao(admin: SupabaseClient, tenantId: string): Promise<ConfigProducao> {
  const { data } = await admin.from('estudio_config').select('*').eq('tenant_id', tenantId).maybeSingle()
  const c = (data ?? {}) as Record<string, unknown>
  return {
    con: c.access_token && c.phone_number_id ? { tenant_id: tenantId, phone_number_id: String(c.phone_number_id), access_token: String(c.access_token), whatsapp_avisos: (c.whatsapp_avisos as string) ?? null } : null,
    motor: c.motor === 'api_gemini' ? 'api_gemini' : 'chatgpt_site',
    aprovacao_manual: c.aprovacao_manual === true,
    // Chave do Gemini: segredo do servidor se existir; senão a colada em Configurações (só service role lê).
    gemini_key: process.env.GEMINI_API_KEY || (c.gemini_api_key as string) || null,
    prazo_min: Number(c.prazo_min ?? 60) || 60,
    ajustes_gratis: Number(c.ajustes_gratis ?? 1),
    upsell_qtd: Number(c.upsell_qtd ?? 5) || 5,
    upsell_desconto_pct: Number(c.upsell_desconto_pct ?? 20),
  }
}

async function avisar(admin: SupabaseClient, cfg: ConfigProducao, tenantId: string, msg: string, pedidoId?: string) {
  if (cfg.con) await avisarLuis(admin, cfg.con, msg, pedidoId ?? null)
}

async function evento(admin: SupabaseClient, pedidoId: string, tipo: string, detalhe: Record<string, unknown> = {}) {
  await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo, detalhe })
}

// ── 1) Entrar na fila ───────────────────────────────────────────────────────

/** Pedido pago (ou prévia) com fotos + poses + idade → 'aguardando_producao' + aviso ao Luís. */
/**
 * `forcar`: quem chama é a própria Ana ao terminar a conversa, o tempo das
 * preferências acabou ou o Luís mandou na mão. Sem `forcar`, um pagamento que
 * chega com a conversa ainda em andamento (fotos/poses/preferências) NÃO entra
 * na fila — senão a produção começa antes das respostas (maquiagem, decote…).
 */
export async function entrarNaFila(admin: SupabaseClient, pedidoId: string, opts: { forcar?: boolean; semIdade?: boolean } = {}): Promise<{ ok: boolean; falta?: string[] }> {
  const { data: p } = await admin.from('estudio_pedidos').select('*').eq('id', pedidoId).single()
  if (!p) return { ok: false, falta: ['pedido'] }
  const ped = p as PedidoFila & { tenant_id: string }
  const cid = (p as { contato_id?: string | null }).contato_id
  if (!opts.forcar && cid && ped.tipo !== 'previa') {
    const { data: ct } = await admin.from('estudio_contatos').select('etapa, modo').eq('id', cid).maybeSingle()
    if (ct && ct.modo !== 'humano' && ['fotos_poses', 'idade_prefs'].includes(String(ct.etapa))) return { ok: false, falta: ['conversa em andamento'] }
  }
  const falta = faltaParaFila(ped, { semIdade: opts.semIdade })
  const cfg = await configProducao(admin, ped.tenant_id)
  if (falta.length) {
    await admin.from('estudio_pedidos').update({ status: 'aguardando_fotos' }).eq('id', pedidoId)
    // Pagou antes de mandar tudo e a Ana ainda está pedindo fotos/poses: ela mesma
    // coloca na fila quando completar — não precisa avisar o Luís.
    const contatoId = (p as { contato_id?: string | null }).contato_id
    if (contatoId) {
      const { data: ct } = await admin.from('estudio_contatos').select('etapa, modo').eq('id', contatoId).maybeSingle()
      if (ct && ct.modo !== 'humano' && ['fotos_poses', 'idade_prefs'].includes(String(ct.etapa))) return { ok: false, falta }
    }
    // Falta FOTO: a Ana pede para a cliente (não para o Luís) e a foto que chegar completa este pedido.
    try {
      const { pedirFotoQueFalta } = await import('./ana/executor')
      if (await pedirFotoQueFalta(admin, pedidoId, falta)) return { ok: false, falta }
    } catch (err) { console.warn('[estudio/producao] pedir foto à cliente:', String(err).slice(0, 200)) }
    // Prévia é grátis: o aviso diz "PRÉVIA", nunca "pago".
    const oQue = ped.tipo === 'previa' ? `✨ PRÉVIA grátis de ${ped.cliente_nome ?? 'cliente'} (não é pedido pago)` : `💰 Pedido PAGO de ${ped.cliente_nome ?? 'cliente'}`
    await avisar(admin, cfg, ped.tenant_id, `⚠️ ${oQue} — falta: ${falta.join(', ')}.\n🆔 ${pedidoId}\nConfira a conversa: ${APP_URL()}/estudio-ia?aba=pedidos&p=${pedidoId}`)
    return { ok: false, falta }
  }
  const agora = new Date().toISOString()
  await admin.from('estudio_pedidos').update({
    status: 'aguardando_producao', fila_em: agora, motor: cfg.motor, api_iniciada_em: null, api_erro: null,
    atraso_avisado_em: null, entrega_iniciada_em: null, entrega_erro: null,
  }).eq('id', pedidoId)
  await evento(admin, pedidoId, 'na_fila', { motor: cfg.motor })
  await avisar(admin, cfg, ped.tenant_id, mensagemNovoPedido(ped, nomeDoTema(ped.tema_slug, 'pt-BR'), cfg.motor), pedidoId)
  return { ok: true }
}

// ── 2) Motor "API automática" (Gemini) ──────────────────────────────────────

async function baixar(admin: SupabaseClient, bucket: string, path: string): Promise<Imagem | null> {
  const { data } = await admin.storage.from(bucket).download(path)
  if (!data) return null
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || 'image/jpeg' }
}

async function usoGemini(admin: SupabaseClient, tenantId: string, contatoId: string | null, pedidoId: string, finalidade: string, modelo: string, custo: number) {
  const { error } = await admin.from('estudio_ia_uso').insert({ tenant_id: tenantId, contato_id: contatoId, pedido_id: pedidoId, finalidade, modelo, custo_usd: custo })
  if (error) console.warn('[estudio/producao] custo não gravado:', error.message)
}

/**
 * Gera as poses pendentes por API, uma por chamada, dentro do orçamento de
 * tempo (o resto fica para a próxima rodada). Erro numa pose: tenta 1 vez de
 * novo; se falhar, o pedido volta para o modo site e o Luís é avisado.
 */
export async function gerarPorApi(admin: SupabaseClient, pedidoId: string, orcamentoMs = 240_000, forcar = false): Promise<{ geradas: number; terminou: boolean; erro?: string }> {
  const inicio = Date.now()
  // Trava: só uma geração por pedido (6 min de validade).
  let q = admin.from('estudio_pedidos').update({ api_iniciada_em: new Date().toISOString(), status: 'gerando', motor: 'api_gemini', api_erro: null })
    .eq('id', pedidoId).in('status', ['aguardando_producao', 'ajuste', ...(forcar ? ['gerando'] : [])])
  if (!forcar) q = q.or(`api_iniciada_em.is.null,api_iniciada_em.lt.${new Date(Date.now() - 6 * 60e3).toISOString()}`)
  const { data: travado } = await q.select('*').maybeSingle()
  if (!travado) return { geradas: 0, terminou: false, erro: 'Pedido não está na fila (ou já está gerando).' }
  const p = travado as Record<string, unknown> & PedidoFila & { tenant_id: string; contato_id: string | null; observacoes_ajuste?: string | null; ajuste_em?: string | null; ajuste_poses?: string[]; status: string }
  const statusOriginal = (p.ajuste_em && (p.ajuste_poses ?? []).length) ? 'ajuste' : 'aguardando_producao'
  const cfg = await configProducao(admin, p.tenant_id)
  const falhar = async (msg: string) => {
    await admin.from('estudio_pedidos').update({ status: statusOriginal, motor: 'chatgpt_site', api_iniciada_em: null, api_erro: msg.slice(0, 500) }).eq('id', pedidoId)
    await evento(admin, pedidoId, 'api_falhou', { erro: msg })
    await avisar(admin, cfg, p.tenant_id, `❗ A API não conseguiu gerar o pedido ${pedidoId} (${msg.slice(0, 160)}).\nEle voltou para o modo site: abra o Claude Code e peça: gera o pedido ${pedidoId}`)
    return { geradas: 0, terminou: false, erro: msg }
  }
  if (!cfg.gemini_key) return falhar('sem chave do Gemini (Configurações → Motor de produção)')
  const [rosto, corpo] = await Promise.all([
    p.foto_rosto_path ? baixar(admin, BUCKET_CLIENTES, p.foto_rosto_path) : null,
    p.foto_corpo_path ? baixar(admin, BUCKET_CLIENTES, p.foto_corpo_path) : null,
  ])
  if (!rosto || !corpo) return falhar('fotos da cliente não encontradas no Storage')

  const { data: ents } = await admin.from('estudio_entregas').select('pose_numero, status, criado_em').eq('pedido_id', pedidoId)
  const pendentes = posesPendentes({ poses: p.poses, status: statusOriginal, ajuste_poses: p.ajuste_poses }, ents ?? [], p.ajuste_em ?? null)
  const { data: poses } = await admin.from('estudio_poses').select('numero, prompt_cliente, cena').eq('tenant_id', p.tenant_id).eq('tema_slug', p.tema_slug ?? '').in('numero', pendentes.length ? pendentes : ['--'])
  const ajuste = statusOriginal === 'ajuste' && p.observacoes_ajuste ? `\nAJUSTE PEDIDO PELA CLIENTE (obedeça): ${p.observacoes_ajuste}` : ''

  let geradas = 0
  for (const numero of pendentes) {
    if (Date.now() - inicio > orcamentoMs) break
    const pose = (poses ?? []).find(x => x.numero === numero)
    if (!pose) return falhar(`pose ${numero} não existe no tema ${p.tema_slug}`)
    const prompt = preencherPrompt(pose.prompt_cliente || pose.cena, { idade: p.idade, cabelo: (p.cabelo as string) ?? null, preferencias: (p.preferencias as string) ?? null }) + ajuste
    const tentativas: { img: Imagem; nota: number | null }[] = []
    const umaFoto = async () => {
      let img: Imagem
      try { img = await gerarFotoGemini(prompt, rosto, corpo, cfg.gemini_key!) }
      catch { img = await gerarFotoGemini(prompt, rosto, corpo, cfg.gemini_key!) }   // 1 nova tentativa
      await usoGemini(admin, p.tenant_id, p.contato_id, pedidoId, 'geracao', MODELO_IMAGEM, PRECO_FOTO_GEMINI_USD)
      const nota = await notaDoRosto(rosto, img, cfg.gemini_key!)
      await usoGemini(admin, p.tenant_id, p.contato_id, pedidoId, 'nota_rosto', MODELO_NOTA, PRECO_NOTA_ROSTO_USD)
      tentativas.push({ img, nota })
    }
    try {
      await umaFoto()
      if (precisaRefazer(tentativas[0].nota)) await umaFoto()   // nota < 7: mais 1 vez, fica a melhor
    } catch (err) {
      if (!tentativas.length) return falhar(`pose ${numero}: ${err instanceof Error ? err.message : String(err)}`)
    }
    const melhor = melhorTentativa(tentativas)
    const sharp = await carregarSharp()
    const png = await sharp(Buffer.from(melhor.img.bytes)).png().toBuffer()
    const caminho = `${pedidoId}/${numero}.png`
    const { error: eUp } = await admin.storage.from(BUCKET_ENTREGAS).upload(caminho, png, { contentType: 'image/png', upsert: true })
    if (eUp) return falhar(`salvar ${caminho}: ${eUp.message}`)
    await admin.from('estudio_entregas').update({ status: 'refazer' }).eq('pedido_id', pedidoId).eq('pose_numero', numero).neq('status', 'refazer')
    await admin.from('estudio_entregas').insert({
      pedido_id: pedidoId, pose_numero: numero, foto_path: caminho, motor: 'api_gemini', nota_rosto: melhor.nota,
      status: cfg.aprovacao_manual ? 'aguardando_aprovacao' : 'aprovada',
    })
    geradas++
  }

  const { data: ents2 } = await admin.from('estudio_entregas').select('pose_numero, status, criado_em').eq('pedido_id', pedidoId)
  const faltam = posesPendentes({ poses: p.poses, status: statusOriginal, ajuste_poses: p.ajuste_poses }, ents2 ?? [], p.ajuste_em ?? null)
  if (faltam.length) {
    // Orçamento de tempo acabou: libera a trava; a próxima rodada continua.
    await admin.from('estudio_pedidos').update({ status: statusOriginal, api_iniciada_em: null }).eq('id', pedidoId)
    return { geradas, terminou: false }
  }
  await admin.from('estudio_pedidos').update({ status: cfg.aprovacao_manual ? 'aguardando_aprovacao' : 'pronto', api_iniciada_em: null }).eq('id', pedidoId)
  await evento(admin, pedidoId, 'api_gerou', { geradas })
  if (cfg.aprovacao_manual) await avisar(admin, cfg, p.tenant_id, `👀 Pedido ${pedidoId} gerado pela API e esperando sua aprovação: ${APP_URL()}/estudio-ia?aba=pedidos&p=${pedidoId}`)
  return { geradas, terminou: true }
}

// ── 3) Entrega automática ───────────────────────────────────────────────────

/** JPEG para o WhatsApp (≤5 MB); na prévia, com marca d'água. */
export async function prepararEnvio(png: Buffer, previa: boolean): Promise<Buffer> {
  const sharp = await carregarSharp()
  let img = sharp(png).rotate().resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true })
  if (previa) {
    const meta = await img.clone().toBuffer({ resolveWithObject: true })
    img = sharp(meta.data).composite([{ input: Buffer.from(svgMarcaDagua(meta.info.width, meta.info.height)), top: 0, left: 0 }])
  }
  return img.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
}

async function registrarSaida(admin: SupabaseClient, tenantId: string, contatoId: string, r: { ok: boolean; wamid?: string | null; erro?: string }, tipo: string, texto: string | null, extras: Record<string, unknown> = {}) {
  await admin.from('estudio_mensagens').insert({
    tenant_id: tenantId, contato_id: contatoId, wamid: r.ok ? r.wamid ?? null : null, direcao: 'saida', autor: 'ana',
    tipo, texto, status_entrega: r.ok ? 'sent' : 'failed', erro: r.ok ? null : (r.erro ?? '').slice(0, 300), ...extras,
  })
}

/**
 * Pedido 'pronto' → envia SOZINHO: fotos uma a uma + áudio A6 + ajuste grátis
 * + oferta "+5 fotos com 20% off" → 'entregue' (entregue_em).
 * Trava em entrega_iniciada_em: nunca entrega duas vezes.
 */
export async function entregarPedido(admin: SupabaseClient, pedidoId: string): Promise<{ enviadas: number; erro?: string }> {
  const { data: trav } = await admin.from('estudio_pedidos').update({ entrega_iniciada_em: new Date().toISOString(), entrega_erro: null })
    .eq('id', pedidoId).eq('status', 'pronto').is('entrega_iniciada_em', null).select('*').maybeSingle()
  if (!trav) return { enviadas: 0, erro: 'Pedido não está pronto (ou a entrega já começou).' }
  const p = trav as Record<string, unknown> & { id: string; tenant_id: string; contato_id: string | null; wa_id: string | null; tipo: string | null; ajuste_em: string | null; ajuste_poses: string[] | null; valor_cents: number | null; moeda: string | null; entregue_em: string | null }
  const cfg = await configProducao(admin, p.tenant_id)
  const erro = async (msg: string) => {
    await admin.from('estudio_pedidos').update({ entrega_erro: msg.slice(0, 500) }).eq('id', pedidoId)
    await avisar(admin, cfg, p.tenant_id, `❗ Não consegui entregar o pedido ${pedidoId}: ${msg}\n${APP_URL()}/estudio-ia?aba=pedidos&p=${pedidoId}`)
    return { enviadas: 0, erro: msg }
  }
  if (!cfg.con) return erro('número do estúdio não conectado')
  const { data: c } = p.contato_id ? await admin.from('estudio_contatos').select('*').eq('id', p.contato_id).single() : { data: null }
  if (!c) return erro('conversa da cliente não encontrada')
  if (!dentroDaJanela(c.janela_ate)) return erro('a janela de 24 h da cliente fechou — mande um modelo aprovado pelo chat e use "Reenviar entrega"')

  const { data: ents } = await admin.from('estudio_entregas').select('id, pose_numero, foto_path').eq('pedido_id', pedidoId).eq('status', 'aprovada').is('enviada_em', null).order('pose_numero')
  // Ajuste: só as poses pedidas vão de novo (o PC pode ter subido o pacote inteiro).
  const soAjuste = p.ajuste_em && (p.ajuste_poses ?? []).length ? new Set(p.ajuste_poses) : null
  const agora = new Date().toISOString()
  const previa = p.tipo === 'previa'
  let enviadas = 0
  for (const e of ents ?? []) {
    if (soAjuste && !soAjuste.has(e.pose_numero)) { await admin.from('estudio_entregas').update({ status: 'enviada', enviada_em: agora }).eq('id', e.id); continue }
    const { data: arq } = await admin.storage.from(BUCKET_ENTREGAS).download(e.foto_path)
    if (!arq) continue
    const jpg = await prepararEnvio(Buffer.from(await arq.arrayBuffer()), previa)
    const envio = `${pedidoId}/envio/${e.pose_numero}.jpg`
    await admin.storage.from(BUCKET_CLIENTES).upload(envio, jpg, { contentType: 'image/jpeg', upsert: true })
    const { data: link } = await admin.storage.from(BUCKET_CLIENTES).createSignedUrl(envio, 3 * 86400)
    if (!link?.signedUrl) continue
    const legenda = previa ? '✨ Prévia' : `📸 ${e.pose_numero}`
    const s = await enviarMidiaCloud(cfg.con, c.wa_id, 'image', link.signedUrl, legenda)
    await registrarSaida(admin, p.tenant_id, c.id, s, 'imagem', legenda, { media_path: envio, media_mime: 'image/jpeg' })
    if (s.ok) { enviadas++; await admin.from('estudio_entregas').update({ status: 'enviada', enviada_em: new Date().toISOString(), envio_path: envio }).eq('id', e.id) }
  }
  if (enviadas === 0) return erro('nenhuma foto aprovada para enviar (ou o WhatsApp recusou)')

  // Fechamento da entrega: A6 + ajuste grátis + oferta (prévia: convite para fechar).
  const idioma = idiomaDaAna(c.idioma)
  const { textos, audios } = await sobrescritas(admin, p.tenant_id)
  const d = (c.dados ?? {}) as Record<string, unknown>
  const precos = await precosDoPais(admin, p.tenant_id, c.pais)
  const cheio = precos.find(x => x.pacote_qtd === cfg.upsell_qtd)
  const moeda = cheio?.moeda ?? p.moeda ?? 'BRL'
  const comDesc = cheio ? valorComDesconto(cheio.valor_cents, cfg.upsell_desconto_pct) : 0
  const vars = {
    nome: (d.nome as string) ?? c.nome ?? '', qtd: cfg.upsell_qtd, desconto: cfg.upsell_desconto_pct,
    valor: dinheiro(comDesc, moeda, idioma), valor_cheio: cheio ? dinheiro(cheio.valor_cents, moeda, idioma) : '', tabela: tabelaDePrecos(precos, idioma),
  }
  const texto = async (chave: string) => {
    const t = renderTexto(chave, idioma, vars, textos)
    if (!t.trim()) return
    const s = await enviarTextoCloud(cfg.con!, c.wa_id, t)
    await registrarSaida(admin, p.tenant_id, c.id, s, 'texto', t)
  }
  const a6 = audios.get(`a6|${idioma}`)
  const urlA6 = a6 ? urlPublicaDoCatalogo(a6, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : null
  if (urlA6 && !p.ajuste_em) {
    const s = await enviarMidiaCloud(cfg.con, c.wa_id, 'audio', urlA6)
    await registrarSaida(admin, p.tenant_id, c.id, s, 'audio', '[🎙 A6]', { media_mime: 'audio/ogg' })
  } else if (!p.ajuste_em) await texto('a6')
  if (previa) await texto('previa_entregue')
  else if (!p.ajuste_em) { await texto('entrega_ajuste'); if (cheio) await texto('upsell_oferta') }

  // Custo de IA do pedido (conversa + geração por API).
  const { data: usos } = await admin.from('estudio_ia_uso').select('custo_usd').eq('pedido_id', pedidoId)
  const custo = (usos ?? []).reduce((s, u) => s + Number(u.custo_usd ?? 0), 0)
  await admin.from('estudio_pedidos').update({ status: 'entregue', entregue_em: p.entregue_em && p.ajuste_em ? p.entregue_em : new Date().toISOString(), custo_ia_usd: Math.round(custo * 1e6) / 1e6, entrega_erro: null }).eq('id', pedidoId)
  await evento(admin, pedidoId, p.ajuste_em ? 'ajuste_entregue' : 'entregue', { fotos: enviadas })
  // Prévia: a conversa já voltou para a etapa de antes (a venda continua); só marca quando a Ana falou.
  // Pacote: etapa 'entregue' (ajuste grátis / +5 fotos), sem cobranças.
  await admin.from('estudio_contatos').update(previa
    ? { ultima_ana_em: new Date().toISOString(), dados: { ...d, aguardando_previa: false, aguardando_desde: new Date().toISOString() }, cobrancas: 0 }
    : { etapa: 'entregue', pedido_atual_id: pedidoId, dados: { ...d, upsell_oferecido: !!cheio, aguardando_desde: new Date().toISOString() }, cobrancas: 3, ultima_ana_em: new Date().toISOString() },
  ).eq('id', c.id)
  return { enviadas }
}

// ── 4) Ajuste grátis ────────────────────────────────────────────────────────

/** contar=false: REFAZER pedido pelo Luís (não gasta o ajuste grátis da cliente). */
export async function registrarAjuste(admin: SupabaseClient, pedidoId: string, poses: string[], obs: string, contar = true): Promise<{ ok: boolean; erro?: string }> {
  const { data: p } = await admin.from('estudio_pedidos').select('id, tenant_id, cliente_nome, wa_id, tema_slug, ajustes_usados, observacoes_ajuste, status').eq('id', pedidoId).single()
  if (!p) return { ok: false, erro: 'pedido não encontrado' }
  const cfg = await configProducao(admin, p.tenant_id)
  const agora = new Date().toISOString()
  const linha = `[${agora.slice(0, 16).replace('T', ' ')}]${contar ? '' : ' (Luís)'} fotos ${poses.join(', ')}: ${obs}`
  const { error } = await admin.from('estudio_pedidos').update({
    status: 'ajuste', ajustes_usados: (p.ajustes_usados ?? 0) + (contar ? 1 : 0), ajuste_em: agora, ajuste_poses: poses,
    observacoes_ajuste: [p.observacoes_ajuste, linha].filter(Boolean).join('\n').slice(-2000),
    fila_em: agora, motor: cfg.motor, entrega_iniciada_em: null, atraso_avisado_em: null, api_iniciada_em: null,
  }).eq('id', pedidoId)
  if (error) return { ok: false, erro: error.message }
  await evento(admin, pedidoId, contar ? 'ajuste_pedido' : 'refazer', { poses, obs })
  if (contar) await avisar(admin, cfg, p.tenant_id, `🔁 Ajuste grátis pedido por ${p.cliente_nome ?? `+${p.wa_id}`} · ${nomeDoTema(p.tema_slug, 'pt-BR')}\nFoto(s) ${poses.join(', ')}: "${obs.slice(0, 200)}"\n🆔 ${pedidoId}\n` +
    (cfg.motor === 'api_gemini' ? '🤖 A API vai refazer sozinha.' : `Abra o Claude Code e peça: gera o pedido ${pedidoId}`))
  return { ok: true }
}

/** "+5 fotos com desconto": novo pedido com as MESMAS fotos da cliente. */
export async function criarUpsell(admin: SupabaseClient, origemId: string, contatoId: string, qtd: number, valorCents: number, moeda: string): Promise<string | null> {
  const { data: o } = await admin.from('estudio_pedidos').select('*').eq('id', origemId).single()
  if (!o) return null
  const { data: novo } = await admin.from('estudio_pedidos').insert({
    tenant_id: o.tenant_id, contato_id: contatoId, cliente_nome: o.cliente_nome, wa_id: o.wa_id, tema_slug: o.tema_slug,
    pacote_qtd: qtd, valor_cents: valorCents, moeda, idioma: o.idioma, pais: o.pais, status: 'novo', tipo: 'pacote',
    idade: o.idade, cabelo: o.cabelo, preferencias: o.preferencias, upsell_de: origemId,
  }).select('id').single()
  if (!novo) return null
  for (const [campo, nome] of [['foto_rosto_path', 'rosto.jpg'], ['foto_corpo_path', 'corpo.jpg']] as const) {
    if (!o[campo]) continue
    const destino = `${novo.id}/${nome}`
    const { error } = await admin.storage.from(BUCKET_CLIENTES).copy(o[campo], destino)
    if (!error) await admin.from('estudio_pedidos').update({ [campo]: destino }).eq('id', novo.id)
  }
  await evento(admin, novo.id, 'pedido_criado', { tipo: 'upsell', de: origemId, pacote_qtd: qtd })
  return novo.id
}

// ── 5) Rodada do robô (cron a cada minuto) ──────────────────────────────────

export async function avisarAtrasos(admin: SupabaseClient, agora = new Date()): Promise<number> {
  const { data } = await admin.from('estudio_pedidos').select('id, tenant_id, contato_id, cliente_nome, wa_id, tema_slug, status, fila_em, pago_em, atraso_avisado_em')
    .in('status', ['aguardando_producao', 'gerando']).is('atraso_avisado_em', null).limit(100)
  let n = 0
  const cfgs = new Map<string, ConfigProducao>()
  for (const p of data ?? []) {
    if (!cfgs.has(p.tenant_id)) cfgs.set(p.tenant_id, await configProducao(admin, p.tenant_id))
    const cfg = cfgs.get(p.tenant_id)!
    if (!atrasado(p, cfg.prazo_min, agora)) continue
    await admin.from('estudio_pedidos').update({ atraso_avisado_em: agora.toISOString() }).eq('id', p.id)
    await avisar(admin, cfg, p.tenant_id, `⏰ Pedido ATRASADO (mais de ${cfg.prazo_min} min): ${p.cliente_nome ?? `+${p.wa_id}`} · ${nomeDoTema(p.tema_slug, 'pt-BR')}\n🆔 ${p.id}\nAbra o Claude Code e peça: gera o pedido ${p.id}`)
    if (p.contato_id) await falarComCliente(admin, p.tenant_id, p.contato_id, 'atraso')
    await evento(admin, p.id, 'atraso_avisado', {})
    n++
  }
  return n
}

export async function rodadaDeProducao(admin: SupabaseClient, orcamentoMs = 250_000): Promise<{ entregues: number; geradas: number; atrasos: number }> {
  const inicio = Date.now()
  let entregues = 0, geradas = 0
  const { data: prontos } = await admin.from('estudio_pedidos').select('id').eq('status', 'pronto').is('entrega_iniciada_em', null).order('fila_em').limit(20)
  for (const p of prontos ?? []) { const r = await entregarPedido(admin, p.id); if (r.enviadas) entregues++ }
  const atrasos = await avisarAtrasos(admin)
  const { data: api } = await admin.from('estudio_pedidos').select('id').in('status', ['aguardando_producao', 'ajuste']).eq('motor', 'api_gemini').order('fila_em').limit(5)
  for (const p of api ?? []) {
    const resto = orcamentoMs - (Date.now() - inicio)
    if (resto < 60_000) break
    const r = await gerarPorApi(admin, p.id, resto - 30_000)
    geradas += r.geradas
    if (r.terminou) { const e = await entregarPedido(admin, p.id); if (e.enviadas) entregues++ }
  }
  // Evento da Meta que falhou: reenvia (até 3×).
  await import('./anuncios-servidor').then(x => x.reenviarEventosPendentes(admin)).catch(err => console.warn('[estudio] reenvio Meta:', String(err).slice(0, 200)))
  return { entregues, geradas, atrasos }
}
