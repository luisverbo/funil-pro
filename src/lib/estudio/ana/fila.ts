// ============================================================================
// Estúdio IA — fila da conversa: UMA execução por vez + fotos agrupadas
// ----------------------------------------------------------------------------
// O WhatsApp entrega cada foto num webhook separado, quase ao mesmo tempo.
// Antes, cada webhook rodava a Ana sozinho: as duas achavam "só 1 foto",
// respondiam a mesma frase 2× e a 2ª sobrescrevia o rosto.jpg.
// Agora: toda mensagem é gravada (processada_em = null) e só quem pega a
// trava da conversa (estudio_travar_conversa) processa — em ordem. Com mídia
// chegando, espera 8 s sem mídia nova e trata as fotos JUNTAS.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_CLIENTES } from '../catalogo'
import { Cronometro } from '../tempos'
import { rodarAna, falarComCliente, type Conexao, type MensagemDaCliente } from './executor'

export const ESPERA_MIDIA_MS = 8000
const TRAVA_S = 120
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Pendente {
  id: string; wamid: string | null; tipo: string; texto: string | null; media_path: string | null; media_mime: string | null; criado_em: string
}

const IMAGEM_DOC = /^image\/(jpe?g|png|webp|heic|heif|gif)$/i
export const ehFoto = (p: Pick<Pendente, 'tipo' | 'media_mime'>) => p.tipo === 'imagem' || (p.tipo === 'documento' && IMAGEM_DOC.test((p.media_mime ?? '').split(';')[0]))
export const ehMidia = (p: Pick<Pendente, 'tipo' | 'media_mime'>) => ehFoto(p) || ['video', 'documento', 'figurinha'].includes(p.tipo)

/** Agrupa: fotos seguidas viram UM lote; o resto vai uma por uma, em ordem. */
export function agrupar<T extends Pick<Pendente, 'tipo' | 'media_mime'>>(lista: T[]): T[][] {
  const grupos: T[][] = []
  for (const m of lista) {
    const ult = grupos[grupos.length - 1]
    if (ult && ehFoto(m) && ehFoto(ult[0])) ult.push(m)
    else grupos.push([m])
  }
  return grupos
}

/** Ainda chegando mídia? Espera até 8 s depois da última. */
export function esperaPorMidia(lista: Pick<Pendente, 'tipo' | 'media_mime' | 'criado_em'>[], agora = Date.now()): number {
  const ultima = lista.filter(ehMidia).map(m => new Date(m.criado_em).getTime()).sort((a, b) => b - a)[0]
  return ultima ? Math.max(0, ESPERA_MIDIA_MS - (agora - ultima)) : 0
}

async function heicParaJpeg(admin: SupabaseClient, path: string): Promise<string | null> {
  try {
    const { data } = await admin.storage.from(BUCKET_CLIENTES).download(path)
    if (!data) return null
    const sharp = (await import('sharp')).default
    const jpg = await sharp(Buffer.from(await data.arrayBuffer())).rotate().jpeg({ quality: 92 }).toBuffer()
    const novo = path.replace(/\.[a-z0-9]+$/i, '') + '.jpg'
    const { error } = await admin.storage.from(BUCKET_CLIENTES).upload(novo, jpg, { contentType: 'image/jpeg', upsert: true })
    return error ? null : novo
  } catch { return null }
}

async function transcrever(admin: SupabaseClient, p: Pendente): Promise<string | null> {
  if (!p.media_path || !process.env.OPENAI_API_KEY) return null
  try {
    const { data } = await admin.storage.from(BUCKET_CLIENTES).download(p.media_path)
    if (!data) return null
    const { transcribeAudio } = await import('@/lib/agents/transcribe')
    return await transcribeAudio(Buffer.from(await data.arrayBuffer()).toString('base64'), p.media_mime ?? 'audio/ogg')
  } catch { return null }
}

/**
 * Processa as mensagens pendentes da conversa. Quem não pegar a trava sai na
 * hora: a execução dona vê a mensagem nova (inclusive depois de soltar a trava).
 */
