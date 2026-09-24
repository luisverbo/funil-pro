// ============================================================================
// Conteúdos Instagram — regras puras (sem React, sem rede, sem banco)
// ----------------------------------------------------------------------------
// Tudo o que decide algo neste módulo vive aqui, testável: status válidos,
// transições permitidas, legenda final, o recorte dos 125 caracteres que o
// Instagram mostra antes do "mais", e o mapa de slots da semana (06:00 reel,
// 15:00 carrossel, em Brasília). O SQL em `proxima_data_livre` segue a MESMA
// régua — o teste da migration cobra isso.
// ============================================================================

export const TIPOS = ['reel', 'carrossel'] as const
export type TipoConteudo = (typeof TIPOS)[number]

export const STATUS = ['pendente', 'agendado', 'publicando', 'publicado', 'erro', 'descartado'] as const
export type StatusConteudo = (typeof STATUS)[number]

export const FUSO = 'America/Sao_Paulo'
export const MAX_TENTATIVAS = 3
/** O Instagram corta a legenda aqui e mostra "… mais". */
export const CORTE_VISIVEL = 125
/** Limite de legenda da API de publicação. */
export const MAX_LEGENDA = 2200
export const MAX_HASHTAGS = 30

export const HORA_DO_SLOT: Record<TipoConteudo, { hora: number; minuto: number; rotulo: string }> = {
  reel:      { hora: 6,  minuto: 0, rotulo: '06:00' },
  carrossel: { hora: 15, minuto: 0, rotulo: '15:00' },
}

export function tipoValido(v: unknown): v is TipoConteudo {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v)
}
export function statusValido(v: unknown): v is StatusConteudo {
  return typeof v === 'string' && (STATUS as readonly string[]).includes(v)
}

export interface Conteudo {
  id: string
  tenant_id: string
  conta_instagram_id: string | null
  tipo: TipoConteudo
  status: StatusConteudo
  data_agendada: string
  midia_urls: string[]
  capa_url: string | null
  descricao: string
  alt_text: string | null
  hashtags: string[]
  palavra_chave: string | null
  tema: string | null
  origem_url: string | null
  origem_trecho: string | null
  nota: number | null
  ig_container_id: string | null
  ig_media_id: string | null
  ig_permalink: string | null
  erro: string | null
  tentativas: number
  created_at: string
  aprovado_em: string | null
  publicado_em: string | null
  publicando_desde?: string | null
}

// ── Transições ──────────────────────────────────────────────────────────────

/** O que o dono pode fazer com um item em cada status. */
export type Acao = 'aprovar' | 'descartar' | 'editar' | 'tentar_de_novo' | 'publicar_agora' | 'voltar_para_pendente'

export function acoesPermitidas(status: StatusConteudo): Acao[] {
  switch (status) {
    case 'pendente':   return ['aprovar', 'descartar', 'editar', 'publicar_agora']
    case 'agendado':   return ['descartar', 'editar', 'publicar_agora', 'voltar_para_pendente']
    case 'erro':       return ['tentar_de_novo', 'descartar', 'editar', 'publicar_agora']
    case 'publicando': return []
    case 'publicado':  return []
    case 'descartado': return ['voltar_para_pendente']
  }
}

export function podeFazer(status: StatusConteudo, acao: Acao): boolean {
  return acoesPermitidas(status).includes(acao)
}

// ── Legenda ─────────────────────────────────────────────────────────────────

/** Normaliza hashtags: tira '#', espaços e repetidas; mantém a ordem. */
export function normalizarHashtags(lista: readonly string[] | null | undefined): string[] {
  const vistas = new Set<string>()
  const saida: string[] = []
  for (const h of lista ?? []) {
    const limpa = h.replace(/^#+/, '').replace(/\s+/g, '').trim()
    if (!limpa) continue
    const chave = limpa.toLowerCase()
    if (vistas.has(chave)) continue
    vistas.add(chave)
    saida.push(limpa)
    if (saida.length >= MAX_HASHTAGS) break
  }
  return saida
}

/** caption = descrição + duas quebras + hashtags (#a #b …), dentro do limite. */
export function montarLegenda(descricao: string, hashtags: readonly string[] | null | undefined): string {
  const tags = normalizarHashtags(hashtags).map(h => `#${h}`).join(' ')
  const corpo = (descricao ?? '').trim()
  const legenda = tags ? `${corpo}\n\n${tags}` : corpo
  return legenda.length > MAX_LEGENDA ? legenda.slice(0, MAX_LEGENDA) : legenda
}

/** Divide a descrição no que aparece antes do "mais" e no resto. */
export function recorteVisivel(descricao: string): { visivel: string; resto: string } {
  const d = descricao ?? ''
  if (d.length <= CORTE_VISIVEL) return { visivel: d, resto: '' }
  return { visivel: d.slice(0, CORTE_VISIVEL), resto: d.slice(CORTE_VISIVEL) }
}

// ── Slots da semana ─────────────────────────────────────────────────────────

/** Partes de uma data no fuso de Brasília. */
export function partesEmBrasilia(iso: string | Date): { ano: number; mes: number; dia: number; hora: number; minuto: number; diaSemana: number } {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  })
  const p: Record<string, string> = {}
  for (const parte of f.formatToParts(d)) p[parte.type] = parte.value
  const semana: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour) % 24, minuto: Number(p.minute),
    diaSemana: semana[p.weekday] ?? 0,
  }
}

