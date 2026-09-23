// Cliente HTTP do painel /conteudos — mesmas assinaturas das actions (tipo via
// typeof import), transporte por fetch para /api/conteudos.
type Acoes = typeof import('@/app/actions/conteudos-ig')

async function chamar(op: string, args: unknown[]): Promise<unknown> {
  let resp: Response
  try {
    resp = await fetch('/api/conteudos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, args }), cache: 'no-store',
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }
  const corpo = await resp.json().catch(() => null) as { resultado?: unknown; error?: string } | null
  if (resp.status === 401 || corpo?.error === 'sem_sessao') {
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new Error('Sessão expirada')
  }
  if (!resp.ok || !corpo || corpo.error) throw new Error(corpo?.error ?? `HTTP ${resp.status}`)
  return corpo.resultado
}

function op<K extends keyof Acoes>(nome: K): Acoes[K] {
  return ((...args: unknown[]) => chamar(nome as string, args)) as Acoes[K]
}

export const listarConteudos = op('listarConteudos')
export const contagemPorStatus = op('contagemPorStatus')
export const conexaoInstagram = op('conexaoInstagram')
export const aprovarConteudo = op('aprovarConteudo')
export const aprovarTodosPendentes = op('aprovarTodosPendentes')
export const descartarConteudo = op('descartarConteudo')
export const voltarParaPendente = op('voltarParaPendente')
export const editarConteudo = op('editarConteudo')
export const tentarDeNovo = op('tentarDeNovo')
export const publicarAgora = op('publicarAgora')
export const proximaDataLivre = op('proximaDataLivre')