export async function processarConversa(admin: SupabaseClient, con: Conexao, contatoId: string, opts: { cronometro?: Cronometro; wamid?: string; primeira?: boolean }): Promise<void> {
  for (let volta = 0; volta < 4; volta++) {
    const { data: travou, error: eTrava } = await admin.rpc('estudio_travar_conversa', { p_contato: contatoId, p_segundos: TRAVA_S })
    const semTrava = !!eTrava   // SQL pendente: processa só a própria mensagem (comportamento antigo)
    if (!semTrava && !travou) return
    try {
      for (let rodada = 0; rodada < 12; rodada++) {
        let q = admin.from('estudio_mensagens').select('id, wamid, tipo, texto, media_path, media_mime, criado_em')
          .eq('contato_id', contatoId).eq('direcao', 'entrada').order('criado_em', { ascending: true }).limit(30)
        q = semTrava ? q.eq('wamid', opts.wamid ?? '-') : q.is('processada_em', null)
        const { data: pend } = await q
        const lista = (pend ?? []) as Pendente[]
        if (!lista.length) break
        // Foto/vídeo chegando: espera a próxima (até 8 s sem mídia nova).
        const espera = esperaPorMidia(lista)
        if (espera > 0 && rodada < 6) { await dormir(espera + 150); if (!semTrava) await admin.from('estudio_contatos').update({ processando_ate: new Date(Date.now() + TRAVA_S * 1000).toISOString() }).eq('id', contatoId); continue }

        const grupo = agrupar(lista)[0]
        const meu = grupo.some(g => g.wamid === opts.wamid)
        const crono = meu && opts.cronometro ? opts.cronometro : new Cronometro(new Date(grupo[0].criado_em).getTime())
        let msg: MensagemDaCliente
        if (ehFoto(grupo[0])) {
          const fotos: NonNullable<MensagemDaCliente['fotos']> = []
          for (const g of grupo) {
            if (!g.media_path) continue
            const mime = (g.media_mime ?? 'image/jpeg').split(';')[0]
            if (/hei[cf]/i.test(mime)) { const jpg = await heicParaJpeg(admin, g.media_path); if (jpg) fotos.push({ path: jpg, mime: 'image/jpeg', wamid: g.wamid }); continue }
            fotos.push({ path: g.media_path, mime, wamid: g.wamid })
          }
          const legenda = grupo.map(g => g.texto ?? '').filter(t => t && !t.startsWith('[')).join(' ')
          const ult = grupo[grupo.length - 1]
          msg = fotos.length
            ? { tipo: 'imagem', texto: legenda, media_path: fotos[fotos.length - 1].path, media_mime: fotos[fotos.length - 1].mime, wamid: ult.wamid, fotos, cronometro: crono }
            : { tipo: 'documento', texto: legenda, wamid: ult.wamid, cronometro: crono }
        } else {
          const g = grupo[0]
          let tipo = g.tipo, texto = g.texto ?? ''
          if (tipo === 'audio') {
            const t = await crono.medir('ia', () => transcrever(admin, g))
            if (t) { tipo = 'texto'; texto = t }
            else {
              await falarComCliente(admin, con.tenant_id, contatoId, 'audio_nao_ouvi')
              await marcar(admin, grupo.map(x => x.id), crono)
              continue
            }
          }
          msg = { tipo, texto, media_path: g.media_path, media_mime: g.media_mime, wamid: g.wamid, cronometro: crono }
        }
        try {
          await rodarAna(admin, con, contatoId, msg, !!opts.primeira && rodada === 0 && volta === 0)
        } finally {
          await marcar(admin, grupo.map(x => x.id), crono)
        }
        if (semTrava) break
      }
    } finally {
      if (!semTrava) await admin.from('estudio_contatos').update({ processando_ate: null }).eq('id', contatoId)
    }
    if (semTrava) return
    // Chegou algo enquanto a trava estava com a gente? Volta e processa.
    const { count } = await admin.from('estudio_mensagens').select('id', { count: 'exact', head: true })
      .eq('contato_id', contatoId).eq('direcao', 'entrada').is('processada_em', null)
    if (!count) return
  }
}

async function marcar(admin: SupabaseClient, ids: string[], crono: Cronometro) {
  const agora = new Date().toISOString()
  const tempos = crono.resumo()
  console.log('[estudio/tempos]', JSON.stringify(tempos))
  // Tempos ficam na 1ª mensagem do grupo (a que a cliente mandou primeiro).
  await admin.from('estudio_mensagens').update({ processada_em: agora, tempos }).eq('id', ids[0]).then(() => {}, () => {})
  if (ids.length > 1) await admin.from('estudio_mensagens').update({ processada_em: agora }).in('id', ids.slice(1)).then(() => {}, () => {})
}
