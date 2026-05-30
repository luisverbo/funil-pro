import type { Node } from '@xyflow/react'

export type Plan = 'starter' | 'pro' | 'scale'
export type LeadStatus = 'active' | 'converted' | 'unsubscribed' | 'lost'
export type BlockType = 'message' | 'condition' | 'delay' | 'tag' | 'sale' | 'form' | 'page' | 'entry'
export type FunnelStatus = 'draft' | 'published' | 'paused'
export type EdgeCondition =
  | 'opened'
  | 'not_opened'
  | 'clicked'
  | 'not_clicked'
  | 'replied'
  | 'purchased'
  | 'default'
export type WhatsappStatus = 'connected' | 'disconnected' | 'connecting'

export interface Tenant {
  id: string
  name: string
  slug: string
  custom_domain: string | null
  plan: Plan
  plan_expires_at: string | null
  meta_access_token: string | null
  meta_ad_account_id: string | null
  resend_api_key: string | null
  email_quota_used: number
  email_quota_limit: number
  created_at: string
}

export interface UserTenant {
  id: string
  user_id: string
  tenant_id: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
}

export interface TenantAddon {
  id: string
  tenant_id: string
  addon_type: 'whatsapp_instance' | 'form' | 'pages'
  status: 'active' | 'cancelled'
  price_cents: number
  created_at: string
}

export interface WhatsappInstance {
  id: string
  tenant_id: string
  instance_name: string
  display_name: string | null
  description: string | null
  phone_number: string | null
  status: WhatsappStatus
  is_addon: boolean
  created_at: string
}

export interface Funnel {
  id: string
  tenant_id: string
  name: string
  description: string | null
  status: FunnelStatus
  whatsapp_instance_id: string | null
  agent_enabled: boolean
  agent_prompt: string | null
  utm_source: string | null
  created_at: string
  published_at: string | null
}

export interface FunnelBlock {
  id: string
  funnel_id: string
  block_type: BlockType
  label: string
  config: Record<string, unknown>
  position_x: number
  position_y: number
  created_at: string
}

export interface FunnelEdge {
  id: string
  funnel_id: string
  source_block_id: string
  target_block_id: string
  condition: EdgeCondition
  condition_value: string | null
  created_at: string
}

export interface FunnelTemplate {
  id: string
  tenant_id: string | null
  name: string
  description: string | null
  category: string | null
  funnel_json: Record<string, unknown>
  is_public: boolean
  price_cents: number
  downloads_count: number
  created_at: string
}

export interface Lead {
  id: string
  tenant_id: string
  funnel_id: string
  name: string | null
  phone: string | null
  email: string | null
  status: LeadStatus
  current_block_id: string | null
  agent_active: boolean
  agent_last_at: string | null
  funnel_paused_at: string | null
  funnel_resume_block_id: string | null
  tags: string[]
  metadata: Record<string, unknown>
  created_at: string
}

export interface LeadSource {
  id: string
  lead_id: string
  utm_source: string | null
  utm_campaign: string | null
  utm_campaign_id: string | null
  utm_adset_id: string | null
  utm_ad_id: string | null
  utm_content: string | null
  referrer_url: string | null
  landing_url: string | null
  created_at: string
}

export interface LeadEvent {
  id: string
  tenant_id: string
  lead_id: string
  funnel_id: string
  block_id: string | null
  event_type: string
  event_data: Record<string, unknown>
  platform: string | null
  revenue_cents: number | null
  product_name: string | null
  created_at: string
}

export interface AdMetric {
  id: string
  tenant_id: string
  ad_id: string
  campaign_id: string | null
  adset_id: string | null
  ad_name: string | null
  campaign_name: string | null
  spend_cents: number
  impressions: number
  clicks: number
  leads_count: number
  revenue_cents: number
  cpl_cents: number
  roas: number
  date: string
  synced_at: string
}

export interface Page {
  id: string
  tenant_id: string
  funnel_id: string | null
  title: string
  slug: string
  content: Record<string, unknown>
  video_url: string | null
  button_text: string | null
  button_show_at_seconds: number | null
  button_url: string | null
  pixel_meta_id: string | null
  published: boolean
  created_at: string
}

export interface FunnelNodeData extends Record<string, unknown> {
  label: string
  blockType: string
  config: Record<string, unknown>
  onDelete?: (id: string) => void
}

export type FunnelNode = Node<FunnelNodeData>

export interface BlockDTO {
  id: string
  block_type: string
  label: string
  config: Record<string, unknown>
  position_x: number
  position_y: number
}

export interface EdgeDTO {
  id: string
  source_block_id: string
  target_block_id: string
  condition: string
}

export interface FunnelAgent {
  id: string
  funnel_id: string
  tenant_id: string
  enabled: boolean
  model: string
  system_prompt: string | null
  product_name: string | null
  product_description: string | null
  payment_link: string | null
  max_activations_per_month: number
  activations_used: number
  created_at: string
}
