// ============================================================================
// Parecer do estrategista-chefe — a IA ESCREVE, as regras DECIDEM
// ----------------------------------------------------------------------------
// Sob demanda (botão), nunca no carregamento da página: custo zero para quem
// só olha. A IA recebe o plano já calculado por mesa.ts e é proibida de
// inventar número — só pode reorganizar e priorizar o que as regras provaram.
// ============================================================================
import { brl, ROTULO_RESULTADO, type PlanoMesa, type TipoResultado } from './mesa'

export type ChamadaIa = (system: string, msgs: { role: string; content: string }[], maxTokens: number) => Promise<string>

export const SISTEMA_CHEFE = `Você é o estrategista-chefe de uma agência de tráfego pago, falando com o dono do negócio em português do Brasil.
Um time de especialistas já analisou a conta e te entregou as conclusões abaixo.
REGRAS:
- Use SOMENTE os números fornecidos. Nunca invente valor, porcentagem ou previsão.
- Se os dados forem poucos, diga isso com clareza.
- Formato: 1) Diagnóstico em 2 frases. 2) "Faça hoje": até 3 ações, em ordem. 3) "Esta semana": até 3 ações. 4) Um risco para vigiar.
- Frases curtas, sem jargão sem explicar, sem markdown pesado (use só listas com "-").`

export function montarBriefing(plano: PlanoMesa, dias: number): string {
  const r = plano.resumo
  const res = (Object.keys(r.resultados) as TipoResultado[])
    .filter(t => r.resultados[t] > 0)
    .map(t => `${r.resultados[t]} ${ROTULO_RESULTADO[t].varios}`).join(', ') || 'nenhum resultado registrado'
  const linhas = [
    `Período: últimos ${dias} dias.`,
    `Investido: ${brl(r.gastoCents)}. Resultados: ${res}. Faturamento confirmado: ${brl(r.receitaCents)}${r.roas !== null ? ` (ROAS ${r.roas}x)` : ''}.`,
    `Dinheiro em itens que o time mandou pausar/reduzir: ${brl(r.dinheiroEmRiscoCents)}. Em vencedores: ${brl(r.gastoVencedoresCents)}.`,
    '',
    'Conclusões do time (por urgência):',
    ...plano.recomendacoes.slice(0, 25).map(x => `- [${x.especialista}/${x.urgencia}] ${x.titulo}. ${x.porque}${x.impacto ? ` → ${x.impacto}` : ''}`),
  ]
  if (plano.recomendacoes.length === 0) linhas.push('- Nenhum alerta: a conta está dentro das réguas.')
  return linhas.join('\n')
}

export async function gerarParecer(plano: PlanoMesa, dias: number, chamar: ChamadaIa): Promise<string> {
  const texto = await chamar(SISTEMA_CHEFE, [{ role: 'user', content: montarBriefing(plano, dias) }], 900)
  return texto.trim()
}
