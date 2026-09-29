// ============================================================================
// Mesa de estrategistas — o "time de gestores de tráfego" da aba Tráfego
// ----------------------------------------------------------------------------
// Pedido do dono: "que a aba seja como um time enorme de gestores de tráfego
// e estrategistas: onde estou perdendo dinheiro, onde colocar mais, o que
// pausar, alertas de risco — e eu entro e já tenho as respostas".
//
// Seis especialistas, cada um com a sua régua EXPLÍCITA:
//   💸 Performance    — onde o dinheiro está indo embora
//   🚀 Escala         — onde colocar mais dinheiro
//   💰 Orçamento      — de onde tirar e para onde mover
//   🎨 Criativo       — anúncio que não prende, público cansado ou caro
//   🛡️ Risco          — o que pode quebrar a operação
//   (e o estrategista-chefe, que escreve o parecer — ver mesa-parecer.ts)
//
// Por que regra e não IA para decidir: número inventado, custo e auditoria
// (mesmo raciocínio do diagnose.ts). A IA só ESCREVE o parecer em cima do que
// estas regras provaram.
//
// "Resultado" não é só venda: boa parte das campanhas do dono é de captação
// (quiz, WhatsApp). Cada linha é julgada pelo seu resultado principal —
// compra > lead > conversa > cadastro — e só comparada com linhas do MESMO
// tipo. ROAS real (vendas do FunilPro) entra quando existe.
// ============================================================================

import type { NivelAnuncio } from '@/lib/meta/sync-v2'

// ── Tipos ───────────────────────────────────────────────────────────────────

export type TipoResultado = 'compra' | 'lead' | 'conversa' | 'cadastro'

export const ROTULO_RESULTADO: Record<TipoResultado, { um: string; varios: string }> = {
  compra: { um: 'compra', varios: 'compras' },
  lead: { um: 'lead', varios: 'leads' },
  conversa: { um: 'conversa', varios: 'conversas' },
  cadastro: { um: 'cadastro', varios: 'cadastros' },
}

/** Ações da Meta que contam como cada resultado, na ordem de preferência. */
const ACOES: Record<TipoResultado, string[]> = {
  compra: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'],
  lead: ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
  conversa: ['onsite_conversion.messaging_conversation_started_7d'],
  cadastro: ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration'],
}
const ORDEM_RESULTADO: TipoResultado[] = ['compra', 'lead', 'conversa', 'cadastro']

export interface AcaoMeta { action_type: string; value: string | number }

/**
 * Quanto de cada resultado há numa lista de ações. Usa a PRIMEIRA ação da
 * preferência que aparecer — a Meta repete o mesmo evento com nomes
 * diferentes (lead e fb_pixel_lead), e somar contaria em dobro.
 */
export function contarResultados(acoes: readonly AcaoMeta[] | null | undefined): Record<TipoResultado, number> {
  const mapa = new Map<string, number>()
  for (const a of acoes ?? []) {
    const v = Number(a.value)
    if (Number.isFinite(v)) mapa.set(a.action_type, (mapa.get(a.action_type) ?? 0) + v)
  }
  const out = { compra: 0, lead: 0, conversa: 0, cadastro: 0 } as Record<TipoResultado, number>
  for (const tipo of ORDEM_RESULTADO) {
    const achado = ACOES[tipo].find(t => mapa.has(t))
    out[tipo] = achado ? Math.round(mapa.get(achado)!) : 0
  }
  return out
}

/** O resultado que define a linha: o primeiro tipo com volume. */
export function resultadoPrincipal(r: Record<TipoResultado, number>): TipoResultado | null {
  return ORDEM_RESULTADO.find(t => r[t] > 0) ?? null
}

export interface LinhaMesa {
  nivel: NivelAnuncio
  id: string
  nome: string
  /** Campanha dona (para concentração e contexto). */
  campanhaId: string | null
  status: string | null        // effective_status da Meta
  orcamentoDiarioCents: number | null
  gastoCents: number
  impressoes: number
  cliques: number
  ctr: number | null           // %
  cpmCents: number | null
  frequencia: number | null
  resultados: Record<TipoResultado, number>
  /** Vendas confirmadas no FunilPro (com atribuição), quando houver. */
  vendasReais: number
  receitaRealCents: number
  /** Janela recente x anterior (tendência). */
  recente: { gastoCents: number; resultados: number }
  anterior: { gastoCents: number; resultados: number }
  /** Dias com gasto zero no fim do período (entrega parada). */
  diasSemGastoNoFim: number
}

