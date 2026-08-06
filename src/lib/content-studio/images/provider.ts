// ============================================================================
// Content Studio — provider de IMAGEM (OpenAI, server-only)
// ----------------------------------------------------------------------------
// Mesma OPENAI_API_KEY já usada pelo Whisper (src/lib/agents/transcribe.ts) e
// o MESMO estilo de chamada: fetch direto, sem SDK, chave lida do process.env
// no servidor. Nenhuma variável nova, nada NEXT_PUBLIC, nenhum cliente no
// navegador — este módulo só é importado por código de servidor.
//
// Endpoint oficial de geração: POST https://api.openai.com/v1/images/generations
// Modelo: gpt-image-1 (retorna b64_json por padrão).
//
// O provider devolve o PNG bruto como bytes — quem decide o que fazer com eles
// (compor, salvar) é o runner. Base64 nunca sai desta camada para persistência.
// ============================================================================

export const STUDIO_IMAGE_MODEL = 'gpt-image-1'
export const STUDIO_IMAGE_SIZE = '1024x1024'
/** Tamanhos suportados pelo gpt-image-1 — lista branca do servidor. */
export const STUDIO_IMAGE_SIZES = ['1024x1024', '1024x1536'] as const
export type StudioImageSize = (typeof STUDIO_IMAGE_SIZES)[number]

/**
 * Qualidades PERMITIDAS — decididas no servidor a partir do enum do cliente
 * (quick -> medium, premium -> high). Nunca texto livre.
 */
export const STUDIO_IMAGE_QUALITIES = ['medium', 'high'] as const
export type StudioImageQuality = (typeof STUDIO_IMAGE_QUALITIES)[number]
export const STUDIO_IMAGE_QUALITY: StudioImageQuality = 'medium'

/**
 * Timeout da chamada de imagem.
 *
 * Era 45s "para caber em maxDuration=60s" — e essa conta é justamente a causa
 * do erro visto em produção: `gpt-image-1` em qualidade alta e 1024×1536 leva
 * mais que isso, então TODA capa Premium morria em `studio_images:timeout`.
 * Com a rota em 300s (Fluid Compute), a geração ganha o tempo que realmente
 * precisa e ainda sobram ~70s para compor, salvar e responder.
 *
 * INVARIANTE (conferido em teste): TIMEOUT + MARGEM <= maxDuration da rota.
 */
export const STUDIO_IMAGE_TIMEOUT_MS = 230_000

/** Tempo reservado para compor (sharp), subir ao Storage e persistir o step. */
export const STUDIO_IMAGE_PERSIST_MARGIN_MS = 60_000

/** maxDuration declarado na rota que hospeda as Server Actions de imagem. */
export const STUDIO_IMAGE_ROUTE_MAX_DURATION_MS = 300_000

{
  // Configuração impossível não deve nem carregar.
  if (STUDIO_IMAGE_TIMEOUT_MS + STUDIO_IMAGE_PERSIST_MARGIN_MS > STUDIO_IMAGE_ROUTE_MAX_DURATION_MS) {
    throw new Error('studio_images: timeout não cabe no maxDuration da rota')
  }
}

/** Teto do corpo decodificado — um PNG 1024² honesto fica muito abaixo disso. */
export const STUDIO_IMAGE_MAX_BYTES = 24 * 1024 * 1024

export interface StudioImageRequest {
  /** Prompt COMPLETO, montado no servidor a partir da direção do Designer. */
  prompt: string
  /** Identificação para log — nunca vai para a OpenAI além do necessário. */
  executionId: string
  /** Qualidade JÁ validada pelo servidor (lista branca). */
  quality?: StudioImageQuality
  /** Tamanho da lista branca — vertical 1024x1536 para a capa viral. */
  size?: StudioImageSize
}

export interface StudioImageResult {
  /** Bytes do PNG gerado (já decodificados e validados). */
  bytes: Uint8Array
  model: string
  size: string
  quality: string
  durationMs: number
}

export interface StudioImageProvider {
  generate(req: StudioImageRequest): Promise<StudioImageResult>
}

// ─── Preflight (sem rede) ───────────────────────────────────────────────────

/**
 * Falha ANTES de qualquer persistência quando a geração de imagem não pode
 * funcionar. Não faz rede — só configuração.
 */
export function preflightStudioImages(): void {
  if (__imageProviderForTests) return
  const key = process.env.OPENAI_API_KEY
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('studio_images:missing_key')
  }
}

// ─── Provider real ──────────────────────────────────────────────────────────

/** Assinatura PNG (8 bytes) — a única saída aceita do endpoint. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)
}

export function createOpenAIImageProvider(): StudioImageProvider {
  return {
    async generate(req: StudioImageRequest): Promise<StudioImageResult> {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('studio_images:missing_key')

      const inicio = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), STUDIO_IMAGE_TIMEOUT_MS)

      try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: STUDIO_IMAGE_MODEL,
            prompt: req.prompt,
            n: 1,
            size: req.size ?? STUDIO_IMAGE_SIZE,
            // Só valores da lista branca chegam aqui; o padrão é o mais barato.
            quality: req.quality ?? STUDIO_IMAGE_QUALITY,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          // Só o status e o type estruturado — NUNCA o corpo cru (pode ecoar
          // o prompt) e nunca a chave.
          let providerType = 'unknown'
          try {
            const corpo = await res.json() as { error?: { type?: string; code?: string } }
            providerType = corpo?.error?.type ?? corpo?.error?.code ?? 'unknown'
          } catch { /* corpo ilegível: fica unknown */ }
          const err = new Error(`studio_images:provider_error: status=${res.status} type=${providerType}`)
          ;(err as { code?: string }).code = 'studio_images:provider_error'
          throw err
        }

        const json = await res.json() as { data?: { b64_json?: string }[] }
        const b64 = json?.data?.[0]?.b64_json
        if (typeof b64 !== 'string' || b64.length === 0) {
          const err = new Error('studio_images:empty_response')
          ;(err as { code?: string }).code = 'studio_images:empty_response'
          throw err
        }

        // Decodifica APENAS aqui, valida tamanho e content-type reais.
        const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
        if (bytes.byteLength > STUDIO_IMAGE_MAX_BYTES) {
          const err = new Error('studio_images:too_large')
          ;(err as { code?: string }).code = 'studio_images:too_large'
          throw err
        }
        if (!isPng(bytes)) {
          const err = new Error('studio_images:invalid_content')
          ;(err as { code?: string }).code = 'studio_images:invalid_content'
          throw err
        }

        return {
          bytes,
          model: STUDIO_IMAGE_MODEL,
          size: req.size ?? STUDIO_IMAGE_SIZE,
          quality: req.quality ?? STUDIO_IMAGE_QUALITY,
          durationMs: Date.now() - inicio,
        }
      } catch (raw) {
        if (raw instanceof Error && raw.name === 'AbortError') {
          const err = new Error('studio_images:timeout')
          ;(err as { code?: string }).code = 'studio_images:timeout'
          throw err
        }
        throw raw
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

// ─── Override de teste ──────────────────────────────────────────────────────

let __imageProviderForTests: StudioImageProvider | null = null

/** Substituição explícita — exclusiva de teste. */
export function __setStudioImageProviderForTests(p: StudioImageProvider | null): void {
  __imageProviderForTests = p
}

/** Teste instalado tem prioridade; sem teste, o provider real da OpenAI. */
export function resolveStudioImageProvider(): StudioImageProvider {
  return __imageProviderForTests ?? createOpenAIImageProvider()
}
