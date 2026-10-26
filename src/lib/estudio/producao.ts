// ============================================================================
// Estúdio IA — Fase 5: regras da fila de produção, entrega e ajuste (puro)
// ----------------------------------------------------------------------------
// Contrato com o producao.py do PC (seção 8) — NÃO mudar sem avisar o Luís:
//   aguardando_producao | ajuste  → o PC lista
//   --baixar  → 'gerando'          (lê estudio-clientes/<id>/rosto.jpg e corpo.jpg)
//   --subir   → estudio-entregas/<id>/<numero>.png + estudio_entregas 'aprovada'
//               + pedido 'pronto'  → o FunilPro ENTREGA SOZINHO
// ============================================================================

export const PRECO_FOTO_GEMINI_USD = 0.14      // referência da seção 8b (2K)
export const PRECO_NOTA_ROSTO_USD = 0.001
export const NOTA_MINIMA_ROSTO = 7
export const MARCA_PREVIA = 'PRÉVIA · Studio Fotografico'

export interface PedidoFila {
  id: string; tipo?: string | null; status: string; cliente_nome?: string | null; wa_id?: string | null
  tema_slug?: string | null; pacote_qtd?: number | null; poses?: string[] | null; idade?: number | null
  foto_rosto_path?: string | null; foto_corpo_path?: string | null
  /** Casal (2 pessoas): fotos e nome da pessoa 2. */
  foto_rosto2_path?: string | null; foto_corpo2_path?: string | null; pessoa2_nome?: string | null
}

/** Pago + 2 fotos (casal: 4) + todas as poses + idade (prévia: sem idade) → pode entrar na fila. */
export function faltaParaFila(p: PedidoFila, opts: { semIdade?: boolean; casal?: boolean } = {}): string[] {
  const falta: string[] = []
  const casal = opts.casal ?? p.tema_slug === 'casal'
  const quem1 = casal ? ` (${p.cliente_nome ?? 'pessoa 1'})` : ''
  if (!p.foto_rosto_path) falta.push(`foto do rosto${quem1}`)
  if (!p.foto_corpo_path) falta.push(`foto de corpo inteiro${quem1}`)
  if (casal) {
    const quem2 = ` (${p.pessoa2_nome ?? 'pessoa 2'})`
    if (!p.foto_rosto2_path) falta.push(`foto do rosto${quem2}`)
    if (!p.foto_corpo2_path) falta.push(`foto de corpo inteiro${quem2}`)
  }
  const qtd = p.tipo === 'previa' ? 1 : (p.pacote_qtd ?? 0)
  if ((p.poses ?? []).length < qtd || qtd === 0) falta.push('poses')
  if (!p.idade && p.tipo !== 'previa' && !opts.semIdade) falta.push('idade')   // a prévia só pede 1 foto + 1 pose
  return falta
}

export function mensagemNovoPedido(p: PedidoFila, nomeTema: string, motor: string): string {
  const qtd = p.tipo === 'previa' ? 1 : p.pacote_qtd
  const cab = p.tipo === 'previa' ? '✨ Nova PRÉVIA grátis para produzir' : '💰 Novo pedido para produzir'
  const linhas = [
    cab,
    `👤 ${p.cliente_nome ?? (p.wa_id ? `+${p.wa_id}` : 'cliente')}`,
    `🎨 ${nomeTema} · 📸 ${qtd} foto${qtd === 1 ? '' : 's'} · poses ${(p.poses ?? []).join(', ')}`,
    ...(p.tema_slug === 'casal' || p.pessoa2_nome ? [`💑 Casal: ${p.cliente_nome ?? 'pessoa 1'} + ${p.pessoa2_nome ?? 'pessoa 2'} (4 fotos: rosto/corpo + rosto2/corpo2)`] : []),
    `🆔 ${p.id}`,
  ]
  linhas.push(motor === 'api_gemini'
    ? '🤖 Motor: API automática — vou gerar sozinho e entregar.'
    : `Abra o Claude Code e peça: gera o pedido ${p.id}`)
  return linhas.join('\n')
}

/** Passou do prazo na fila/gerando e ainda não avisou? */
export function atrasado(p: { status: string; fila_em?: string | null; pago_em?: string | null; atraso_avisado_em?: string | null }, prazoMin: number, agora = new Date()): boolean {
  if (!['aguardando_producao', 'gerando'].includes(p.status) || p.atraso_avisado_em) return false
  const desde = p.fila_em ?? p.pago_em
  if (!desde) return false
  return agora.getTime() - new Date(desde).getTime() > prazoMin * 60e3
}

/** "8", "8.5", "Nota: 9/10" → número 0–10; ilegível → null. */
export function lerNota(texto: string): number | null {
  const m = (texto ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 10 ? n : null
}

/** Das tentativas (nota null = não deu para conferir), fica a de maior nota. */
export function melhorTentativa<T extends { nota: number | null }>(t: T[]): T {
  return [...t].sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1))[0]
}

/** Precisa gerar de novo? (nota < 7; sem nota não força nova chamada) */
export function precisaRefazer(nota: number | null): boolean {
  return nota !== null && nota < NOTA_MINIMA_ROSTO
}

/** Poses que ainda faltam gerar (no ajuste, só as pedidas). */
export function posesPendentes(p: { poses?: string[] | null; status: string; ajuste_poses?: string[] | null }, entregues: { pose_numero: string; status: string; criado_em?: string }[], ajusteDesde?: string | null): string[] {
  const alvo = p.status === 'ajuste' && (p.ajuste_poses ?? []).length ? (p.ajuste_poses ?? []) : (p.poses ?? [])
  return alvo.filter(n => !entregues.some(e => e.pose_numero === n && e.status !== 'refazer'
    && (!ajusteDesde || p.status !== 'ajuste' || (e.criado_em ?? '') > ajusteDesde)))
}

