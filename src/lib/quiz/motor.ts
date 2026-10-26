// ============================================================================
// Quiz v2 — MOTOR puro (sem React, sem rede): pontuação, validação, ramificação,
// contato do lead, personalização {{nome}} e a conversão de uma página em
// "passos de conversa" (modo chat). Mesmas regras do renderer de páginas:
// o quiz montado no editor roda igual nos dois formatos.
// ============================================================================
import type { QuizData, QuizPage, QuizBlock, BlockConfig } from '@/app/actions/quiz-v2'

/** Blocos que NÃO são pergunta/campo (conteúdo, landing, resultado). */
export const BLOCOS_SEM_RESPOSTA = new Set([
  'result', 'heading', 'text_block', 'image', 'video', 'audio', 'button',
  'hero', 'testimonials', 'features', 'faq', 'countdown', 'pricing',
  'alert', 'notification', 'loading', 'level', 'checklist', 'before_after', 'carousel',
  'metrics', 'chart', 'spacer', 'divider', 'html_embed',
])
export const BLOCOS_DE_ESCOLHA = new Set(['single_choice', 'yes_no'])
export const BLOCOS_DE_CAMPO = new Set(['field_text', 'field_email', 'field_phone', 'field_number', 'field_textarea', 'field_date', 'field_height', 'field_weight'])