/** 'YYYY-MM-DD' do dia em Brasília. */
export function diaEmBrasilia(iso: string | Date): string {
  const p = partesEmBrasilia(iso)
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`
}

/** 'DD/MM · HH:MM' para o card. */
export function rotuloDataHora(iso: string): string {
  const p = partesEmBrasilia(iso)
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} · ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}

/** Valor para <input type="datetime-local"> no fuso de Brasília. */
export function paraInputLocal(iso: string): string {
  const p = partesEmBrasilia(iso)
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}T${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}

/**
 * Converte o valor do <input datetime-local> (interpretado em Brasília) para
 * ISO UTC. Não confia no fuso do navegador: o dono pode aprovar de qualquer
 * lugar e o horário é sempre o do Brasil.
 */
export function deInputLocalParaIso(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const [, a, me, d, h, mi] = m.map(Number)
  // Chute em UTC e corrige pela diferença observada no fuso.
  const chute = Date.UTC(a, me - 1, d, h, mi)
  const p = partesEmBrasilia(new Date(chute))
  const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto)
  const corrigido = chute - (visto - chute)
  return new Date(corrigido).toISOString()
}

export interface SlotSemana {
  dia: string            // 'YYYY-MM-DD'
  tipo: TipoConteudo
  rotulo: string         // '06:00' | '15:00'
  conteudo: Conteudo | null
}

/** Segunda-feira (Brasília) da semana que contém `referencia`, como 'YYYY-MM-DD'. */
export function inicioDaSemana(referencia: string | Date): string {
  const p = partesEmBrasilia(referencia)
  const base = Date.UTC(p.ano, p.mes - 1, p.dia)
  const recuo = (p.diaSemana + 6) % 7   // segunda = 0
  const seg = new Date(base - recuo * 86_400_000)
  return seg.toISOString().slice(0, 10)
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Grade da semana: 7 dias × 2 slots. Um slot está preenchido quando há item
 * NÃO descartado do tipo naquele dia (mesma régua do SQL).
 */
export function gradeDaSemana(itens: readonly Conteudo[], inicio: string): SlotSemana[] {
  const porDiaTipo = new Map<string, Conteudo>()
  for (const c of itens) {
    if (c.status === 'descartado') continue
    const chave = `${diaEmBrasilia(c.data_agendada)}|${c.tipo}`
    const atual = porDiaTipo.get(chave)
    // Se houver mais de um (edição manual), mostra o mais cedo.
    if (!atual || c.data_agendada < atual.data_agendada) porDiaTipo.set(chave, c)
  }
  const grade: SlotSemana[] = []
  for (let i = 0; i < 7; i++) {
    const dia = somarDias(inicio, i)
    for (const tipo of TIPOS) {
      grade.push({ dia, tipo, rotulo: HORA_DO_SLOT[tipo].rotulo, conteudo: porDiaTipo.get(`${dia}|${tipo}`) ?? null })
    }
  }
  return grade
}

// ── Publicação: decisões puras ──────────────────────────────────────────────

/** Depois de uma falha: volta para 'agendado' (tenta de novo) ou vira 'erro'? */
export function statusAposFalha(tentativasAntes: number): { status: 'agendado' | 'erro'; tentativas: number } {
  const tentativas = tentativasAntes + 1
  return { status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'agendado', tentativas }
}

/** Mensagem de erro curta e sem segredo para guardar no banco. */
export function resumirErro(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err)
  return texto.replace(/access_token=[^&\s"]+/gi, 'access_token=***').slice(0, 500)
}

/** Validação mínima antes de mandar para a Meta. */
export function validarParaPublicar(c: Pick<Conteudo, 'tipo' | 'midia_urls' | 'descricao'>): string | null {
  if (!tipoValido(c.tipo)) return 'tipo inválido'
  const urls = c.midia_urls ?? []
  if (urls.some(u => !/^https:\/\//.test(u))) return 'toda mídia precisa ser uma URL https pública'
  if (c.tipo === 'reel' && urls.length !== 1) return 'reel precisa de exatamente 1 vídeo'
  if (c.tipo === 'carrossel' && (urls.length < 2 || urls.length > 10)) return 'carrossel precisa de 2 a 10 imagens'
  return null
}
