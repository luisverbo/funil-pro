// ============================================================================
// Estúdio IA — regras puras do catálogo (temas, poses, importação, URLs)
// ----------------------------------------------------------------------------
// Sem banco e sem rede: tudo aqui é testado no `npm run test:cs`.
// Nomes de campos = seção 4 do projeto (o script do PC depende deles).
// ============================================================================

export const BUCKET_CLIENTES = 'estudio-clientes'
export const BUCKET_ENTREGAS = 'estudio-entregas'
export const BUCKET_CATALOGO = 'estudio-catalogo'

export const SUJEITOS = ['mulher', 'casal', 'criança', 'pet'] as const
export type Sujeito = (typeof SUJEITOS)[number]

/** Os 4 temas do lançamento, na ordem do menu do atendente (seção 5, etapa 2). */
export const ORDEM_LANCAMENTO = ['aniversario', 'corporativo', 'casual', 'sensual'] as const

export interface Tema {
  id?: string
  slug: string
  nome: string
  sujeito: Sujeito
  capa_url: string | null
  ativo: boolean
  ordem: number
}

export interface Pose {
  id?: string
  tema_slug: string
  numero: string
  cena: string
  prompt_catalogo: string
  prompt_cliente: string
  foto_exemplo_path: string | null
  ativa: boolean
}

// ── Importação do poses.json ────────────────────────────────────────────────

interface PoseJson { numero?: unknown; cena?: unknown; prompt_catalogo?: unknown; prompt_cliente?: unknown }
interface TemaJson { slug?: unknown; nome?: unknown; sujeito?: unknown; poses?: unknown }

export interface ResultadoImportacao {
  temas: Omit<Tema, 'id'>[]
  poses: Omit<Pose, 'id' | 'foto_exemplo_path' | 'ativa'>[]
  erros: string[]
}

const SLUG_OK = /^[a-z0-9][a-z0-9-]{0,40}$/

/** Número sempre com 2 dígitos ('1' → '01'); null se não for número. */
export function normalizarNumero(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{1,3}$/.test(s)) return null
  return s.padStart(2, '0')
}

/**
 * Lê o poses.json (formato {versao, temas:[{slug,nome,sujeito,poses:[…]}]}).
 * Não apaga nada: o banco faz upsert e preserva foto_exemplo_path/ativa já
 * gravados (o PC atualiza a foto depois).
 */
export function lerPosesJson(json: unknown): ResultadoImportacao {
  const erros: string[] = []
  const temas: ResultadoImportacao['temas'] = []
  const poses: ResultadoImportacao['poses'] = []
  const lista = (json as { temas?: unknown })?.temas
  if (!Array.isArray(lista)) return { temas, poses, erros: ['arquivo sem a lista "temas"'] }

  lista.forEach((t: TemaJson, i) => {
    const slug = String(t?.slug ?? '').trim()
    if (!SLUG_OK.test(slug)) { erros.push(`tema ${i + 1}: slug inválido "${slug}"`); return }
    const sujeito = (SUJEITOS as readonly string[]).includes(String(t.sujeito)) ? (t.sujeito as Sujeito) : 'mulher'
    const ordem = ORDEM_LANCAMENTO.indexOf(slug as (typeof ORDEM_LANCAMENTO)[number])
    temas.push({
      slug, nome: String(t.nome ?? slug).trim() || slug, sujeito, capa_url: null,
      // Os 4 do lançamento entram ativos; qualquer outro tema entra DESLIGADO.
      ativo: ordem >= 0,
      ordem: ordem >= 0 ? ordem + 1 : 100 + i,
    })
    const vistos = new Set<string>()
    for (const p of (Array.isArray(t.poses) ? t.poses : []) as PoseJson[]) {
      const numero = normalizarNumero(p?.numero)
      if (!numero) { erros.push(`${slug}: pose com número inválido "${String(p?.numero)}"`); continue }
      if (vistos.has(numero)) { erros.push(`${slug}: pose ${numero} repetida`); continue }
      vistos.add(numero)
      poses.push({
        tema_slug: slug, numero,
        cena: String(p.cena ?? '').trim(),
        prompt_catalogo: String(p.prompt_catalogo ?? '').trim(),
        prompt_cliente: String(p.prompt_cliente ?? '').trim(),
      })
    }
  })
  return { temas, poses, erros }
}

// ── URLs das fotos ──────────────────────────────────────────────────────────

/**
 * Caminho no bucket público → URL. Aceita URL completa, 'aniversario/01.jpg'
 * ou 'estudio-catalogo/aniversario/01.jpg' (o PC pode gravar qualquer um).
 */
export function urlPublicaDoCatalogo(path: string | null | undefined, supabaseUrl: string): string | null {
  const p = (path ?? '').trim()
  if (!p) return null
  if (/^https?:\/\//i.test(p)) return p
  const dentro = p.replace(/^\/+/, '').replace(new RegExp(`^${BUCKET_CATALOGO}/`), '')
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET_CATALOGO}/${dentro.split('/').map(encodeURIComponent).join('/')}`
}

/** Caminho padrão da foto de exemplo de uma pose (seção 10). */
export function caminhoExemplo(slug: string, numero: string): string {
  return `${slug}/${numero}.jpg`
}

/** Caminhos das fotos da cliente (seção 4/8): estudio-clientes/<pedido_id>/rosto.jpg e corpo.jpg */
export function caminhosDaCliente(pedidoId: string): { rosto: string; corpo: string } {
  return { rosto: `${pedidoId}/rosto.jpg`, corpo: `${pedidoId}/corpo.jpg` }
}

// ── Escolha das poses na página pública ─────────────────────────────────────

/** "Quero as poses 03, 12, 45" — ordenadas, sem repetir; frase no idioma do catálogo. */
export function mensagemDeEscolha(numeros: readonly string[], nomeTema?: string, querer?: (lista: string[]) => string): string {
  const lista = [...new Set(numeros.map(normalizarNumero).filter((n): n is string => !!n))]
    .sort((a, b) => Number(a) - Number(b))
  if (lista.length === 0) return ''
  const frase = querer ? querer(lista) : `Quero ${lista.length === 1 ? 'a pose' : 'as poses'} ${lista.join(', ')}`
  return `${frase}${nomeTema ? ` (${nomeTema})` : ''}`
}

/** wa.me com a mensagem pronta; null sem número válido. */
export function linkWhatsApp(numero: string | null | undefined, texto: string): string | null {
  const digitos = (numero ?? '').replace(/\D/g, '')
  if (digitos.length < 10) return null
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`
}

/** Preenche os placeholders do prompt_cliente (seção 8: {idade}, {cabelo}, {preferencias}). */
export function preencherPrompt(prompt: string, v: { idade?: number | null; cabelo?: string | null; preferencias?: string | null }): string {
  return prompt
    .replaceAll('{idade}', v.idade ? String(v.idade) : 'a mesma da foto')
    .replaceAll('{cabelo}', v.cabelo?.trim() || 'igual ao da foto')
    .replaceAll('{preferencias}', v.preferencias?.trim() || 'sem preferências especiais')
}

/**
 * A cena mostra a IDADE da cliente (bolo/velas/balões/número gigante "com a
 * idade dela")? Então a foto precisa do número — sem ele a produção faz só
 * com velas. Palavra inteira: "cidade" não conta.
 */
export function poseLevaIdade(cena: string | null | undefined): boolean {
  return /(?<![a-zà-ú])(idade|n[uú]mero da idade|n[uú]meros da idade)(?![a-zà-ú])/i.test(cena ?? '')
}

