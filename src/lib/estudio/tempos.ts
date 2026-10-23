// ============================================================================
// Estúdio IA — cronômetro por mensagem (onde vai o tempo da resposta)
// webhook → "digitando" → mídia → IA → banco → envio (+ atraso humano)
// Gravado em estudio_mensagens.tempos da mensagem da cliente e mostrado no chat.
// ============================================================================

export type Parte = 'digitando' | 'midia' | 'ia' | 'envio' | 'espera'

export interface Tempos {
  total_ms: number
  ate_digitando_ms: number | null   // da chegada até o "digitando…" (meta < 1 s)
  ate_1a_resposta_ms: number | null  // da chegada até a 1ª mensagem da Ana
  midia_ms: number; ia_ms: number; envio_ms: number; espera_ms: number; banco_ms: number
  frio: boolean                      // 1ª execução desta instância (cold start)
  idade_instancia_ms: number
  mensagens: number                  // quantas a Ana mandou nesta resposta
}

const NASCEU = Date.now()
let primeiraExecucao = true

export class Cronometro {
  readonly inicio: number
  readonly frio: boolean
  private partes: Record<Parte, number> = { digitando: 0, midia: 0, ia: 0, envio: 0, espera: 0 }
  private digitandoEm: number | null = null
  private primeiraRespostaEm: number | null = null
  private enviadas = 0

  constructor(inicio = Date.now()) {
    this.inicio = inicio
    this.frio = primeiraExecucao
    primeiraExecucao = false
  }

  somar(parte: Parte, ms: number) { this.partes[parte] += Math.max(0, ms) }

  async medir<T>(parte: Parte, fn: () => Promise<T>): Promise<T> {
    const t = Date.now()
    try { return await fn() } finally { this.somar(parte, Date.now() - t) }
  }

  digitou() { if (this.digitandoEm === null) this.digitandoEm = Date.now() }
  respondeu() { this.enviadas++; if (this.primeiraRespostaEm === null) this.primeiraRespostaEm = Date.now() }

  resumo(agora = Date.now()): Tempos {
    const total = agora - this.inicio
    const { midia, ia, envio, espera } = this.partes
    return {
      total_ms: total,
      ate_digitando_ms: this.digitandoEm === null ? null : this.digitandoEm - this.inicio,
      ate_1a_resposta_ms: this.primeiraRespostaEm === null ? null : this.primeiraRespostaEm - this.inicio,
      midia_ms: midia, ia_ms: ia, envio_ms: envio, espera_ms: espera,
      banco_ms: Math.max(0, total - midia - ia - envio - espera),
      frio: this.frio, idade_instancia_ms: this.inicio - NASCEU, mensagens: this.enviadas,
    }
  }
}

/** "3,2 s · IA 1,1 s · mídia 0,8 s · envio 0,6 s · atraso 1,9 s" */
export function textoDosTempos(t: Tempos | null | undefined): string {
  if (!t) return ''
  const s = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  const partes = [
    t.ate_digitando_ms !== null ? `digitando ${s(t.ate_digitando_ms)}` : null,
    t.ate_1a_resposta_ms !== null ? `1ª resposta ${s(t.ate_1a_resposta_ms)}` : null,
    t.ia_ms ? `IA ${s(t.ia_ms)}` : null, t.midia_ms ? `mídia ${s(t.midia_ms)}` : null,
    t.banco_ms ? `banco ${s(t.banco_ms)}` : null, t.envio_ms ? `envio ${s(t.envio_ms)}` : null,
    t.espera_ms ? `atraso humano ${s(t.espera_ms)}` : null, t.frio ? '🧊 cold start' : null,
  ].filter(Boolean)
  return `⏱ ${s(t.total_ms)} · ${partes.join(' · ')}`
}
