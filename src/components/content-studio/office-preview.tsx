'use client'

// ============================================================================
// Office Preview V2 — escritório 2D dirigido por eventos reais
// ----------------------------------------------------------------------------
// A tela NÃO simula a produção. Ela consome os eventos gravados em cs_events e
// revela um por vez. O timer controla apenas a VELOCIDADE da revelação — nunca
// o conteúdo: se o backend não gravou um evento, ele não aparece aqui.
//
// Por isso o estado visual é sempre `buildOfficeView(eventos revelados)`:
// recarregar a página reconstrói exatamente a mesma cena a partir do banco.
//
// PAUSAR interrompe só a revelação visual. O backend segue processando: os
// jobs já enfileirados continuam sendo executados e gravados.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { advanceDemo, getDemoState, getLatestDemo, startDemoProduction } from '@/app/actions/content-studio'
import {
  advanceProduction,
  createProduction,
  continueStudioProduction,
  createStudioProduction,
  getLatestProduction,
  getProductionState,
  generateAllStudioSlideImages,
  generateStudioSlideImage,
  listProductions,
  approveContentProduction,
  rejectContentProduction,
  removeAllOpenContentProductions,
  removeContentProduction,
  type RemoveResult,
  type ProductionState,
  type ProductionSummary,
} from '@/app/actions/content-production'
import { emptyProductionResult, type ProductionResult } from '@/lib/content-studio/result-view'
import { emptyOfficeView } from '@/lib/content-studio/view-model'
import type { BriefField } from '@/lib/content-studio/brief'
import ProductionForm from './production-form'
import QuickCreateForm, { type BrandProfile } from './quick-create-form'
import type { QuickObjetivo } from '@/lib/content-studio/quick/schema'
import ResultPanel from './result-panel'
import {
  buildOfficeView,
  productionStatusLabel,
  type OfficeView,
} from '@/lib/content-studio/view-model'
import type { PublicEvent } from '@/lib/content-studio/demo-guard'
import { PRODUCTION_TERMINAL, safeProductionMessage } from '@/lib/content-studio/production-guard'
import OfficeScene from './office-scene'
import TimelinePanel from './timeline-panel'

/**
 * Demonstração e produção real são FONTES SEPARADAS.
 *
 * Nunca compartilham lista de eventos: trocar de modo zera o que está na tela e
 * recarrega do lado certo. Misturar as duas mostraria um escritório dirigido
 * por eventos de duas produções diferentes — e a timeline viraria ficção.
 */
type Modo = 'demo' | 'producao'

const REVEAL_MS = 950         // ritmo base de revelação dos eventos gravados
const TICK_MS = 400           // intervalo entre pedidos de avanço ao servidor
const MAX_TICKS = 30          // teto de chamadas: o pipeline tem 3 passos
const MAX_TOTAL_MS = 60_000   // teto de tempo total do laço
// Geração Studio: 3 agentes. Se cada requisição avançar ao menos um, 3 bastam;
// o teto é 4 para tolerar uma parada por orçamento sem travar a tela.
const MAX_CONTINUACOES = 4
const MAX_SEM_PROGRESSO = 3   // rodadas sem evento novo antes de desistir

type Velocidade = 'normal' | 'rapido'
const FATOR: Record<Velocidade, number> = { normal: 1, rapido: 2.2 }

