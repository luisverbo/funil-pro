// "Conectar Instagram": manda o usuário logado para o login do Instagram.
import { NextResponse } from 'next/server'
import { assinarEstado, urlDeAutorizacao } from '@/lib/instagram/contas'
import { obterAppId, segredoDoApp } from '@/lib/instagram/contas-servidor'
import { tenantDaSessao } from '@/lib/instagram/tenant-da-sessao'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origem = new URL(request.url).origin
  const tenantId = await tenantDaSessao()
  if (!tenantId) return NextResponse.redirect(`${origem}/login`)
  const [appId, segredo] = [await obterAppId(), segredoDoApp()]
  if (!appId || !segredo) return NextResponse.redirect(`${origem}/conteudos?ig=sem_app`)
  const url = urlDeAutorizacao(appId, `${origem}/api/instagram/callback`, assinarEstado(tenantId, segredo))
  return NextResponse.redirect(url)
}
