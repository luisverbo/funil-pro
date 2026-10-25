'use client'
// ============================================================================
// Estúdio IA — painel com 6 subabas (seção 3.1)
// ----------------------------------------------------------------------------
// Fase 1: Catálogo completo (temas, poses, importação, foto de exemplo).
// As outras subabas mostram em que fase chegam — a ordem é a da seção 11.
// ============================================================================
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { listarCatalogo, importarPoses, salvarTema, salvarPose, subirFotoExemplo } from '@/lib/estudio/client'
import { urlPublicaDoCatalogo, type Pose, type Tema } from '@/lib/estudio/catalogo'
import { FotoOuPlaceholder } from '@/lib/estudio/foto'
import { AbaConfig } from './aba-config'
import { AbaConversas } from './aba-conversas'
import { AbaAtendente } from './aba-atendente'
import { AbaMidias } from './aba-midias'
import { AbaPainelPix, CartaoPix } from './pix-ui'
import { AbaPedidos, CartaoMotor } from './aba-pedidos'
import { CartaoHotmart, CartaoPrecos } from './hotmart-ui'
import { CartaoMetaCapi } from './anuncios-ui'
import { AbaSupervisor } from './aba-supervisor'

/** Fase em construção: subabas até ela já funcionam (sem selo). */
const FASE_ATUAL = 5

type Catalogo = Awaited<ReturnType<typeof listarCatalogo>>

const SUBABAS = [
  { chave: 'conversas', rotulo: 'Conversas', fase: 2, texto: '' },
  { chave: 'painel', rotulo: 'Painel', fase: 4, texto: 'Vendas do dia e da semana, ticket médio, pedidos por status e tempo médio de entrega.' },
  { chave: 'pedidos', rotulo: 'Pedidos', fase: 5, texto: 'A fila de produção: fotos da cliente, tema, poses, pagamento, fotos geradas e os botões Aprovar, Refazer e Cancelar.' },
  { chave: 'catalogo', rotulo: 'Catálogo', fase: 1, texto: '' },
  { chave: 'supervisor', rotulo: 'Supervisor', fase: 5, texto: '' },
  { chave: 'atendente', rotulo: 'Atendente', fase: 3, texto: 'A Ana, do Estúdio: textos de cada etapa, áudios e cobranças.' },
  { chave: 'midias', rotulo: 'Mídias', fase: 3, texto: 'Áudios A1–A6, imagem do menu, PDFs dos catálogos e foto de perfil.' },
  { chave: 'config', rotulo: 'Configurações', fase: 2, texto: 'WhatsApp do estúdio, Pix e motor de produção.' },
] as const
type Subaba = (typeof SUBABAS)[number]['chave']

