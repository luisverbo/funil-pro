// ============================================================================
// Cliente da Marketing API — leitura confiável (Fase 1, item 1.8)
// ============================================================================
// O cliente anterior (src/lib/meta/index.ts e sync.ts) tinha quatro defeitos
// que a auditoria levantou, e todos silenciosos:
//
//   1. SEM PAGINAÇÃO. A Graph API devolve no máximo ~25 itens por página e o
//      resto em `paging.next`. Conta com muitos anúncios era truncada sem
//      nenhum aviso — exatamente o mesmo tipo de erro do corte de 1000 linhas
//      que sumiu com os leads do quiz.
//   2. SEM TRATAMENTO DE LIMITE. A Meta cobra por "pontuação de uso" e devolve
//      429 com códigos próprios; o código antigo tratava tudo como falha
//      genérica e engolia com `catch {}`.
//   3. ERRO INDISTINGUÍVEL. Token expirado, permissão faltando e instabilidade
//      caíam todos no mesmo lugar, sem chegar à tela.
//   4. VERSÃO v19.0, fora do ciclo de suporte de 2 anos da Meta.
//
// Nenhuma dependência nova: `fetch` puro, como o resto do projeto.
// ============================================================================

/**
 * Versão da Graph API.
 *
 * A Meta lança uma versão a cada ~4 meses e mantém cada uma por 2 anos. A
 * v25.0 saiu em fevereiro de 2026. Subir de versão é trocar esta linha — mas
 * só depois de conferir o changelog, porque campo removido vira erro 400.
 */
export const META_API_VERSION = 'v25.0'
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/** Teto de páginas por consulta — trava contra laço infinito de `paging.next`. */
export const META_MAX_PAGINAS = 100

/** Tempo máximo que uma chamada isolada pode levar. */
export const META_TIMEOUT_MS = 25_000

// ─── Classificação de erro ──────────────────────────────────────────────────

export type MetaErrorKind =
  | 'token_expirado'      // precisa reconectar a conta
  | 'sem_permissao'       // falta scope/papel no app (App Review)
  | 'limite_de_uso'       // rate limit: esperar e repetir
  | 'instavel'            // erro transitório do lado da Meta
  | 'requisicao_invalida' // repetir não conserta
  | 'desconhecido'

export class MetaApiError extends Error {
  readonly kind: MetaErrorKind
  readonly httpStatus: number
  readonly metaCode?: number
  readonly metaSubcode?: number
  /** Repetir tem chance de dar certo? */
  readonly retentavel: boolean

  constructor(args: {
    kind: MetaErrorKind; httpStatus: number; message: string
    metaCode?: number; metaSubcode?: number
  }) {
    super(args.message)
    this.name = 'MetaApiError'
    this.kind = args.kind
    this.httpStatus = args.httpStatus
    this.metaCode = args.metaCode
    this.metaSubcode = args.metaSubcode
    this.retentavel = args.kind === 'limite_de_uso' || args.kind === 'instavel'
  }
}

/**
 * Traduz o par (status, código da Meta) num tipo acionável.
 *
 * Os códigos vêm da documentação de erros da Marketing API. O que importa
 * aqui é separar "reconecte a conta" de "espere e tente de novo" — porque a
 * ação do usuário é completamente diferente.
 */
export function classificarErroMeta(
  httpStatus: number,
  code?: number,
  subcode?: number,
): MetaErrorKind {
  // 190: token inválido/expirado. O subcódigo detalha o motivo (senha trocada,
  // sessão expirada, app desautorizado) — todos levam à mesma ação: reconectar.
  if (code === 102 || code === 190) return 'token_expirado'
  // 458..467: sessão do usuário caiu, mesmo sem o código 190.
  if (typeof subcode === 'number' && subcode >= 458 && subcode <= 467) return 'token_expirado'
  // 4 = limite do app, 17 = limite do usuário, 32 = limite da página,
  // 613 = limite personalizado, 80000..80004 = limites da Marketing API.
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'limite_de_uso'
  if (typeof code === 'number' && code >= 80000 && code <= 80014) return 'limite_de_uso'
  // 10 e 200..299: permissão ausente — normalmente falta App Review.
  if (code === 10 || (typeof code === 'number' && code >= 200 && code <= 299)) return 'sem_permissao'
  // 1 e 2: erro temporário/desconhecido do lado da Meta.
  if (code === 1 || code === 2) return 'instavel'
  if (httpStatus === 429) return 'limite_de_uso'
  if (httpStatus >= 500) return 'instavel'
  if (httpStatus === 401 || httpStatus === 403) return 'sem_permissao'
  if (httpStatus >= 400) return 'requisicao_invalida'
  return 'desconhecido'
}

