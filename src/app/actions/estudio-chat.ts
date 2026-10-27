'use server'
// ============================================================================
// Estúdio IA — chat do estúdio (Fase 2b)
// ----------------------------------------------------------------------------
// Chamadas pela tela via /api/estudio (despachante de lista fechada). Sessão +
// tenant conferidos em toda função. Token e links da Meta nunca vão para a
// tela: mídia sai só como link assinado curto do NOSSO Storage.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarTextoCloud, enviarMidiaCloud, enviarTemplateCloud, listarTemplatesCloud } from '@/lib/whatsapp-cloud'
import { BUCKET_CLIENTES, BUCKET_ENTREGAS } from '@/lib/estudio/catalogo'
import { dentroDaJanela, limparErro } from '@/lib/estudio/whatsapp'
import { caminhoMidiaDaConversa, extensaoDoMime, tipoCloudDoMime, tipoDoHistorico, LIMITE_ENVIO, previaDaMensagem } from '@/lib/estudio/chat'
import { linkAssinado } from '@/lib/estudio/midia'
import { enviarVoz } from '@/lib/estudio/envio'
import { textoDosTempos } from '@/lib/estudio/tempos'

async function getTenantId(): Promise<string> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
    } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

function aviso(msg: string): string {
  return /column|schema cache|does not exist/i.test(msg)
    ? 'Falta rodar o SQL do chat (20261026000000_estudio_ia_chat.sql) no Supabase.'
    : msg
}

async function conexao(tenantId: string) {
  const { data } = await createAdminClient().from('estudio_config')
    .select('phone_number_id, access_token, waba_id').eq('tenant_id', tenantId).maybeSingle()
  if (!data?.phone_number_id || !data.access_token) throw new Error('Conecte o número do estúdio em Configurações.')
  return { phone_number_id: String(data.phone_number_id), access_token: String(data.access_token), waba_id: (data.waba_id as string | null) ?? null }
}

async function contatoDoTenant(tenantId: string, contatoId: string) {
  const { data } = await createAdminClient().from('estudio_contatos').select('*')
    .eq('id', contatoId).eq('tenant_id', tenantId).maybeSingle()
  if (!data) throw new Error('Conversa não encontrada.')
  return data as Record<string, unknown> & { id: string; wa_id: string; janela_ate: string | null }
}

// ── Lista ───────────────────────────────────────────────────────────────────

export interface ContatoChat {
  id: string; wa_id: string; nome: string | null; pais: string | null; idioma: string | null
  origem: string; ultima_msg: string | null; ultima_msg_em: string; nao_lidas: number
  modo: string; humano_fixo: boolean; precisa_humano: boolean; etapa: string | null
  janela_ate: string | null; pedido_status: string | null
  encerrada_em?: string | null; encerrada_motivo?: string | null
}

export async function listarConversasChat(busca?: string): Promise<{ contatos: ContatoChat[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    let q = admin.from('estudio_contatos').select('*').eq('tenant_id', tenantId).order('ultima_msg_em', { ascending: false }).limit(200)
    const b = (busca ?? '').trim()
    if (b) q = q.or(`nome.ilike.%${b.replace(/[%,()]/g, '')}%,wa_id.ilike.%${b.replace(/\D/g, '') || '§'}%`)
    const { data, error } = await q
    if (error) return { contatos: [], error: aviso(error.message) }
    const ids = (data ?? []).map(c => c.id)
    const { data: pedidos } = ids.length
      ? await admin.from('estudio_pedidos').select('contato_id, status, criado_em').in('contato_id', ids).order('criado_em', { ascending: false })
      : { data: [] as { contato_id: string; status: string }[] }
    const ultimoPedido = new Map<string, string>()
    for (const p of pedidos ?? []) if (!ultimoPedido.has(p.contato_id)) ultimoPedido.set(p.contato_id, p.status)
    return {
      contatos: (data ?? []).map(c => ({
        id: c.id, wa_id: c.wa_id, nome: c.nome ?? null, pais: c.pais ?? null, idioma: c.idioma ?? null,
        origem: c.origem, ultima_msg: c.ultima_msg ?? null, ultima_msg_em: c.ultima_msg_em,
        nao_lidas: Number(c.nao_lidas ?? 0), modo: c.modo ?? 'ana', humano_fixo: !!c.humano_fixo,
        precisa_humano: !!c.precisa_humano, etapa: c.etapa ?? null, janela_ate: c.janela_ate ?? null,
        pedido_status: ultimoPedido.get(c.id) ?? null,
        encerrada_em: c.encerrada_em ?? null, encerrada_motivo: c.encerrada_motivo ?? null,
      })),
    }
  } catch (err) { return { contatos: [], error: String(err) } }
}

