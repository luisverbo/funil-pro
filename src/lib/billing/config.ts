// Lê a configuração da venda do quiz em platform_settings (service role).
// Só no servidor — nunca passe o objeto inteiro para um componente cliente.
import { createAdminClient } from '@/lib/supabase/admin'
import { CHAVES_VENDA_QUIZ, type ConfigVendaQuiz } from './quiz-venda'

export async function carregarConfigVendaQuiz(): Promise<ConfigVendaQuiz> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('platform_settings')
    .select('key, value')
    .in('key', [...CHAVES_VENDA_QUIZ])
  const c: Record<string, string | null> = {}
  for (const r of data ?? []) c[r.key] = r.value
  return c as ConfigVendaQuiz
}

/** O que a landing pode saber — sem chave nenhuma. */
export function configPublica(c: ConfigVendaQuiz): { stripe: boolean; preco: string | null } {
  return {
    stripe: !!(c.stripe_secret_key?.trim() && c.stripe_quiz_price_id?.trim()),
    preco: c.quiz_preco_exibido ?? null,
  }
}