export default function EstudioClient({ inicial, supabaseUrl }: { inicial: Catalogo; supabaseUrl: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const aba = (SUBABAS.some(s => s.chave === sp.get('aba')) ? sp.get('aba') : 'catalogo') as Subaba
  const info = SUBABAS.find(s => s.chave === aba)!

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl overflow-x-clip px-0 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">Ensaio fotográfico com IA</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Estúdio IA</h1>
        </div>
        <a href="/estudio/catalogo" target="_blank" rel="noreferrer"
          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
          Ver catálogo público ↗
        </a>
      </header>

      <nav className="-mx-1 mt-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
        {SUBABAS.map(s => (
          <button key={s.chave} onClick={() => router.replace(`/estudio-ia?aba=${s.chave}`, { scroll: false })}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${aba === s.chave ? 'border-rose-600 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {s.rotulo}
            {s.fase > FASE_ATUAL && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Fase {s.fase}</span>}
          </button>
        ))}
      </nav>

      {aba === 'catalogo' ? <AbaCatalogo inicial={inicial} supabaseUrl={supabaseUrl} /> : aba === 'config' ? <><AbaConfig /><CartaoPix /><CartaoHotmart /><CartaoPrecos /><CartaoMetaCapi /><CartaoMotor /></> : aba === 'pedidos' ? <AbaPedidos /> : aba === 'painel' ? <AbaPainelPix /> : aba === 'conversas' ? <AbaConversas /> : aba === 'atendente' ? <AbaAtendente /> : aba === 'midias' ? <AbaMidias /> : aba === 'supervisor' ? <AbaSupervisor /> : (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-3xl">🛠️</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">{info.rotulo} chega na Fase {info.fase}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{info.texto}</p>
        </div>
      )}
    </div>
  )
}

// ── Catálogo ───────────────────────────────────────────────────────────────

function AbaCatalogo({ inicial, supabaseUrl }: { inicial: Catalogo; supabaseUrl: string }) {
  const [dados, setDados] = useState<Catalogo>(inicial)
  const [temaSel, setTemaSel] = useState<string | null>(inicial.temas[0]?.slug ?? null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(inicial.error ? { tipo: 'erro', texto: inicial.error } : null)
  const [ocupado, setOcupado] = useState(false)
  const [editando, setEditando] = useState<Pose | null>(null)
  const [colar, setColar] = useState(false)

  async function recarregar() {
    const r = await listarCatalogo()
    setDados(r)
    if (!temaSel || !r.temas.some(t => t.slug === temaSel)) setTemaSel(r.temas[0]?.slug ?? null)
    if (r.error) setAviso({ tipo: 'erro', texto: r.error })
  }

  async function importar(json?: string) {
    setOcupado(true); setAviso(null)
    try {
      const r = await importarPoses(json)
      if (!r.success) setAviso({ tipo: 'erro', texto: r.error ?? 'Não deu certo.' })
      else {
        setAviso({ tipo: 'ok', texto: `Importado: ${r.temas} temas e ${r.poses} poses.${r.avisos?.length ? ` Avisos: ${r.avisos.join(' · ')}` : ''}` })
        setColar(false)
      }
      await recarregar()
    } catch (e) { setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : String(e) }) }
    finally { setOcupado(false) }
  }

  const tema = dados.temas.find(t => t.slug === temaSel) ?? null
  const poses = useMemo(() => dados.poses.filter(p => p.tema_slug === temaSel).sort((a, b) => Number(a.numero) - Number(b.numero)), [dados.poses, temaSel])
  const contagem = (slug: string) => dados.poses.filter(p => p.tema_slug === slug)
  const vazio = dados.temas.length === 0

  return (
    <div className="mt-5">
      {aviso && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${aviso.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {aviso.texto}
        </div>
      )}

      {vazio ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-3xl">📚</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Catálogo vazio</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Importe o <code>poses.json</code> do projeto: 4 temas (Aniversário, Corporativo, Casual e Sensual) com 20 poses cada.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => importar()} disabled={ocupado} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
              {ocupado ? 'Importando…' : 'Importar as 80 poses'}
            </button>
            <button onClick={() => setColar(true)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Colar outro JSON</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
          {/* Temas */}
          <aside className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Temas</h2>
              <div className="flex gap-1">
                <button onClick={() => importar()} disabled={ocupado} title="Atualiza cenas e prompts pelo poses.json do projeto, sem apagar fotos"
                  className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">{ocupado ? '…' : '↻ Reimportar'}</button>
                <button onClick={() => setColar(true)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">Colar JSON</button>
              </div>
            </div>
            <ul className="space-y-2">
              {dados.temas.map(t => {
                const ps = contagem(t.slug)
                const comFoto = ps.filter(p => p.foto_exemplo_path).length
                return (
                  <li key={t.slug}>
                    <button onClick={() => setTemaSel(t.slug)}
                      className={`w-full rounded-xl border p-3 text-left transition ${temaSel === t.slug ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-500' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{t.nome}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{t.ativo ? 'Ativo' : 'Desligado'}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">/{t.slug} · {ps.filter(p => p.ativa).length} poses ativas · {comFoto}/{ps.length} com foto</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {/* Poses do tema */}
          {tema && (
            <section className="min-w-0">
              <CabecalhoTema key={`${tema.slug}|${tema.nome}|${tema.capa_url ?? ''}`} tema={tema} onSalvo={recarregar} onErro={t => setAviso({ tipo: 'erro', texto: t })} />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {poses.map(p => {
                  const foto = urlPublicaDoCatalogo(p.foto_exemplo_path, supabaseUrl)
                  return (
                    <button key={p.numero} onClick={() => setEditando(p)}
                      className={`overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:shadow ${p.ativa ? 'border-slate-200' : 'border-slate-200 opacity-50'}`}>
                      <div className="aspect-[4/5] bg-slate-100">
                        <FotoOuPlaceholder src={foto} alt={`Pose ${p.numero}`} className="h-full w-full object-cover"
                          placeholder={<div className="flex h-full items-center justify-center text-2xl text-slate-300">📷</div>} />
                      </div>
                      <div className="p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-serif text-xl font-semibold tabular-nums text-slate-900">{p.numero}</span>
                          {!p.ativa && <span className="text-[10px] font-semibold uppercase text-slate-400">oculta</span>}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{p.cena}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
              {poses.length === 0 && <p className="mt-6 text-sm text-slate-500">Nenhuma pose neste tema.</p>}
            </section>
          )}
        </div>
      )}

      {editando && <ModalPose pose={editando} supabaseUrl={supabaseUrl} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await recarregar() }} />}
      {colar && <ModalColar ocupado={ocupado} onFechar={() => setColar(false)} onImportar={importar} />}
    </div>
  )
}

function CabecalhoTema({ tema, onSalvo, onErro }: { tema: Tema; onSalvo: () => void; onErro: (t: string) => void }) {
  const [nome, setNome] = useState(tema.nome)
  const [capa, setCapa] = useState(tema.capa_url ?? '')
  const [ocupado, setOcupado] = useState(false)
  const mudou = nome !== tema.nome || capa !== (tema.capa_url ?? '')

  async function salvar(patch: Parameters<typeof salvarTema>[1]) {
    setOcupado(true)
    const r = await salvarTema(tema.slug, patch)
    setOcupado(false)
    if (!r.success) onErro(r.error ?? 'Não deu certo.')
    else onSalvo()
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <input value={nome} onChange={e => setNome(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base font-semibold text-slate-900 focus:border-rose-500 focus:outline-none" />
          <input value={capa} onChange={e => setCapa(e.target.value)} placeholder="Capa (opcional): URL ou caminho no bucket. Vazio = 1ª pose com foto"
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:border-rose-500 focus:outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <a href={`/estudio/catalogo/${tema.slug}`} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">Ver página ↗</a>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={tema.ativo} disabled={ocupado} onChange={e => salvar({ ativo: e.target.checked })} /> Ativo
          </label>
          {mudou && (
            <button onClick={() => salvar({ nome, capa_url: capa || null })} disabled={ocupado}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{ocupado ? '…' : 'Salvar'}</button>
          )}
        </div>
      </div>
      {!tema.ativo && <p className="mt-2 text-xs text-amber-700">Tema desligado: não aparece no catálogo público nem no menu do atendente.</p>}
    </div>
  )
}

function ModalPose({ pose, supabaseUrl, onFechar, onSalvo }: { pose: Pose; supabaseUrl: string; onFechar: () => void; onSalvo: () => void }) {
  const [cena, setCena] = useState(pose.cena)
  const [pCat, setPCat] = useState(pose.prompt_catalogo)
  const [pCli, setPCli] = useState(pose.prompt_cliente)
  const [ativa, setAtiva] = useState(pose.ativa)
  const [foto, setFoto] = useState(urlPublicaDoCatalogo(pose.foto_exemplo_path, supabaseUrl))
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function salvar() {
    setOcupado(true); setErro(null)
    const r = await salvarPose(pose.tema_slug, pose.numero, { cena, prompt_catalogo: pCat, prompt_cliente: pCli, ativa })
    setOcupado(false)
    if (!r.success) setErro(r.error ?? 'Não deu certo.')
    else onSalvo()
  }

  async function enviarFoto(f: File) {
    setOcupado(true); setErro(null)
    try {
      const b64 = await new Promise<string>((ok, falha) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result)); rd.onerror = () => falha(rd.error); rd.readAsDataURL(f) })
      const r = await subirFotoExemplo(pose.tema_slug, pose.numero, b64, f.type)
      if (!r.success) setErro(r.error ?? 'Não deu certo.')
      else setFoto(`${urlPublicaDoCatalogo(r.path, supabaseUrl)}?v=${Date.now()}`)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setOcupado(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center" onClick={onFechar}>
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Pose <span className="font-serif text-2xl">{pose.numero}</span> · {pose.tema_slug}</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">✕</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
          <div>
            <div className="aspect-[4/5] overflow-hidden rounded-xl bg-slate-100">
              <FotoOuPlaceholder src={foto} alt="" className="h-full w-full object-cover"
                placeholder={<div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400"><span className="text-3xl">📷</span><span className="text-[11px]">sem foto ainda</span></div>} />
            </div>
            <label className="mt-2 block cursor-pointer rounded-lg border border-slate-200 py-2 text-center text-xs font-medium text-slate-700 hover:bg-slate-50">
              {ocupado ? 'Enviando…' : foto ? 'Trocar foto' : 'Enviar foto de exemplo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={ocupado}
                onChange={e => { const f = e.target.files?.[0]; if (f) void enviarFoto(f); e.target.value = '' }} />
            </label>
            <p className="mt-1 text-[11px] text-slate-400">Vai para estudio-catalogo/{pose.tema_slug}/{pose.numero}.jpg. O Claude Code do PC também sobe aqui.</p>
          </div>
          <div className="space-y-3">
            <Campo rotulo="Cena" valor={cena} onChange={setCena} linhas={3} />
            <Campo rotulo="Prompt do catálogo (gera a foto de exemplo com modelo fictícia)" valor={pCat} onChange={setPCat} linhas={4} />
            <Campo rotulo="Prompt da cliente ({idade}, {cabelo} e {preferencias} são preenchidos no pedido)" valor={pCli} onChange={setPCli} linhas={6} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={ativa} onChange={e => setAtiva(e.target.checked)} /> Pose ativa (aparece no catálogo público)
            </label>
          </div>
        </div>
        {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button onClick={salvar} disabled={ocupado} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{ocupado ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>, document.body)
}

function Campo({ rotulo, valor, onChange, linhas }: { rotulo: string; valor: string; onChange: (v: string) => void; linhas: number }) {
  return (
    <label className="block text-xs font-medium text-slate-600">{rotulo}
      <textarea value={valor} onChange={e => onChange(e.target.value)} rows={linhas}
        className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-900 focus:border-rose-500 focus:outline-none" />
    </label>
  )
}

function ModalColar({ ocupado, onFechar, onImportar }: { ocupado: boolean; onFechar: () => void; onImportar: (json: string) => void }) {
  const [texto, setTexto] = useState('')
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center" onClick={onFechar}>
      <div className="w-full max-w-2xl rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900">Importar poses.json</h3>
        <p className="mt-1 text-sm text-slate-500">Cole o conteúdo do arquivo. Temas e poses são atualizados por slug e número; fotos e ativações já feitas ficam como estão. Tema fora dos 4 do lançamento entra desligado.</p>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={10} placeholder='{"versao": "...", "temas": [...]}'
          className="mt-3 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs focus:border-rose-500 focus:outline-none" />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button onClick={() => onImportar(texto)} disabled={ocupado || !texto.trim()} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{ocupado ? 'Importando…' : 'Importar'}</button>
        </div>
      </div>
    </div>, document.body)
}
