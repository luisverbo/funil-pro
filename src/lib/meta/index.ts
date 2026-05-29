const META_GRAPH_URL = 'https://graph.facebook.com/v19.0'

export async function fetchAdMetrics(
  adAccountId: string,
  accessToken: string,
  date: string
) {
  const fields = 'ad_id,ad_name,campaign_id,campaign_name,adset_id,spend,impressions,clicks'
  const url = `${META_GRAPH_URL}/act_${adAccountId}/insights?fields=${fields}&time_range={"since":"${date}","until":"${date}"}&level=ad&access_token=${accessToken}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Meta API error: ${res.status}`)
  return res.json()
}
