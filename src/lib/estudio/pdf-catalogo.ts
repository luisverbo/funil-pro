// ============================================================================
// Estúdio IA — PDF do catálogo no idioma do atendimento (sem dependência nova)
// ----------------------------------------------------------------------------
// montarPdfCatalogo (puro): A4, título + instrução na 1ª página, 4 poses por
// página (foto 4:5 + número grande), rodapé "geradas por IA" em toda página.
// Fotos entram como JPEG (DCTDecode); texto em Helvetica (WinAnsi: acentos,
// ñ, ç ok — emoji sai). gerarPdfCatalogo (servidor) busca as fotos do tema,
// reduz com sharp e grava em estudio-catalogo/<tema>/catalogo-<tema>-<id>.pdf.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IdiomaAna } from './ana/textos'
import { BUCKET_CATALOGO, urlPublicaDoCatalogo } from './catalogo'
import { caminhoPdfIdioma, textosDoCatalogo, tituloDoTema } from './catalogo-idiomas'

export interface JpegPdf { bytes: Uint8Array; largura: number; altura: number }
export interface PaginaPose { numero: string; foto: JpegPdf | null }

const A4 = { w: 595, h: 842 }
const FOTO = { w: 220, h: 275 }
const ESPACO = 30

const CP1252: Record<string, number> = { '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85, '€': 0x80 }

/** Texto → bytes WinAnsi (parênteses e barra escapados; o que não cabe some). */
export function textoPdf(t: string): number[] {
  const out: number[] = []
  for (const ch of t.normalize('NFC')) {
    const c = CP1252[ch] ?? (ch.codePointAt(0)! < 256 ? ch.codePointAt(0)! : -1)
    if (c < 0) continue
    if (c === 0x28 || c === 0x29 || c === 0x5c) out.push(0x5c)
    out.push(c)
  }
  return out
}

/** Quebra em linhas pelo tamanho aproximado da Helvetica. */
export function quebrarLinhas(t: string, tamanho: number, larguraMax: number): string[] {
  const max = Math.max(10, Math.floor(larguraMax / (tamanho * 0.5)))
  const linhas: string[] = []; let atual = ''
  for (const p of t.split(/\s+/).filter(Boolean)) {
    if ((atual ? atual.length + 1 : 0) + p.length > max && atual) { linhas.push(atual); atual = p } else atual = atual ? `${atual} ${p}` : p
  }
  if (atual) linhas.push(atual)
  return linhas
}

const sem = (t: string) => t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim()

export function montarPdfCatalogo(o: { titulo: string; instrucao: string; rodape: string; poses: PaginaPose[] }): Uint8Array {
  const partes: Uint8Array[] = []; const offsets: number[] = []; let tam = 0
  const enc = new TextEncoder()
  const add = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; partes.push(u); tam += u.length }
  const obj = (n: number, corpo: (string | Uint8Array)[]) => { offsets[n] = tam; add(`${n} 0 obj\n`); corpo.forEach(add); add('\nendobj\n') }
  const linhaTexto = (fonte: 'F1' | 'F2', tamanho: number, x: number, y: number, t: string) =>
    new Uint8Array([...enc.encode(`BT /${fonte} ${tamanho} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (`), ...textoPdf(sem(t)), ...enc.encode(') Tj ET\n')])
  const centro = (t: string, tamanho: number, fator = 0.5) => (A4.w - sem(t).length * tamanho * fator) / 2

  const porPagina = 4
  const paginas: PaginaPose[][] = []
  for (let i = 0; i < Math.max(o.poses.length, 1); i += porPagina) paginas.push(o.poses.slice(i, i + porPagina))

  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  // 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold; depois página/conteúdo/imagens.
  let prox = 5
  const idsPaginas: number[] = []
  const corpoPaginas: { pag: number; cont: number; imgs: { id: number; foto: JpegPdf }[]; poses: PaginaPose[] }[] = []
  for (const ps of paginas) {
    const pag = prox++, cont = prox++
    const imgs = ps.filter(p => p.foto).map(p => ({ id: prox++, foto: p.foto! }))
    idsPaginas.push(pag); corpoPaginas.push({ pag, cont, imgs, poses: ps })
  }
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  obj(2, [`<< /Type /Pages /Kids [${idsPaginas.map(i => `${i} 0 R`).join(' ')}] /Count ${idsPaginas.length} >>`])
  obj(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'])
  obj(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'])

  corpoPaginas.forEach((p, idx) => {
    const cmds: Uint8Array[] = [enc.encode(`0.04 0.04 0.04 rg 0 0 ${A4.w} ${A4.h} re f\n`)]
    let topo = A4.h - 50
    if (idx === 0) {
      cmds.push(enc.encode('0.99 0.83 0.30 rg\n'), linhaTexto('F2', 24, centro(o.titulo, 24, 0.56), topo - 10, o.titulo))
      cmds.push(enc.encode('0.75 0.75 0.75 rg\n'))
      quebrarLinhas(sem(o.instrucao), 11, A4.w - 120).forEach((l, i) => cmds.push(linhaTexto('F1', 11, centro(l, 11), topo - 36 - i * 15, l)))
      topo -= 80
    }
    const x0 = (A4.w - 2 * FOTO.w - ESPACO) / 2
    let img = 0
    p.poses.forEach((pose, i) => {
      const col = i % 2, lin = Math.floor(i / 2)
      const x = x0 + col * (FOTO.w + ESPACO), y = topo - (lin + 1) * (FOTO.h + 44) + 44
      if (pose.foto) {
        const { id } = p.imgs[img++]
        cmds.push(enc.encode(`q ${FOTO.w} 0 0 ${FOTO.h} ${x.toFixed(1)} ${y.toFixed(1)} cm /Im${id} Do Q\n`))
      } else cmds.push(enc.encode(`0.15 0.15 0.15 rg ${x.toFixed(1)} ${y.toFixed(1)} ${FOTO.w} ${FOTO.h} re f\n`))
      cmds.push(enc.encode('1 1 1 rg\n'), linhaTexto('F2', 26, x + FOTO.w / 2 - pose.numero.length * 26 * 0.278, y - 32, pose.numero))
    })
    cmds.push(enc.encode('0.5 0.5 0.5 rg\n'))
    quebrarLinhas(sem(o.rodape), 8, A4.w - 80).forEach((l, i) => cmds.push(linhaTexto('F1', 8, centro(l, 8), 26 - i * 10, l)))
    const conteudo = new Uint8Array(cmds.reduce((s, c) => s + c.length, 0)); let k = 0
    for (const c of cmds) { conteudo.set(c, k); k += c.length }
    const xobj = p.imgs.map(i => `/Im${i.id} ${i.id} 0 R`).join(' ')
    obj(p.pag, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${p.cont} 0 R >>`])
    obj(p.cont, [`<< /Length ${conteudo.length} >>\nstream\n`, conteudo, '\nendstream'])
    for (const i of p.imgs) {
      obj(i.id, [`<< /Type /XObject /Subtype /Image /Width ${i.foto.largura} /Height ${i.foto.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${i.foto.bytes.length} >>\nstream\n`, i.foto.bytes, '\nendstream'])
    }
  })

  const total = prox
  const xref = tam
  add(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let n = 1; n < total; n++) add(`${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`)
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(tam); let k = 0
  for (const p of partes) { out.set(p, k); k += p.length }
  return out
}

/** Gera (ou refaz) o PDF do tema no idioma e devolve a URL pública. */
export async function gerarPdfCatalogo(admin: SupabaseClient, tema: string, idioma: IdiomaAna): Promise<{ url: string | null; erro?: string }> {
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const { data: t } = await admin.from('estudio_temas').select('slug, nome').eq('slug', tema).maybeSingle()
  if (!t) return { url: null, erro: 'Tema não encontrado.' }
  const { data: poses } = await admin.from('estudio_poses').select('numero, foto_exemplo_path').eq('tema_slug', tema).eq('ativa', true).limit(1000)
  const lista = (poses ?? []).sort((a, b) => Number(a.numero) - Number(b.numero))
  if (!lista.some(p => p.foto_exemplo_path)) return { url: null, erro: 'O tema ainda não tem fotos de exemplo.' }
  const sharp = (await import('sharp')).default
  const fotos = await Promise.all(lista.map(async (p): Promise<PaginaPose> => {
    const url = urlPublicaDoCatalogo(p.foto_exemplo_path, supa)
    if (!url) return { numero: p.numero, foto: null }
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return { numero: p.numero, foto: null }
      const { data, info } = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(660, 825, { fit: 'cover' }).flatten({ background: '#000' }).jpeg({ quality: 72 }).toBuffer({ resolveWithObject: true })
      return { numero: p.numero, foto: { bytes: new Uint8Array(data), largura: info.width, altura: info.height } }
    } catch { return { numero: p.numero, foto: null } }
  }))
  const tx = textosDoCatalogo(idioma)
  const pdf = montarPdfCatalogo({ titulo: tx.pdfTitulo(tituloDoTema(tema, t.nome, idioma)), instrucao: tx.pdfInstrucao, rodape: tx.rodape, poses: fotos })
  const caminho = caminhoPdfIdioma(tema, idioma)
  const { error } = await admin.storage.from(BUCKET_CATALOGO).upload(caminho, pdf, { contentType: 'application/pdf', upsert: true, cacheControl: '300' })
  if (error) return { url: null, erro: error.message }
  return { url: urlPublicaDoCatalogo(caminho, supa) }
}
