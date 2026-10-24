// /estudio/catalogo — vitrine pública dos temas ativos (seção 3.2).
import Link from 'next/link'
import type { Metadata } from 'next'
import { temasPublicos } from './dados'
import { idiomaDoCatalogo, textosDoCatalogo, tituloDoTema, sufixoIdioma } from '@/lib/estudio/catalogo-idiomas'
import { FotoOuPlaceholder } from '@/lib/estudio/foto'

export const dynamic = 'force-dynamic'
type Busca = { searchParams: Promise<{ l?: string }> }

export async function generateMetadata({ searchParams }: Busca): Promise<Metadata> {
  const t = textosDoCatalogo(idiomaDoCatalogo((await searchParams).l))
  return { title: `${t.titulo} · ${t.marca}` }
}

export default async function CatalogoPage({ searchParams }: Busca) {
  const idioma = idiomaDoCatalogo((await searchParams).l)
  const tx = textosDoCatalogo(idioma)
  const temas = (await temasPublicos()).map(t => ({ ...t, nome: tituloDoTema(t.slug, t.nome, idioma) }))
  return (
    <main lang={tx.html} className="min-h-dvh bg-neutral-950 px-4 py-10 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">{tx.marca}</p>
        <h1 className="mt-2 text-center font-serif text-3xl font-semibold sm:text-4xl">{tx.titulo}</h1>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-neutral-400">{tx.subtitulo}</p>

        {temas.length === 0 ? (
          <p className="mt-12 text-center text-sm text-neutral-500">{tx.vazio}</p>
        ) : (
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            {temas.map(t => (
              <Link key={t.slug} href={`/estudio/catalogo/${t.slug}${sufixoIdioma(idioma)}`}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 transition hover:border-amber-300/50">
                <div className="relative aspect-[4/5] overflow-hidden bg-neutral-800">
                  <FotoOuPlaceholder src={t.capa} alt={t.nome} className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    placeholder={<div className="flex h-full items-center justify-center text-4xl text-neutral-600">📷</div>} />
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold leading-tight">{t.nome}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{tx.poses(t.qtd)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-12 text-center text-xs text-neutral-500">{tx.rodape}</p>
      </div>
    </main>
  )
}
