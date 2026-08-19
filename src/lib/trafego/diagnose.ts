// ============================================================================
// Agente analista de tráfego (Fase 1, item 1.14)
// ----------------------------------------------------------------------------
// Este agente é DETERMINÍSTICO de propósito. A tentação era mandar os números
// para o modelo e pedir uma análise; três motivos para não fazer isso:
//
//   1. NÚMERO INVENTADO. Modelo de linguagem erra aritmética e arredonda
//      quando resume. Aqui, quem decide "isto é um problema" é regra com
//      limite explícito — o texto só descreve o que a conta já provou.
//   2. CUSTO. É a mesma decisão do classificador antes do agente de WhatsApp:
//      não chamar IA para o que uma comparação resolve.
//   3. AUDITÁVEL. Cada achado carrega o número que o gerou. Quando o Luís
//      discordar de um diagnóstico, dá para apontar a linha exata que decidiu.
//
// Os limites abaixo não são universais — são um ponto de partida honesto para
// e-commerce/infoproduto no Brasil, e ficam num só lugar para serem ajustados
// com dado real depois.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'
import type { LinhaRoas, ResumoRoas } from './roas'

export type Severidade = 'info' | 'atencao' | 'critico'

export interface Diagnostico {
  /** Regra que gerou — é a chave para o painel não repetir o mesmo achado. */
  regra: string
  severidade: Severidade
  escopo: 'account' | NivelAnuncio
  escopoId: string | null
  titulo: string
  corpo: string
  /** Ação proposta. A Fase 2 é que executa; aqui é só recomendação. */
  sugestao: Record<string, unknown>
  /** Os números que produziram o achado — sem eles, não dá para conferir. */
  numeros: Record<string, number | null>
}

export interface LimitesDiagnostico {
  /** Abaixo disto o gasto é pequeno demais para concluir qualquer coisa. */
  gastoMinimoCents: number
  /** ROAS abaixo do qual o anúncio está destruindo dinheiro. */
  roasCritico: number
  /** ROAS a partir do qual vale escalar. */
  roasBom: number
  /** Frequência média acima disto = público saturado. */
  frequenciaAlta: number
  /** CTR (%) abaixo disto = criativo não segura atenção. */
  ctrBaixo: number
  /** Fatia da receita sem origem que já denuncia rastreamento quebrado. */
  fatiaSemOrigem: number
}

export const LIMITES_PADRAO: LimitesDiagnostico = {
  gastoMinimoCents: 5_000,     // R$ 50 — abaixo disso é ruído, não tendência
  roasCritico: 1,
  roasBom: 3,
  frequenciaAlta: 3,
  ctrBaixo: 1,
  fatiaSemOrigem: 0.3,
}

const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const rotulo: Record<NivelAnuncio, string> = {
  campaign: 'A campanha', adset: 'O conjunto', ad: 'O anúncio',
}

function nomeDe(l: LinhaRoas): string {
  return l.nome ?? l.externalId
}

/**
 * Analisa o período e devolve os achados, do mais grave para o menos.
 *
 * Função pura: os testes rodam com dados de mentira e nenhuma chamada externa.
 */
