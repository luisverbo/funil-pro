// ============================================================================
// Content Studio — tradução da falha de imagem para a tela (módulo PURO)
// ----------------------------------------------------------------------------
// O defeito que isto conserta: `runStudioSlideImage`/`runViralCover` capturam
// o erro internamente e devolvem `{ok:false}` — a Server Action seguia para o
// readState e respondia SUCESSO. Resultado em produção: o botão "não fazia
// nada", o slide ficava "falhou" e a causa real (gravada em cs_steps.error)
// nunca chegava a quem clicou.
//
// Aqui o erro persistido vira UMA frase acionável em português. Regras:
//   • nada de corpo cru do provedor, prompt, chave ou URL interna
//   • o CÓDIGO técnico acompanha a frase entre parênteses — é ele que permite
//     diagnosticar sem adivinhação (verificação da organização, política de
//     conteúdo, tempo esgotado, cota)
//   • código desconhecido nunca some: aparece como está, truncado
// ============================================================================

/** Códigos que o provider de imagens emite (`code` do Error). */
export const STUDIO_IMAGE_ERROR_CODES = [
  'studio_images:missing_key',
  'studio_images:timeout',
  'studio_images:provider_error',
  'studio_images:empty_response',
  'studio_images:too_large',
  'studio_images:invalid_content',
] as const

/** Extrai `status=NNN` da mensagem persistida (o provider grava assim). */
function statusDe(mensagem: string): number | null {
  const m = /status=(\d{3})/.exec(mensagem)
  return m ? Number(m[1]) : null
}

/** Extrai `type=xxx` da mensagem persistida. */
function tipoDe(mensagem: string): string | null {
  const m = /type=([a-z0-9_.-]+)/i.exec(mensagem)
  return m && m[1] !== 'unknown' ? m[1] : null
}

/**
 * Traduz o `error` persistido do step de imagem numa frase acionável.
 * Devolve `null` quando não há erro — o chamador não precisa checar antes.
 */
export function describeImageFailure(erroPersistido: unknown): string | null {
  if (typeof erroPersistido !== 'string' || !erroPersistido.trim()) return null
  const bruto = erroPersistido.trim()
  const status = statusDe(bruto)
  const tipo = tipoDe(bruto)

  if (bruto.includes('studio_images:missing_key')) {
    return 'A chave da OpenAI não está configurada neste ambiente.'
  }
  if (bruto.includes('studio_images:timeout')) {
    return 'A geração passou do tempo limite da requisição. A qualidade Premium '
      + 'costuma demorar mais — tente novamente ou use a qualidade Rápida.'
  }
  if (bruto.includes('studio_images:empty_response')) {
    return 'A OpenAI respondeu sem imagem. Tente novamente. (resposta vazia)'
  }
  if (bruto.includes('studio_images:too_large')) {
    return 'A imagem devolvida passou do tamanho máximo aceito. (imagem grande demais)'
  }
  if (bruto.includes('studio_images:invalid_content')) {
    return 'A resposta da OpenAI não era uma imagem válida. (conteúdo inválido)'
  }

  if (bruto.includes('studio_images:provider_error')) {
    const sufixo = `(OpenAI ${status ?? '?'}${tipo ? ` · ${tipo}` : ''})`
    if (status === 401) return `A chave da OpenAI foi recusada. ${sufixo}`
    if (status === 403) {
      return 'A OpenAI recusou o acesso ao modelo de imagem. Normalmente é a '
        + `verificação da organização pendente no painel da OpenAI. ${sufixo}`
    }
    if (status === 429) {
      return 'A OpenAI recusou por limite de uso ou saldo — confira créditos e '
        + `limites na sua conta. ${sufixo}`
    }
    if (status === 400 && tipo && /moderation|safety|content_policy/i.test(tipo)) {
      return 'A política de conteúdo da OpenAI bloqueou esta cena. Regenere a '
        + `capa (a direção muda) ou ajuste o tema. ${sufixo}`
    }
    if (status === 400) {
      return `A OpenAI recusou o pedido de imagem. ${sufixo}`
    }
    if (status !== null && status >= 500) {
      return `A OpenAI está instável agora. Tente novamente em instantes. ${sufixo}`
    }
    return `A OpenAI recusou a geração. ${sufixo}`
  }

  // Falha nossa (composição, upload, storage) ou código novo: nunca sumir.
  return `A geração não foi concluída. (${bruto.slice(0, 120)})`
}
