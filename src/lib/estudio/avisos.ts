// ============================================================================
// Estúdio IA — avisos ao Luís, SEMPRE registrados (estudio_avisos)
// ----------------------------------------------------------------------------
// 1) WhatsApp de avisos — mesmo quando é o MESMO número da cliente de teste.
//    O número é trocado pelo wa_id que a Meta já conhece (com/sem o 9º dígito
//    no Brasil), porque a Meta recusa variações do mesmo celular.
// 2) WhatsApp recusou (janela de 24 h fechada para o número de avisos):
//    modelo aprovado "novo_pedido" (utility) com o resumo numa linha só.
// 3) Push no celular (VAPID) — sempre.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { enviarTemplateCloud, enviarTextoCloud, type ContaCloud } from '@/lib/whatsapp-cloud'
import { normalizarWhatsApp } from './whatsapp'
import { avisarAparelhos } from './push'

export const MODELO_AVISO = 'novo_pedido'

/** Variações do mesmo celular brasileiro: com e sem o 9 depois do DDD. */
export function variantesDoNumero(numero: string | null | undefined): string[] {
  const n = normalizarWhatsApp(numero)
  if (!n) return []
  const out = new Set([n])
  const m = n.match(/^55(\d{2})(9?)(\d{8})$/)
  if (m) { out.add(`55${m[1]}9${m[3]}`); out.add(`55${m[1]}${m[3]}`) }
  return [...out]
}

/** Parâmetro de modelo: uma linha só (a Meta recusa quebra de linha/tab/4 espaços). */
export function linhaDoModelo(texto: string): string {
  return texto.replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').replace(/( · )+/g, ' · ').trim().slice(0, 1000)
}

type Resultado = { whatsapp: boolean; modelo: boolean; push: number; erro?: string }

async function registrar(admin: SupabaseClient, r: { tenant_id: string; pedido_id: string | null; canal: string; destino?: string | null; texto?: string | null; status: string; erro?: string | null; wamid?: string | null }) {
  const { error } = await admin.from('estudio_avisos').insert({ ...r, erro: r.erro?.slice(0, 500) ?? null })
  if (error) console.warn('[estudio/avisos] não registrou (SQL pendente?):', error.message)
}

export async function avisarLuisRegistrado(admin: SupabaseClient, con: ContaCloud & { tenant_id: string; whatsapp_avisos?: string | null }, mensagem: string, pedidoId: string | null): Promise<Resultado> {
  const res: Resultado = { whatsapp: false, modelo: false, push: 0 }
  const variantes = variantesDoNumero(con.whatsapp_avisos)
  if (!variantes.length) {
    await registrar(admin, { tenant_id: con.tenant_id, pedido_id: pedidoId, canal: 'whatsapp', destino: con.whatsapp_avisos ?? null, texto: mensagem, status: 'pulado', erro: 'sem número de avisos em Configurações' })
  } else {
    // O wa_id que a Meta já usa para esse celular (ex.: o Luís testando como cliente).
    const { data: conhecido } = await admin.from('estudio_contatos').select('id, wa_id').eq('tenant_id', con.tenant_id).in('wa_id', variantes).limit(1).maybeSingle()
    const destino = conhecido?.wa_id ?? variantes[0]
    const r = await enviarTextoCloud(con, destino, mensagem)
    res.whatsapp = r.ok
    await registrar(admin, { tenant_id: con.tenant_id, pedido_id: pedidoId, canal: 'whatsapp', destino, texto: mensagem, status: r.ok ? 'enviado' : 'erro', erro: r.ok ? null : r.erro, wamid: r.ok ? r.wamid : null })
    // Mesmo celular da cliente de teste: o aviso aparece também na conversa do painel.
    if (r.ok && conhecido) await admin.from('estudio_mensagens').insert({ tenant_id: con.tenant_id, contato_id: conhecido.id, wamid: r.wamid ?? null, direcao: 'saida', autor: 'sistema', tipo: 'texto', texto: mensagem, status_entrega: 'sent' }).then(() => {}, () => {})
    if (!r.ok) {
      res.erro = r.erro
      const m = await enviarTemplateCloud(con, destino, MODELO_AVISO, 'pt_BR', [linhaDoModelo(mensagem)])
      res.modelo = m.ok
      await registrar(admin, { tenant_id: con.tenant_id, pedido_id: pedidoId, canal: 'modelo', destino, texto: linhaDoModelo(mensagem), status: m.ok ? 'enviado' : 'erro', erro: m.ok ? null : `${m.erro} (crie o modelo utility "${MODELO_AVISO}" com 1 variável no corpo)`, wamid: m.ok ? m.wamid : null })
    }
  }
  res.push = await avisarAparelhos(admin, con.tenant_id)
  await registrar(admin, { tenant_id: con.tenant_id, pedido_id: pedidoId, canal: 'push', texto: mensagem.split('\n')[0], status: res.push > 0 ? 'enviado' : 'erro', erro: res.push > 0 ? null : 'nenhum celular inscrito (Conversas → 🔔 Ativar avisos)' })
  return res
}
