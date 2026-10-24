// ============================================================================
// Estúdio IA — despachante HTTP das ações do painel
// ----------------------------------------------------------------------------
// Mesmo desenho de /api/painel-quiz: lista FECHADA de operações que importam
// as MESMAS funções das actions. Autenticação continua dentro de cada função
// (sessão + tenant pelos cookies). Nome fora da lista = 404.
// ============================================================================
import { NextResponse } from 'next/server'
import {
  listarCatalogo, importarPoses, salvarTema, salvarPose, subirFotoExemplo,
  lerConfigEstudio, salvarConfigEstudio, testarConexaoEstudio, registrarNumeroEstudio,
  appsDaWaba, inscreverAppNaWaba, enviarTesteAvisos, ultimasConversasEstudio,
  webhookDoNumeroEstudio, apontarWebhookEstudio,
} from '@/app/actions/estudio'
import {
  listarConversasChat, abrirConversaChat, enviarTextoChat, urlDeUploadChat, enviarMidiaChat,
  enviarFotosDoPedidoChat, listarModelosChat, enviarModeloChat, definirAtendimentoChat, salvarNotasChat,
} from '@/app/actions/estudio-chat'
import {
  listarTextosAna, salvarTextoAna, urlUploadMidiaAna, salvarAudioAna, statusMidiasAna, gerarPdfsCatalogo,
  chavePushEstudio, inscreverPushEstudio, testarPushEstudio, lerHumanizarAna, salvarHumanizarAna,
} from '@/app/actions/estudio-ana'
import {
  lerPixConfig, salvarPixConfig, listarConferenciasPix, listarPixDoDia, aprovarPagamentoPix, recusarPagamentoPix, cancelarPedidoEstudio, listarConhecimento, salvarConhecimento, excluirConhecimento, custoIaDaConversa, custoIaDoDia, lerHotmartConfig, salvarHotmartConfig, listarPrecosEstudio, salvarPrecoEstudio, excluirPrecoEstudio, resumoFaturamento,
} from '@/app/actions/estudio-pix'
import {
  lerProducaoConfig, salvarProducaoConfig, listarPedidosEstudio, abrirPedidoEstudio, gerarPorApiAgora, aprovarEntregaEstudio, refazerPedidoEstudio, reenviarEntregaEstudio, listarAvisosEstudio, fotosRecebidasDoPedido, usarFotoComoEstudio, origemDasVendas, painelEstudio, painelSupervisor, aplicarAchado, ignorarAchado, revisarAgoraSupervisor, estadoMetaCapi, obterDatasetMeta, salvarCodigoTesteMeta,
} from '@/app/actions/estudio-pedidos'

// Envio de várias fotos do pedido pela Meta pode levar alguns segundos.
export const maxDuration = 300   // gerar os PDFs do catálogo (es/en) leva mais que 1 min

/* eslint-disable @typescript-eslint/no-explicit-any */
const OPERACOES: Record<string, (...args: any[]) => Promise<unknown>> = {
  listarCatalogo, importarPoses, salvarTema, salvarPose, subirFotoExemplo,
  lerConfigEstudio, salvarConfigEstudio, testarConexaoEstudio, registrarNumeroEstudio,
  appsDaWaba, inscreverAppNaWaba, enviarTesteAvisos, ultimasConversasEstudio,
  webhookDoNumeroEstudio, apontarWebhookEstudio,
  listarConversasChat, abrirConversaChat, enviarTextoChat, urlDeUploadChat, enviarMidiaChat,
  enviarFotosDoPedidoChat, listarModelosChat, enviarModeloChat, definirAtendimentoChat, salvarNotasChat,
  listarTextosAna, salvarTextoAna, urlUploadMidiaAna, salvarAudioAna, statusMidiasAna, gerarPdfsCatalogo,
  chavePushEstudio, inscreverPushEstudio, testarPushEstudio,
  lerPixConfig, salvarPixConfig, listarConferenciasPix, listarPixDoDia, aprovarPagamentoPix, recusarPagamentoPix, cancelarPedidoEstudio, listarConhecimento, salvarConhecimento, excluirConhecimento, custoIaDaConversa, custoIaDoDia,
  lerProducaoConfig, salvarProducaoConfig, listarPedidosEstudio, abrirPedidoEstudio, gerarPorApiAgora, aprovarEntregaEstudio, refazerPedidoEstudio, reenviarEntregaEstudio,
  lerHumanizarAna, salvarHumanizarAna, listarAvisosEstudio, fotosRecebidasDoPedido, usarFotoComoEstudio,
  lerHotmartConfig, salvarHotmartConfig, listarPrecosEstudio, salvarPrecoEstudio, excluirPrecoEstudio, resumoFaturamento,
  origemDasVendas, painelEstudio, painelSupervisor, aplicarAchado, ignorarAchado, revisarAgoraSupervisor, estadoMetaCapi, obterDatasetMeta, salvarCodigoTesteMeta,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  let corpo: { op?: string; args?: unknown[] }
  try { corpo = await request.json() } catch { return NextResponse.json({ error: 'corpo inválido' }, { status: 400 }) }

  const fn = corpo.op ? OPERACOES[corpo.op] : undefined
  if (!fn) return NextResponse.json({ error: 'operação desconhecida' }, { status: 404 })

  const args = Array.isArray(corpo.args) ? corpo.args.slice(0, 4) : []
  try {
    return NextResponse.json({ resultado: await fn(...args) })
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? ''
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return NextResponse.json({ error: 'sem_sessao' }, { status: 401 })
    }
    console.error(`[estudio] ${corpo.op} falhou`)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
