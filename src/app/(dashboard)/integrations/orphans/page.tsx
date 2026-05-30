import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ArrowLeft } from 'lucide-react'

interface OrphanPurchase {
  id: string
  platform: string
  buyer_email: string | null
  buyer_phone: string | null
  buyer_name: string | null
  product_name: string | null
  revenue_cents: number | null
  created_at: string
}

const PLATFORM_STYLES: Record<string, string> = {
  hotmart: 'bg-orange-100 text-orange-700',
  kiwify: 'bg-purple-100 text-purple-700',
  eduzz: 'bg-blue-100 text-blue-700',
  yampi: 'bg-green-100 text-green-700',
}

function formatCurrency(cents: number | null): string {
  if (!cents) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function OrphansPage() {
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
  const { data: orphans } = await admin
    .from('orphan_purchases')
    .select('id, platform, buyer_email, buyer_phone, buyer_name, product_name, revenue_cents, created_at')
    .eq('tenant_id', ut.tenant_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const list = (orphans ?? []) as OrphanPurchase[]

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/integrations"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Integrações
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">Compras não vinculadas</h1>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <p className="text-sm font-medium text-amber-800">O que são compras não vinculadas?</p>
          <p className="text-sm text-amber-700 mt-0.5">
            São compras recebidas via webhook cujo comprador (email ou telefone) não foi encontrado entre os leads do seu funil.
            Isso pode acontecer quando o lead usou um e-mail diferente para comprar ou não passou pelo funil antes de comprar.
          </p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-14 text-center">
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300">
              <path d="M9 12l2 2 4-4" />
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">Nenhuma compra não vinculada</p>
          <p className="text-sm text-gray-400 mt-1">Todas as compras foram vinculadas a leads com sucesso.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plataforma</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Comprador</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Produto</th>
                  <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((orphan) => (
                  <tr key={orphan.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 text-gray-500 whitespace-nowrap">
                      {formatDate(orphan.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${PLATFORM_STYLES[orphan.platform] ?? 'bg-gray-100 text-gray-600'}`}>
                        {orphan.platform}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{orphan.buyer_name ?? '—'}</p>
                      <p className="text-gray-400 text-xs mt-0.5">{orphan.buyer_email ?? orphan.buyer_phone ?? '—'}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{orphan.product_name ?? '—'}</td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                      {formatCurrency(orphan.revenue_cents)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        disabled
                        title="Em breve"
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 cursor-not-allowed"
                      >
                        Vincular
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
            {list.length} registro{list.length !== 1 ? 's' : ''} encontrado{list.length !== 1 ? 's' : ''} (máximo 100)
          </div>
        </div>
      )}
    </div>
  )
}
