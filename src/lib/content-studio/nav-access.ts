// ============================================================================
// Content Studio — visibilidade do item de menu (decisão SERVER-ONLY)
// ----------------------------------------------------------------------------
// O botão "Content Studio" na sidebar só aparece para contas autorizadas via
// variável de ambiente CONTENT_STUDIO_NAV_USER_IDS (lista de UUIDs separados
// por vírgula, definida APENAS no servidor — nunca NEXT_PUBLIC).
//
// Regras:
//   - variável ausente / vazia / só espaços  -> NINGUÉM vê (default deny)
//   - comparação é por igualdade EXATA do id do usuário (após trim)
//   - nenhum e-mail, displayName ou papel (admin) participa da decisão
//
// Isto controla apenas a VISIBILIDADE do atalho. A rota /content-studio
// continua protegida pelo middleware de sessão como qualquer rota do painel.
// ============================================================================

const ENV_KEY = 'CONTENT_STUDIO_NAV_USER_IDS'

/** true somente se o userId consta na allowlist do servidor. Default: deny. */
export function canShowContentStudioNav(userId: string | null | undefined): boolean {
  if (typeof userId !== 'string' || userId.trim().length === 0) return false

  const raw = process.env[ENV_KEY]
  if (typeof raw !== 'string' || raw.trim().length === 0) return false

  const alvo = userId.trim()
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .includes(alvo)
}