export type Respostas = Record<string, unknown>
export interface Lead { name?: string; email?: string; phone?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const emailValido = (v: string) => EMAIL_RE.test(v.trim())
export const telefoneValido = (v: string) => v.replace(/\D/g, '').length >= 10   // DDD + número

/** Pontuação SEMPRE derivada das respostas (nunca acumulada). */
export function calcularPontuacao(pages: QuizPage[], ans: Respostas): number {
  let total = 0
  for (const p of pages) for (const b of p.blocks) {
    if (BLOCOS_DE_ESCOLHA.has(b.type)) total += (b.config.options ?? []).find(o => o.label === ans[b.id])?.points ?? 0
    else if (b.type === 'multi_choice') for (const l of (ans[b.id] as string[]) ?? []) total += (b.config.options ?? []).find(o => o.label === l)?.points ?? 0
    else if (b.type === 'scale') { const v = ans[b.id]; if (typeof v === 'number') total += v }
  }
  return total
}

export function respostaVazia(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Erro de validação de UM bloco (obrigatório, e-mail, telefone); null = ok. */
export function validarBloco(b: QuizBlock, v: unknown, captura?: { name: string; email: string; phone: string }): string | null {
  if (b.type === 'final_capture') {
    const fc = captura ?? { name: '', email: '', phone: '' }
    if (b.config.show_name && b.config.required && !fc.name.trim()) return 'Preencha seu nome'
    if (b.config.show_email && (b.config.required || fc.email) && !emailValido(fc.email)) return 'E-mail inválido'
    if (b.config.show_phone && (b.config.required || fc.phone) && !telefoneValido(fc.phone)) return 'Telefone inválido'
    return null
  }
  if (BLOCOS_SEM_RESPOSTA.has(b.type)) return null
  const vazio = respostaVazia(v)
  if (b.config.required && vazio) return 'Campo obrigatório'
  if (b.type === 'field_email' && !vazio && !emailValido(String(v))) return 'E-mail inválido'
  if (b.type === 'field_phone' && !vazio && !telefoneValido(String(v))) return 'Telefone inválido'
  return null
}

/** Contato que a página trouxe (campos + captura final) por cima do que já havia. */
export function contatoDaPagina(page: QuizPage, ans: Respostas, atual: Lead, captura?: { name: string; email: string; phone: string }): Lead {
  let l = { ...atual }
  for (const b of page.blocks) {
    const v = ans[b.id]
    if (b.type === 'field_text' && v && !l.name) l = { ...l, name: String(v) }
    if (b.type === 'field_email' && v) l = { ...l, email: String(v) }
    if (b.type === 'field_phone' && v) l = { ...l, phone: String(v) }
    if (b.type === 'final_capture' && captura) l = { name: captura.name || l.name, email: captura.email || l.email, phone: captura.phone || l.phone }
  }
  return l
}

export type Proximo = { tipo: 'pagina'; idx: number } | { tipo: 'resultado'; bloco: QuizBlock } | { tipo: 'fim' }

/**
 * Para onde a conversa vai depois da página: destino da opção escolhida →
 * resultado da própria página → faixa de pontuação do próximo resultado →
 * página seguinte → fim. (Regra idêntica ao renderer de páginas.)
 */
export function proximaPagina(pages: QuizPage[], idx: number, ans: Respostas, pontos: number): Proximo {
  const page = pages[idx]
  for (const b of page.blocks) {
    const opts = b.config.options ?? []
    let alvo: string | null | undefined
    if (BLOCOS_DE_ESCOLHA.has(b.type)) alvo = opts.find(o => o.label === ans[b.id])?.goto_page_id
    else if (b.type === 'multi_choice') { const sel = Array.isArray(ans[b.id]) ? ans[b.id] as string[] : []; alvo = opts.find(o => sel.includes(o.label) && o.goto_page_id)?.goto_page_id }
    if (alvo) { const i = pages.findIndex(p => p.id === alvo); if (i >= 0) return { tipo: 'pagina', idx: i } }
  }
  const proprio = page.blocks.find(b => b.type === 'result')
  if (proprio) return { tipo: 'resultado', bloco: proprio }
  for (let i = idx + 1; i < pages.length; i++) {
    const rb = pages[i].blocks.find(b => b.type === 'result')
    if (!rb) continue
    const faixas = rb.config.score_ranges ?? []
    if (faixas.length) {
      const m = faixas.find(r => pontos >= r.min && pontos <= r.max)
      if (m?.goto_page_id) {
        const j = pages.findIndex(p => p.id === m.goto_page_id)
        if (j >= 0) { const alvo = pages[j].blocks.find(b => b.type === 'result'); return alvo ? { tipo: 'resultado', bloco: alvo } : { tipo: 'pagina', idx: j } }
      }
      return { tipo: 'resultado', bloco: rb }
    }
  }
  if (idx + 1 >= pages.length) return { tipo: 'fim' }
  return { tipo: 'pagina', idx: idx + 1 }
}

/** {{nome}}, {{email}}, {{telefone}}, {{score}} e {{identificador}} dos campos. */
export function personalizar(texto: string, pages: QuizPage[], ans: Respostas, lead: Lead, pontos: number): string {
  if (!texto || !texto.includes('{{')) return texto
  const map: Record<string, string> = {}
  for (const p of pages) for (const b of p.blocks) {
    const a = ans[b.id]; if (a == null || a === '') continue
    const k = (b.config.field_key || '').trim().toLowerCase()
    if (k) map[k] = Array.isArray(a) ? a.join(', ') : String(a)
  }
  let name = lead.name || map['nome'] || map['name'] || '', email = lead.email || map['email'] || '', phone = lead.phone || map['telefone'] || map['whatsapp'] || ''
  for (const p of pages) for (const b of p.blocks) {
    const a = ans[b.id]; if (a == null || a === '') continue
    if (b.type === 'field_text' && !name) name = String(a)
    if (b.type === 'field_email' && !email) email = String(a)
    if (b.type === 'field_phone' && !phone) phone = String(a)
  }
  const primeiro = name.trim().split(/\s+/)[0] || ''
  return texto.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, raw) => {
    const k = String(raw).toLowerCase()
    if (['nome', 'name', 'primeiro_nome'].includes(k)) return primeiro || (map[k] ?? m)
    if (k === 'nome_completo' || k === 'full_name') return name
    if (k === 'email' || k === 'e-mail') return email
    if (['telefone', 'whatsapp', 'phone'].includes(k)) return phone
    if (k === 'score') return String(pontos)
    return map[k] ?? m
  })
}

// ── Modo conversa: a página vira passos ─────────────────────────────────────