/**
 * Media query como fonte externa de verdade.
 *
 * `useSyncExternalStore` em vez de useEffect + setState: o navegador é quem
 * manda aqui, e o React só se inscreve. No servidor devolve `false`, então a
 * primeira pintura nunca diverge da hidratação.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mq = window.matchMedia(query)
    mq.addEventListener('change', notify)
    return () => mq.removeEventListener('change', notify)
  }, [query])

  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

export default function OfficePreview() {
  const [allEvents, setAllEvents] = useState<PublicEvent[]>([])
  const [revealed, setRevealed] = useState(0)
  const [productionId, setProductionId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [velocidade, setVelocidade] = useState<Velocidade>('normal')
  const [pausado, setPausado] = useState(false)

  // ─── Produção real ───────────────────────────────────────────────────────
  const [modo, setModo] = useState<Modo>('producao')
  const [result, setResult] = useState<ProductionResult>(emptyProductionResult)
  const [producoes, setProducoes] = useState<ProductionSummary[]>([])
  const [criando, setCriando] = useState(false)
  const [erroBrief, setErroBrief] = useState<string | null>(null)
  // Criação rápida é o PADRÃO; o briefing completo fica atrás do link.
  const [briefingAvancado, setBriefingAvancado] = useState(false)
  const [pipelineAtual, setPipelineAtual] = useState<string | null>(null)
  // Feedback COSMÉTICO durante a Server Action síncrona do quick: mostra o
  // Copywriter trabalhando SEM criar evento — nenhum evento sintético entra
  // em cs_events nem na timeline; a resposta real substitui tudo.
  const [quickGenerating, setQuickGenerating] = useState(false)
  // Produção Studio com agente faltando (pending do SERVIDOR): habilita o
  // botão "Continuar produção". Nunca dispara sozinho — retomar custa dinheiro
  // e exige um clique consciente.
  const [studioPendente, setStudioPendente] = useState(false)
  const [avisoContinuacao, setAvisoContinuacao] = useState<string | null>(null)
  const [gerandoImagens, setGerandoImagens] = useState(false)
  const [progressoImagens, setProgressoImagens] = useState<{ done: number; total: number } | null>(null)
  // Erro do FLUXO DE IMAGENS, escopado ao painel (nunca o banner global) e à
  // produção selecionada — trocar de produção ou de modo o limpa.
  const [erroImagem, setErroImagem] = useState<string | null>(null)
  /** Slide cuja geração está em voo — o botão daquele slide entra em loading. */
  const [gerandoSlide, setGerandoSlide] = useState<number | null>(null)
  const [aprovando, setAprovando] = useState(false)
  // Gerenciamento de produções: painel, confirmação pendente e toast.
  const [gerenciando, setGerenciando] = useState(false)
  const [confirmacao, setConfirmacao] = useState<
    | { tipo: 'uma'; id: string; titulo: string; aberta: boolean }
    | { tipo: 'todas'; qtd: number }
    | null
  >(null)
  const [removendo, setRemovendo] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const abrirProducaoRef = useRef<(id: string) => Promise<void>>(async () => {})

  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const compact = useMediaQuery('(max-width: 639px)')

  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  /**
   * Retomada ao abrir a página — só LEITURA.
   *
   * Recarregar NUNCA cria produção: as duas funções chamadas aqui apenas leem
   * a última produção (ou demonstração) já persistida. Se não houver nenhuma, a
   * tela fica vazia esperando o briefing.
   */
  useEffect(() => {
    let vivo = true

    // Duas chamadas distintas, sem união de tipos: a produção real devolve
    // `result`, a demonstração não. Unir as duas aqui esconderia essa diferença.
    const carregar = modo === 'demo'
      ? getLatestDemo().then(res => (
          res.ok
            ? { ok: true as const, data: res.data && { ...res.data, result: emptyProductionResult() } }
            : res
        ))
      : getLatestProduction()

    carregar
      .then(res => {
        if (!vivo) return
        if (!res.ok) { setError(res.error); return }
        if (res.data) {
          setProductionId(res.data.production.id)
          const prod = res.data.production as { pipelineKey?: string }
          setPipelineAtual(typeof prod.pipelineKey === 'string' ? prod.pipelineKey : null)
          setStatus(res.data.production.status)
          setAllEvents(res.data.events)
          setRevealed(res.data.events.length) // já aconteceu: mostra completa
          setResult(res.data.result)
        }
      })
      .catch(() => { if (vivo) setError('Não foi possível carregar. Tente novamente.') })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [modo])

  // Lista de produções para o seletor. Só leitura, só do tenant da sessão.
  useEffect(() => {
    if (modo !== 'producao') return
    let vivo = true
    listProductions()
      .then(res => { if (vivo && res.ok) setProducoes(res.data) })
      .catch(() => {})
    return () => { vivo = false }
  }, [modo, productionId])

  // Revela os eventos já gravados, um a um. Nunca cria evento.
  // Pausar apenas suspende ESTE efeito — o backend não sabe que existe pausa.
  useEffect(() => {
    if (pausado) return
    if (revealed >= allEvents.length) return
    const espera = reducedMotion ? 120 : REVEAL_MS / FATOR[velocidade]
    const t = setTimeout(() => setRevealed(n => Math.min(n + 1, allEvents.length)), espera)
    return () => clearTimeout(t)
  }, [revealed, allEvents.length, pausado, velocidade, reducedMotion])

  const view: OfficeView = useMemo(() => {
    // Durante a Server Action do quick não há eventos ainda: a cena mostra o
    // Copywriter trabalhando como estado VISUAL, sem tocar em cs_events. Assim
    // que a resposta chega, quickGenerating cai e os eventos reais assumem.
    if (quickGenerating) {
      // Enquanto a primeira Server Action não responde não existe evento algum.
      // A cena mostra o Estrategista (o primeiro da fila) trabalhando como
      // estado VISUAL, e as outras duas mesas já identificadas — sem gravar
      // nada em cs_events. Quando os eventos reais chegam, eles assumem.
      const cena = emptyOfficeView()
      const estrategista = cena.agents.find(a => a.key === 'strategist')
      if (estrategista) {
        estrategista.state = 'working'
        estrategista.bubble = 'Planejando seu carrossel…'
      }
      const designer = cena.agents.find(a => a.key === 'researcher')
      if (designer) designer.label = 'Designer'
      return cena
    }
    const cena = buildOfficeView(allEvents.slice(0, revealed))
    // IDENTIDADE DO PIPELINE, não evento: na geração Studio a terceira estação
    // pertence ao Designer desde o primeiro instante — só o RÓTULO muda; o
    // estado (idle/working/done) continua vindo exclusivamente dos eventos.
    // Produções antigas (pipelines cc_*) seguem mostrando "Pesquisador".
    if (pipelineAtual === 'content_carousel_studio_v1') {
      const terceira = cena.agents.find(a => a.key === 'researcher')
      if (terceira) terceira.label = 'Designer'
    }
    return cena
  }, [allEvents, revealed, quickGenerating, pipelineAtual])

  const reproduzindo = revealed < allEvents.length

  const iniciar = useCallback(async () => {
    // Guarda de clique duplo no cliente. O servidor também é idempotente — as
    // duas camadas existem porque nenhuma sozinha basta.
    if (running) return

    setError(null)
    setRunning(true)
    setPausado(false)
    setAllEvents([])
    setRevealed(0)

    const limite = Date.now() + MAX_TOTAL_MS
    let semProgresso = 0
    let ultimoTotal = -1

    try {
      const criada = await startDemoProduction()
      if (!criada.ok) { setError(criada.error); return }
      if (cancelled.current) return

      const id = criada.data.productionId
      setProductionId(id)

      for (let i = 0; i < MAX_TICKS; i++) {
        if (cancelled.current) return
        if (Date.now() > limite) {
          setError('A demonstração demorou mais que o esperado e foi interrompida.')
          break
        }

        const res = await advanceDemo(id)
        if (cancelled.current) return
        if (!res.ok) { setError(res.error); break }

        setAllEvents(res.data.events)
        setStatus(res.data.production.status)

        if (!res.data.pending) break   // terminou: para imediatamente

        semProgresso = res.data.events.length === ultimoTotal ? semProgresso + 1 : 0
        ultimoTotal = res.data.events.length
        if (semProgresso >= MAX_SEM_PROGRESSO) {
          setError('A demonstração parou de avançar. Tente novamente.')
          break
        }

        await new Promise(r => setTimeout(r, TICK_MS))
      }
    } catch {
      setError('Não foi possível concluir a demonstração. Tente novamente.')
    } finally {
      if (!cancelled.current) setRunning(false)
    }
  }, [running])

  // Reiniciar = reler do banco e reproduzir. NÃO cria produção nova.
  const reiniciar = useCallback(async () => {
    if (!productionId) return
    setError(null)
    setPausado(false)
    setRevealed(0)
    const res = await getDemoState(productionId)
    if (!res.ok) { setError(res.error); return }
    setAllEvents(res.data.events)
    setStatus(res.data.production.status)
  }, [productionId])

  /**
   * Troca a fonte exibida.
   *
   * O reset acontece AQUI, no evento, e não no efeito de carga: nenhum evento
   * do modo anterior pode sobreviver à transição, e limpar antes da chamada
   * garante que a tela nunca mostre a mistura por um instante sequer.
   */
  const trocarModo = useCallback((proximo: Modo) => {
    setModo(atual => {
      if (atual === proximo) return atual
      setLoading(true)
      setAllEvents([])
      setRevealed(0)
      setResult(emptyProductionResult())
      setProducoes([])
      setProductionId(null)
      setPipelineAtual(null)
      setStatus(null)
      setError(null)
      setErroBrief(null)
      setPausado(false)
      setQuickGenerating(false)
      setErroImagem(null)
      setGerandoSlide(null)
      setProgressoImagens(null)
      setAvisoContinuacao(null)
      return proximo
    })
  }, [])

  /**
   * Laço de avanço da produção real.
   *
   * O cliente só pede "processe o próximo passo". Ele não escolhe agente, não
   * envia status e não envia output — tudo isso é decidido e gravado no
   * servidor. Repetir a chamada é seguro: sem job aberto, é no-op.
   */
  const avancarAteParar = useCallback(async (id: string) => {
    const limite = Date.now() + MAX_TOTAL_MS
    let semProgresso = 0
    let ultimoTotal = -1

    for (let i = 0; i < MAX_TICKS; i++) {
      if (cancelled.current) return
      if (Date.now() > limite) {
        setError('A produção demorou mais que o esperado. Recarregue para ver o andamento.')
        return
      }

      const res = await advanceProduction(id)
      if (cancelled.current) return
      if (!res.ok) { setError(res.error); return }

      setAllEvents(res.data.events)
      setStatus(res.data.production.status)
      setResult(res.data.result)

      if (!res.data.pending) return   // acabou: para imediatamente

      semProgresso = res.data.events.length === ultimoTotal ? semProgresso + 1 : 0
      ultimoTotal = res.data.events.length
      if (semProgresso >= MAX_SEM_PROGRESSO) {
        setError('A produção parou de avançar. Tente novamente.')
        return
      }

      await new Promise(r => setTimeout(r, TICK_MS))
    }
  }, [])

  /**
   * O estado REAL entra na tela após CADA requisição — eventos, status,
   * resultado parcial e o `pending` do servidor. É o que faz a cena mostrar o
   * Estrategista entregar ao Copywriter, e ele ao Designer, em vez de congelar
   * no primeiro personagem até o fim.
   */
  const aplicarEstado = useCallback((estado: ProductionState) => {
    setStatus(estado.production.status)
    setAllEvents(estado.events)
    setResult(estado.result)
    setStudioPendente(
      estado.production.pipelineKey === 'content_carousel_studio_v1' && estado.pending,
    )
    if (!estado.pending) setAvisoContinuacao(null)
  }, [])

  /**
   * CRIAÇÃO RÁPIDA (geração Studio): Estrategista → Copywriter → Designer.
   *
   * Três chamadas de IA não cabem com segurança no limite de UMA requisição.
   * O servidor executa o que couber no orçamento e responde `pending: true`
   * quando ainda falta agente; aqui pedimos a continuação, no MÁXIMO
   * MAX_CONTINUACOES vezes. Não é polling: cada chamada faz trabalho real e o
   * estado de parada vem do banco (steps concluídos), não de um relógio.
   */
  const criarRapido = useCallback(async (dados: {
    tema: string; objetivo: QuickObjetivo; oferta: string; cta: string
    slides: number; marca: BrandProfile; idempotencyKey: string
  }) => {
    if (criando || running) return
    setErroBrief(null)
    setError(null)
    setErroImagem(null)
    setAvisoContinuacao(null)
    setCriando(true)
    setRunning(true)
    setQuickGenerating(true)
    setPausado(false)
    setAllEvents([])
    setRevealed(0)
    setResult(emptyProductionResult())

    try {
      let r = await createStudioProduction(dados)
      if (!r.ok) { setErroBrief(r.error); return }
      if (cancelled.current) return

      const id = r.data.production.id
      setProductionId(id)
      setPipelineAtual(r.data.production.pipelineKey)

      aplicarEstado(r.data)
      // A partir da primeira resposta existem eventos persistidos: a cena
      // cosmética sai e os eventos reais dirigem o escritório.
      setQuickGenerating(false)

      // Continua enquanto o SERVIDOR disser que falta agente. Laço fechado:
      // no máximo MAX_CONTINUACOES, cada iteração executa trabalho real (um
      // agente) ou devolve estado terminal — sem setInterval, sem polling.
      for (let i = 0; i < MAX_CONTINUACOES && r.ok && r.data.pending; i++) {
        const proximo = await continueStudioProduction(id)
        if (cancelled.current) return
        if (!proximo.ok) { setErroBrief(proximo.error); break }
        r = proximo
        aplicarEstado(r.data)
      }

      // Acabou o teto e AINDA falta agente? Nada de silêncio: a pessoa vê o
      // aviso e o botão "Continuar produção" para retomar com um clique.
      if (r.ok && r.data.pending) {
        setAvisoContinuacao('A produção ainda não terminou. Use "Continuar produção" para retomar de onde parou.')
      }
    } catch {
      setErroBrief('Não foi possível criar o carrossel. Tente novamente.')
    } finally {
      // Erro ou sucesso: o estado cosmético SEMPRE é limpo — a cena volta a
      // ser dirigida exclusivamente pelos eventos persistidos.
      if (!cancelled.current) { setCriando(false); setRunning(false); setQuickGenerating(false) }
    }
  }, [aplicarEstado, criando, running])

  /**
   * RETOMADA EXPLÍCITA de uma produção Studio incompleta — recarregou a
   * página, caiu a conexão, houve deploy no meio, ou o teto de continuações
   * terminou. Cada clique refaz o laço fechado de continuações; steps
   * concluídos nunca são repetidos (o servidor pula pelo estado persistido).
   * NUNCA dispara sozinho ao abrir a página: retomar custa uma chamada de IA.
   */
  const continuarProducao = useCallback(async () => {
    if (criando || running || !productionId) return
    setErroBrief(null)
    setError(null)
    setAvisoContinuacao(null)
    setCriando(true)
    setRunning(true)

    try {
      let r = await continueStudioProduction(productionId)
      if (!r.ok) { setErroBrief(r.error); return }
      if (cancelled.current) return
      aplicarEstado(r.data)

      for (let i = 0; i < MAX_CONTINUACOES && r.ok && r.data.pending; i++) {
        const proximo = await continueStudioProduction(productionId)
        if (cancelled.current) return
        if (!proximo.ok) { setErroBrief(proximo.error); break }
        r = proximo
        aplicarEstado(r.data)
      }

      if (r.ok && r.data.pending) {
        setAvisoContinuacao('A produção ainda não terminou. Use "Continuar produção" para retomar de onde parou.')
      }
    } catch {
      setErroBrief('Não foi possível continuar a produção. Tente novamente.')
    } finally {
      if (!cancelled.current) { setCriando(false); setRunning(false) }
    }
  }, [aplicarEstado, criando, productionId, running])

  /** Cria a produção a partir do briefing e acompanha até o portão de aprovação. */
  const iniciarProducao = useCallback(async (
    valores: Record<BriefField, string>,
    idempotencyKey: string,
  ) => {
    if (criando || running) return

    setErroBrief(null)
    setError(null)
    setCriando(true)
    setRunning(true)
    setPausado(false)
    setAllEvents([])
    setRevealed(0)
    setResult(emptyProductionResult())

    try {
      // A chave viaja com o briefing: dois envios iguais devolvem a MESMA
      // produção, mesmo que o botão desabilitado não tenha segurado o segundo.
      const criada = await createProduction({ ...valores, idempotencyKey })
      if (!criada.ok) { setErroBrief(criada.error); return }
      if (cancelled.current) return

      const id = criada.data.production.id
      setProductionId(id)
      setPipelineAtual(criada.data.production.pipelineKey)
      setStatus(criada.data.production.status)
      setAllEvents(criada.data.events)
      setResult(criada.data.result)

      if (criada.data.pending) await avancarAteParar(id)
    } catch {
      setErroBrief('Não foi possível iniciar a produção. Tente novamente.')
    } finally {
      if (!cancelled.current) { setCriando(false); setRunning(false) }
    }
  }, [avancarAteParar, criando, running])

  /**
   * ARTE de um slide: uma Server Action, uma chamada de imagem. `retry` só
   * vem dos botões explícitos (Tentar novamente / Regenerar) — nunca é
   * decidido sozinho.
   */
  const gerarImagem = useCallback(async (slide: number, retry: boolean) => {
    if (criando || running || gerandoImagens || !productionId) return
    // Ação nova = erro velho fora. O erro de imagem vive NO painel de imagens,
    // nunca no banner global — e sucesso o apaga.
    setErroImagem(null)
    setGerandoImagens(true)
    setGerandoSlide(slide)
    try {
      const r = await generateStudioSlideImage(productionId, slide, retry ? { retry: true } : undefined)
      if (cancelled.current) return
      if (!r.ok) { setErroImagem(r.error); return }
      aplicarEstado(r.data)
      const img = r.data.result.imagens.find(i => i.numero === slide)
      if (img?.status === 'falhou') {
        setErroImagem('A imagem deste slide falhou. Use "Tentar novamente" quando quiser.')
      }
    } catch {
      setErroImagem('Não foi possível gerar a imagem. Tente novamente.')
    } finally {
      if (!cancelled.current) { setGerandoImagens(false); setGerandoSlide(null) }
    }
  }, [aplicarEstado, criando, gerandoImagens, productionId, running])

  /**
   * "Gerar todas": laço FECHADO — cada requisição gera A PRÓXIMA imagem que
   * falta e devolve o progresso real (N de M). Para quando completa, quando o
   * servidor deixa de progredir (ex.: só restam falhas, que exigem o botão
   * explícito) ou no teto. Sem setInterval, sem polling.
   */
  const gerarTodas = useCallback(async () => {
    if (criando || running || gerandoImagens || !productionId) return
    setErroImagem(null)
    setGerandoImagens(true)
    setProgressoImagens(null)
    try {
      let anterior = -1
      let ultimo: ProductionState | null = null
      for (let i = 0; i < 10; i++) {
        const r = await generateAllStudioSlideImages(productionId)
        if (cancelled.current) return
        if (!r.ok) { setErroImagem(r.error); break }
        ultimo = r.data
        aplicarEstado(r.data)
        setProgressoImagens({ done: r.data.imagesDone, total: r.data.imagesTotal })
        if (r.data.imagesDone >= r.data.imagesTotal) break
        if (r.data.imagesDone === anterior) break  // sem progresso: parar
        anterior = r.data.imagesDone
      }
      // Resumo honesto: quantas ficaram prontas e quantas falharam. As que já
      // estavam prontas permanecem — falha de uma não derruba as outras.
      if (ultimo) {
        const prontas = ultimo.result.imagens.filter(i => i.status === 'pronto').length
        const falhas = ultimo.result.imagens.filter(i => i.status === 'falhou').length
        if (falhas > 0) {
          setErroImagem(`${prontas} de ${ultimo.result.imagens.length} imagens prontas; ${falhas} ${falhas === 1 ? 'falhou' : 'falharam'}. Use "Tentar novamente" nos slides que faltaram.`)
        } else if (prontas === ultimo.result.imagens.length) {
          setToast(`Todas as ${prontas} imagens do carrossel estão prontas.`)
        }
      }
    } catch {
      setErroImagem('Não foi possível gerar as imagens. Tente novamente.')
    } finally {
      if (!cancelled.current) setGerandoImagens(false)
    }
  }, [aplicarEstado, criando, gerandoImagens, productionId, running])

  /** Volta a tela ao estado inicial (nenhuma produção selecionada). */
  const limparTela = useCallback(() => {
    setProductionId(null)
    setPipelineAtual(null)
    setStatus(null)
    setAllEvents([])
    setRevealed(0)
    setResult(emptyProductionResult())
    setStudioPendente(false)
    setAvisoContinuacao(null)
    setProgressoImagens(null)
  }, [])

  /**
   * Aplica o retorno das ações de remoção: lista nova no seletor e, se a
   * produção selecionada saiu da lista, seleciona a mais recente restante —
   * ou limpa a tela quando não sobra nenhuma. Tudo sem refresh.
   */
  const aplicarRemocao = useCallback(async (dados: RemoveResult) => {
    setProducoes(dados.productions)
    if (dados.removed > 0) {
      setToast('Produção removida. Agora você pode criar outra.')
      // O limite deixou de valer: o aviso antigo sai da frente do formulário.
      if (erroBrief === safeProductionMessage('too_many_open')) setErroBrief(null)
    }
    const selecionadaSumiu = productionId && !dados.productions.some(p => p.id === productionId)
    if (selecionadaSumiu) {
      const maisRecente = dados.productions[0]
      if (maisRecente) await abrirProducaoRef.current(maisRecente.id)
      else limparTela()
    }
  }, [erroBrief, limparTela, productionId])

  /** Remove UMA produção (soft delete no servidor). Idempotente. */
  const removerProducao = useCallback(async (id: string) => {
    if (removendo) return
    setRemovendo(true)
    setError(null)
    try {
      const r = await removeContentProduction(id)
      if (cancelled.current) return
      if (!r.ok) { setError(r.error); return }
      await aplicarRemocao(r.data)
    } catch {
      setError('Não foi possível remover a produção. Tente novamente.')
    } finally {
      if (!cancelled.current) { setRemovendo(false); setConfirmacao(null) }
    }
  }, [aplicarRemocao, removendo])

  /** Cancela TODAS as abertas do tenant — o servidor decide quais são. */
  const removerTodasAbertas = useCallback(async () => {
    if (removendo) return
    setRemovendo(true)
    setError(null)
    try {
      const r = await removeAllOpenContentProductions()
      if (cancelled.current) return
      if (!r.ok) { setError(r.error); return }
      await aplicarRemocao(r.data)
    } catch {
      setError('Não foi possível remover as produções. Tente novamente.')
    } finally {
      if (!cancelled.current) { setRemovendo(false); setConfirmacao(null) }
    }
  }, [aplicarRemocao, removendo])

  /** APROVA a produção no portão humano — CAS awaiting_approval -> approved. */
  const aprovarProducao = useCallback(async () => {
    if (aprovando || removendo || !productionId) return
    setError(null)
    setErroImagem(null)
    setAprovando(true)
    try {
      const r = await approveContentProduction(productionId)
      if (cancelled.current) return
      if (!r.ok) { setError(r.error); return }
      aplicarEstado(r.data)
      // O seletor reflete o novo status sem refetch.
      setProducoes(atual => atual.map(p =>
        p.id === productionId ? { ...p, status: r.data.production.status } : p))
      setToast('Produção aprovada!')
    } catch {
      setError('Não foi possível aprovar. Tente novamente.')
    } finally {
      if (!cancelled.current) setAprovando(false)
    }
  }, [aplicarEstado, aprovando, productionId, removendo])

  /**
   * REPROVA: grava o evento content_rejected e ARQUIVA a produção (status
   * canceled — sai da lista e da cota; histórico e artes ficam). A confirmação
   * na tela diz exatamente isso antes do clique.
   */
  const reprovarProducao = useCallback(async () => {
    if (aprovando || removendo || !productionId) return
    setError(null)
    setErroImagem(null)
    setAprovando(true)
    try {
      const r = await rejectContentProduction(productionId)
      if (cancelled.current) return
      if (!r.ok) { setError(r.error); return }
      await aplicarRemocao(r.data)
      setToast('Produção reprovada e arquivada. Crie uma nova versão quando quiser.')
    } catch {
      setError('Não foi possível reprovar. Tente novamente.')
    } finally {
      if (!cancelled.current) setAprovando(false)
    }
  }, [aplicarRemocao, aprovando, productionId, removendo])

  /** Troca a produção exibida. Só lê — nunca dispara execução. */
  const abrirProducao = useCallback(async (id: string) => {
    if (running) return
    // NENHUM erro sobrevive à troca de produção: cada erro pertence à ação e
    // à produção em que nasceu.
    setError(null)
    setErroBrief(null)
    setErroImagem(null)
    setProgressoImagens(null)
    setGerandoSlide(null)
    setPausado(false)
    setRevealed(0)
    setAllEvents([])
    setResult(emptyProductionResult())

    setAvisoContinuacao(null)
    const res = await getProductionState(id)
    if (!res.ok) { setError(res.error); return }
    setProductionId(id)
    setPipelineAtual(res.data.production.pipelineKey)
    // `aplicarEstado` também deriva `studioPendente` do pending do servidor:
    // reabrir uma produção Studio incompleta mostra o botão de continuar.
    aplicarEstado(res.data)
  }, [aplicarEstado, running])

  // `aplicarRemocao` é declarado antes de `abrirProducao`; o ref quebra o nó.
  useEffect(() => { abrirProducaoRef.current = abrirProducao }, [abrirProducao])

  // O toast se recolhe sozinho.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const vazio = !loading && allEvents.length === 0 && !running
  const estadoCor =
    status === 'failed' ? 'text-rose-600'
    : status === 'review' || status === 'published' ? 'text-emerald-600'
    : status ? 'text-indigo-600' : 'text-gray-400'
  const eventoAtual = revealed > 0 ? (view.timeline[view.timeline.length - 1]?.seq ?? 0) : 0

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">
      {/* Cabeçalho — faixa única: identidade, selo e estado na mesma linha */}
      <header className="mb-3 rounded-2xl bg-white border border-gray-100 shadow-sm px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-lg sm:text-xl shadow-md shadow-indigo-200/60">
            🏢
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-gray-900 leading-tight truncate">
                Content Studio
              </h1>
              {/* Selo VERDADEIRO por contexto — a fonte é o pipelineKey do
                  servidor, nunca uma escolha do cliente. */}
              {(() => {
                const selo = modo === 'demo'
                  ? { txt: 'demo', title: 'Agentes determinísticos, sem IA e sem custo', cor: 'bg-amber-50 border-amber-200/70 text-amber-600' }
                  : pipelineAtual === 'content_carousel_studio_v1'
                    ? { txt: 'IA + design', title: 'Estrategista, Copywriter e Designer com IA', cor: 'bg-violet-50 border-violet-200/70 text-violet-600' }
                    : pipelineAtual === 'content_carousel_quick_v1'
                    ? { txt: 'IA rápida', title: 'Criação rápida: uma geração direta com IA', cor: 'bg-violet-50 border-violet-200/70 text-violet-600' }
                    : pipelineAtual === 'content_carousel_ai_v1'
                      ? { txt: 'IA', title: 'Geração realizada com IA', cor: 'bg-violet-50 border-violet-200/70 text-violet-600' }
                      : pipelineAtual === 'content_carousel_v1'
                        ? { txt: 'determinístico', title: 'Geração determinística, sem IA', cor: 'bg-gray-100 border-gray-200 text-gray-500' }
                        : { txt: 'pronto', title: 'Nenhuma produção selecionada', cor: 'bg-gray-100 border-gray-200 text-gray-500' }
                return (
                  <span
                    className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${selo.cor}`}
                    title={selo.title}
                  >
                    {selo.txt}
                  </span>
                )
              })()}
            </div>
            <p className="text-[12px] sm:text-[13px] text-gray-500 truncate">
              Escritório virtual dos agentes de conteúdo
            </p>
          </div>

          {/* Estado da produção, sempre em português */}
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 leading-none">Produção</p>
            <p className={`text-[12px] sm:text-[13px] font-bold leading-tight ${estadoCor}`}>
              {productionStatusLabel(status)}
            </p>
          </div>
        </div>
      </header>

      {/* Seletor de fonte: demonstração e produção real nunca se misturam. */}
      <div
        className="mb-3 inline-flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
        role="group"
        aria-label="O que mostrar no escritório"
      >
        {([['producao', 'Produção'], ['demo', 'Demonstração']] as const).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => trocarModo(valor)}
            disabled={running || criando}
            aria-pressed={modo === valor}
            className={`px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-50 ${
              modo === valor ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {/* Criação rápida é o padrão; o briefing completo fica atrás do link. */}
      {modo === 'producao' && !briefingAvancado && (
        <QuickCreateForm
          onSubmit={criarRapido}
          enviando={criando}
          erro={erroBrief}
          onBriefingAvancado={() => setBriefingAvancado(true)}
        />
      )}
      {modo === 'producao' && briefingAvancado && (
        <>
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setBriefingAvancado(false)}
              className="text-sm font-semibold text-indigo-600 underline-offset-2 hover:underline"
            >
              ← Voltar para a criação rápida
            </button>
          </div>
          <ProductionForm onSubmit={iniciarProducao} enviando={criando} erro={erroBrief} />
        </>
      )}

      {/* Produções do tenant — trocar de produção só LÊ, nunca executa. */}
      {modo === 'producao' && producoes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="cs-producao" className="text-[12px] font-semibold text-gray-600">
            Produção
          </label>
          <select
            id="cs-producao"
            value={productionId ?? ''}
            disabled={running || criando}
            onChange={e => { void abrirProducao(e.target.value) }}
            className="max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-50"
          >
            {producoes.map(p => (
              <option key={p.id} value={p.id}>
                {p.title ?? 'Sem título'} — {productionStatusLabel(p.status)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setGerenciando(true)}
            disabled={running || criando}
            aria-label="Gerenciar produções"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            <span aria-hidden>🗑</span>
            <span className="ml-1 hidden sm:inline">Gerenciar</span>
          </button>
        </div>
      )}

      {/* Limite atingido: além do aviso, o CAMINHO para resolver */}
      {modo === 'producao' && erroBrief === safeProductionMessage('too_many_open') && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm font-semibold text-amber-900">{erroBrief}</p>
          <button
            type="button"
            onClick={() => setGerenciando(true)}
            className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-600"
          >
            Gerenciar produções
          </button>
        </div>
      )}

      {/* Toast de confirmação */}
      {toast && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5" role="status">
          <p className="text-sm font-semibold text-emerald-800">✓ {toast}</p>
        </div>
      )}

      {/* Controles — HUD compacto, tudo numa faixa */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {modo === 'demo' && (
        <button
          onClick={iniciar}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-b from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 ring-1 ring-inset ring-white/25 transition-all hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0"
        >
          <span aria-hidden>{running ? '⏳' : '▶'}</span>
          {running ? 'Executando...' : 'Iniciar demonstração'}
        </button>
        )}

        <div className="inline-flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={reiniciar}
            disabled={running || !productionId || modo !== 'demo'}
            className="px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Reproduz de novo os eventos já gravados"
          >
            ↻ <span className="hidden sm:inline">Reiniciar</span>
          </button>
          <span className="w-px bg-gray-200" aria-hidden />
          <button
            onClick={() => setPausado(p => !p)}
            disabled={!reproduzindo && !pausado}
            aria-pressed={pausado}
            className="px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Pausa apenas a animação — o processamento continua"
          >
            {pausado ? '▶' : '❚❚'} <span className="hidden sm:inline">{pausado ? 'Continuar' : 'Pausar'}</span>
          </button>
        </div>

        {/* Velocidade: puramente visual. */}
        <div
          className="inline-flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
          role="group"
          aria-label="Velocidade da animação"
        >
          {(['normal', 'rapido'] as const).map(vel => (
            <button
              key={vel}
              onClick={() => setVelocidade(vel)}
              aria-pressed={velocidade === vel}
              className={`px-3.5 py-2.5 text-sm font-bold transition-colors ${
                velocidade === vel ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {vel === 'normal' ? '1x' : '2x'}
            </button>
          ))}
        </div>

        {/* Andamento da reprodução — some quando não há nada a reproduzir */}
        {allEvents.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 tabular-nums">
            <span
              className={`w-1.5 h-1.5 rounded-full ${reproduzindo && !pausado ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}
              aria-hidden
            />
            {revealed}/{allEvents.length}
          </span>
        )}
      </div>

      {/* Geração rápida em andamento — texto honesto, sem evento sintético */}
      {quickGenerating && (
        <div className="mb-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
          <p className="text-sm font-semibold text-indigo-800">
            Estrategista, Copywriter e Designer trabalhando no seu carrossel…
          </p>
          <p className="text-[12px] text-indigo-600 mt-0.5">
            São três etapas seguidas: isso costuma levar de trinta segundos a um minuto.
          </p>
        </div>
      )}

      {/* Produção Studio incompleta — retomada EXPLÍCITA, nunca automática */}
      {modo === 'producao' && studioPendente && !criando && !quickGenerating && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">
              {avisoContinuacao ?? 'Esta produção parou no meio — os agentes que já trabalharam estão salvos.'}
            </p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Continuar executa apenas os agentes que faltam; nada é refeito.
            </p>
          </div>
          <button
            type="button"
            onClick={continuarProducao}
            className="shrink-0 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-600"
          >
            Continuar produção
          </button>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-semibold text-rose-800">Não foi possível concluir</p>
          <p className="text-sm text-rose-700 mt-0.5 break-words">{error}</p>
        </div>
      )}

      {/* Escritório */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-4">
        {loading ? (
          <div className="h-64 sm:h-80 animate-pulse bg-gradient-to-b from-slate-100 to-slate-50" />
        ) : (
          <OfficeScene
            view={view}
            layout={compact ? 'compact' : 'wide'}
            reducedMotion={reducedMotion}
            speed={FATOR[velocidade]}
            paused={pausado}
          />
        )}
      </section>

      {/* Conclusão / falha */}
      {view.finished && (
        <p className="mb-4 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          ✓ Produção concluída — aguardando aprovação.
        </p>
      )}
      {view.failed && (
        <p className="mb-4 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-800">
          A produção falhou. A linha do tempo mostra em qual agente parou.
        </p>
      )}

      {/* Resultado — conteúdo vindo pronto do servidor, lido de cs_steps */}
      {modo === 'producao' && (
        <ResultPanel
          result={result}
          aguardandoAprovacao={status === 'awaiting_approval'}
          aprovado={status === 'approved'}
          onAprovar={aprovarProducao}
          onReprovar={reprovarProducao}
          aprovando={aprovando}
          onGerarImagem={gerarImagem}
          onGerarTodas={gerarTodas}
          gerandoImagens={gerandoImagens}
          gerandoSlide={gerandoSlide}
          progressoImagens={progressoImagens}
          erroImagem={erroImagem}
        />
      )}

      {/* Linha do tempo — cabeçalho, botão de ocultar e rolagem vivem no painel */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-4 sm:p-5">
        <TimelinePanel
          entries={view.timeline}
          currentSeq={eventoAtual}
          vazio={vazio}
          reducedMotion={reducedMotion}
        />
      </section>

      {/* Rodapé por MODO — o texto precisa dizer a verdade sobre a geração. */}
      <p className="mt-4 text-xs text-gray-400">
        {modo === 'demo'
          ? 'Os agentes desta demonstração são determinísticos e não usam IA: nenhuma chamada externa é feita e nenhum custo é gerado.'
          : pipelineAtual === 'content_carousel_studio_v1'
            ? 'Criação rápida: Estrategista, Copywriter e Designer, com IA — a direção visual é texto, não imagem gerada.'
            : pipelineAtual === 'content_carousel_quick_v1'
            ? 'Criação rápida: uma geração direta com IA (produção anterior).'
            : pipelineAtual === 'content_carousel_ai_v1'
              ? 'Geração realizada com IA.'
              : pipelineAtual === 'content_carousel_v1'
                ? 'Geração determinística (produção antiga, sem IA).'
                : 'Crie um carrossel para começar.'}{' '}
        Os eventos exibidos são lidos de <code>cs_events</code>.
      </p>

      {/* ── Painel Gerenciar produções (modal, desktop e mobile) ─────────── */}
      {gerenciando && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          onClick={() => { if (!removendo) { setGerenciando(false); setConfirmacao(null) } }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Gerenciar produções"
            onClick={e => e.stopPropagation()}
            className="animate-modal-in max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-5"
          >
            {confirmacao ? (
              // ── Confirmação — nada de window.confirm ──
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {confirmacao.tipo === 'todas'
                    ? `Remover ${confirmacao.qtd} ${confirmacao.qtd === 1 ? 'produção' : 'produções'} em andamento?`
                    : confirmacao.aberta ? 'Cancelar e remover esta produção?' : 'Remover esta produção da lista?'}
                </h3>
                {confirmacao.tipo === 'uma' && (
                  <p className="mt-1 truncate text-sm font-semibold text-gray-600">{confirmacao.titulo}</p>
                )}
                <p className="mt-2 text-sm text-gray-600">
                  {confirmacao.tipo === 'todas'
                    ? 'Elas não continuarão sendo processadas.'
                    : confirmacao.aberta
                      ? 'O processamento será interrompido e ela sumirá da lista.'
                      : 'O histórico será preservado no sistema.'}
                </p>
                <p className="mt-1 text-[12px] text-gray-400">
                  A produção será removida da lista e não continuará sendo processada.
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={removendo}
                    onClick={() => setConfirmacao(null)}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    disabled={removendo}
                    onClick={() => {
                      if (confirmacao.tipo === 'todas') void removerTodasAbertas()
                      else void removerProducao(confirmacao.id)
                    }}
                    className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-50"
                  >
                    {removendo ? 'Removendo…' : 'Confirmar remoção'}
                  </button>
                </div>
              </div>
            ) : (
              // ── Lista de produções ──
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-gray-900">Gerenciar produções</h3>
                  <button
                    type="button"
                    onClick={() => setGerenciando(false)}
                    aria-label="Fechar"
                    className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-gray-500">
                  Remover é definitivo para a lista; o histórico fica preservado no sistema.
                </p>

                {(() => {
                  const abertas = producoes.filter(p => !PRODUCTION_TERMINAL.includes(p.status))
                  return abertas.length > 0 && (
                    <button
                      type="button"
                      disabled={removendo}
                      onClick={() => setConfirmacao({ tipo: 'todas', qtd: abertas.length })}
                      className="mt-3 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
                    >
                      Limpar todas em andamento ({abertas.length})
                    </button>
                  )
                })()}

                <ul className="mt-3 space-y-2">
                  {producoes.length === 0 && (
                    <li className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                      Nenhuma produção na lista.
                    </li>
                  )}
                  {producoes.map(p => {
                    const aberta = !PRODUCTION_TERMINAL.includes(p.status)
                    const modoTexto =
                      p.pipelineKey === 'content_carousel_studio_v1' ? 'Studio (IA + design)'
                      : p.pipelineKey === 'content_carousel_quick_v1' ? 'Criação rápida (IA)'
                      : p.pipelineKey === 'content_carousel_ai_v1' ? 'Briefing avançado (IA)'
                      : 'Determinístico'
                    return (
                      <li key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{p.title ?? 'Sem título'}</p>
                          <p className="text-[12px] text-gray-500">
                            {productionStatusLabel(p.status)} · {modoTexto} · {new Date(p.createdAt).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={removendo}
                          onClick={() => setConfirmacao({ tipo: 'uma', id: p.id, titulo: p.title ?? 'Sem título', aberta })}
                          className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors disabled:opacity-50 ${
                            aberta
                              ? 'bg-rose-500 text-white hover:bg-rose-600'
                              : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {aberta ? 'Cancelar e remover' : 'Remover da lista'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
