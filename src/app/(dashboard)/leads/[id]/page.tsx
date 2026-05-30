import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, User, Phone, Mail, Tag } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Lead, LeadSource, LeadEvent } from '@/types'

function fmtBRL(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

const statusConfig: Record<string, { label: string; className: string }> = {
  active:       { label: 'Ativo',        className: 'bg-indigo-50 text-indigo-700' },
  converted:    { label: 'Convertido',   className: 'bg-emerald-50 text-emerald-700' },
  unsubscribed: { label: 'Descadastrado', className: 'bg-gray-100 text-gray-600' },
  lost:         { label: 'Perdido',      className: 'bg-red-50 text-red-700' },
}

function eventIcon(type: string) {
  switch (type) {
    case 'entered_funnel':
      return (
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-emerald-600">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
      )
    case 'message_sent':
      return (
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-blue-600">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
      )
    case 'message_opened':
      return (
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-blue-600">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
      )
    case 'message_clicked':
    case 'link_clicked':
      return (
        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-indigo-600">
            <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
        </div>
      )
    case 'replied':
      return (
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-emerald-600">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 00-4-4H4" />
          </svg>
        </div>
      )
    case 'purchased':
      return (
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-emerald-600">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
        </div>
      )
    case 'tag_added':
      return (
        <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-violet-600">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        </div>
      )
    case 'agent_activated':
      return (
        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-indigo-600">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4M8 15h.01M16 15h.01" />
          </svg>
        </div>
      )
    default:
      return (
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
      )
  }
}

const eventLabels: Record<string, string> = {
  entered_funnel: 'Entrou no funil',
  message_sent: 'Mensagem enviada',
  message_opened: 'Mensagem aberta',
  message_clicked: 'Link clicado',
  link_clicked: 'Link clicado',
  replied: 'Respondeu',
  purchased: 'Compra realizada',
  tag_added: 'Tag adicionada',
  agent_activated: 'Agente IA ativado',
  agent_deactivated: 'Agente IA desativado',
  page_viewed: 'Página visualizada',
  page_button_clicked: 'Botão da página clicado',
  unsubscribed: 'Descadastrado',
  funnel_completed: 'Funil concluído',
}

export default async function LeadDetailPage({
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

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', userTenant.tenant_id)
    .single()

  if (!lead) notFound()

  const { data: source } = await supabase
    .from('lead_sources')
    .select('*')
    .eq('lead_id', id)
    .single()

  const { data: events } = await supabase
    .from('lead_events')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: true })

  const typedLead = lead as Lead
  const typedSource = source as LeadSource | null
  const typedEvents = (events ?? []) as LeadEvent[]
  const st = statusConfig[typedLead.status] ?? statusConfig.active

  // Revenue enrichment
  const purchaseEvents = typedEvents.filter((e) =>
    e.event_type === 'purchased' || e.event_type === 'purchased_order_bump' || e.event_type === 'purchased_upsell'
  )
  const totalRevenue = purchaseEvents.reduce((s, e) => s + (e.revenue_cents ?? 0), 0)

  // Ad revenue contribution (if lead has utm_ad_id)
  let adTotalRevenue = 0
  let adRevenueContribution: number | null = null
  if (typedSource?.utm_ad_id && totalRevenue > 0) {
    const admin = createAdminClient()
    const { data: adEventsRaw } = await admin
      .from('lead_events')
      .select('revenue_cents')
      .eq('tenant_id', userTenant.tenant_id)
      .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')

    // Get all leads with same utm_ad_id
    const { data: sameAdSources } = await admin
      .from('lead_sources')
      .select('lead_id')
      .eq('utm_ad_id', typedSource.utm_ad_id)

    const sameAdLeadIds = (sameAdSources ?? []).map((s: { lead_id: string }) => s.lead_id)

    if (sameAdLeadIds.length > 0) {
      const { data: adRevEventsRaw } = await admin
        .from('lead_events')
        .select('revenue_cents')
        .eq('tenant_id', userTenant.tenant_id)
        .in('lead_id', sameAdLeadIds)
        .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')

      adTotalRevenue = (adRevEventsRaw ?? []).reduce((s: number, e: { revenue_cents: number | null }) => s + (e.revenue_cents ?? 0), 0)
      if (adTotalRevenue > 0) {
        adRevenueContribution = (totalRevenue / adTotalRevenue) * 100
      }
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Leads
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
              <User className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{typedLead.name ?? 'Sem nome'}</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {typedLead.phone && (
                  <span className="flex items-center gap-1 text-sm text-gray-500">
                    <Phone className="w-3.5 h-3.5" />
                    {typedLead.phone}
                  </span>
                )}
                {typedLead.email && (
                  <span className="flex items-center gap-1 text-sm text-gray-500">
                    <Mail className="w-3.5 h-3.5" />
                    {typedLead.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>
            {st.label}
          </span>
        </div>

        {typedLead.tags && typedLead.tags.length > 0 && (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-gray-400" />
            {typedLead.tags.map((tag) => (
              <span key={tag} className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Origin card */}
      {typedSource && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
          <h2 className="font-semibold text-gray-900 mb-4">Origem do Lead</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {typedSource.utm_source && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Fonte</p>
                <p className="font-medium text-gray-900">{typedSource.utm_source}</p>
              </div>
            )}
            {typedSource.utm_campaign && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Campanha</p>
                <p className="font-medium text-gray-900">{typedSource.utm_campaign}</p>
              </div>
            )}
            {typedSource.utm_campaign_id && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">ID da Campanha</p>
                <p className="font-medium text-gray-900 font-mono text-xs">{typedSource.utm_campaign_id}</p>
              </div>
            )}
            {typedSource.utm_adset_id && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">ID do Conjunto</p>
                <p className="font-medium text-gray-900 font-mono text-xs">{typedSource.utm_adset_id}</p>
              </div>
            )}
            {typedSource.utm_ad_id && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">ID do Anúncio</p>
                <p className="font-medium text-gray-900 font-mono text-xs">{typedSource.utm_ad_id}</p>
              </div>
            )}
            {typedSource.utm_content && (
              <div>
                <p className="text-gray-500 text-xs mb-0.5">Conteúdo</p>
                <p className="font-medium text-gray-900">{typedSource.utm_content}</p>
              </div>
            )}
            {typedSource.landing_url && (
              <div className="col-span-2">
                <p className="text-gray-500 text-xs mb-0.5">URL de entrada</p>
                <p className="font-medium text-gray-900 text-xs break-all">{typedSource.landing_url}</p>
              </div>
            )}
          </div>
          {!typedSource.utm_source && !typedSource.utm_campaign && !typedSource.utm_ad_id && (
            <p className="text-sm text-gray-400">Nenhum dado de UTM registrado para este lead.</p>
          )}
        </div>
      )}

      {/* Revenue card */}
      {totalRevenue > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
          <h2 className="font-semibold text-gray-900 mb-4">Receita Gerada</h2>
          <div className="flex items-center gap-4 mb-4">
            <div>
              <p className="text-2xl font-bold text-emerald-700">{fmtBRL(totalRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{purchaseEvents.length} evento{purchaseEvents.length !== 1 ? 's' : ''} de compra</p>
            </div>
            {adRevenueContribution !== null && (
              <div className="ml-6 pl-6 border-l border-gray-100">
                <p className="text-sm font-semibold text-gray-700">{adRevenueContribution.toFixed(1)}%</p>
                <p className="text-xs text-gray-400 mt-0.5">da receita do anúncio ({fmtBRL(adTotalRevenue)})</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {purchaseEvents.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-gray-700">{ev.product_name ?? 'Produto não identificado'}</span>
                  {ev.platform && (
                    <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{ev.platform}</span>
                  )}
                </div>
                <span className="font-semibold text-emerald-700">{fmtBRL(ev.revenue_cents ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-5">Timeline de Eventos</h2>
        {typedEvents.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum evento registrado ainda.</p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-4 bottom-4 w-px bg-gray-100" />

            <div className="space-y-4">
              {typedEvents.map((event, idx) => (
                <div key={event.id} className="flex items-start gap-4 relative">
                  <div className="z-10 shrink-0">
                    {eventIcon(event.event_type)}
                  </div>
                  <div className="flex-1 pt-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">
                      {eventLabels[event.event_type] ?? event.event_type}
                    </p>
                    {event.product_name && (
                      <p className="text-xs text-gray-500 mt-0.5">Produto: {event.product_name}</p>
                    )}
                    {event.revenue_cents != null && event.revenue_cents > 0 && (
                      <p className="text-xs text-emerald-600 mt-0.5 font-medium">
                        + R$ {(event.revenue_cents / 100).toFixed(2).replace('.', ',')}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(event.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
