import { createAdminClient } from '@/lib/supabase/admin'

const META_GRAPH_URL = 'https://graph.facebook.com/v19.0'

async function fetchAdMetricsFromMeta(adAccountId: string, accessToken: string, date: string) {
  const fields = 'ad_id,ad_name,campaign_id,campaign_name,adset_id,spend,impressions,clicks'
  const timeRange = JSON.stringify({ since: date, until: date })
  const url = `${META_GRAPH_URL}/act_${adAccountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&level=ad&access_token=${accessToken}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Meta API ${res.status}`)
  return res.json()
}

export async function syncMetaAdMetrics(tenantId: string): Promise<number> {
  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('meta_access_token, meta_ad_account_id')
    .eq('id', tenantId)
    .single()

  if (!tenant?.meta_access_token || !tenant?.meta_ad_account_id) return 0

  const today = new Date()
  let synced = 0

  for (let i = 0; i < 30; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const date = d.toISOString().split('T')[0]

    try {
      const data = await fetchAdMetricsFromMeta(
        tenant.meta_ad_account_id,
        tenant.meta_access_token,
        date
      )
      const ads = data?.data ?? []

      for (const ad of ads) {
        // Calculate leads_count from lead_sources
        const { count: leadsCount } = await admin
          .from('lead_sources')
          .select('*', { count: 'exact', head: true })
          .eq('utm_ad_id', ad.ad_id)

        // Get lead IDs from this ad
        const { data: leadIdRows } = await admin
          .from('lead_sources')
          .select('lead_id')
          .eq('utm_ad_id', ad.ad_id)

        const leadIdSet = new Set((leadIdRows ?? []).map((l: { lead_id: string }) => l.lead_id))

        // Calculate revenue from lead_events attributed to this ad's leads
        let revFromAd = 0
        if (leadIdSet.size > 0) {
          const { data: revenueData } = await admin
            .from('lead_events')
            .select('revenue_cents, lead_id')
            .eq('tenant_id', tenantId)
            .in('event_type', ['purchased', 'purchased_order_bump', 'purchased_upsell'])
            .in('lead_id', Array.from(leadIdSet))
            .not('revenue_cents', 'is', null)

          revFromAd = (revenueData ?? []).reduce(
            (sum: number, e: { revenue_cents: number | null }) => sum + (e.revenue_cents ?? 0),
            0
          )
        }

        const spendCents = Math.round(parseFloat(ad.spend ?? '0') * 100)
        const lc = leadsCount ?? 0
        const cplCents = lc > 0 ? Math.round(spendCents / lc) : 0
        const roas = spendCents > 0 ? revFromAd / spendCents : 0

        await admin.from('ad_metrics').upsert(
          {
            tenant_id: tenantId,
            ad_id: ad.ad_id,
            campaign_id: ad.campaign_id ?? null,
            adset_id: ad.adset_id ?? null,
            ad_name: ad.ad_name ?? null,
            campaign_name: ad.campaign_name ?? null,
            spend_cents: spendCents,
            impressions: parseInt(ad.impressions ?? '0'),
            clicks: parseInt(ad.clicks ?? '0'),
            leads_count: lc,
            revenue_cents: revFromAd,
            cpl_cents: cplCents,
            roas,
            date,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,ad_id,date' }
        )

        synced++
      }
    } catch {
      // Skip days with errors, continue
    }
  }

  return synced
}
