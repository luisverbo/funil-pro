import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Link2, Megaphone, FileText } from 'lucide-react'
import CopyUrlButton from '@/components/funnels/copy-url-button'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export default async function FunnelLinksPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await getSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/login')

  const { data: funnel } = await supabase
    .from('funnels')
    .select('id, name, status')
    .eq('id', id)
    .eq('tenant_id', userTenant.tenant_id)
    .single()

  if (!funnel) notFound()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'
  const activateUrl = `${baseUrl}/api/funnels/${id}/activate`
  const metaUrl = `${baseUrl}/api/funnels/${id}/activate?utm_source=meta&utm_campaign_id={{campaign.id}}&utm_adset_id={{adset.id}}&utm_ad_id={{ad.id}}&utm_content={{ad.name}}&landing_url={{site_source_url}}`
  const formUrl = `${baseUrl}/f/${id}`

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/funnels/${id}/builder`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao Builder
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Links do Funil</h1>
        <p className="text-sm text-gray-500 mt-1">{funnel.name}</p>
      </div>

      <div className="space-y-5">
        {/* Base URL */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-5 h-5 text-indigo-500" />
            <h2 className="font-semibold text-gray-900">URL Base (API)</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Endpoint POST para ativar um lead no funil. Use em integrações customizadas.
          </p>
          <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs text-gray-700 break-all mb-3">
            {activateUrl}
          </div>
          <CopyUrlButton url={activateUrl} label="Copiar URL base" />
        </div>

        {/* Meta Ads */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-gray-900">Link para Meta Ads</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Use como URL de destino no Meta Ads. As macros <code className="bg-gray-100 px-1 rounded text-xs">{'{{campaign.id}}'}</code>, <code className="bg-gray-100 px-1 rounded text-xs">{'{{ad.id}}'}</code> etc. são preenchidas automaticamente pelo Meta.
          </p>
          <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs text-gray-700 break-all mb-3">
            {metaUrl}
          </div>
          <CopyUrlButton url={metaUrl} label="Copiar link Meta Ads" />

          <div className="mt-4 bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-semibold mb-1">Como usar no Meta Ads:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700">
              <li>No gerenciador de anúncios, vá em "Destino" do anúncio</li>
              <li>Cole a URL acima como URL do site</li>
              <li>O Meta preencherá automaticamente os IDs da campanha, conjunto e anúncio</li>
              <li>Os dados de gasto serão vinculados ao lead automaticamente</li>
            </ol>
          </div>
        </div>

        {/* Landing page form */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-emerald-500" />
            <h2 className="font-semibold text-gray-900">Página de Captura</h2>
          </div>
          <p className="text-sm text-gray-500 mb-3">
            Página pública com formulário de captura (nome, email, telefone). Ideal para usar como URL de destino no Meta Ads com rastreamento UTM automático.
          </p>
          <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs text-gray-700 break-all mb-3">
            {formUrl}
          </div>
          <div className="flex items-center gap-3">
            <CopyUrlButton url={formUrl} label="Copiar link da página" />
            <a
              href={formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-500 text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              Abrir página
            </a>
          </div>
          <div className="mt-4 bg-emerald-50 rounded-lg p-4 text-sm text-emerald-800">
            <p className="font-semibold mb-1">Dica:</p>
            <p className="text-emerald-700">
              Adicione UTMs ao final da URL para rastrear a origem dos leads. Ex:{' '}
              <code className="bg-emerald-100 px-1 rounded text-xs">{formUrl}?utm_source=meta&utm_campaign_id=123</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
