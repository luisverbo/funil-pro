import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import InstanceCard from '@/components/whatsapp/instance-card'
import CreateInstanceButton from '@/components/whatsapp/create-instance-button'
import MetaSection from '@/components/integrations/meta-section'
import PaymentPlatformsSection from '@/components/integrations/payment-platforms-section'
import type { WhatsappInstance, Product } from '@/types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'

const PLATFORM_DEFS = [
  {
    id: 'hotmart',
    name: 'Hotmart',
    color: '#FF5F01',
    bgColor: '#fff3ee',
    textColor: '#FF5F01',
    icon: 'HM',
    instructions: [
      'Acesse Hotmart → Ferramentas → Webhooks',
      'Clique em "Novo Webhook" e cole a URL acima',
      'Selecione os eventos: Compra Aprovada, Compra Reembolsada, Carrinho Abandonado',
      'Salve e aguarde o primeiro evento chegar',
    ],
  },
  {
    id: 'kiwify',
    name: 'Kiwify',
    color: '#6B1AFF',
    bgColor: '#f3eeff',
    textColor: '#6B1AFF',
    icon: 'KW',
    instructions: [
      'Acesse Kiwify → Configurações → Webhooks',
      'Cole a URL do webhook acima',
      'Ative os eventos de compra aprovada e abandono de checkout',
      'Copie o Token e cole no campo abaixo',
    ],
  },
  {
    id: 'eduzz',
    name: 'Eduzz',
    color: '#1A2E6E',
    bgColor: '#eef0f9',
    textColor: '#1A2E6E',
    icon: 'ED',
    instructions: [
      'Acesse Eduzz → Configurações → Postback URL',
      'Cole a URL do webhook acima no campo de postback',
      'Salve as configurações — a Eduzz não usa token de verificação',
    ],
  },
  {
    id: 'yampi',
    name: 'Yampi',
    color: '#16A34A',
    bgColor: '#eefbf3',
    textColor: '#16A34A',
    icon: 'YP',
    instructions: [
      'Acesse Yampi → Configurações → Webhooks',
      'Clique em "+ Novo Webhook" e cole a URL acima',
      'Selecione os eventos de pedido aprovado e carrinho abandonado',
      'Copie o Secret e cole no campo abaixo',
    ],
  },
]

export default async function IntegrationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!ut) redirect('/onboarding')

  const admin = createAdminClient()

  const [{ data: instances }, { data: recentEvents }, { data: tenantData }, { data: allProducts }] = await Promise.all([
    admin
      .from('whatsapp_instances')
      .select('*')
      .eq('tenant_id', ut.tenant_id)
      .order('created_at', { ascending: false }),
    admin
      .from('lead_events')
      .select('platform')
      .eq('tenant_id', ut.tenant_id)
      .in('platform', ['hotmart', 'kiwify', 'eduzz', 'yampi'])
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    admin
      .from('tenants')
      .select('meta_access_token, meta_ad_account_id, meta_pixel_id, webhook_tokens')
      .eq('id', ut.tenant_id)
      .single(),
    admin
      .from('products')
      .select('*')
      .eq('tenant_id', ut.tenant_id)
      .order('created_at', { ascending: false }),
  ])

  const activePlatforms = [...new Set((recentEvents ?? []).map((e: { platform: string }) => e.platform))]
  const webhookTokens = (tenantData?.webhook_tokens as Record<string, string>) ?? {}

  const productsByPlatform: Record<string, Product[]> = {}
  for (const p of (allProducts as Product[]) ?? []) {
    if (!productsByPlatform[p.platform]) productsByPlatform[p.platform] = []
    productsByPlatform[p.platform].push(p)
  }

  const platforms = PLATFORM_DEFS.map((def) => ({
    ...def,
    webhookUrl: `${APP_URL}/api/webhooks/${def.id}/${ut.tenant_id}`,
    webhookToken: webhookTokens[def.id] ?? null,
  }))

  return (
    <div>
      {/* Page header */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900">Integrações</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Conecte seus canais de comunicação e plataformas de pagamento
        </p>
      </div>

      {/* WhatsApp section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-600">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-800">WhatsApp</h2>
          </div>
          <CreateInstanceButton />
        </div>

        {!instances || instances.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#25D366' }}>
              <svg viewBox="0 0 24 24" fill="white" className="w-9 h-9">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
            </div>
            <p className="text-gray-800 font-semibold text-base">Nenhuma instância conectada</p>
            <p className="text-sm text-gray-400 mt-1">Clique em &quot;Nova Instância&quot; para conectar seu WhatsApp</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(instances as WhatsappInstance[]).map((inst) => (
              <InstanceCard key={inst.id} instance={inst} />
            ))}
          </div>
        )}
      </div>

      {/* Payment Platforms section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-indigo-600">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-800">Plataformas de Pagamento</h2>
          </div>
          <Link
            href="/integrations/orphans"
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1.5 transition-colors duration-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            Compras não vinculadas
          </Link>
        </div>

        <PaymentPlatformsSection
          platforms={platforms}
          productsByPlatform={productsByPlatform}
          activePlatforms={activePlatforms}
        />
      </div>

      {/* Meta Ads section */}
      <div className="mb-10">
        <MetaSection
          metaAccessToken={tenantData?.meta_access_token ?? null}
          metaAdAccountId={tenantData?.meta_ad_account_id ?? null}
          metaPixelId={tenantData?.meta_pixel_id ?? null}
          tenantId={ut.tenant_id}
        />
      </div>
    </div>
  )
}
