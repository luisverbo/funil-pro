// /estudio/catalogo — vitrine pública dos temas ativos (seção 3.2).
import Link from 'next/link'
import type { Metadata } from 'next'
import { temasPublicos, RODAPE } from './dados'
import { FotoOuPlaceholder } from '@/lib/estudio/foto'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Catálogo · Estúdio IA',
  description: 'Escolha o tema do seu ensaio fotográfico com IA.',
}

export default async function CatalogoPage() {
  const temas = await temasPublicos()
  return (
    <main className="min-h-dvh bg-neutral-950 px-4 py-10 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">Estúdio IA</p>
        <h1 className="mt-2 text-center font-serif text-3xl font-semibold sm:text-4xl">Escolha o seu ensaio</h1>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-neutral-400">Toque no tema para ver as poses numeradas.</p>

        {temas.length === 0 ? (
          <p className="mt-12 text-center text-sm text-neutral-500">O catálogo está sendo preparado. Volte em instantes 💖</p>
        ) : (
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            {temas.map(t => (
              <Link key={t.slug} href={`/estudio/catalogo/${t.slug}`}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 transition hover:border-amber-300/50">
                <div className="relative aspect-[4/5] overflow-hidden bg-neutral-800">
                  <FotoOuPlaceholder src={t.capa} alt={t.nome} className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    placeholder={<div className="flex h-full items-center justify-center text-4xl text-neutral-600">📷</div>} />
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold leading-tight">{t.nome}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{t.qtd} poses</p>
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-12 text-center text-xs text-neutral-500">{RODAPE}</p>
      </div>
    </main>
  )
}