// ── Conversa ────────────────────────────────────────────────────────────────

export interface MensagemChat {
  id: string; direcao: string; autor: string; tipo: string; texto: string | null
  media_url: string | null; media_mime: string | null; media_nome: string | null
  status_entrega: string | null; erro: string | null; criado_em: string
  /** Mensagem da cliente: quanto a Ana levou para responder (por parte). */
  tempos?: string | null
}
export interface PedidoChat { id: string; status: string; tema_slug: string | null; pacote_qtd: number | null; valor_cents: number | null; poses: string[]; criado_em: string; entregas: { id: string; pose_numero: string; status: string; url: string | null }[] }

export async function abrirConversaChat(contatoId: string, marcarLida = true): Promise<{
  contato?: ContatoChat & { notas: string | null; humano_desde: string | null }
  mensagens: MensagemChat[]; pedidos: PedidoChat[]; error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const c = await contatoDoTenant(tenantId, contatoId)
    const { data: msgs, error } = await admin.from('estudio_mensagens').select('*')
      .eq('contato_id', contatoId).order('criado_em', { ascending: false }).limit(200)
    if (error) return { mensagens: [], pedidos: [], error: aviso(error.message) }
    const mensagens: MensagemChat[] = []
    for (const m of [...(msgs ?? [])].reverse()) {
      mensagens.push({
        id: m.id, direcao: m.direcao, autor: m.autor ?? (m.direcao === 'saida' ? 'ana' : 'cliente'), tipo: m.tipo, texto: m.texto,
        media_url: m.media_path ? await linkAssinado(admin, m.media_path, 600) : null,
        media_mime: m.media_mime ?? null, media_nome: m.media_nome ?? null,
        status_entrega: m.status_entrega ?? null, erro: m.erro ?? null, criado_em: m.criado_em,
        tempos: m.tempos ? textoDosTempos(m.tempos) : null,
      })
    }
    const { data: peds } = await admin.from('estudio_pedidos')
      .select('id, status, tema_slug, pacote_qtd, valor_cents, poses, criado_em').eq('contato_id', contatoId).eq('tenant_id', tenantId)
      .order('criado_em', { ascending: false }).limit(10)
    const pedidos: PedidoChat[] = []
    for (const p of peds ?? []) {
      const { data: ents } = await admin.from('estudio_entregas').select('id, pose_numero, status, foto_path').eq('pedido_id', p.id).order('pose_numero')
      const entregas = []
      for (const e of ents ?? []) {
        const { data: u } = await admin.storage.from(BUCKET_ENTREGAS).createSignedUrl(e.foto_path, 600)
        entregas.push({ id: e.id, pose_numero: e.pose_numero, status: e.status, url: u?.signedUrl ?? null })
      }
      pedidos.push({ ...p, poses: p.poses ?? [], entregas })
    }
    if (marcarLida && Number(c.nao_lidas ?? 0) > 0) await admin.from('estudio_contatos').update({ nao_lidas: 0 }).eq('id', contatoId)
    return {
      contato: {
        id: c.id, wa_id: c.wa_id, nome: (c.nome as string) ?? null, pais: (c.pais as string) ?? null, idioma: (c.idioma as string) ?? null,
        origem: String(c.origem), ultima_msg: (c.ultima_msg as string) ?? null, ultima_msg_em: String(c.ultima_msg_em),
        nao_lidas: 0, modo: (c.modo as string) ?? 'ana', humano_fixo: !!c.humano_fixo, precisa_humano: !!c.precisa_humano,
        etapa: (c.etapa as string) ?? null, janela_ate: c.janela_ate, pedido_status: pedidos[0]?.status ?? null,
        notas: (c.notas as string) ?? null, humano_desde: (c.humano_desde as string) ?? null,
        encerrada_em: (c.encerrada_em as string) ?? null, encerrada_motivo: (c.encerrada_motivo as string) ?? null,
      },
      mensagens, pedidos,
    }
  } catch (err) { return { mensagens: [], pedidos: [], error: String(err) } }
}

// ── Envio ───────────────────────────────────────────────────────────────────

type Envio = { success: boolean; error?: string; foraDaJanela?: boolean }

