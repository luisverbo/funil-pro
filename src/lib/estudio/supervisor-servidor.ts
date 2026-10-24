// ============================================================================
// Estúdio IA — Supervisor da Ana no servidor (banco + Sonnet 5.5)
// ----------------------------------------------------------------------------
// revisarConversas: pega as conversas paradas com mensagem nova, lê cada uma,
// grava estudio_revisoes (nota, resumo, onde parou) + estudio_achados e marca
// estudio_contatos.revisado_ate. Custo em estudio_ia_uso (finalidade
// 'supervisor'). Orçamento de tempo: o resto fica para a próxima hora.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarClaude, MODELO_FORTE } from './ana/ia'
import { precosDoPais, tabelaDePrecos } from './ana/executor'
import { idiomaDaAna } from './ana/textos'
import { registrarUsoIa } from './pix-servidor'
import { precisaRevisar, transcricao, promptSupervisor, lerAnalise, SCHEMA_SUPERVISOR, type MsgRevisao } from './supervisor'

export async function revisarConversas(admin: SupabaseClient, o: { tenantId?: string; contatoId?: string; limite?: number; orcamentoMs?: number } = {}): Promise<{ revisadas: number; achados: number; erros: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) return { revisadas: 0, achados: 0, erros: ['ANTHROPIC_API_KEY ausente'] }
  const inicio = Date.now()
  const orcamento = o.orcamentoMs ?? 240e3
  let q = admin.from('estudio_contatos').select('id, tenant_id, nome, pais, idioma, etapa, modo, ultima_msg_em, ultima_ana_em, revisado_ate')
    .order('ultima_msg_em', { ascending: false }).limit(200)
  if (o.tenantId) q = q.eq('tenant_id', o.tenantId)
  if (o.contatoId) q = q.eq('id', o.contatoId)
  const { data: contatos, error } = await q
  if (error) return { revisadas: 0, achados: 0, erros: [/revisado_ate|column/i.test(error.message) ? 'Falta rodar o SQL 20261108000000_estudio_ia_supervisor.sql no Supabase.' : error.message] }

  const agora = new Date()
  const fila = (contatos ?? []).map(c => ({ ...c, ultima: [c.ultima_msg_em, c.ultima_ana_em].filter(Boolean).sort().pop() ?? null }))
    .filter(c => o.contatoId ? true : precisaRevisar({ ultima_msg_em: c.ultima, revisado_ate: c.revisado_ate }, agora))
    .slice(0, o.limite ?? 25)
  const bases = new Map<string, { tipo: string; pergunta: string | null; resposta: string }[]>()
  let revisadas = 0, total = 0
  const erros: string[] = []

  for (const c of fila) {
    if (Date.now() - inicio > orcamento) break
    try {
      const { data: msgs } = await admin.from('estudio_mensagens').select('direcao, tipo, texto, criado_em, autor').eq('contato_id', c.id).order('criado_em', { ascending: true }).limit(300)
      const lista = (msgs ?? []) as MsgRevisao[]
      if (lista.length < 3) { await admin.from('estudio_contatos').update({ revisado_ate: c.ultima }).eq('id', c.id); continue }
      if (!bases.has(c.tenant_id)) {
        const { data: b } = await admin.from('estudio_conhecimento').select('tipo, pergunta, resposta').eq('tenant_id', c.tenant_id).eq('ativo', true).limit(200)
        bases.set(c.tenant_id, b ?? [])
      }
      const idioma = idiomaDaAna(c.idioma)
      const precos = await precosDoPais(admin, c.tenant_id, c.pais)
      const { texto, uso } = await chamarClaude(MODELO_FORTE, {
        max_tokens: 4096,
        system: [{ type: 'text', text: promptSupervisor({ pais: c.pais, idioma, tabelaPrecos: tabelaDePrecos(precos, idioma).replace(/\n/g, '; '), base: bases.get(c.tenant_id)! }) }],
        messages: [{ role: 'user', content: `Conversa (etapa atual da Ana: ${c.etapa ?? '?'}; atendimento: ${c.modo ?? 'ana'}):\n\n${transcricao(lista)}` }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA_SUPERVISOR } },
      })
      await registrarUsoIa(admin, { tenant_id: c.tenant_id, contato_id: c.id, pedido_id: null, finalidade: 'supervisor', uso })
      const a = lerAnalise(texto)
      if (!a) { erros.push(`${c.nome ?? c.id}: resposta ilegível`); continue }
      const { data: rev, error: eRev } = await admin.from('estudio_revisoes').insert({
        tenant_id: c.tenant_id, contato_id: c.id, nota: a.nota, resumo: a.resumo, parou_em: a.parou_em, venda: a.venda, mensagens: lista.length, custo_usd: uso.custo_usd,
      }).select('id').single()
      if (eRev || !rev) { erros.push(eRev?.message ?? 'revisão não gravada'); continue }
      // Revisão nova da mesma conversa substitui os achados ainda não tratados da anterior.
      await admin.from('estudio_achados').delete().eq('contato_id', c.id).eq('status', 'novo')
      if (a.achados.length) {
        await admin.from('estudio_achados').insert(a.achados.map(x => ({
          tenant_id: c.tenant_id, revisao_id: rev.id, contato_id: c.id, gravidade: x.gravidade, tipo: x.tipo,
          trecho: x.trecho.slice(0, 500), problema: x.problema.slice(0, 800), deveria: x.deveria.slice(0, 800), correcao: x.correcao,
        })))
      }
      await admin.from('estudio_contatos').update({ revisado_ate: c.ultima }).eq('id', c.id)
      revisadas++; total += a.achados.length
    } catch (err) { erros.push(`${c.nome ?? c.id}: ${String(err).slice(0, 160)}`) }
  }
  return { revisadas, achados: total, erros }
}