export interface ContaMesa {
  nome: string
  status: string
  erro: string | null
  tokenExpiraEm: string | null
}

export interface EntradaMesa {
  dias: number
  linhas: LinhaMesa[]
  contas: ContaMesa[]
  /** Receita confirmada sem anúncio de origem (rastreamento). */
  semAtribuicao: { vendas: number; receitaCents: number }
  receitaAtribuidaCents: number
  agora?: Date
}

export type Especialista = 'performance' | 'escala' | 'orcamento' | 'criativo' | 'risco'
export type Urgencia = 'alta' | 'media' | 'baixa'
export type AcaoSugerida =
  | 'pausar' | 'reduzir' | 'escalar' | 'mover_verba' | 'trocar_criativo'
  | 'ampliar_publico' | 'corrigir_rastreamento' | 'reconectar' | 'revisar' | 'observar'

export interface Recomendacao {
  especialista: Especialista
  acao: AcaoSugerida
  urgencia: Urgencia
  alvo: { nivel: NivelAnuncio | 'account'; id: string | null; nome: string }
  titulo: string
  porque: string
  /** O que muda se fizer (ex.: "para de gastar R$ 40/dia"). Estimativa marcada como tal. */
  impacto: string | null
  numeros: Record<string, number | null>
  /** Chave estável (regra + alvo): o painel não repete o mesmo conselho. */
  chave: string
}

export interface LimitesMesa {
  gastoMinimoCents: number
  /** Linha sem resultado que gastou mais que N× o custo por resultado típico = pausar. */
  semResultadoMultiplo: number
  /** Custo por resultado acima de N× a mediana do mesmo tipo = perdendo dinheiro. */
  cprCaroMultiplo: number
  /** Custo por resultado até N× a mediana, com volume = escalar. */
  cprBaratoMultiplo: number
  resultadosMinimosParaEscalar: number
  roasCritico: number
  roasBom: number
  frequenciaAlta: number
  ctrBaixoMultiplo: number
  cpmCaroMultiplo: number
  /** Custo por resultado recente acima de N× o anterior = piorando. */
  pioraRecenteMultiplo: number
  gastoAcelerandoMultiplo: number
  concentracaoMax: number
  fatiaSemOrigem: number
  passoEscalaPct: number
}

export const LIMITES_MESA: LimitesMesa = {
  gastoMinimoCents: 5_000,        // R$ 50: abaixo é ruído
  semResultadoMultiplo: 2,
  cprCaroMultiplo: 2,
  cprBaratoMultiplo: 0.7,
  resultadosMinimosParaEscalar: 3,
  roasCritico: 1,
  roasBom: 3,
  frequenciaAlta: 3,
  ctrBaixoMultiplo: 0.6,
  cpmCaroMultiplo: 1.8,
  pioraRecenteMultiplo: 1.4,
  gastoAcelerandoMultiplo: 1.6,
  concentracaoMax: 0.7,
  fatiaSemOrigem: 0.3,
  passoEscalaPct: 20,
}

export interface PlanoMesa {
  resumo: {
    gastoCents: number
    resultados: Record<TipoResultado, number>
    receitaCents: number
    roas: number | null
    /** Gasto nas linhas que o time mandou pausar/reduzir. */
    dinheiroEmRiscoCents: number
    /** Gasto nas linhas que o time mandou escalar. */
    gastoVencedoresCents: number
    /** 0–100: quanto do gasto está em linhas saudáveis. */
    saude: number | null
  }
  recomendacoes: Recomendacao[]
  porEspecialista: Record<Especialista, Recomendacao[]>
}

// ── Utilitários puros ──────────────────────────────────────────────────────

export const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function mediana(valores: number[]): number | null {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length === 0) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

function cpr(l: LinhaMesa, tipo: TipoResultado): number | null {
  const n = l.resultados[tipo]
  return n > 0 ? l.gastoCents / n : null
}

const ROTULO_NIVEL: Record<NivelAnuncio, string> = { campaign: 'campanha', adset: 'conjunto', ad: 'anúncio' }
/** Artigo certo: "a campanha", "o conjunto", "o anúncio". */
const ART: Record<NivelAnuncio, { o: string; no: string }> = {
  campaign: { o: 'A', no: 'Na' }, adset: { o: 'O', no: 'No' }, ad: { o: 'O', no: 'No' },
}
const URG: Record<Urgencia, number> = { alta: 0, media: 1, baixa: 2 }