/** Registra a saída manual e pausa a Ana para este contato. */
async function registrarSaida(tenantId: string, contatoId: string, r: { ok: boolean; wamid?: string | null; erro?: string }, dados: {
  tipo: string; texto: string | null; media_path?: string | null; media_mime?: string | null; media_nome?: string | null
}) {
  const admin = createAdminClient()
  await admin.from('estudio_mensagens').insert({
    tenant_id: tenantId, contato_id: contatoId, wamid: r.ok ? r.wamid ?? null : null, direcao: 'saida', autor: 'luis',
    tipo: dados.tipo, texto: dados.texto, media_path: dados.media_path ?? null, media_mime: dados.media_mime ?? null,
    media_nome: dados.media_nome ?? null, status_entrega: r.ok ? 'sent' : 'failed', erro: r.ok ? null : limparErro(r.erro ?? 'falhou'),
  })
  if (r.ok) {
    await admin.from('estudio_contatos').update({
      modo: 'humano', humano_desde: new Date().toISOString(), precisa_humano: false,
      ultima_msg: previaDaMensagem(dados.tipo, dados.texto), ultima_msg_em: new Date().toISOString(),
    }).eq('id', contatoId)
  }
}

function checarJanela(c: { janela_ate: string | null }): Envio | null {
  return dentroDaJanela(c.janela_ate) ? null
    : { success: false, foraDaJanela: true, error: 'A janela de 24h da Meta fechou: só dá para mandar um modelo aprovado.' }
}