export function diagnosticar(
  resumo: ResumoRoas,
  limites: LimitesDiagnostico = LIMITES_PADRAO,
): Diagnostico[] {
  const achados: Diagnostico[] = []
  const nivel = resumo.nivel
  const t = resumo.totais

  // ── Conta inteira ────────────────────────────────────────────────────────

  if (t.gastoCents === 0) {
    achados.push({
      regra: 'sem_gasto',
      severidade: 'info',
      escopo: 'account', escopoId: null,
      titulo: 'Nenhum gasto registrado no período',
      corpo: 'Ou os anúncios estão pausados, ou a leitura da Meta ainda não trouxe estes dias. '
        + 'Isto NÃO significa que não houve venda — significa que não há gasto para comparar.',
      sugestao: { acao: 'verificar_sincronizacao' },
      numeros: { gastoCents: 0 },
    })
    return achados
  }

  const receitaTotal = t.receitaCents + resumo.semAtribuicao.receitaCents
  const fatiaSemOrigem = receitaTotal > 0 ? resumo.semAtribuicao.receitaCents / receitaTotal : 0

  if (resumo.semAtribuicao.vendas > 0 && fatiaSemOrigem >= limites.fatiaSemOrigem) {
    achados.push({
      regra: 'rastreamento_furado',
      severidade: 'critico',
      escopo: 'account', escopoId: null,
      titulo: `${Math.round(fatiaSemOrigem * 100)}% do faturamento não tem anúncio de origem`,
      corpo: `${resumo.semAtribuicao.vendas} venda(s), somando ${brl(resumo.semAtribuicao.receitaCents)}, `
        + 'chegaram sem saber de qual anúncio vieram. Enquanto isso durar, o ROAS de cada linha '
        + 'abaixo está subestimado e não dá para decidir o que pausar. A causa quase sempre é link '
        + 'de anúncio sem utm_ad_id: gere o link de novo pelo funil.',
      sugestao: { acao: 'regerar_links_utm' },
      numeros: {
        vendasSemOrigem: resumo.semAtribuicao.vendas,
        receitaSemOrigemCents: resumo.semAtribuicao.receitaCents,
        fatia: Math.round(fatiaSemOrigem * 100),
      },
    })
  }

  if (t.estornadoCents > 0 && t.receitaCents > 0
      && t.estornadoCents / (t.receitaCents + t.estornadoCents) >= 0.1) {
    achados.push({
      regra: 'estorno_alto',
      severidade: 'atencao',
      escopo: 'account', escopoId: null,
      titulo: 'Estorno acima de 10% do faturado',
      corpo: `${brl(t.estornadoCents)} voltaram como reembolso ou chargeback. `
        + 'Isso costuma apontar promessa do anúncio desalinhada da entrega, não problema de mídia.',
      sugestao: { acao: 'revisar_promessa_da_oferta' },
      numeros: { estornadoCents: t.estornadoCents, receitaCents: t.receitaCents },
    })
  }

  // ── Linha a linha ────────────────────────────────────────────────────────

  for (const l of resumo.linhas) {
    // Gasto pequeno não sustenta conclusão nenhuma — dizer algo aqui seria
    // dar palpite com cara de análise.
    if (l.gastoCents < limites.gastoMinimoCents) continue

    if (l.vendas === 0) {
      achados.push({
        regra: 'gasto_sem_venda',
        severidade: 'critico',
        escopo: nivel, escopoId: l.externalId,
        titulo: `${nomeDe(l)}: ${brl(l.gastoCents)} sem nenhuma venda`,
        corpo: `${rotulo[nivel]} gastou ${brl(l.gastoCents)} no período e não tem venda atribuída. `
          + 'Confirme primeiro se o rastreamento do link está certo; se estiver, é candidato a pausa.',
        sugestao: { acao: 'pausar', motivo: 'sem_conversao' },
        numeros: { gastoCents: l.gastoCents, vendas: 0, cliques: l.cliques },
      })
    } else if (l.roas !== null && l.roas < limites.roasCritico) {
      achados.push({
        regra: 'roas_abaixo_de_um',
        severidade: 'critico',
        escopo: nivel, escopoId: l.externalId,
        titulo: `${nomeDe(l)}: ROAS ${l.roas.toFixed(2)}x — volta menos do que entra`,
        corpo: `Gastou ${brl(l.gastoCents)} e trouxe ${brl(l.receitaCents)}. `
          + `Cada real investido está voltando ${l.roas.toFixed(2)}.`,
        sugestao: { acao: 'pausar_ou_reduzir_orcamento' },
        numeros: { gastoCents: l.gastoCents, receitaCents: l.receitaCents, roas: l.roas },
      })
    } else if (l.roas !== null && l.roas >= limites.roasBom) {
      achados.push({
        regra: 'candidato_a_escalar',
        severidade: 'info',
        escopo: nivel, escopoId: l.externalId,
        titulo: `${nomeDe(l)}: ROAS ${l.roas.toFixed(2)}x — candidato a escalar`,
        corpo: `${brl(l.gastoCents)} viraram ${brl(l.receitaCents)} em ${l.vendas} venda(s). `
          + 'Suba o orçamento em passos de 20% e acompanhe: aumento brusco reinicia o aprendizado.',
        sugestao: { acao: 'aumentar_orcamento', passoPct: 20 },
        numeros: { gastoCents: l.gastoCents, receitaCents: l.receitaCents, roas: l.roas, vendas: l.vendas },
      })
    }

    if (l.frequenciaMedia !== null && l.frequenciaMedia >= limites.frequenciaAlta) {
      achados.push({
        regra: 'publico_saturado',
        severidade: 'atencao',
        escopo: nivel, escopoId: l.externalId,
        titulo: `${nomeDe(l)}: frequência ${l.frequenciaMedia.toFixed(1)} — público saturado`,
        corpo: 'A mesma pessoa já viu este anúncio várias vezes. Daqui em diante o custo sobe '
          + 'sem trazer gente nova: amplie o público ou troque o criativo.',
        sugestao: { acao: 'ampliar_publico_ou_trocar_criativo' },
        numeros: { frequencia: l.frequenciaMedia, impressoes: l.impressoes },
      })
    }

    if (l.ctrMedio !== null && l.ctrMedio > 0 && l.ctrMedio < limites.ctrBaixo && l.impressoes >= 1000) {
      achados.push({
        regra: 'criativo_fraco',
        severidade: 'atencao',
        escopo: nivel, escopoId: l.externalId,
        titulo: `${nomeDe(l)}: CTR ${l.ctrMedio.toFixed(2)}% — o criativo não segura atenção`,
        corpo: `${l.impressoes.toLocaleString('pt-BR')} impressões e poucos cliques. `
          + 'O problema está antes da página: é o anúncio que não faz clicar.',
        sugestao: { acao: 'trocar_criativo' },
        numeros: { ctr: l.ctrMedio, impressoes: l.impressoes, cliques: l.cliques },
      })
    }
  }

  const ordem: Record<Severidade, number> = { critico: 0, atencao: 1, info: 2 }
  return achados.sort((a, b) => ordem[a.severidade] - ordem[b.severidade])
}

