// Volta do login do Instagram: troca o code pelo token de 60 dias e grava a conta.
import { NextResponse } from 'next/server'
import { lerEstado } from '@/lib/instagram/contas'
import { obterAppId, salvarConta, segredoDoApp, trocarCodigo } from '@/lib/instagram/contas-servidor'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const voltar = (ig: string) => NextResponse.redirect(`${url.origin}/conteudos?ig=${ig}`)
  if (url.searchParams.get('error')) return voltar('cancelado')

  const segredo = segredoDoApp()
  const appId = await obterAppId()
  if (!segredo || !appId) return voltar('sem_app')
  const tenantId = lerEstado(url.searchParams.get('state'), segredo)
  if (!tenantId) return voltar('expirou')
  // A Meta às vezes cola "#_" no fim do code.
  const code = (url.searchParams.get('code') ?? '').replace(/#_$/, '')
  if (!code) return voltar('cancelado')

  try {
    const conta = await trocarCodigo({ code, appId, segredo, redirectUri: `${url.origin}/api/instagram/callback` })
    await salvarConta(tenantId, conta)
    return voltar('ok')
  } catch (err) {
    console.error('[instagram/callback] falhou:', String(err).slice(0, 300))
    return voltar('falhou')
  }
}