export async function enviarTextoChat(contatoId: string, texto: string): Promise<Envio> {
  try {
    const tenantId = await getTenantId()
    const t = String(texto ?? '').trim()
    if (!t) return { success: false, error: 'Mensagem vazia.' }
    if (t.length > 4096) return { success: false, error: 'Mensagem longa demais (máx. 4096).' }
    const c = await contatoDoTenant(tenantId, contatoId)
    const fora = checarJanela(c); if (fora) return fora
    const r = await enviarTextoCloud(await conexao(tenantId), c.wa_id, t)
    await registrarSaida(tenantId, contatoId, r, { tipo: 'texto', texto: t })
    return r.ok ? { success: true } : { success: false, error: limparErro(r.erro) }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}

/** Link assinado para o navegador subir o arquivo DIRETO no Storage (sem passar do limite da Vercel). */
export async function urlDeUploadChat(contatoId: string, nome: string, mime: string, tamanho: number): Promise<{ path?: string; token?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    await contatoDoTenant(tenantId, contatoId)
    const tipo = tipoCloudDoMime(mime)
    if (tamanho > LIMITE_ENVIO[tipo]) return { error: `Arquivo grande demais para o WhatsApp (${Math.round(tamanho / 1048576)} MB; limite ${Math.round(LIMITE_ENVIO[tipo] / 1048576)} MB).` }
    const ext = extensaoDoMime(mime, nome)
    const path = caminhoMidiaDaConversa(contatoId, `saida-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
    const { data, error } = await createAdminClient().storage.from(BUCKET_CLIENTES).createSignedUploadUrl(path)
    if (error || !data) return { error: error?.message ?? 'não deu para preparar o envio' }
    return { path, token: data.token }
  } catch (err) { return { error: String(err) } }
}

/** Depois do upload: manda pela Meta por link assinado de 1 dia. */
export async function enviarMidiaChat(contatoId: string, path: string, mime: string, legenda?: string, nome?: string): Promise<Envio> {
  try {
    const tenantId = await getTenantId()
    if (!path.startsWith(`conversas/${contatoId}/`)) return { success: false, error: 'Arquivo inválido.' }
    const c = await contatoDoTenant(tenantId, contatoId)
    const fora = checarJanela(c); if (fora) return fora
    const admin = createAdminClient()
    const link = await linkAssinado(admin, path, 24 * 3600)
    if (!link) return { success: false, error: 'Arquivo não encontrado no Storage.' }
    const tipo = tipoCloudDoMime(mime)
    const conta = await conexao(tenantId)
    // Áudio OGG/Opus (gravado no painel) vai como MENSAGEM DE VOZ: media_id + voice:true.
    const r = tipo === 'audio' && /ogg|opus/i.test(mime)
      ? await enviarVoz(admin, tenantId, conta, c.wa_id, {
          chave: `${BUCKET_CLIENTES}/${path}`, link,
          baixar: async () => { const { data } = await admin.storage.from(BUCKET_CLIENTES).download(path); return data ? { bytes: new Uint8Array(await data.arrayBuffer()), mime: 'audio/ogg' } : null },
        })
      : await enviarMidiaCloud(conta, c.wa_id, tipo, link, legenda?.trim() || undefined, tipo === 'document' ? (nome || 'arquivo') : undefined)
    await registrarSaida(tenantId, contatoId, r, { tipo: tipoDoHistorico(tipo), texto: legenda?.trim() || null, media_path: path, media_mime: mime, media_nome: nome ?? null })
    return r.ok ? { success: true } : { success: false, error: limparErro(r.erro ?? "falhou") }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}

/** "Enviar fotos do pedido": escolhidas em estudio_entregas; marca como enviada. */
export async function enviarFotosDoPedidoChat(contatoId: string, entregaIds: string[]): Promise<{ enviadas: number; error?: string; foraDaJanela?: boolean }> {
  try {
    const tenantId = await getTenantId()
    const c = await contatoDoTenant(tenantId, contatoId)
    const fora = checarJanela(c); if (fora) return { enviadas: 0, error: fora.error, foraDaJanela: true }
    const admin = createAdminClient()
    const ids = (entregaIds ?? []).slice(0, 30)
    const { data: ents } = await admin.from('estudio_entregas').select('id, pedido_id, pose_numero, foto_path').in('id', ids)
    const { data: meus } = await admin.from('estudio_pedidos').select('id, tipo').eq('tenant_id', tenantId).eq('contato_id', contatoId)
    const permitidos = new Set((meus ?? []).map(p => p.id))
    const previas = new Set((meus ?? []).filter(p => p.tipo === 'previa').map(p => p.id))
    const con = await conexao(tenantId)
    let enviadas = 0
    for (const e of (ents ?? []).filter(x => permitidos.has(x.pedido_id))) {
      let link: string | null = null
      if (previas.has(e.pedido_id)) {
        // Prévia mandada à mão também sai COM a marca d'água (igual à entrega automática).
        const { data: arq } = await admin.storage.from(BUCKET_ENTREGAS).download(e.foto_path)
        if (!arq) continue
        const { prepararEnvio } = await import('@/lib/estudio/producao-servidor')
        const jpg = await prepararEnvio(Buffer.from(await arq.arrayBuffer()), true)
        const destino = `${e.pedido_id}/envio/${e.pose_numero}.jpg`
        await admin.storage.from(BUCKET_CLIENTES).upload(destino, jpg, { contentType: 'image/jpeg', upsert: true })
        link = (await admin.storage.from(BUCKET_CLIENTES).createSignedUrl(destino, 24 * 3600)).data?.signedUrl ?? null
      } else link = (await admin.storage.from(BUCKET_ENTREGAS).createSignedUrl(e.foto_path, 24 * 3600)).data?.signedUrl ?? null
      const u = link ? { signedUrl: link } : null
      if (!u?.signedUrl) continue
      const r = await enviarMidiaCloud(con, c.wa_id, 'image', u.signedUrl)
      await registrarSaida(tenantId, contatoId, r, { tipo: 'imagem', texto: `Foto ${e.pose_numero}`, media_mime: 'image/png' })
      if (r.ok) { enviadas++; await admin.from('estudio_entregas').update({ status: 'enviada' }).eq('id', e.id) }
    }
    return { enviadas }
  } catch (err) { return { enviadas: 0, error: String(err) } }
}

// ── Fora da janela: modelos aprovados ───────────────────────────────────────

export async function listarModelosChat(): Promise<{ modelos: { name: string; language: string; corpo: string }[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const con = await conexao(tenantId)
    if (!con.waba_id) return { modelos: [], error: 'Preencha o WABA id em Configurações.' }
    const r = await listarTemplatesCloud(con.waba_id, con.access_token)
    if (!r.ok) return { modelos: [], error: limparErro(r.erro) }
    // Só os aprovados e sem variáveis ({{1}}) — os com variáveis entram depois.
    return { modelos: r.templates.filter(t => t.status === 'APPROVED' && !/\{\{\d+\}\}/.test(t.corpo)).map(t => ({ name: t.name, language: t.language, corpo: t.corpo })) }
  } catch (err) { return { modelos: [], error: String(err) } }
}

export async function enviarModeloChat(contatoId: string, nome: string, idioma: string): Promise<Envio> {
  try {
    const tenantId = await getTenantId()
    const c = await contatoDoTenant(tenantId, contatoId)
    const r = await enviarTemplateCloud(await conexao(tenantId), c.wa_id, String(nome), String(idioma || 'pt_BR'))
    await registrarSaida(tenantId, contatoId, r, { tipo: 'texto', texto: `📋 Modelo: ${nome}` })
    return r.ok ? { success: true } : { success: false, error: limparErro(r.erro) }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}

// ── Atendimento ─────────────────────────────────────────────────────────────

/** Assumir: Luís atende e a Ana NÃO volta sozinha. Devolver: Ana volta já. */
export async function definirAtendimentoChat(contatoId: string, quem: 'luis' | 'ana' | 'encerrar'): Promise<{ success: boolean; error?: string; retomou?: 'respondeu' | 'nada' }> {
  try {
    const tenantId = await getTenantId()
    await contatoDoTenant(tenantId, contatoId)
    const { encerrarConversa, limparEncerramento } = await import('@/lib/estudio/encerrar')
    // Encerrar: Ana para de vez nesta conversa (sem push, sem IA) até reabrir.
    if (quem === 'encerrar') { await encerrarConversa(createAdminClient(), contatoId, 'manual'); return { success: true } }
    await limparEncerramento(createAdminClient(), contatoId)
    const upd = quem === 'luis'
      ? { modo: 'humano', humano_fixo: true, humano_desde: new Date().toISOString(), precisa_humano: false }
      : { modo: 'ana', humano_fixo: false, humano_desde: null, precisa_humano: false }
    const admin = createAdminClient()
    const { error } = await admin.from('estudio_contatos').update(upd).eq('id', contatoId).eq('tenant_id', tenantId)
    if (error) return { success: false, error: aviso(error.message) }
    // Devolveu: a Ana lê onde parou e continua sozinha (responde a cliente ou faz a próxima pergunta).
    if (quem === 'ana') {
      const { retomarConversa } = await import('@/lib/estudio/ana/executor')
      const r = await retomarConversa(admin, tenantId, contatoId).catch(e => { console.error('[estudio] retomar:', String(e).slice(0, 200)); return 'nada' as const })
      return { success: true, retomou: r }
    }
    return { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/** O que a tela precisa para o Luís criar pedido/prévia nesta conversa. */
export async function opcoesPedidoManualChat(contatoId: string): Promise<{
  temas: { slug: string; nome: string }[]; precos: { pacote_qtd: number; valor_cents: number; moeda: string }[]
  tema: string | null; poses: string[]; pacote_qtd: number | null; tem_rosto: boolean; tem_corpo: boolean; previa_feita: boolean; error?: string
}> {
  const vazio = { temas: [], precos: [], tema: null, poses: [], pacote_qtd: null, tem_rosto: false, tem_corpo: false, previa_feita: false }
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const c = await contatoDoTenant(tenantId, contatoId) as unknown as { pais: string | null }
    const { data: ct } = await admin.from('estudio_contatos').select('dados, fotos_recebidas, pais').eq('id', contatoId).single()
    const [{ data: temas }, { precosDoPais }, { resumoDasFotos }] = await Promise.all([
      admin.from('estudio_temas').select('slug, nome').eq('tenant_id', tenantId).eq('ativo', true).order('ordem'),
      import('@/lib/estudio/ana/executor'), import('@/lib/estudio/ana/fotos'),
    ])
    const precos = await precosDoPais(admin, tenantId, ct?.pais ?? c.pais ?? null)
    const d = (ct?.dados ?? {}) as { tema?: string; poses?: string[]; pacote_qtd?: number; previa_feita?: boolean }
    const f = resumoDasFotos(Array.isArray(ct?.fotos_recebidas) ? ct!.fotos_recebidas : [])
    return { temas: temas ?? [], precos, tema: d.tema ?? null, poses: d.poses ?? [], pacote_qtd: d.pacote_qtd ?? null, tem_rosto: f.tem_rosto, tem_corpo: f.tem_corpo, previa_feita: !!d.previa_feita }
  } catch (err) { return { ...vazio, error: String(err) } }
}

/** Luís cria o pedido (ou a prévia) da cliente pela conversa. */
export async function criarPedidoManualChat(contatoId: string, v: { tipo: 'previa' | 'pacote'; tema: string; poses: string[]; pacote_qtd?: number | null; pago?: boolean }): Promise<{ success: boolean; pedido_id?: string; falta?: string[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    await contatoDoTenant(tenantId, contatoId)
    if (!['previa', 'pacote'].includes(v?.tipo)) return { success: false, error: 'Tipo inválido.' }
    const { criarPedidoPeloLuis } = await import('@/lib/estudio/ana/executor')
    const r = await criarPedidoPeloLuis(createAdminClient(), tenantId, contatoId, {
      tipo: v.tipo, tema: String(v.tema ?? ''), poses: Array.isArray(v.poses) ? v.poses.map(String).slice(0, 30) : [], pacote_qtd: v.pacote_qtd ?? null, pago: !!v.pago,
    })
    return r.error ? { success: false, ...r } : { success: true, ...r }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function salvarNotasChat(contatoId: string, notas: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { error } = await createAdminClient().from('estudio_contatos')
      .update({ notas: String(notas ?? '').slice(0, 5000) || null }).eq('id', contatoId).eq('tenant_id', tenantId)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}
