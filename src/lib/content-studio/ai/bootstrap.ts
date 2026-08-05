// ============================================================================
// Content Studio — bootstrap do provedor de IA (Fase 2B)
// ----------------------------------------------------------------------------
// A ligação EXPLÍCITA entre a porta e a implementação concreta.
//
// A primeira versão registrava a fábrica por efeito colateral de import em
// anthropic.ts — e o grafo de produção (registry → carousel-ai → provider)
// nunca importava aquele arquivo: em produção, o provedor real simplesmente
// não carregava, e toda produção falharia com "provider real não carregado".
// O teste de grafo em phase2b-provider.test.ts reproduz o defeito e trava a
// regressão.
//
// Regras desta resolução, na ordem:
//   1. provedor de TESTE instalado -> usa (nenhum teste chama API real)
//   2. kill switch desligado       -> ContentAIError('disabled')
//   3. cria o provedor Anthropic   -> lança missing_key/invalid_config na hora
//
// Server-only por transitividade: importa anthropic.ts, que lê a API key.
// Nenhum componente de cliente importa este módulo.
// ============================================================================

import { createAnthropicProvider } from './anthropic'
import { isContentAIEnabled } from './config'
import { ContentAIError, __getTestProvider, type ContentAIProvider } from './provider'

/**
 * Resolve o provedor ativo. SEM fallback silencioso: qualquer impossibilidade
 * vira erro com código claro — produção real jamais degrada para template.
 */
export function resolveContentAIProvider(): ContentAIProvider {
  const teste = __getTestProvider()
  if (teste) return teste

  if (!isContentAIEnabled()) throw new ContentAIError('disabled')

  return createAnthropicProvider()
}
