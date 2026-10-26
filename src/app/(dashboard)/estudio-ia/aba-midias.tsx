'use client'
// ============================================================================
// Estúdio IA — subaba Mídias: áudios A1–A6 por idioma, imagem do menu e
// status dos PDFs do catálogo (o Claude Code do PC sobe os PDFs).
// Tudo no bucket PÚBLICO estudio-catalogo/midias/… (a Meta busca pelo link).
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { listarTextosAna, urlUploadMidiaAna, salvarAudioAna, statusMidiasAna, gerarPdfsCatalogo } from '@/lib/estudio/client'
import { BUCKET_CATALOGO } from '@/lib/estudio/catalogo'

type Linha = Awaited<ReturnType<typeof listarTextosAna>>['linhas'][number]
type Status = Awaited<ReturnType<typeof statusMidiasAna>>

const IDIOMAS = [['pt-BR', '🇧🇷 PT-BR'], ['pt-PT', '🇵🇹 PT-PT'], ['es', '🇪🇸 ES'], ['en', '🇺🇸 EN']] as const
const AUDIOS: [string, string, string][] = [
  ['a1', 'A1 · Boas-vindas', '~10 s — "Oi, tudo bem? Prazer, eu sou a Ana do Estúdio!…"'],
  ['a2', 'A2 · Como funciona', '~25 s — "O ensaio é cem por cento on-line…"'],
  ['a3', 'A3 · As 2 fotos', '~30 s — "Eu só preciso de duas fotos suas…"'],
  ['a4', 'A4 · Catálogo', '~15 s — "Cada foto tem um número: me manda só os números…"'],
  ['a5', 'A5 · Pix', '~7 s — "Te mandei o Pix aqui em cima…" (Fase 4)'],
  ['a6', 'A6 · Entrega', '"Seu ensaio ficou lindo!…" (Fase 5)'],
  ['a2_casal', 'A2 · Casal', '~15 s — "O ensaio de casal é com os DOIS na mesma foto: preciso de rosto e corpo de cada um…" (sem áudio, sai o texto)'],
]

