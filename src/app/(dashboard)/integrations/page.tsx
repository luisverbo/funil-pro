import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import PaymentPlatformsSection from '@/components/integrations/payment-platforms-section'
import type { Product } from '@/types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'

const PLATFORM_COLORS: Record<string, string> = {
  hotmart: '#FF6B35',
  kiwify: '#7C3AED',
  eduzz: '#0066FF',
  yampi: '#00B37E',
}

const PLATFORM_INSTRUCTIONS: Record<string, string[]> = {
  hotmart: [
    'Acesse o painel da Hotmart e vá em Ferramentas → Webhooks',
    'Clique em "Adicionar Webhook" e cole a URL acima',
    'Selecione os eventos: Compra Aprovada, Cancelada, Chargeback e Carrinho Abandonado',
  ],
  kiwify: [
    'Acesse o painel da Kiwify e vá em Configurações → Webhooks',
    'Cole a URL acima no campo de webhook',
    'Ative os eventos de compra, cancelamento e carrinho abandonado',
  ],
  eduzz: [
    'Acesse o painel da Eduzz e vá em Configurações → Postback URL',
    'Cole a URL acima no campo de Postback',
    'Salve e faça um disparo de teste para validar',
  ],
  yampi: [
    'Acesse o painel da Yampi e vá em Configurações → Webhooks',
    'Cole a URL acima e selecione os eventos de pedido e carrinho',
    'Salve as configurações e verifique o status acima',
  ],
}

const PLATFORM_ICONS: Record<string, string> = {
  hotmart: 'HM',
  kiwify: 'KW',
  eduzz: 'ED',
  yampi: 'YP',
}

const PLATFORM_NAMES: Record<string, string> = {
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
  eduzz: 'Eduzz',
  yampi: 'Yampi',
}

const COMING_SOON = [
  { id: 'meta', name: 'Meta Ads', icon: 'M' },
  { id: 'google', name: 'Google Ads', icon: 'G' },
  { id: 'stripe', name: 'Stripe', icon: 'S' },
  { id: 'active', name: 'ActiveCampaign', icon: 'AC' },
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
  const tenantId = ut.tenant_id

  const [{ data: recentEvents }, { data: allProducts }] = await Promise.all([
    admin
      .from('lead_events')
      .select('platform')
      .eq('tenant_id', tenantId)
      .in('platform', ['hotmart', 'kiwify', 'eduzz', 'yampi'])
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    admin
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId),
  ])

  const activePlatforms = Array.from(
    new Set((recentEvents ?? []).map((e: { platform: string }) => e.platform))
  ) as string[]

  // Group products by platform
  const productsByPlatform: Record<string, Product[]> = {}
  for (const p of (allProducts ?? []) as Product[]) {
    if (!productsByPlatform[p.platform]) productsByPlatform[p.platform] = []
    productsByPlatform[p.platform].push(p)
  }

  const platformConfigs = ['hotmart', 'kiwify', 'eduzz', 'yampi'].map((id) => ({
    id,
    name: PLATFORM_NAMES[id],
    color: PLATFORM_COLORS[id],
    bgColor: '',
    textColor: '',
    icon: PLATFORM_ICONS[id],
    webhookUrl: `${APP_URL}/api/webhooks/${id}/${tenantId}`,
    instructions: PLATFORM_INSTRUCTIONS[id],
  }))

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Integrações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Conecte suas ferramentas ao FunilPro</p>
      </div>

      {/* ────────── WhatsApp Section ────────── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-emerald-500">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
            <h2 className="text-base font-semibold text-gray-800">WhatsApp</h2>
          </div>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Em breve</span>
        </div>

        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-emerald-400">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
          </div>
          <p className="text-gray-600 font-medium text-sm">Gerenciamento de instâncias WhatsApp</p>
          <p className="text-xs text-gray-400 mt-1">Configure suas instâncias WhatsApp na próxima versão</p>
        </div>
      </section>

      {/* ────────── Payment Platforms Section ────────── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-indigo-500">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            <h2 className="text-base font-semibold text-gray-800">Plataformas de Pagamento</h2>
          </div>
          <a
            href="/integrations/orphans"
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
          >
            Compras não vinculadas
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>
        <PaymentPlatformsSection
          platforms={platformConfigs}
          productsByPlatform={productsByPlatform}
          activePlatforms={activePlatforms}
        />
      </section>

      {/* ────────── Coming Soon Section ────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-gray-400">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <h2 className="text-base font-semibold text-gray-400">Em breve</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {COMING_SOON.map((item) => (
            <div
              key={item.id}
              className="bg-gray-50 border border-gray-200 rounded-2xl p-4 opacity-60 cursor-not-allowed"
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-gray-400 bg-gray-200 text-sm font-bold mb-3 mx-auto">
                {item.icon}
              </div>
              <p className="font-semibold text-gray-500 text-sm text-center">{item.name}</p>
              <div className="flex justify-center mt-2">
                <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Em breve
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
