// Encerrar / reabrir a conversa do estúdio. Encerrada = Ana calada (modo
// humano fixo) + selo com o motivo. Sem as colunas novas, fica só o "fixo".
import type { SupabaseClient } from '@supabase/supabase-js'

const faltaColuna = (m?: string) => !!m && /column|schema cache/i.test(m)

export async function encerrarConversa(admin: SupabaseClient, contatoId: string, motivo: string): Promise<void> {
  const base = { modo: 'humano', humano_fixo: true, humano_desde: new Date().toISOString(), precisa_humano: false }
  const { error } = await admin.from('estudio_contatos').update({ ...base, encerrada_em: new Date().toISOString(), encerrada_motivo: motivo.slice(0, 200) }).eq('id', contatoId)
  if (faltaColuna(error?.message)) await admin.from('estudio_contatos').update(base).eq('id', contatoId)
  else if (error) throw new Error(error.message)
}

/** Tira o selo (usado ao devolver para a Ana / assumir). */
export async function limparEncerramento(admin: SupabaseClient, contatoId: string): Promise<void> {
  await admin.from('estudio_contatos').update({ encerrada_em: null, encerrada_motivo: null }).eq('id', contatoId).then(() => {}, () => {})
}