/**
 * Guarda os achados em `traffic_diagnoses`.
 *
 * Antes de inserir, apaga o que a MESMA regra já gravou para o mesmo período —
 * senão cada rodada de hora em hora empilharia o mesmo alerta e o histórico
 * viraria ruído. Nunca lança: diagnóstico é leitura, não pode derrubar a
 * sincronização que veio antes.
 */
export async function salvarDiagnosticos(
  admin: SupabaseClient,
  entrada: {
    tenantId: string
    adAccountId: string | null
    periodo: { desde: string; ate: string }
    diagnosticos: Diagnostico[]
  },
): Promise<{ gravados: number; motivo?: string }> {
  if (entrada.diagnosticos.length === 0) return { gravados: 0 }
  try {
    await admin
      .from('traffic_diagnoses')
      .delete()
      .eq('tenant_id', entrada.tenantId)
      .eq('period_start', entrada.periodo.desde)
      .eq('period_end', entrada.periodo.ate)

    const linhas = entrada.diagnosticos.map(d => ({
      tenant_id: entrada.tenantId,
      ad_account_id: entrada.adAccountId,
      scope_level: d.escopo,
      scope_id: d.escopoId,
      period_start: entrada.periodo.desde,
      period_end: entrada.periodo.ate,
      severity: d.severidade,
      title: d.titulo,
      body: d.corpo,
      suggestion: { regra: d.regra, ...d.sugestao },
      metrics_snapshot: d.numeros,
      model: 'regras_deterministicas',
      prompt_version: 'v1',
    }))

    const { error } = await admin.from('traffic_diagnoses').insert(linhas)
    if (error) return { gravados: 0, motivo: error.message }
    return { gravados: linhas.length }
  } catch (err) {
    return { gravados: 0, motivo: err instanceof Error ? err.message : 'erro' }
  }
}
