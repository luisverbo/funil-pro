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
}

/** Pago + 2 fotos + todas as poses + idade (prévia: sem idade) → pode entrar na fila. */
export function faltaParaFila(p: PedidoFila): string[] {
  const falta: string[] = []
  if (!p.foto_rosto_path) falta.push('foto do rosto')
  if (!p.foto_corpo_path) falta.push('foto de corpo inteiro')
  const qtd = p.tipo === 'previa' ? 1 : (p.pacote_qtd ?? 0)
  if ((p.poses ?? []).length < qtd || qtd === 0) falta.push('poses')
  if (!p.idade && p.tipo !== 'previa') falta.push('idade')   // a prévia só pede 1 foto + 1 pose
  return falta
}

export function mensagemNovoPedido(p: PedidoFila, nomeTema: string, motor: string): string {
  const qtd = p.tipo === 'previa' ? 1 : p.pacote_qtd
  const cab = p.tipo === 'previa' ? '✨ Nova PRÉVIA grátis para produzir' : '💰 Novo pedido para produzir'
  const linhas = [
    cab,
    `👤 ${p.cliente_nome ?? (p.wa_id ? `+${p.wa_id}` : 'cliente')}`,
    `🎨 ${nomeTema} · 📸 ${qtd} foto${qtd === 1 ? '' : 's'} · poses ${(p.poses ?? []).join(', ')}`,
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
export function svgMarcaDagua(w: number, h: number, texto = MARCA_PREVIA): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const fs = Math.round(Math.max(w, h) / 22)
  const linhas: string[] = []
  for (let y = -h; y < h * 2; y += fs * 5) {
    linhas.push(`<text x="${-w}" y="${y}" font-size="${fs}" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="white" fill-opacity="0.28" stroke="black" stroke-opacity="0.12" stroke-width="1">${Array(8).fill(esc).join('   ·   ')}</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g transform="rotate(-30 ${w / 2} ${h / 2})">${linhas.join('')}</g>` +
    `<rect x="0" y="${h - fs * 2}" width="${w}" height="${fs * 2}" fill="black" fill-opacity="0.45"/>` +
    `<text x="${w / 2}" y="${h - fs * 0.65}" font-size="${fs}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="white">${esc}</text></svg>`
}
