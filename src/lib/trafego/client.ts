// Cliente HTTP da aba /trafego — mesmas assinaturas das actions (tipo via
// typeof import), transporte por fetch para /api/trafego.
type Acoes = typeof import('@/app/actions/trafego-conexao')

async function chamar(op: string, args: unknown[]): Promise<unknown> {
  let resp: Response
  try {
    resp = await fetch('/api/trafego', {
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

export const buscarContasDoToken = op('buscarContasDoToken')
export const conectarContas = op('conectarContas')
export const listarContasConectadas = op('listarContasConectadas')
export const desconectarConta = op('desconectarConta')
export const sincronizarAgora = op('sincronizarAgora')
export const painelTrafego = op('painelTrafego')
export const parecerDoChefe = op('parecerDoChefe')
export const executarAcao = op('executarAcao')
