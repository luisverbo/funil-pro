// /estudio/catalogo/<slug> — poses numeradas do tema (seção 3.2).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { temaPublico, numeroDoEstudio } from '../dados'
import { idiomaDoCatalogo, textosDoCatalogo, tituloDoTema, sufixoIdioma } from '@/lib/estudio/catalogo-idiomas'
import { GradePoses } from './grade-poses'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ l?: string }> }

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params
  const idioma = idiomaDoCatalogo((await searchParams).l)
  const t = await temaPublico(slug)
  const tx = textosDoCatalogo(idioma)
  return { title: t ? `${tituloDoTema(slug, t.nome, idioma)} · ${tx.marca}` : `${tx.titulo} · ${tx.marca}` }
}

export default async function TemaPage({ params, searchParams }: Props) {
  const { slug } = await params
  const idioma = idiomaDoCatalogo((await searchParams).l)
  const tx = textosDoCatalogo(idioma)
  const [tema, whatsapp] = await Promise.all([temaPublico(slug), numeroDoEstudio()])
  if (!tema) notFound()
  const nome = tituloDoTema(slug, tema.nome, idioma)
  return (
    <main lang={tx.html} className="min-h-dvh bg-neutral-950 px-4 pb-32 pt-8 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <Link href={`/estudio/catalogo${sufixoIdioma(idioma)}`} className="text-xs text-neutral-400 hover:text-neutral-200">{tx.voltar}</Link>
        <h1 className="mt-3 text-center font-serif text-3xl font-semibold sm:text-4xl">{nome}</h1>
        <p className="mt-2 text-center text-sm text-neutral-400">{tx.tocar}</p>
        <GradePoses poses={tema.poses} nomeTema={nome} whatsapp={whatsapp} idioma={idioma} />
        <p className="mt-12 text-center text-xs text-neutral-500">{tx.rodape}</p>
      </div>
    </main>
  )
}
