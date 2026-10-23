// Cliente HTTP da aba Estúdio IA — mesmas assinaturas das actions (tipo via
// typeof import), transporte por fetch para /api/estudio.
type Acoes = typeof import('@/app/actions/estudio') & typeof import('@/app/actions/estudio-chat') & typeof import('@/app/actions/estudio-ana') & typeof import('@/app/actions/estudio-pix') & typeof import('@/app/actions/estudio-pedidos')

async function chamar(op: string, args: unknown[]): Promise<unknown> {
  let resp: Response
  try {
    resp = await fetch('/api/estudio', {
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

export const listarCatalogo = op('listarCatalogo')
export const importarPoses = op('importarPoses')
export const salvarTema = op('salvarTema')
export const salvarPose = op('salvarPose')
export const subirFotoExemplo = op('subirFotoExemplo')
export const lerConfigEstudio = op('lerConfigEstudio')
export const salvarConfigEstudio = op('salvarConfigEstudio')
export const testarConexaoEstudio = op('testarConexaoEstudio')
export const registrarNumeroEstudio = op('registrarNumeroEstudio')
export const appsDaWaba = op('appsDaWaba')
export const inscreverAppNaWaba = op('inscreverAppNaWaba')
export const enviarTesteAvisos = op('enviarTesteAvisos')
export const ultimasConversasEstudio = op('ultimasConversasEstudio')
export const webhookDoNumeroEstudio = op('webhookDoNumeroEstudio')
export const apontarWebhookEstudio = op('apontarWebhookEstudio')
export const listarConversasChat = op('listarConversasChat')
export const abrirConversaChat = op('abrirConversaChat')
export const enviarTextoChat = op('enviarTextoChat')
export const urlDeUploadChat = op('urlDeUploadChat')
export const enviarMidiaChat = op('enviarMidiaChat')
export const enviarFotosDoPedidoChat = op('enviarFotosDoPedidoChat')
export const listarModelosChat = op('listarModelosChat')
export const enviarModeloChat = op('enviarModeloChat')
export const definirAtendimentoChat = op('definirAtendimentoChat')
export const salvarNotasChat = op('salvarNotasChat')
export const listarTextosAna = op('listarTextosAna')
export const salvarTextoAna = op('salvarTextoAna')
export const urlUploadMidiaAna = op('urlUploadMidiaAna')
export const salvarAudioAna = op('salvarAudioAna')
export const statusMidiasAna = op('statusMidiasAna')
export const chavePushEstudio = op('chavePushEstudio')
export const inscreverPushEstudio = op('inscreverPushEstudio')
export const testarPushEstudio = op('testarPushEstudio')

export const lerPixConfig = op('lerPixConfig')
export const salvarPixConfig = op('salvarPixConfig')
export const listarConferenciasPix = op('listarConferenciasPix')
export const listarPixDoDia = op('listarPixDoDia')
export const aprovarPagamentoPix = op('aprovarPagamentoPix')
export const recusarPagamentoPix = op('recusarPagamentoPix')
export const cancelarPedidoEstudio = op('cancelarPedidoEstudio')
export const listarConhecimento = op('listarConhecimento')
export const salvarConhecimento = op('salvarConhecimento')
export const excluirConhecimento = op('excluirConhecimento')
export const custoIaDaConversa = op('custoIaDaConversa')
export const custoIaDoDia = op('custoIaDoDia')
export const lerProducaoConfig = op('lerProducaoConfig')
export const salvarProducaoConfig = op('salvarProducaoConfig')
export const listarPedidosEstudio = op('listarPedidosEstudio')
export const abrirPedidoEstudio = op('abrirPedidoEstudio')
export const gerarPorApiAgora = op('gerarPorApiAgora')
export const aprovarEntregaEstudio = op('aprovarEntregaEstudio')
export const refazerPedidoEstudio = op('refazerPedidoEstudio')
export const reenviarEntregaEstudio = op('reenviarEntregaEstudio')
