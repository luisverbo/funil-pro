'use client'
// Grade de poses com seleção: tocar marca o número; a barra de baixo monta
// "Quero as poses 03, 12, 45" para copiar (e, na Fase 2, abrir o WhatsApp do
// estúdio). Evita print — a cliente manda só os números.
import { useState } from 'react'
import { mensagemDeEscolha, linkWhatsApp } from '@/lib/estudio/catalogo'
import { FotoOuPlaceholder } from '@/lib/estudio/foto'
import type { PosePublica } from '../dados'

export function GradePoses({ poses, nomeTema, whatsapp }: { poses: PosePublica[]; nomeTema: string; whatsapp?: string | null }) {
  const [sel, setSel] = useState<string[]>([])
  const [copiado, setCopiado] = useState(false)
  const msg = mensagemDeEscolha(sel, nomeTema)
  const wa = linkWhatsApp(whatsapp, msg)

  const alternar = (n: string) => { setCopiado(false); setSel(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n]) }

  return (
    <>
      {poses.length === 0 ? (
        <p className="mt-12 text-center text-sm text-neutral-500">As poses deste tema estão sendo preparadas.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {poses.map(p => {
            const on = sel.includes(p.numero)
            return (
              <button key={p.numero} onClick={() => alternar(p.numero)}
                className={`group overflow-hidden rounded-2xl border text-left transition ${on ? 'border-amber-300 ring-2 ring-amber-300' : 'border-white/10 hover:border-white/30'}`}
                aria-pressed={on} aria-label={`Pose ${p.numero}`}>
                <div className="relative aspect-[4/5] bg-neutral-800">
                  <FotoOuPlaceholder src={p.foto} alt={`Pose ${p.numero}`} className="h-full w-full object-cover"
                    placeholder={<div className="flex h-full flex-col items-center justify-center gap-1 text-neutral-600">
                      <span className="text-3xl">📷</span><span className="text-[11px]">foto em breve</span>
                    </div>} />
                  {on && <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-amber-300 text-sm font-bold text-neutral-950">✓</span>}
                </div>
                <p className={`py-2 text-center font-serif text-3xl font-semibold tabular-nums ${on ? 'text-amber-300' : 'text-neutral-100'}`}>{p.numero}</p>
              </button>
            )
          })}
        </div>
      )}

      {sel.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-neutral-950/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-sm"><span className="text-neutral-400">{sel.length} escolhida(s):</span> {msg.replace(/^Quero (a pose|as poses) /, '')}</p>
            <button onClick={() => setSel([])} className="rounded-lg px-3 py-2 text-xs text-neutral-400 hover:text-neutral-100">Limpar</button>
            {wa ? (
              <a href={wa} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-emerald-400">Escolher estas no WhatsApp</a>
            ) : (
              <button onClick={async () => { try { await navigator.clipboard.writeText(msg); setCopiado(true) } catch { setCopiado(false) } }}
                className="rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-amber-200">
                {copiado ? 'Copiado! Cole no WhatsApp' : 'Copiar números'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
