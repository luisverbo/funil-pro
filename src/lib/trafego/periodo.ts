// ============================================================================
// Período do painel — hoje, ontem, 7/14/30 dias, este mês ou datas livres
// ----------------------------------------------------------------------------
// Pedido do dono (29/09): "quero gráfico de hoje, de ontem, personalizado —
// o gráfico na minha mão". Tudo puro; a URL guarda `p`, `de` e `ate`.
// "Hoje" é o dia em Brasília: a Meta fecha o dia no fuso da conta, e todas
// as contas do dono são BR.
// ============================================================================

export type PresetPeriodo = 'hoje' | 'ontem' | '7' | '14' | '30' | 'mes' | 'custom'

export interface Periodo {
  preset: PresetPeriodo
  desde: string   // YYYY-MM-DD
  ate: string     // YYYY-MM-DD
  dias: number
  rotulo: string
}

export const PRESETS: { chave: PresetPeriodo; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: 'ontem', rotulo: 'Ontem' },
  { chave: '7', rotulo: '7 dias' },
  { chave: '14', rotulo: '14 dias' },
  { chave: '30', rotulo: '30 dias' },
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'custom', rotulo: 'Personalizado' },
]

/** Máximo que o painel deixa pedir de uma vez — a leitura da Meta tem custo. */
export const MAX_DIAS_PERIODO = 92

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Data de hoje em Brasília, como YYYY-MM-DD. */
export function hojeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

export function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(desde: string, ate: string): number {
  return Math.round((new Date(`${ate}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()) / 86_400_000) + 1
}

export function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/**
 * Resolve o que veio da URL. Inválido cai no padrão (7 dias) — a tela nunca
 * quebra por link errado. Datas livres são ordenadas e limitadas.
 */
export function resolverPeriodo(
  q: { p?: string | null; de?: string | null; ate?: string | null },
  agora: Date = new Date(),
): Periodo {
  const hoje = hojeBrasilia(agora)
  const preset = (PRESETS.some(x => x.chave === q.p) ? q.p : '7') as PresetPeriodo

  const montar = (p: PresetPeriodo, desde: string, ate: string, rotulo: string): Periodo =>
    ({ preset: p, desde, ate, dias: diasEntre(desde, ate), rotulo })

  switch (preset) {
    case 'hoje': return montar('hoje', hoje, hoje, `Hoje · ${formatarData(hoje)}`)
    case 'ontem': { const o = somarDias(hoje, -1); return montar('ontem', o, o, `Ontem · ${formatarData(o)}`) }
    case 'mes': {
      const inicio = `${hoje.slice(0, 7)}-01`
      return montar('mes', inicio, hoje, `Este mês · ${formatarData(inicio)} – ${formatarData(hoje)}`)
    }
    case 'custom': {
      let de = ISO.test(q.de ?? '') ? q.de! : somarDias(hoje, -6)
      let ate = ISO.test(q.ate ?? '') ? q.ate! : hoje
      if (de > ate) [de, ate] = [ate, de]
      if (ate > hoje) ate = hoje
      if (diasEntre(de, ate) > MAX_DIAS_PERIODO) de = somarDias(ate, -(MAX_DIAS_PERIODO - 1))
      return montar('custom', de, ate, `${formatarData(de)} – ${formatarData(ate)}`)
    }
    default: {
      const n = Number(preset)
      const de = somarDias(hoje, -(n - 1))
      return montar(preset, de, hoje, `Últimos ${n} dias · ${formatarData(de)} – ${formatarData(hoje)}`)
    }
  }
}

/** Query string que reabre o painel no mesmo recorte. */
export function queryDoPeriodo(p: Periodo): Record<string, string> {
  return p.preset === 'custom' ? { p: 'custom', de: p.desde, ate: p.ate } : { p: p.preset }
}
