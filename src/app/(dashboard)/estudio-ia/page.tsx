// /estudio-ia — aba "Estúdio IA" (seção 3.1). Fase 1: Catálogo.
import { Suspense } from 'react'
import { listarCatalogo } from '@/app/actions/estudio'
import EstudioClient from './estudio-client'

export const dynamic = 'force-dynamic'

export default async function EstudioPage() {
  const inicial = await listarCatalogo()
  return (
    <Suspense>
      <EstudioClient inicial={inicial} supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''} />
    </Suspense>
  )
}
