import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import InstanceCard from '@/components/whatsapp/instance-card'
import CreateInstanceButton from '@/components/whatsapp/create-instance-button'
import CopyUrlButton from '@/components/funnels/copy-url-button'
import type { WhatsappInstance } from '@/types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'

const PAYMENT_PLATFORMS = [
  {
    id: 'hotmart',
    name: 'Hotmart',
    color: 'bg-orange-100 text-orange-700',
    badgeColor: 'bg-orange-500',
    instruction: 'Cole esta URL no painel da Hotmart em: Ferramentas → Webhooks',
    icon: 'HM',
  },
  {
    id: 'kiwify',
    name: 'Kiwify',
    color: 'bg-purple-100 text-purple-700',
    badgeColor: 'bg-purple-500',
    instruction: 'Cole esta URL no painel da Kiwify em: Configurações → Webhooks',
    icon: 'KW',
  },
  {
    id: 'eduzz',
    name: 'Eduzz',
    color: 'bg-blue-100 text-blue-700',
    badgeColor: 'bg-blue-500',
    instruction: 'Cole esta URL no painel da Eduzz em: Configurações → Postback URL',
    icon: 'ED',
  },
  {
    id: 'yampi',
    name: 'Yampi',
    color: 'bg-green-100 text-green-700',
    badgeColor: 'bg-green-500',
    instruction: 'Cole esta URL no painel da Yampi em: Configurações → Webhooks',
    icon: 'YP',
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

  const [{ data: instances }, { data: recentEvents }] = await Promise.all([
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
  ])

  const activePlatforms = new Set((recentEvents ?? []).map((e: { platform: string }) => e.platform))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrações</h1>
          <p className="text-sm text-gray-500 mt-0.5">Conecte suas instâncias WhatsApp e plataformas de pagamento</p>
        </div>
        <CreateInstanceButton />
      </div>

      {/* WhatsApp section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-emerald-500">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
          </svg>
          <h2 className="text-base font-semibold text-gray-800">WhatsApp</h2>
        </div>

        {!instances || instances.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center">
            <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-emerald-400">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
            </div>
            <p className="text-gray-600 font-medium">Nenhuma instância WhatsApp</p>
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
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-indigo-500">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            <h2 className="text-base font-semibold text-gray-800">Plataformas de Pagamento</h2>
          </div>
          <Link
            href="/integrations/orphans"
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            Compras não vinculadas
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PAYMENT_PLATFORMS.map((platform) => {
            const webhookUrl = `${APP_URL}/api/webhooks/${platform.id}/${ut.tenant_id}`
            const isActive = activePlatforms.has(platform.id)
            return (
              <div key={platform.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${platform.color}`}>
                      {platform.icon}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{platform.name}</p>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          Ativo — recebeu webhook nos últimos 7 dias
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Aguardando primeiro webhook</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 mb-3">
                  <p className="text-xs text-gray-500 mb-1 font-medium">URL do Webhook</p>
                  <p className="text-xs font-mono text-gray-700 break-all leading-relaxed">{webhookUrl}</p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500 flex-1">{platform.instruction}</p>
                  <CopyUrlButton url={webhookUrl} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Email — coming soon */}
      <div className="border border-gray-200 rounded-2xl p-5 bg-white shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-gray-400">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <h2 className="text-base font-semibold text-gray-400">E-mail via Resend</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Em breve</span>
        </div>
        <p className="text-sm text-gray-400">Integração com Resend para envio de e-mails transacionais e sequências.</p>
      </div>
    </div>
  )
}
