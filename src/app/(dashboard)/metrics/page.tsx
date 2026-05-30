import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import LeadsChart from '@/components/metrics/leads-chart'
import FunnelChart from '@/components/metrics/funnel-chart'
import FunnelFilter from '@/components/metrics/funnel-filter'

function fmtBRL(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getPeriodDates(period: string, from?: string, to?: string): { since: string; until: string } {
  const now = new Date()
  const until = now.toISOString().split('T')[0]
  if (period === 'today') return { since: until, until }
  if (period === '7d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return { since: d.toISOString().split('T')[0], until }
  }
  if (period === 'custom' && from && to) return { since: from, until: to }
  const d = new Date(now)
  d.setDate(d.getDate() - 30)
  return { since: d.toISOString().split('T')[0], until }
}

const eventLabels: Record<string, string> = {
  entered_funnel: 'Entrou no funil',
  message_sent: 'Mensagem enviada',
  message_opened: 'Mensagem aberta',
  message_clicked: 'Link clicado',
  replied: 'Respondeu',
  purchased: 'Compra realizada',
  purchased_order_bump: 'Order Bump',
  purchased_upsell: 'Upsell',
  tag_added: 'Tag adicionada',
  agent_activated: 'Agente IA ativado',
  funnel_completed: 'Funil concluído',
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const period = sp.period ?? '30d'
  const funnelId = sp.funnel_id ?? ''

  const { since, until } = getPeriodDates(period, sp.from, sp.to)

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

  // Fetch all funnels for dropdown
  const { data: funnelsRaw } = await admin
    .from('funnels')
    .select('id, name, status')
    .eq('tenant_id', tenantId)
    .order('name')

  const funnels = (funnelsRaw ?? []) as Array<{ id: string; name: string; status: string }>

  // Build lead query with optional funnel filter
  let leadsQuery = admin
    .from('leads')
    .select('id, name, phone, email, status, current_block_id, funnel_id, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .lte('created_at', until + 'T23:59:59.999Z')
    .order('created_at', { ascending: false })

  if (funnelId) leadsQuery = leadsQuery.eq('funnel_id', funnelId)

  const { data: leadsRaw } = await leadsQuery
  const leads = (leadsRaw ?? []) as Array<{
    id: string
    name: string | null
    phone: string | null
    email: string | null
    status: string
    current_block_id: string | null
    funnel_id: string
    created_at: string
  }>

  // Count active leads (all time)
  let activeQuery = admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
  if (funnelId) activeQuery = activeQuery.eq('funnel_id', funnelId)
  const { count: activeCount } = await activeQuery

  // Purchase events in period
  let purchaseQuery = admin
    .from('lead_events')
    .select('lead_id, revenue_cents, created_at')
    .eq('tenant_id', tenantId)
    .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')
    .gte('created_at', since)
    .lte('created_at', until + 'T23:59:59.999Z')
  if (funnelId) purchaseQuery = purchaseQuery.eq('funnel_id', funnelId)
  const { data: purchaseEventsRaw } = await purchaseQuery
  const purchaseEvents = (purchaseEventsRaw ?? []) as Array<{ lead_id: string; revenue_cents: number | null; created_at: string }>

  const uniqueBuyers = new Set(purchaseEvents.map((e) => e.lead_id)).size
  const totalRevenue = purchaseEvents.reduce((s, e) => s + (e.revenue_cents ?? 0), 0)

  // Ad metrics summary
  let adQuery = admin
    .from('ad_metrics')
    .select('spend_cents, leads_count, revenue_cents')
    .eq('tenant_id', tenantId)
    .gte('date', since)
    .lte('date', until)
  const { data: adMetricsRaw } = await adQuery
  const adMetrics = (adMetricsRaw ?? []) as Array<{ spend_cents: number; leads_count: number; revenue_cents: number }>

  let totalSpend = 0, totalLeadsMeta = 0, totalRevenueMeta = 0
  for (const m of adMetrics) {
    totalSpend += m.spend_cents
    totalLeadsMeta += m.leads_count
    totalRevenueMeta += m.revenue_cents
  }
  const avgCPL = totalLeadsMeta > 0 ? Math.round(totalSpend / totalLeadsMeta) : 0
  const avgROAS = totalSpend > 0 ? totalRevenueMeta / totalSpend : 0

  // Leads per day for chart
  const leadsPerDay = new Map<string, number>()
  for (const lead of leads) {
    const day = lead.created_at.split('T')[0]
    leadsPerDay.set(day, (leadsPerDay.get(day) ?? 0) + 1)
  }

  const purchasesPerDay = new Map<string, number>()
  for (const ev of purchaseEvents) {
    const day = ev.created_at.split('T')[0]
    purchasesPerDay.set(day, (purchasesPerDay.get(day) ?? 0) + 1)
  }

  // Build date range for chart
  const chartData: Array<{ date: string; leads: number; purchases: number }> = []
  const startDate = new Date(since)
  const endDate = new Date(until)
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0]
    chartData.push({
      date: key,
      leads: leadsPerDay.get(key) ?? 0,
      purchases: purchasesPerDay.get(key) ?? 0,
    })
  }

  // Conversion funnel data (only if funnel selected)
  let funnelSteps: Array<{ blockId: string; label: string; blockType: string; count: number }> = []
  if (funnelId) {
    const { data: blocksRaw } = await admin
      .from('funnel_blocks')
      .select('id, label, block_type, position_y')
      .eq('funnel_id', funnelId)
      .order('position_y')

    const blocks = (blocksRaw ?? []) as Array<{ id: string; label: string; block_type: string; position_y: number }>

    if (blocks.length > 0) {
      // Count leads at each block
      const blockIds = blocks.map((b) => b.id)
      const { data: blockLeadsRaw } = await admin
        .from('leads')
        .select('current_block_id')
        .eq('tenant_id', tenantId)
        .eq('funnel_id', funnelId)
        .in('current_block_id', blockIds)

      const blockLeadCounts = new Map<string, number>()
      for (const row of (blockLeadsRaw ?? [])) {
        if (row.current_block_id) {
          blockLeadCounts.set(row.current_block_id, (blockLeadCounts.get(row.current_block_id) ?? 0) + 1)
        }
      }

      funnelSteps = blocks.map((b) => ({
        blockId: b.id,
        label: b.label,
        blockType: b.block_type,
        count: blockLeadCounts.get(b.id) ?? 0,
      })).filter((s) => s.count > 0)
    }
  }

  // Recent leads enrichment
  const recentLeads = leads.slice(0, 20)
  const leadIds = recentLeads.map((l) => l.id)

  let sourcesMap = new Map<string, string>()
  let lastEventMap = new Map<string, { event_type: string; created_at: string }>()
  let revenueMap = new Map<string, number>()

  if (leadIds.length > 0) {
    const { data: sourcesRaw } = await admin
      .from('lead_sources')
      .select('lead_id, utm_source')
      .in('lead_id', leadIds)

    for (const s of (sourcesRaw ?? [])) {
      if (s.utm_source) sourcesMap.set(s.lead_id, s.utm_source)
    }

    // Last event per lead
    const { data: lastEventsRaw } = await admin
      .from('lead_events')
      .select('lead_id, event_type, created_at')
      .eq('tenant_id', tenantId)
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false })

    const seen = new Set<string>()
    for (const ev of (lastEventsRaw ?? [])) {
      if (!seen.has(ev.lead_id)) {
        seen.add(ev.lead_id)
        lastEventMap.set(ev.lead_id, { event_type: ev.event_type, created_at: ev.created_at })
      }
    }

    // Revenue per lead
    const { data: revEventsRaw } = await admin
      .from('lead_events')
      .select('lead_id, revenue_cents')
      .eq('tenant_id', tenantId)
      .in('lead_id', leadIds)
      .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')

    for (const ev of (revEventsRaw ?? [])) {
      revenueMap.set(ev.lead_id, (revenueMap.get(ev.lead_id) ?? 0) + (ev.revenue_cents ?? 0))
    }
  }

  const periodLabels: Record<string, string> = {
    today: 'Hoje',
    '7d': '7 dias',
    '30d': '30 dias',
  }

  const statusConfig: Record<string, { label: string; className: string }> = {
    active: { label: 'Ativo', className: 'bg-indigo-50 text-indigo-700' },
    converted: { label: 'Convertido', className: 'bg-emerald-50 text-emerald-700' },
    unsubscribed: { label: 'Descadastrado', className: 'bg-gray-100 text-gray-600' },
    lost: { label: 'Perdido', className: 'bg-red-50 text-red-700' },
  }

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Visão geral de desempenho dos seus funis</p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-6 border-b border-gray-200 mb-6 text-sm font-medium">
        <Link href="/metrics" className="pb-2.5 border-b-2 border-indigo-600 text-indigo-600">
          Visão Geral
        </Link>
        <Link href="/metrics/funnels" className="pb-2.5 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          Por Funil
        </Link>
        <Link href="/metrics/ads" className="pb-2.5 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          Anúncios
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm">
          {(['today', '7d', '30d'] as const).map((p) => (
            <Link
              key={p}
              href={`/metrics?period=${p}${funnelId ? `&funnel_id=${funnelId}` : ''}`}
              className={`px-4 py-2 font-medium transition-colors ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {periodLabels[p]}
            </Link>
          ))}
        </div>

        <FunnelFilter funnels={funnels} currentFunnelId={funnelId} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-1">Leads no período</p>
          <p className="text-2xl font-bold text-gray-900">{leads.length.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-gray-400 mt-0.5">{since} → {until}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-1">Compradores</p>
          <p className="text-2xl font-bold text-emerald-700">{uniqueBuyers.toLocaleString('pt-BR')}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {leads.length > 0 ? `${((uniqueBuyers / leads.length) * 100).toFixed(1)}% conversão` : '—'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-1">Receita</p>
          <p className="text-2xl font-bold text-gray-900">{fmtBRL(totalRevenue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{purchaseEvents.length} evento{purchaseEvents.length !== 1 ? 's' : ''} de compra</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-1">Leads Ativos</p>
          <p className="text-2xl font-bold text-indigo-700">{(activeCount ?? 0).toLocaleString('pt-BR')}</p>
          <p className="text-xs text-gray-400 mt-0.5">em andamento agora</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-1">CPL Médio</p>
          <p className="text-2xl font-bold text-gray-900">{totalLeadsMeta > 0 ? fmtBRL(avgCPL) : '—'}</p>
          <p className="text-xs text-gray-400 mt-0.5">custo por lead (Meta)</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-1">ROAS Médio</p>
          <p className={`text-2xl font-bold ${totalSpend > 0 ? (avgROAS >= 1 ? 'text-emerald-700' : 'text-red-600') : 'text-gray-900'}`}>
            {totalSpend > 0 ? `${avgROAS.toFixed(2)}x` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">retorno sobre gasto</p>
        </div>
      </div>

      {/* Chart */}
      <div className="mb-6">
        <LeadsChart data={chartData} />
      </div>

      {/* Funnel drop-off */}
      <div className="mb-6">
        {funnelId ? (
          <FunnelChart steps={funnelSteps} />
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Drop-off por Etapa</h3>
            <p className="text-sm text-gray-400">Selecione um funil no filtro acima para ver o drop-off por etapa.</p>
          </div>
        )}
      </div>

      {/* Recent leads table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Leads Recentes</h2>
        </div>
        {recentLeads.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            Nenhum lead no período selecionado
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Nome</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Telefone</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Origem</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Último evento</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500">Valor</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Entrada</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentLeads.map((lead) => {
                  const st = statusConfig[lead.status] ?? statusConfig.active
                  const lastEv = lastEventMap.get(lead.id)
                  const rev = revenueMap.get(lead.id) ?? 0
                  const utmSource = sourcesMap.get(lead.id)
                  return (
                    <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-gray-900">{lead.name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-gray-600">{lead.phone ?? '—'}</td>
                      <td className="px-5 py-3.5">
                        {utmSource ? (
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{utmSource}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-500 text-xs">
                        {lastEv ? (eventLabels[lastEv.event_type] ?? lastEv.event_type) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-gray-800">
                        {rev > 0 ? fmtBRL(rev) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-gray-500 text-xs">
                        {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                        >
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
