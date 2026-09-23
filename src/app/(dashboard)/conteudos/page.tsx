import { Suspense } from 'react'
import { listarConteudos, contagemPorStatus, conexaoInstagram } from '@/app/actions/conteudos-ig'
import ConteudosClient from './conteudos-client'

export const dynamic = 'force-dynamic'

export default async function ConteudosPage() {
  const [{ itens, error }, contagem, conexao] = await Promise.all([
    listarConteudos(),
    contagemPorStatus(),
    conexaoInstagram(),
  ])
  return (
    <Suspense>
      <ConteudosClient itensIniciais={itens} erroInicial={error ?? null} contagemInicial={contagem} conexao={conexao} />
    </Suspense>
  )
}