export function AbaMidias() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)

  const carregar = useCallback(async () => {
    const [t, s] = await Promise.all([listarTextosAna(), statusMidiasAna()])
    setLinhas(t.linhas); setStatus(s); setVersao(v => v + 1)
    if (t.error || s.error) setErro(t.error ?? s.error ?? null)
  }, [])
  useEffect(() => {
    let vivo = true
    Promise.all([listarTextosAna(), statusMidiasAna()]).then(([t, s]) => {
      if (!vivo) return
      setLinhas(t.linhas); setStatus(s)
      if (t.error || s.error) setErro(t.error ?? s.error ?? null)
    }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [])

  async function subir(tipo: 'audio' | 'menu', chave: string | null, idioma: string | null, arq: File) {
    const k = `${tipo}|${chave}|${idioma}`
    setOcupado(k); setErro(null)
    try {
      const up = await urlUploadMidiaAna(tipo, chave, idioma, arq.type)
      if (up.error || !up.path || !up.token) { setErro(up.error ?? 'falhou'); return }
      const { error } = await createClient().storage.from(BUCKET_CATALOGO).uploadToSignedUrl(up.path, up.token, arq, { contentType: arq.type, upsert: true })
      if (error) { setErro(error.message); return }
      if (tipo === 'audio' && chave && idioma) {
        const r = await salvarAudioAna(chave, idioma, up.path)
        if (!r.success) { setErro(r.error ?? 'falhou'); return }
      }
      await carregar()
    } finally { setOcupado(null) }
  }

  const audio = (chave: string, idioma: string) => linhas?.find(l => l.chave === chave && l.idioma === idioma)?.audio_url ?? null

  return (
    <div className="mt-5 space-y-5">
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Áudios da Ana</h2>
        <p className="text-xs text-slate-500">Gravados UMA vez por uma mulher real, celular perto da boca. Use <strong>.ogg</strong> (chega como nota de voz) ou .mp3. Sem áudio no idioma, a Ana manda o texto equivalente.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Áudio</th>{IDIOMAS.map(([k, l]) => <th key={k} className="px-2 py-2">{l}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {AUDIOS.map(([chave, nome, dica]) => (
                <tr key={chave}>
                  <td className="py-3 pr-3 align-top"><p className="font-medium text-slate-900">{nome}</p><p className="text-[11px] text-slate-500">{dica}</p></td>
                  {IDIOMAS.map(([idioma]) => {
                    const url = audio(chave, idioma); const k = `audio|${chave}|${idioma}`
                    return (
                      <td key={idioma} className="px-2 py-3 align-top">
                        {url ? <audio controls src={url} preload="none" className="mb-1 h-8 w-40" /> : <p className="mb-1 text-[11px] text-slate-400">— sem áudio</p>}
                        <label className="inline-block cursor-pointer rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                          {ocupado === k ? 'Enviando…' : url ? 'Trocar' : 'Enviar'}
                          <input type="file" accept="audio/ogg,audio/mpeg,audio/mp4,audio/aac" className="hidden" disabled={!!ocupado}
                            onChange={e => { const f = e.target.files?.[0]; if (f) void subir('audio', chave, idioma, f); e.target.value = '' }} />
                        </label>
                        {url && <button onClick={async () => { await salvarAudioAna(chave, idioma, null); await carregar() }} className="ml-1 text-[11px] text-slate-400 hover:text-red-600">remover</button>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Imagem do menu</h2>
          <p className="text-xs text-slate-500">Vai junto com o menu de temas (3 exemplos: aniversário, corporativo, casual). JPG ou PNG, até 5 MB.</p>
          <div className="mt-3 flex items-center gap-4">
            <div className="h-28 w-28 overflow-hidden rounded-lg bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {status?.menu ? <img src={`${status.menu}?v=${versao}`} alt="menu" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-2xl text-slate-300">🖼</div>}
            </div>
            <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {ocupado === 'menu|null|null' ? 'Enviando…' : status?.menu ? 'Trocar imagem' : 'Enviar imagem'}
              <input type="file" accept="image/jpeg,image/png" className="hidden" disabled={!!ocupado}
                onChange={e => { const f = e.target.files?.[0]; if (f) void subir('menu', null, null, f); e.target.value = '' }} />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">PDFs do catálogo</h2>
          <p className="text-xs text-slate-500">Português: o Claude Code do PC sobe em <code>estudio-catalogo/&lt;tema&gt;/catalogo-&lt;tema&gt;.pdf</code>. Espanhol e inglês: o FunilPro monta sozinho com as fotos do catálogo (na 1ª vez que a Ana precisar). Trocou fotos? Clique em <strong>Refazer PDFs</strong>.</p>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {(status?.pdfs ?? []).map(p => (
              <li key={p.slug} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-slate-800">{p.nome}</span>
                <span className="flex gap-3 text-xs">
                  {([['🇧🇷 PT', p.url], ['🇪🇸 ES', p.es], ['🇺🇸 EN', p.en]] as const).map(([r, u]) => u
                    ? <a key={r} href={u} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 hover:underline">✅ {r}</a>
                    : <span key={r} className="text-slate-400">— {r}</span>)}
                </span>
              </li>
            ))}
          </ul>
          <button disabled={!!ocupado} onClick={async () => {
            setOcupado('pdfs'); setErro(null)
            try {
              const r = await gerarPdfsCatalogo()
              if (r.error || r.erros.length) setErro(r.error ?? r.erros.join(' · '))
              setVersao(v => v + 1)
            } catch (e) { setErro(String(e)) } finally { setOcupado(null) }
          }} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {ocupado === 'pdfs' ? 'Gerando… (pode levar 1–2 min)' : 'Refazer PDFs em espanhol e inglês'}
          </button>
        </section>
      </div>
    </div>
  )
}
