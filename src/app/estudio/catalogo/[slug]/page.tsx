// /estudio/catalogo/<slug> — poses numeradas do tema (seção 3.2).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { temaPublico, numeroDoEstudio, RODAPE } from '../dados'
import { GradePoses } from './grade-poses'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const t = await temaPublico(slug)
  return { title: t ? `${t.nome} · Estúdio IA` : 'Catálogo · Estúdio IA' }
}

export default async function TemaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [tema, whatsapp] = await Promise.all([temaPublico(slug), numeroDoEstudio()])
  if (!tema) notFound()
  return (
    <main className="min-h-dvh bg-neutral-950 px-4 pb-32 pt-8 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <Link href="/estudio/catalogo" className="text-xs text-neutral-400 hover:text-neutral-200">‹ Todos os temas</Link>
        <h1 className="mt-3 text-center font-serif text-3xl font-semibold sm:text-4xl">{tema.nome}</h1>
        <p className="mt-2 text-center text-sm text-neutral-400">Toque no número para escolher suas fotos.</p>
        <GradePoses poses={tema.poses} nomeTema={tema.nome} whatsapp={whatsapp} />
        <p className="mt-12 text-center text-xs text-neutral-500">{RODAPE}</p>
      </div>
    </main>
  )
}