/** Uma "fala" do atendente: texto, mídia ou bloco rico (renderizado como cartão). */
export type Fala =
  | { t: 'texto'; texto: string }
  | { t: 'imagem'; url: string }
  | { t: 'video'; url: string }
  | { t: 'audio'; url: string; titulo?: string }
  | { t: 'cartao'; bloco: QuizBlock }

/** Um passo = falas do atendente + (opcional) o que a pessoa responde. */
export interface Passo {
  falas: Fala[]
  /** Bloco que espera resposta (escolha, campo, captura, escala…); null = só conteúdo. */
  entrada: QuizBlock | null
  /** Botão de seguir (bloco 'button' next_page/submit, CTA do hero, ou "Continuar" automático). */
  botao: { texto: string; bloco: QuizBlock | null; url?: string } | null
  /** Bloco 'loading': espera N segundos e segue sozinho. */
  esperaSeg?: number
}

const semHtml = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()

/** O que o atendente "fala" por um bloco de conteúdo (null = bloco sem fala no chat). */
export function falasDoBloco(b: QuizBlock): Fala[] {
  const c = b.config
  switch (b.type) {
    case 'heading': return c.heading_text ? [{ t: 'texto', texto: semHtml(c.heading_text) }] : []
    case 'text_block': return c.content ? [{ t: 'texto', texto: semHtml(c.content) }] : []
    case 'alert': return c.alert_text ? [{ t: 'texto', texto: semHtml(c.alert_text) }] : []
    case 'image': return c.image_url ? [{ t: 'imagem', url: c.image_url }] : []
    case 'video': return c.video_url ? [{ t: 'video', url: c.video_url }] : []
    case 'audio': return c.audio_url ? [{ t: 'audio', url: c.audio_url, titulo: c.audio_title }] : []
    case 'hero': return [
      ...(c.hero_image_url ? [{ t: 'imagem' as const, url: c.hero_image_url }] : []),
      ...(c.hero_headline ? [{ t: 'texto' as const, texto: semHtml(c.hero_headline) }] : []),
      ...(c.hero_subheadline ? [{ t: 'texto' as const, texto: semHtml(c.hero_subheadline) }] : []),
    ]
    case 'loading': return c.loading_text ? [{ t: 'texto', texto: semHtml(c.loading_text) }] : []
    case 'spacer': case 'divider': case 'notification': return []
    // Pergunta/campo: o enunciado vira fala; o resto (opções) é a entrada.
    case 'single_choice': case 'multi_choice': case 'yes_no': case 'scale': case 'video_answer': return [
      ...(b.type === 'video_answer' && c.video_answer_url ? [{ t: 'video' as const, url: c.video_answer_url }] : []),
      ...(c.question ? [{ t: 'texto' as const, texto: semHtml(c.question) }] : []),
      ...(c.subtitle ? [{ t: 'texto' as const, texto: semHtml(c.subtitle) }] : []),
    ]
    case 'final_capture': return c.title || c.question ? [{ t: 'texto', texto: semHtml(c.title || c.question || '') }] : []
    case 'result': return []
    case 'button': return []
    default:
      if (BLOCOS_DE_CAMPO.has(b.type)) return c.label ? [{ t: 'texto', texto: semHtml(c.label) }] : []
      // testimonials, features, faq, pricing, checklist, before_after, carousel, metrics, chart, level, countdown, html_embed
      return [{ t: 'cartao', bloco: b }]
  }
}

/**
 * Divide a página em passos: cada bloco que espera resposta fecha um passo com
 * as falas que vieram antes dele. Botão/CTA fecha um passo de "seguir". Página
 * só de conteúdo vira 1 passo com "Continuar".
 */