/** Frase em português para a tela — sem jargão e sem vazar token. */
export function descreverErroMeta(erro: MetaApiError): string {
  switch (erro.kind) {
    case 'token_expirado':
      return 'A conexão com o Meta expirou. Reconecte a conta de anúncios para voltar a sincronizar.'
    case 'sem_permissao':
      return 'O Meta recusou o acesso a esta conta. Verifique as permissões do app e o acesso do usuário à conta de anúncios.'
    case 'limite_de_uso':
      return 'O Meta limitou temporariamente as consultas desta conta. A sincronização continua sozinha em alguns minutos.'
    case 'instavel':
      return 'O Meta está instável no momento. A próxima sincronização tenta de novo.'
    case 'requisicao_invalida':
      return `O Meta recusou a consulta. (código ${erro.metaCode ?? erro.httpStatus})`
    default:
      return `Não foi possível falar com o Meta. (código ${erro.metaCode ?? erro.httpStatus})`
  }
}

// ─── Uso da cota ────────────────────────────────────────────────────────────

export interface UsoDaCota {
  /** Maior percentual entre chamadas, CPU e tempo total (0..100+). */
  percentual: number
  /** Minutos que a Meta pede para esperar, quando informa. */
  esperaMinutos: number
}

/**
 * Lê o cabeçalho `x-business-use-case-usage`, que é como a Meta avisa que a
 * conta está perto do limite ANTES de começar a recusar.
 */
export function lerUsoDaCota(headers: Headers): UsoDaCota | null {
  const bruto = headers.get('x-business-use-case-usage')
    ?? headers.get('x-ad-account-usage')
    ?? headers.get('x-app-usage')
  if (!bruto) return null
  try {
    const dados = JSON.parse(bruto) as Record<string, unknown>
    let percentual = 0
    let esperaMinutos = 0
    const considerar = (o: Record<string, unknown>) => {
      for (const campo of ['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct']) {
        const v = o[campo]
        if (typeof v === 'number') percentual = Math.max(percentual, v)
      }
      const espera = o.estimated_time_to_regain_access
      if (typeof espera === 'number') esperaMinutos = Math.max(esperaMinutos, espera)
    }
    // `x-app-usage` vem PLANO ({call_count: 77}); `x-business-use-case-usage`
    // vem aninhado por id de conta ({"123": [{...}]}). Os dois precisam ser
    // lidos — foi um teste que pegou o formato plano ficando de fora.
    considerar(dados)
    for (const valor of Object.values(dados)) {
      if (Array.isArray(valor)) {
        for (const item of valor) if (item && typeof item === 'object') considerar(item as Record<string, unknown>)
      } else if (valor && typeof valor === 'object') {
        considerar(valor as Record<string, unknown>)
      }
    }
    return { percentual, esperaMinutos }
  } catch {
    return null
  }
}

/** Acima disto, é hora de desacelerar por conta própria. */
export const META_LIMITE_ALERTA_PCT = 80

// ─── Chamada ────────────────────────────────────────────────────────────────

interface MetaRespostaErro {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string }
}

export interface MetaFetchDeps {
  fetchFn?: typeof fetch
  esperar?: (ms: number) => Promise<void>
}

/** Espera do retry: exponencial com teto — Server Action não fica presa. */
export function esperaDoRetry(tentativa: number, uso?: UsoDaCota | null): number {
  if (uso && uso.esperaMinutos > 0) {
    // A Meta disse quanto esperar; respeitamos, mas com teto de 30s por
    // chamada — o resto fica para a próxima execução do cron.
    return Math.min(uso.esperaMinutos * 60_000, 30_000)
  }
  return Math.min(1_000 * 2 ** tentativa, 8_000)
}

