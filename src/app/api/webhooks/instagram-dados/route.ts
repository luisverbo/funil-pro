// ============================================================================
// Callbacks da Meta: "Desautorizar" e "Exclusão de dados" (exigidos na revisão)
// ----------------------------------------------------------------------------
// A Meta manda `signed_request` (form) assinado com o App Secret. Apagamos a
// conta (token incluso) em todos os tenants e devolvemos o código de
// confirmação + URL de status, como a Meta pede.
// GET ?codigo=… mostra que o pedido foi atendido.
// ============================================================================
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { lerSignedRequest } from '@/lib/instagram/contas'
import { apagarPorIgUser, segredoDoApp } from '@/lib/instagram/contas-servidor'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const segredo = segredoDoApp()
  const form = await request.formData().catch(() => null)
  const dados = segredo ? lerSignedRequest(form?.get('signed_request') as string | null, segredo) : null
  if (!dados) return NextResponse.json({ error: 'signed_request inválido' }, { status: 400 })
  await apagarPorIgUser(dados.user_id)
  const codigo = randomBytes(8).toString('hex')
  const origem = new URL(request.url).origin
  return NextResponse.json({ url: `${origem}/api/webhooks/instagram-dados?codigo=${codigo}`, confirmation_code: codigo })
}

export async function GET(request: Request) {
  const codigo = new URL(request.url).searchParams.get('codigo') ?? ''
  return new NextResponse(
    `Pedido ${codigo.replace(/[^a-f0-9]/g, '')}: os dados da conta do Instagram (token e perfil) foram apagados do FunilPro.`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
