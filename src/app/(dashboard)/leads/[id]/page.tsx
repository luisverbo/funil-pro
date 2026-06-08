import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Lead, LeadSource, LeadEvent } from '@/types'
import DeleteLeadButton from '@/components/leads/delete-lead-button'

function fmtBRL(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

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

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700', 'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700', 'bg-teal-100 text-teal-700',
]
function getAvatarColor(name: string | null) {
  if (!name) return 'bg-gray-100 text-gray-500'
  const code = name.charCodeAt(0) + (name.charCodeAt(name.length - 1) || 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}
function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase()
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active:       { label: 'Ativo',         className: 'bg-[#EEF2FF] text-[#4F46E5]' },
  converted:    { label: 'Convertido',    className: 'bg-[#DCFCE7] text-[#16A34A]' },
  unsubscribed: { label: 'Descadastrado', className: 'bg-[#F1F5F9] text-[#64748B]' },
  lost:         { label: 'Perdido',       className: 'bg-[#FEE2E2] text-[#DC2626]' },
}

const EVENT_LABELS: Record<string, string> = {
  entered_funnel: '⚡ Entrou no funil',
  message_sent: '💬 Mensagem enviada',
  message_opened: '✉️ Mensagem aberta',
  message_clicked: '🖱️ Link clicado',
  link_clicked: '🖱️ Link clicado',
  replied: '↩️ Respondeu',
  purchased: '💰 Compra realizada',
  purchased_order_bump: '💰 Order bump comprado',
  purchased_upsell: '💰 Upsell comprado',
  delay_scheduled: '⏱️ Atraso agendado',
  tag_added: '🏷️ Tag adicionada',
  agent_activated: '🤖 Agente ativado',
  agent_deactivated: '🤖 Agente desativado',
  page_viewed: '👁️ Página visualizada',
  page_link_sent: '🔗 Link de página enviado',
  page_button_clicked: '🖱️ Botão clicado',
  unsubscribed: '🚫 Descadastrou',
  funnel_completed: '✅ Funil concluído',
  cart_abandoned: '🛒 Carrinho abandonado',
}