export function passosDaPagina(page: QuizPage, textoContinuar = 'Continuar'): Passo[] {
  const passos: Passo[] = []
  let falas: Fala[] = []
  const temResultado = page.blocks.some(b => b.type === 'result')
  for (const b of [...page.blocks].sort((a, z) => a.order - z.order)) {
    if (b.type === 'result') continue
    if (b.type === 'button') {
      if (b.config.button_action === 'external_url' || b.config.button_action === 'whatsapp') {
        passos.push({ falas, entrada: null, botao: { texto: b.config.button_text || 'Abrir', bloco: b, url: b.config.button_url } }); falas = []
      } else { passos.push({ falas, entrada: null, botao: { texto: b.config.button_text || textoContinuar, bloco: b } }); falas = [] }
      continue
    }
    if (b.type === 'hero' && b.config.hero_cta_text) {
      passos.push({ falas: [...falas, ...falasDoBloco(b)], entrada: null, botao: { texto: b.config.hero_cta_text, bloco: b, url: b.config.hero_cta_action === 'external_url' ? b.config.hero_cta_url : undefined } }); falas = []
      continue
    }
    if (b.type === 'loading') {
      passos.push({ falas: [...falas, ...falasDoBloco(b)], entrada: null, botao: null, esperaSeg: Math.max(1, b.config.loading_seconds ?? 3) }); falas = []
      continue
    }
    if (!BLOCOS_SEM_RESPOSTA.has(b.type)) {
      passos.push({ falas: [...falas, ...falasDoBloco(b)], entrada: b, botao: null }); falas = []
      continue
    }
    falas.push(...falasDoBloco(b))
  }
  // Página com resultado: o conteúdo antes dele sai e o resultado vem em seguida, sem "Continuar".
  if (temResultado) { if (falas.length) passos.push({ falas, entrada: null, botao: null }); return passos }
  if (falas.length || passos.length === 0) passos.push({ falas, entrada: null, botao: { texto: textoContinuar, bloco: null } })
  return passos
}

/** O que aparece no balão da pessoa depois de responder. */
export function textoDaResposta(b: QuizBlock, v: unknown, captura?: { name: string; email: string; phone: string }): string {
  if (b.type === 'final_capture') return [captura?.name, captura?.email, captura?.phone].filter(Boolean).join(' · ')
  if (Array.isArray(v)) return v.join(', ')
  if (BLOCOS_DE_ESCOLHA.has(b.type)) { const o = (b.config.options ?? []).find(x => x.label === v); return o ? `${o.emoji ? o.emoji + ' ' : ''}${o.label}` : String(v ?? '') }
  if (b.type === 'scale') return String(v)
  return String(v ?? '')
}

/** Tempo de "digitando…" por fala (ms): proporcional ao texto, dentro de limites. */
export function tempoDigitando(fala: Fala, velocidade: 'rapida' | 'normal' | 'lenta' = 'normal'): number {
  const fator = velocidade === 'rapida' ? 0.5 : velocidade === 'lenta' ? 1.6 : 1
  const base = fala.t === 'texto' ? 350 + Math.min(fala.texto.length, 240) * 14 : 700
  return Math.round(Math.max(300, Math.min(2600, base * fator)))
}

/** Atributos do campo de digitar no modo conversa. */
export function campoDaEntrada(b: QuizBlock): { tipo: string; placeholder: string; inputMode?: string } {
  const c = b.config
  const ph = c.placeholder || ''
  switch (b.type) {
    case 'field_email': return { tipo: 'email', placeholder: ph || 'seu@email.com', inputMode: 'email' }
    case 'field_phone': return { tipo: 'tel', placeholder: ph || '(11) 99999-9999', inputMode: 'tel' }
    case 'field_number': case 'field_height': case 'field_weight': return { tipo: 'number', placeholder: ph || 'Digite um número', inputMode: 'decimal' }
    case 'field_date': return { tipo: 'date', placeholder: ph }
    default: return { tipo: 'text', placeholder: ph || 'Digite sua resposta…' }
  }
}

/** Modo de exibição do quiz (padrão: páginas, como sempre foi). */
export function formatoDoQuiz(data: QuizData): 'paginas' | 'conversa' {
  return data.settings.layout === 'conversa' ? 'conversa' : 'paginas'
}
