import { createAdminClient } from '@/lib/supabase/admin'

// Agenda interna do agente: disponibilidade configurada no painel, slots
// calculados em America/Sao_Paulo, anti-conflito via unique index no banco.
// Google Agenda entra via link "adicionar evento" (sem OAuth).

export interface SchedulingDay {
  enabled: boolean
  start: string   // "09:00"
  end: string     // "18:00"
}

export interface SchedulingConfig {
  enabled?: boolean
  slot_minutes?: number        // duração da reunião
  buffer_minutes?: number      // intervalo entre reuniões
  days_ahead?: number          // quantos dias à frente oferecer
  min_notice_hours?: number    // antecedência mínima
  meeting_title?: string
  meeting_location?: string    // link do Meet/Zoom ou endereço
  week?: Record<string, SchedulingDay>   // '0'(dom) … '6'(sáb)
}

export interface Slot { iso: string; label: string }

const BR_OFFSET = '-03:00'   // Brasil não tem horário de verão desde 2019
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export function isSchedulingEnabled(cfg: unknown): cfg is SchedulingConfig {
  return !!cfg && typeof cfg === 'object' && (cfg as SchedulingConfig).enabled === true
}

function parseHM(t: string | undefined, def: number): number {
  if (!t) return def
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// Data/hora atual no fuso do Brasil, decomposta
function brParts(d: Date): { y: number; mo: number; day: number; h: number; mi: number; wd: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d)
  const get = (t: string) => fmt.find(p => p.type === t)?.value ?? ''
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    y: +get('year'), mo: +get('month'), day: +get('day'),
    h: +get('hour') % 24, mi: +get('minute'), wd: wdMap[get('weekday')] ?? 0,
  }
}

function pad(n: number): string { return String(n).padStart(2, '0') }

/** Slots livres do agente: disponibilidade − reuniões já marcadas − antecedência mínima */
export async function getAvailableSlots(
  agentId: string,
  cfg: SchedulingConfig,
  admin: ReturnType<typeof createAdminClient>,
  limit = 24
): Promise<Slot[]> {
  const slotMin = cfg.slot_minutes ?? 30
  const buffer = cfg.buffer_minutes ?? 10
  const daysAhead = Math.min(cfg.days_ahead ?? 7, 30)
  const noticeMs = (cfg.min_notice_hours ?? 3) * 3600_000
  const week = cfg.week ?? {}

  const now = new Date()
  const minStart = now.getTime() + noticeMs

  // Reuniões confirmadas na janela (para excluir conflitos)
  const windowEnd = new Date(now.getTime() + (daysAhead + 1) * 86400_000)
  const { data: booked } = await admin
    .from('agent_meetings')
    .select('scheduled_at, duration_minutes')
    .eq('agent_id', agentId)
    .eq('status', 'confirmed')
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
  const bookedRanges = (booked ?? []).map(b => {
    const s = new Date(b.scheduled_at).getTime()
    return { start: s, end: s + (b.duration_minutes ?? slotMin) * 60_000 + buffer * 60_000 }
  })

  const slots: Slot[] = []
  const today = brParts(now)

  for (let offset = 0; offset <= daysAhead && slots.length < limit; offset++) {
    // Meia-noite BR do dia alvo, derivada via UTC para não depender do fuso do servidor
    const base = new Date(Date.UTC(today.y, today.mo - 1, today.day + offset, 12, 0, 0))
    const p = brParts(base)
    const dayCfg = week[String(p.wd)]
    if (!dayCfg?.enabled) continue

    const startMin = parseHM(dayCfg.start, 9 * 60)
    const endMin = parseHM(dayCfg.end, 18 * 60)
    const step = slotMin + buffer

    for (let t = startMin; t + slotMin <= endMin && slots.length < limit; t += step) {
      const iso = `${p.y}-${pad(p.mo)}-${pad(p.day)}T${pad(Math.floor(t / 60))}:${pad(t % 60)}:00${BR_OFFSET}`
      const startMs = new Date(iso).getTime()
      if (startMs < minStart) continue
      const endMs = startMs + slotMin * 60_000
      const conflict = bookedRanges.some(r => startMs < r.end && r.start < endMs + buffer * 60_000)
      if (conflict) continue
      slots.push({
        iso,
        label: `${WEEKDAYS[p.wd]}, ${pad(p.day)}/${pad(p.mo)} às ${pad(Math.floor(t / 60))}:${pad(t % 60)}`,
      })
    }
  }
  return slots
}

/** Marca a reunião. O unique index parcial garante que dois leads não pegam o mesmo slot. */
export async function bookMeeting(params: {
  agentId: string
  tenantId: string
  leadId?: string | null
  conversationId?: string | null
  slotIso: string
  cfg: SchedulingConfig
  topic?: string | null
  admin: ReturnType<typeof createAdminClient>
}): Promise<{ ok: boolean; meetingId?: string; reason?: string }> {
  const { agentId, tenantId, leadId, conversationId, slotIso, cfg, topic, admin } = params
  const slotMin = cfg.slot_minutes ?? 30

  // O slot precisa estar na grade de disponibilidade atual (revalida contra config + conflitos)
  const available = await getAvailableSlots(agentId, cfg, admin, 200)
  const target = new Date(slotIso).getTime()
  const valid = available.find(s => new Date(s.iso).getTime() === target)
  if (!valid) return { ok: false, reason: 'slot_unavailable' }

  const { data, error } = await admin.from('agent_meetings').insert({
    tenant_id: tenantId,
    agent_id: agentId,
    lead_id: leadId ?? null,
    conversation_id: conversationId ?? null,
    scheduled_at: valid.iso,
    duration_minutes: slotMin,
    status: 'confirmed',
    topic: topic ?? null,
  }).select('id').single()

  if (error || !data) {
    // 23505 = unique violation: outro lead pegou o slot no meio do caminho
    return { ok: false, reason: error?.code === '23505' ? 'slot_taken' : `insert_failed: ${error?.message}` }
  }
  return { ok: true, meetingId: data.id }
}

/** Link "adicionar ao Google Agenda" — funciona para o lead e para o dono, sem OAuth */
export function googleCalendarLink(opts: {
  title: string
  startIso: string
  durationMinutes: number
  location?: string
  details?: string
}): string {
  const start = new Date(opts.startIso)
  const end = new Date(start.getTime() + opts.durationMinutes * 60_000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    ctz: 'America/Sao_Paulo',
  })
  if (opts.location) q.set('location', opts.location)
  if (opts.details) q.set('details', opts.details)
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

/** Rótulo pt-BR de um horário ISO para mensagens de confirmação */
export function slotLabel(iso: string): string {
  const p = brParts(new Date(iso))
  return `${WEEKDAYS[p.wd]}, ${pad(p.day)}/${pad(p.mo)} às ${pad(p.h)}:${pad(p.mi)}`
}