const EVENT_COLORS: Record<string, string> = {
  entered_funnel: 'bg-violet-100 text-violet-600',
  message_sent: 'bg-blue-100 text-blue-600',
  message_opened: 'bg-blue-100 text-blue-600',
  message_clicked: 'bg-blue-100 text-blue-600',
  link_clicked: 'bg-blue-100 text-blue-600',
  replied: 'bg-emerald-100 text-emerald-600',
  purchased: 'bg-emerald-100 text-emerald-600',
  purchased_order_bump: 'bg-emerald-100 text-emerald-600',
  purchased_upsell: 'bg-emerald-100 text-emerald-600',
  delay_scheduled: 'bg-amber-100 text-amber-600',
  tag_added: 'bg-violet-100 text-violet-600',
  agent_activated: 'bg-indigo-100 text-indigo-600',
  page_viewed: 'bg-indigo-100 text-indigo-600',
  page_link_sent: 'bg-indigo-100 text-indigo-600',
  funnel_completed: 'bg-emerald-100 text-emerald-600',
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!userTenant) redirect('/login')

  const [
    { data: lead },
    { data: source },
    { data: events },
  ] = await Promise.all([
    supabase.from('leads').select('*, funnels(id, name)').eq('id', id).eq('tenant_id', userTenant.tenant_id).single(),
    supabase.from('lead_sources').select('*').eq('lead_id', id).single(),
    supabase.from('lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: true }),
  ])

  if (!lead) notFound()

  const typedLead = lead as Lead & { funnels?: { id: string; name: string } | null }
  const typedSource = source as LeadSource | null
  const typedEvents = (events ?? []) as LeadEvent[]
  const st = STATUS_BADGE[typedLead.status] ?? STATUS_BADGE.active
  const avatarColor = getAvatarColor(typedLead.name ?? null)

  const purchaseEvents = typedEvents.filter(e =>
    e.event_type === 'purchased' || e.event_type === 'purchased_order_bump' || e.event_type === 'purchased_upsell'
  )
  const totalRevenue = purchaseEvents.reduce((s, e) => s + (e.revenue_cents ?? 0), 0)

  let adTotalRevenue = 0
  let adRevenueContribution: number | null = null
  if (typedSource?.utm_ad_id && totalRevenue > 0) {
    const admin = createAdminClient()
    const { data: sameAdSources } = await admin
      .from('lead_sources').select('lead_id').eq('utm_ad_id', typedSource.utm_ad_id)
    const sameAdLeadIds = (sameAdSources ?? []).map((s: { lead_id: string }) => s.lead_id)
    if (sameAdLeadIds.length > 0) {
      const { data: adRevEventsRaw } = await admin
        .from('lead_events').select('revenue_cents').eq('tenant_id', userTenant.tenant_id)
        .in('lead_id', sameAdLeadIds)
        .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')
      adTotalRevenue = (adRevEventsRaw ?? []).reduce((s: number, e: { revenue_cents: number | null }) => s + (e.revenue_cents ?? 0), 0)
      if (adTotalRevenue > 0) adRevenueContribution = (totalRevenue / adTotalRevenue) * 100
    }
  }

  const waPhone = (typedLead.phone ?? '').replace(/\D/g, '')

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5">
        <ArrowLeft className="w-4 h-4" />
        Voltar para Leads
      </Link>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Left column */}
        <div className="w-full lg:w-[360px] shrink-0 space-y-4">

          {/* Lead card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex flex-col items-center text-center gap-3 pb-4 border-b border-gray-100">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold select-none ${avatarColor}`}>
                {getInitials(typedLead.name ?? null)}
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{typedLead.name ?? 'Sem nome'}</h1>
                <span className={`inline-flex text-xs font-semibold px-2.5 py-0.5 rounded-full mt-1 ${st.className}`}>{st.label}</span>
              </div>
            </div>

            <div className="pt-4 space-y-2.5">
              {typedLead.phone && (
                <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-emerald-600 transition-colors group">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-600">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  {typedLead.phone}
                </a>
              )}
              {typedLead.email && (
                <a href={`mailto:${typedLead.email}`} className="flex items-center gap-2.5 text-sm text-gray-700 hover:text-indigo-600 transition-colors group">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-indigo-600">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </div>
                  <span className="truncate">{typedLead.email}</span>
                </a>
              )}
            </div>

            {typedLead.tags && typedLead.tags.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {typedLead.tags.map(tag => (
                    <span key={tag} className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100">
              <DeleteLeadButton leadId={typedLead.id} leadName={typedLead.name ?? null} redirectAfter="/leads" />
            </div>
          </div>

          {/* Origin card */}
          {typedSource && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="text-base">📍</span> Origem
              </h2>
              {!typedSource.utm_source && !typedSource.utm_campaign && !typedSource.utm_ad_id ? (
                <p className="text-xs text-gray-400">Entrada direta</p>
              ) : (
                <div className="space-y-2">
                  {typedSource.utm_source && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Fonte</span>
                      <span className="text-xs font-semibold text-gray-800 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{typedSource.utm_source}</span>
                    </div>
                  )}
                  {typedSource.utm_campaign && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs text-gray-500 shrink-0">Campanha</span>
                      <span className="text-xs font-medium text-gray-800 text-right">{typedSource.utm_campaign}</span>
                    </div>
                  )}
                  {typedSource.utm_ad_id && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">ID Anúncio</span>
                      <span className="text-xs font-mono text-gray-600">{typedSource.utm_ad_id}</span>
                    </div>
                  )}
                  {typedSource.landing_url && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-1">URL de entrada</p>
                      <p className="text-xs text-gray-600 break-all leading-relaxed">{typedSource.landing_url}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active funnel card */}
          {typedLead.funnels && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="text-base">🔀</span> Funil atual
              </h2>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-800 font-medium">{typedLead.funnels.name}</span>
                <Link href={`/funnels/${typedLead.funnels.id}/builder`}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  Abrir →
                </Link>
              </div>
            </div>
          )}

          {/* Purchases card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <span className="text-base">💰</span> Compras
            </h2>
            {totalRevenue > 0 ? (
              <>
                <div className="mb-3">
                  <p className="text-2xl font-bold text-emerald-700">{fmtBRL(totalRevenue)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{purchaseEvents.length} compra{purchaseEvents.length !== 1 ? 's' : ''}</p>
                  {adRevenueContribution !== null && (
                    <p className="text-xs text-gray-500 mt-1">{adRevenueContribution.toFixed(1)}% da receita do anúncio ({fmtBRL(adTotalRevenue)})</p>
                  )}
                </div>
                <div className="space-y-2 border-t border-gray-100 pt-3">
                  {purchaseEvents.map(ev => (
                    <div key={ev.id} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-gray-700">{ev.product_name ?? 'Produto'}</span>
                        {ev.platform && <span className="ml-1.5 bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{ev.platform}</span>}
                      </div>
                      <span className="font-semibold text-emerald-700">{fmtBRL(ev.revenue_cents ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-400">Nenhuma compra registrada</p>
            )}
          </div>
        </div>

        {/* Right column - Timeline */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-5">Timeline de Eventos</h2>
            {typedEvents.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-gray-400">
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                </div>
                <p className="text-sm text-gray-400">Nenhum evento registrado ainda.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-4 bottom-4 w-px bg-gray-100" />
                <div className="space-y-4">
                  {typedEvents.map(event => {
                    const colorClass = EVENT_COLORS[event.event_type] ?? 'bg-gray-100 text-gray-500'
                    const label = EVENT_LABELS[event.event_type] ?? event.event_type
                    const delayInfo = event.event_type === 'delay_scheduled'
                      ? (event.event_data as Record<string, unknown> | null)?.scheduled_for
                      : null
                    return (
                      <div key={event.id} className="flex items-start gap-4 relative">
                        <div className={`z-10 shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${colorClass}`}>
                          {label.split(' ')[0]}
                        </div>
                        <div className="flex-1 pt-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm">{label.split(' ').slice(1).join(' ') || label}</p>
                          {delayInfo && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              Agendado para: {new Date(String(delayInfo)).toLocaleString('pt-BR', {
                                timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          )}
                          {event.product_name && (
                            <p className="text-xs text-gray-500 mt-0.5">Produto: {event.product_name}</p>
                          )}
                          {event.revenue_cents != null && event.revenue_cents > 0 && (
                            <p className="text-xs text-emerald-600 mt-0.5 font-medium">+ {fmtBRL(event.revenue_cents)}</p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">{fmtDate(event.created_at)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