/** Desconto do upsell em centavos, arredondado para baixo no centavo. */
export function valorComDesconto(cents: number, pct: number): number {
  return Math.floor(cents * (100 - Math.max(0, Math.min(90, pct))) / 100)
}

/** Ajuste grátis ainda vale? (até 24 h da entrega e dentro do limite) */
export function podeAjustar(p: { entregue_em?: string | null; ajustes_usados?: number | null }, ajustesGratis: number, agora = new Date()): boolean {
  if (!p.entregue_em) return false
  if ((p.ajustes_usados ?? 0) >= ajustesGratis) return false
  return agora.getTime() - new Date(p.entregue_em).getTime() <= 24 * 3600e3
}

/** SVG da marca d'água da prévia (faixas diagonais repetidas + selo embaixo). */
// Letras desenhadas como traços (grade 6×10): o servidor (Vercel) não tem
// fontes, e <text> em SVG sai INVISÍVEL lá — era a prévia "sem marca d'água".
const GLIFOS: Record<string, string[]> = {
  A: ['0,10 3,0 6,10', '1,6.5 5,6.5'], B: ['0,10 0,0 4,0 5.5,1.5 5.5,3.5 4,5 0,5', '4,5 6,6.5 6,8.5 4.5,10 0,10'],
  C: ['6,1 4.5,0 1.5,0 0,1.5 0,8.5 1.5,10 4.5,10 6,9'], D: ['0,0 0,10 3.5,10 6,7.5 6,2.5 3.5,0 0,0'],
  E: ['6,0 0,0 0,10 6,10', '0,5 4.5,5'], F: ['6,0 0,0 0,10', '0,5 4.5,5'],
  G: ['6,1 4.5,0 1.5,0 0,1.5 0,8.5 1.5,10 4.5,10 6,8.5 6,5.5 3.5,5.5'], I: ['3,0 3,10', '1,0 5,0', '1,10 5,10'],
  O: ['1.5,0 4.5,0 6,1.5 6,8.5 4.5,10 1.5,10 0,8.5 0,1.5 1.5,0'], P: ['0,10 0,0 4.5,0 6,1.5 6,3.5 4.5,5 0,5'],
  R: ['0,10 0,0 4.5,0 6,1.5 6,3.5 4.5,5 0,5', '3,5 6,10'], S: ['6,1 4.5,0 1.5,0 0,1.5 0,3.5 1.5,5 4.5,5 6,6.5 6,8.5 4.5,10 1.5,10 0,9'],
  T: ['0,0 6,0', '3,0 3,10'], U: ['0,0 0,8.5 1.5,10 4.5,10 6,8.5 6,0'], V: ['0,0 3,10 6,0'],
  'É': ['6,0 0,0 0,10 6,10', '0,5 4.5,5', '2.5,-1.5 4.5,-3'], '·': ['2.6,5 3.4,5'], ' ': [],
}
function sem(acento: string) { return acento.normalize('NFD').replace(/[\u0300-\u036f]/g, '') }

/** Texto em traços SVG (sem fonte). Letra desconhecida vira espaço. */
export function textoEmTracos(texto: string, x: number, y: number, alt: number): { d: string; largura: number } {
  const k = alt / 10, passo = 8.5 * k
  let d = ''; let cx = x
  for (const ch0 of texto.toUpperCase()) {
    const ch = GLIFOS[ch0] ? ch0 : GLIFOS[sem(ch0)] ? sem(ch0) : ' '
    for (const linha of GLIFOS[ch]) {
      const pts = linha.split(' ').map(par => { const [a, b] = par.split(',').map(Number); return `${(cx + a * k).toFixed(1)} ${(y + b * k).toFixed(1)}` })
      d += `M${pts.join(' L')} `
    }
    cx += passo
  }
  return { d, largura: cx - x }
}

export function svgMarcaDagua(w: number, h: number, texto = MARCA_PREVIA): string {
  const alt = Math.round(Math.max(w, h) / 28)
  const sw = Math.max(2, alt / 6.5)
  const faixa = textoEmTracos(`${texto}   ·   `, 0, 0, alt).largura
  const linhas: string[] = []
  for (let y = -h; y < h * 2; y += alt * 6) {
    for (let x = -w; x < w * 2; x += faixa) linhas.push(textoEmTracos(`${texto}   ·   `, x, y, alt).d)
  }
  const larg1 = textoEmTracos(texto, 0, 0, 10).largura / 10
  const altR = Math.min(alt, (w * 0.9) / larg1)
  const rodape = textoEmTracos(texto, 0, 0, altR)
  const rx = (w - rodape.largura) / 2, ry = h - alt * 1.2 - altR / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<!-- ${texto.replace(/-->/g, '')} -->` +
    `<g transform="rotate(-30 ${w / 2} ${h / 2})" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${linhas.join('')}" stroke="black" stroke-opacity="0.07" stroke-width="${(sw * 1.6).toFixed(1)}"/>` +
    `<path d="${linhas.join('')}" stroke="white" stroke-opacity="0.22" stroke-width="${(sw * 0.8).toFixed(1)}"/></g>` +
    `<rect x="0" y="${h - alt * 2.4}" width="${w}" height="${alt * 2.4}" fill="black" fill-opacity="0.32"/>` +
    `<path d="${textoEmTracos(texto, rx, ry, altR).d}" fill="none" stroke="white" stroke-width="${Math.max(2, altR / 6.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}