/**
 * Uma chamada à Graph API, com timeout, classificação de erro e no máximo
 * dois retries — só para erro retentável.
 */
export async function metaFetch<T>(
  url: string,
  deps: MetaFetchDeps = {},
): Promise<{ dados: T; uso: UsoDaCota | null }> {
  const fetchFn = deps.fetchFn ?? fetch
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  let ultimo: MetaApiError | null = null

  for (let tentativa = 0; tentativa <= 2; tentativa++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS)
    try {
      const res = await fetchFn(url, { cache: 'no-store', signal: controller.signal })
      const uso = lerUsoDaCota(res.headers)

      if (res.ok) {
        const dados = (await res.json()) as T
        return { dados, uso }
      }

      let corpo: MetaRespostaErro = {}
      try { corpo = (await res.json()) as MetaRespostaErro } catch { /* corpo ilegível */ }
      const kind = classificarErroMeta(res.status, corpo.error?.code, corpo.error?.error_subcode)
      ultimo = new MetaApiError({
        kind,
        httpStatus: res.status,
        metaCode: corpo.error?.code,
        metaSubcode: corpo.error?.error_subcode,
        // A mensagem crua da Meta fica no log, nunca na tela.
        message: `meta: ${kind} status=${res.status} code=${corpo.error?.code ?? '-'}`,
      })

      if (!ultimo.retentavel || tentativa === 2) throw ultimo
      await esperar(esperaDoRetry(tentativa, uso))
    } catch (err) {
      if (err instanceof MetaApiError) {
        if (!err.retentavel || tentativa === 2) throw err
        ultimo = err
        await esperar(esperaDoRetry(tentativa))
        continue
      }
      // Rede ou timeout: transitório.
      ultimo = new MetaApiError({
        kind: 'instavel',
        httpStatus: 0,
        message: (err as Error)?.name === 'AbortError' ? 'meta: timeout' : 'meta: falha de rede',
      })
      if (tentativa === 2) throw ultimo
      await esperar(esperaDoRetry(tentativa))
    } finally {
      clearTimeout(timer)
    }
  }

  throw ultimo ?? new MetaApiError({ kind: 'desconhecido', httpStatus: 0, message: 'meta: sem resposta' })
}

interface PaginaGraph<T> {
  data?: T[]
  paging?: { next?: string; cursors?: { after?: string } }
}

/**
 * Percorre TODAS as páginas de um recurso.
 *
 * É o conserto do defeito nº 1: sem isto, conta com muitos anúncios devolvia
 * só a primeira página e o painel mostrava um recorte arbitrário como se
 * fosse o total.
 */
export async function metaFetchPaginado<T>(
  urlInicial: string,
  deps: MetaFetchDeps & { maxPaginas?: number } = {},
): Promise<{ itens: T[]; paginas: number; truncado: boolean; uso: UsoDaCota | null }> {
  const maxPaginas = deps.maxPaginas ?? META_MAX_PAGINAS
  const itens: T[] = []
  let url: string | undefined = urlInicial
  let paginas = 0
  let uso: UsoDaCota | null = null

  while (url && paginas < maxPaginas) {
    const r: { dados: PaginaGraph<T>; uso: UsoDaCota | null } = await metaFetch<PaginaGraph<T>>(url, deps)
    itens.push(...(r.dados.data ?? []))
    uso = r.uso ?? uso
    paginas++
    url = r.dados.paging?.next

    // Perto do limite, parar por aqui vale mais que ser bloqueado: o cron
    // retoma na próxima execução.
    if (uso && uso.percentual >= META_LIMITE_ALERTA_PCT) break
  }

  return { itens, paginas, truncado: Boolean(url), uso }
}

/** Monta a URL da Graph API com os parâmetros já codificados. */
export function urlGraph(
  caminho: string,
  params: Record<string, string | number | undefined>,
  accessToken: string,
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  qs.set('access_token', accessToken)
  const limpo = caminho.startsWith('/') ? caminho : `/${caminho}`
  return `${META_GRAPH_BASE}${limpo}?${qs.toString()}`
}

/** O token nunca pode aparecer em log. */
export function ocultarToken(url: string): string {
  return url.replace(/access_token=[^&]+/g, 'access_token=<oculto>')
}