// ── O time ─────────────────────────────────────────────────────────────────

export function montarMesa(e: EntradaMesa, lim: LimitesMesa = LIMITES_MESA): PlanoMesa {
  const recs: Recomendacao[] = []
  const add = (r: Omit<Recomendacao, 'chave'> & { regra: string }) => {
    const { regra, ...resto } = r
    recs.push({ ...resto, chave: `${regra}:${r.alvo.nivel}:${r.alvo.id ?? 'conta'}` })
  }
  const agora = e.agora ?? new Date()
  const linhas = e.linhas
  const comGasto = linhas.filter(l => l.gastoCents >= lim.gastoMinimoCents)

  // Custo por resultado típico, por tipo — a régua de comparação justa.
  const medianaCpr: Partial<Record<TipoResultado, number>> = {}
  for (const tipo of ORDEM_RESULTADO) {
    const m = mediana(comGasto.map(l => (resultadoPrincipal(l.resultados) === tipo ? cpr(l, tipo) : null)).filter((x): x is number => x !== null))
    if (m !== null) medianaCpr[tipo] = m
  }
  const medCtr = mediana(comGasto.map(l => l.ctr ?? NaN).filter(Number.isFinite))
  const medCpm = mediana(comGasto.map(l => l.cpmCents ?? NaN).filter(Number.isFinite))
  const cprGeralTipico = mediana(Object.values(medianaCpr).filter((x): x is number => x !== undefined))

  const perdedores: LinhaMesa[] = []
  const vencedores: { l: LinhaMesa; cprCents: number | null; tipo: TipoResultado | null }[] = []

  // ── 💸 Performance + 🚀 Escala, linha a linha ───────────────────────────
  for (const l of comGasto) {
    const tipo = resultadoPrincipal(l.resultados)
    const alvo = { nivel: l.nivel, id: l.id, nome: l.nome }
    const quem = `${ROTULO_NIVEL[l.nivel]} "${l.nome}"`
    const O = ART[l.nivel].o
    const roas = l.receitaRealCents > 0 ? Math.round((l.receitaRealCents / l.gastoCents) * 100) / 100 : null
    const porDia = l.orcamentoDiarioCents ?? Math.round(l.gastoCents / Math.max(1, e.dias))

    // Sem resultado nenhum
    if (!tipo && l.vendasReais === 0) {
      const limite = cprGeralTipico !== null ? Math.max(lim.gastoMinimoCents, cprGeralTipico * lim.semResultadoMultiplo) : lim.gastoMinimoCents
      if (l.gastoCents >= limite) {
        perdedores.push(l)
        add({
          regra: 'sem_resultado', especialista: 'performance', acao: 'pausar', urgencia: 'alta', alvo,
          titulo: `Pausar: ${brl(l.gastoCents)} sem nenhum resultado`,
          porque: `${O} ${quem} gastou ${brl(l.gastoCents)} em ${e.dias} dias e não trouxe compra, lead nem conversa.`
            + (cprGeralTipico !== null ? ` Nos outros, um resultado sai por cerca de ${brl(cprGeralTipico)}.` : ''),
          impacto: `Para de gastar cerca de ${brl(porDia)} por dia.`,
          numeros: { gastoCents: l.gastoCents, resultados: 0, cprTipicoCents: cprGeralTipico, porDiaCents: porDia },
        })
      }
      continue
    }

    // ROAS real ruim (tem venda, mas volta menos do que entra)
    if (roas !== null && l.vendasReais > 0 && roas < lim.roasCritico) {
      perdedores.push(l)
      add({
        regra: 'roas_baixo', especialista: 'performance', acao: 'reduzir', urgencia: 'alta', alvo,
        titulo: `Prejuízo: ROAS ${roas.toFixed(2)}x`,
        porque: `${O} ${quem} investiu ${brl(l.gastoCents)} e as vendas somaram ${brl(l.receitaRealCents)}. Cada real volta ${roas.toFixed(2)}.`,
        impacto: `Reduzir ou pausar evita perder cerca de ${brl(Math.max(0, l.gastoCents - l.receitaRealCents))} a cada ${e.dias} dias.`,
        numeros: { gastoCents: l.gastoCents, receitaCents: l.receitaRealCents, roas },
      })
      continue
    }

    if (tipo) {
      const custo = cpr(l, tipo)!
      const med = medianaCpr[tipo] ?? null
      const r = ROTULO_RESULTADO[tipo]

      if (med !== null && custo >= med * lim.cprCaroMultiplo) {
        perdedores.push(l)
        add({
          regra: 'cpr_caro', especialista: 'performance', acao: custo >= med * 3 ? 'pausar' : 'reduzir',
          urgencia: custo >= med * 3 ? 'alta' : 'media', alvo,
          titulo: `${r.um[0].toUpperCase() + r.um.slice(1)} caro demais: ${brl(custo)} cada`,
          porque: `${O} ${quem} paga ${brl(custo)} por ${r.um}, ${(custo / med).toFixed(1)}× o típico da conta (${brl(med)}).`,
          impacto: `Se a verba fosse para quem paga o típico, os mesmos ${brl(l.gastoCents)} trariam cerca de ${Math.floor(l.gastoCents / med)} ${r.varios} em vez de ${l.resultados[tipo]} (estimativa).`,
          numeros: { gastoCents: l.gastoCents, resultados: l.resultados[tipo], cprCents: Math.round(custo), cprTipicoCents: Math.round(med) },
        })
        continue
      }

      const bomPorCusto = med !== null && custo <= med * lim.cprBaratoMultiplo && l.resultados[tipo] >= lim.resultadosMinimosParaEscalar
      const bomPorRoas = roas !== null && roas >= lim.roasBom && l.vendasReais >= 2
      if (bomPorCusto || bomPorRoas) {
        vencedores.push({ l, cprCents: custo, tipo })
        const novo = Math.round(porDia * (1 + lim.passoEscalaPct / 100))
        add({
          regra: 'escalar', especialista: 'escala', acao: 'escalar', urgencia: 'media', alvo,
          titulo: bomPorRoas
            ? `Escalar: ROAS ${roas!.toFixed(2)}x`
            : `Escalar: ${r.um} a ${brl(custo)}, ${Math.round((1 - custo / med!) * 100)}% abaixo do típico`,
          porque: bomPorRoas
            ? `${O} ${quem} transformou ${brl(l.gastoCents)} em ${brl(l.receitaRealCents)} com ${l.vendasReais} vendas.`
            : `${O} ${quem} trouxe ${l.resultados[tipo]} ${r.varios} a ${brl(custo)} cada, contra ${brl(med!)} no resto da conta.`,
          impacto: `Suba o orçamento em ${lim.passoEscalaPct}% (de ${brl(porDia)} para ${brl(novo)} por dia) e reavalie em 3 dias. Subida brusca reinicia o aprendizado.`,
          numeros: { gastoCents: l.gastoCents, resultados: l.resultados[tipo], cprCents: Math.round(custo), cprTipicoCents: med !== null ? Math.round(med) : null, roas, porDiaCents: porDia, novoPorDiaCents: novo },
        })
      }

      // Tendência: custo por resultado piorando na janela recente
      const cprRec = l.recente.resultados > 0 ? l.recente.gastoCents / l.recente.resultados : null
      const cprAnt = l.anterior.resultados > 0 ? l.anterior.gastoCents / l.anterior.resultados : null
      if (cprRec !== null && cprAnt !== null && l.recente.resultados >= 2 && l.anterior.resultados >= 2 && cprRec >= cprAnt * lim.pioraRecenteMultiplo) {
        add({
          regra: 'custo_subindo', especialista: 'risco', acao: 'revisar', urgencia: 'media', alvo,
          titulo: `Custo subindo ${Math.round((cprRec / cprAnt - 1) * 100)}% nos últimos dias`,
          porque: `${O} ${quem} passou de ${brl(cprAnt)} para ${brl(cprRec)} por ${r.um}. É o primeiro sinal de criativo cansando ou leilão mais caro.`,
          impacto: 'Prepare um criativo novo antes que o custo dispare.',
          numeros: { cprRecenteCents: Math.round(cprRec), cprAnteriorCents: Math.round(cprAnt) },
        })
      }
    }
  }

  // ── 💰 Orçamento: tirar de quem perde, dar para quem ganha ──────────────
  const melhor = vencedores
    .filter(v => v.cprCents !== null && v.tipo !== null)
    .sort((a, b) => (a.cprCents! / (medianaCpr[a.tipo!] ?? 1)) - (b.cprCents! / (medianaCpr[b.tipo!] ?? 1)))[0]
  if (melhor && perdedores.length > 0) {
    const verbaDia = perdedores.reduce((s, l) => s + (l.orcamentoDiarioCents ?? Math.round(l.gastoCents / Math.max(1, e.dias))), 0)
    const tipo = melhor.tipo!
    const extras = Math.floor(verbaDia / melhor.cprCents!)
    add({
      regra: 'mover_verba', especialista: 'orcamento', acao: 'mover_verba', urgencia: 'alta',
      alvo: { nivel: melhor.l.nivel, id: melhor.l.id, nome: melhor.l.nome },
      titulo: `Mover ${brl(verbaDia)}/dia para "${melhor.l.nome}"`,
      porque: `${perdedores.length === 1 ? 'Um item' : `${perdedores.length} itens`} consome${perdedores.length === 1 ? '' : 'm'} ${brl(verbaDia)} por dia sem retorno (${perdedores.slice(0, 3).map(p => `"${p.nome}"`).join(', ')}${perdedores.length > 3 ? '…' : ''}). O melhor da conta traz ${ROTULO_RESULTADO[tipo].um} a ${brl(melhor.cprCents!)}.`,
      impacto: `Mantido esse custo, a mesma verba traria cerca de ${extras} ${ROTULO_RESULTADO[tipo].varios} a mais por dia (estimativa). Mova aos poucos: ${lim.passoEscalaPct}% por vez.`,
      numeros: { verbaDiaCents: verbaDia, cprVencedorCents: Math.round(melhor.cprCents!), resultadosExtrasDia: extras },
    })
  }

  // ── 🎨 Criativo ─────────────────────────────────────────────────────────
  for (const l of comGasto) {
    const alvo = { nivel: l.nivel, id: l.id, nome: l.nome }
    const quem = `${ROTULO_NIVEL[l.nivel]} "${l.nome}"`
    const O = ART[l.nivel].o, NO = ART[l.nivel].no
    if (l.ctr !== null && medCtr !== null && l.impressoes >= 1000 && l.ctr < medCtr * lim.ctrBaixoMultiplo) {
      add({
        regra: 'ctr_baixo', especialista: 'criativo', acao: 'trocar_criativo', urgencia: 'media', alvo,
        titulo: `Criativo não prende: CTR ${l.ctr.toFixed(2)}%`,
        porque: `${O} ${quem} teve ${l.impressoes.toLocaleString('pt-BR')} impressões e CTR de ${l.ctr.toFixed(2)}%, contra ${medCtr.toFixed(2)}% no resto da conta. As pessoas veem e passam.`,
        impacto: 'Teste um gancho novo nos 3 primeiros segundos, mantendo a mesma oferta.',
        numeros: { ctr: l.ctr, ctrTipico: medCtr, impressoes: l.impressoes },
      })
    }
    if (l.frequencia !== null && l.frequencia >= lim.frequenciaAlta) {
      add({
        regra: 'frequencia_alta', especialista: 'criativo', acao: 'ampliar_publico', urgencia: 'media', alvo,
        titulo: `Público cansado: frequência ${l.frequencia.toFixed(1)}`,
        porque: `${NO} ${quem}, cada pessoa já viu o anúncio ${l.frequencia.toFixed(1)} vezes em média. Daqui em diante o custo sobe sem trazer gente nova.`,
        impacto: 'Amplie o público ou troque o criativo.',
        numeros: { frequencia: l.frequencia, impressoes: l.impressoes },
      })
    }
    if (l.cpmCents !== null && medCpm !== null && l.cpmCents >= medCpm * lim.cpmCaroMultiplo) {
      add({
        regra: 'cpm_caro', especialista: 'criativo', acao: 'ampliar_publico', urgencia: 'baixa', alvo,
        titulo: `Público caro: CPM ${brl(l.cpmCents)}`,
        porque: `Mil impressões ${O === 'A' ? 'da' : 'do'} ${quem} custam ${brl(l.cpmCents)}, ${(l.cpmCents / medCpm).toFixed(1)}× o típico (${brl(medCpm)}). Público pequeno ou disputado demais.`,
        impacto: 'Teste público mais amplo ou Advantage+.',
        numeros: { cpmCents: l.cpmCents, cpmTipicoCents: Math.round(medCpm) },
      })
    }
  }

  // ── 🛡️ Risco ────────────────────────────────────────────────────────────
  for (const c of e.contas) {
    const alvo = { nivel: 'account' as const, id: null, nome: c.nome }
    if (c.status === 'token_expired') {
      add({ regra: 'token_vencido', especialista: 'risco', acao: 'reconectar', urgencia: 'alta', alvo,
        titulo: 'Conexão com a Meta caiu', porque: `A conta "${c.nome}" parou de ser lida. Tudo aqui está congelado no último dia lido.`,
        impacto: 'Reconecte a conta em "Contas de anúncio".', numeros: {} })
    } else if (c.erro) {
      add({ regra: 'erro_leitura', especialista: 'risco', acao: 'revisar', urgencia: 'alta', alvo,
        titulo: 'A última leitura da conta falhou', porque: `A Meta respondeu: ${c.erro}.`, impacto: null, numeros: {} })
    }
    if (c.tokenExpiraEm) {
      const diasRestantes = Math.ceil((new Date(c.tokenExpiraEm).getTime() - agora.getTime()) / 86_400_000)
      if (diasRestantes > 0 && diasRestantes <= 7) {
        add({ regra: 'token_vencendo', especialista: 'risco', acao: 'reconectar', urgencia: 'media', alvo,
          titulo: `Conexão vence em ${diasRestantes} dia(s)`, porque: `Quando vencer, a leitura de "${c.nome}" para sem aviso.`,
          impacto: 'Reconecte antes de vencer.', numeros: { diasRestantes } })
      }
    }
  }

  const receitaTotal = e.receitaAtribuidaCents + e.semAtribuicao.receitaCents
  if (e.semAtribuicao.vendas > 0 && receitaTotal > 0 && e.semAtribuicao.receitaCents / receitaTotal >= lim.fatiaSemOrigem) {
    const pct = Math.round((e.semAtribuicao.receitaCents / receitaTotal) * 100)
    add({ regra: 'rastreamento', especialista: 'risco', acao: 'corrigir_rastreamento', urgencia: 'alta',
      alvo: { nivel: 'account', id: null, nome: 'Rastreamento' },
      titulo: `${pct}% do faturamento sem anúncio de origem`,
      porque: `${e.semAtribuicao.vendas} venda(s), ${brl(e.semAtribuicao.receitaCents)}, chegaram sem saber de qual anúncio vieram. Enquanto isso durar, o time decide no escuro.`,
      impacto: 'Gere os links dos anúncios de novo pelo funil, com utm_ad_id.',
      numeros: { vendasSemOrigem: e.semAtribuicao.vendas, receitaSemOrigemCents: e.semAtribuicao.receitaCents, pct } })
  }

  for (const l of linhas) {
    const alvo = { nivel: l.nivel, id: l.id, nome: l.nome }
    const st = (l.status ?? '').toUpperCase()
    if (st === 'DISAPPROVED' || st === 'WITH_ISSUES') {
      add({ regra: 'reprovado', especialista: 'risco', acao: 'revisar', urgencia: 'alta', alvo,
        titulo: st === 'DISAPPROVED' ? 'Anúncio reprovado pela Meta' : 'Anúncio com problema na Meta',
        porque: `${ART[l.nivel].o} ${ROTULO_NIVEL[l.nivel]} "${l.nome}" está ${st === 'DISAPPROVED' ? 'reprovado' : 'com pendências'}. Reprovações repetidas podem restringir a conta inteira.`,
        impacto: 'Abra no Gerenciador e corrija ou peça revisão.', numeros: {} })
    }
    if (st === 'ACTIVE' && l.diasSemGastoNoFim >= 2 && l.gastoCents > 0) {
      add({ regra: 'entrega_parou', especialista: 'risco', acao: 'revisar', urgencia: 'media', alvo,
        titulo: `Ativo, mas sem gastar há ${l.diasSemGastoNoFim} dias`,
        porque: `${ART[l.nivel].o} ${ROTULO_NIVEL[l.nivel]} "${l.nome}" está ligado e parou de entregar. Pode ser orçamento esgotado, cartão, público ou lance.`,
        impacto: null, numeros: { diasSemGasto: l.diasSemGastoNoFim } })
    }
    const g = l.recente.gastoCents; const a = l.anterior.gastoCents
    if (a >= lim.gastoMinimoCents && g >= a * lim.gastoAcelerandoMultiplo && l.recente.resultados <= l.anterior.resultados) {
      add({ regra: 'gasto_acelerando', especialista: 'risco', acao: 'revisar', urgencia: 'media', alvo,
        titulo: `Gasto acelerou ${Math.round((g / a - 1) * 100)}% sem trazer mais resultado`,
        porque: `${ART[l.nivel].o} ${ROTULO_NIVEL[l.nivel]} "${l.nome}" gastou ${brl(g)} nos últimos dias contra ${brl(a)} antes, com ${l.recente.resultados} resultado(s) contra ${l.anterior.resultados}.`,
        impacto: 'Confira se alguém subiu o orçamento ou mudou o lance.', numeros: { gastoRecenteCents: g, gastoAnteriorCents: a } })
    }
  }

  // Dependência de uma campanha só
  const campanhas = linhas.filter(l => l.nivel === 'campaign')
  const totalRes = campanhas.reduce((s, l) => s + ORDEM_RESULTADO.reduce((x, t) => x + l.resultados[t], 0), 0)
  if (campanhas.length >= 2 && totalRes >= 10) {
    const top = [...campanhas].sort((a, b) => ORDEM_RESULTADO.reduce((x, t) => x + b.resultados[t], 0) - ORDEM_RESULTADO.reduce((x, t) => x + a.resultados[t], 0))[0]
    const fatia = ORDEM_RESULTADO.reduce((x, t) => x + top.resultados[t], 0) / totalRes
    if (fatia >= lim.concentracaoMax) {
      add({ regra: 'concentracao', especialista: 'risco', acao: 'revisar', urgencia: 'baixa',
        alvo: { nivel: 'campaign', id: top.id, nome: top.nome },
        titulo: `${Math.round(fatia * 100)}% dos resultados vêm de uma campanha só`,
        porque: `Se "${top.nome}" cair (criativo cansar, reprovação), quase tudo cai junto.`,
        impacto: 'Mantenha sempre um segundo criativo ou público em teste.', numeros: { fatia: Math.round(fatia * 100) } })
    }
  }

  // ── Resumo ──────────────────────────────────────────────────────────────
  const gasto = linhas.filter(l => l.nivel === (linhas.some(x => x.nivel === 'campaign') ? 'campaign' : linhas[0]?.nivel)).reduce((s, l) => s + l.gastoCents, 0)
  const nivelBase = linhas.some(x => x.nivel === 'campaign') ? 'campaign' : linhas[0]?.nivel
  const base = linhas.filter(l => l.nivel === nivelBase)
  const resultados = { compra: 0, lead: 0, conversa: 0, cadastro: 0 } as Record<TipoResultado, number>
  for (const l of base) for (const t of ORDEM_RESULTADO) resultados[t] += l.resultados[t]
  const receita = base.reduce((s, l) => s + l.receitaRealCents, 0)
  const idsPerda = new Set(recs.filter(r => r.especialista === 'performance').map(r => `${r.alvo.nivel}:${r.alvo.id}`))
  const idsGanho = new Set(recs.filter(r => r.acao === 'escalar').map(r => `${r.alvo.nivel}:${r.alvo.id}`))
  const emRisco = base.filter(l => idsPerda.has(`${l.nivel}:${l.id}`)).reduce((s, l) => s + l.gastoCents, 0)
  const vencendo = base.filter(l => idsGanho.has(`${l.nivel}:${l.id}`)).reduce((s, l) => s + l.gastoCents, 0)

  const ordenadas = recs.sort((a, b) => URG[a.urgencia] - URG[b.urgencia])
  const porEspecialista = { performance: [], escala: [], orcamento: [], criativo: [], risco: [] } as Record<Especialista, Recomendacao[]>
  for (const r of ordenadas) porEspecialista[r.especialista].push(r)

  return {
    resumo: {
      gastoCents: gasto,
      resultados,
      receitaCents: receita,
      roas: gasto > 0 && receita > 0 ? Math.round((receita / gasto) * 100) / 100 : null,
      dinheiroEmRiscoCents: emRisco,
      gastoVencedoresCents: vencendo,
      saude: gasto > 0 ? Math.max(0, Math.min(100, Math.round((1 - emRisco / gasto) * 100))) : null,
    },
    recomendacoes: ordenadas,
    porEspecialista,
  }
}
