'use client'

import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow, Background, Controls, Handle, Position, useNodesState,
  type Node, type Edge, type NodeProps, type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { updateIgAutomation, listInstagramPosts, getIgBlockStats, type IgAutomation, type IgBlockStat } from '@/app/actions/ig-automations'
import { uploadIgMedia } from '@/app/actions/upload'
import type { IgMedia } from '@/lib/instagram'
import type { DmStep } from '@/lib/instagram/sequence'
import EmojiPicker from '@/components/ui/emoji-picker'

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'n' + Math.random().toString(36).slice(2))

// Campo de mídia reutilizável (upload ou remover)
function MediaField({ url, type, onChange }: { url?: string; type?: 'image' | 'video' | 'audio'; onChange: (u?: string, t?: 'image' | 'video' | 'audio') => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true); setErr(null)
    const fd = new FormData(); fd.append('file', file)
    const r = await uploadIgMedia(fd)
    setBusy(false)
    if (r.error) setErr(r.error)
    else onChange(r.url, r.kind)
  }
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">Mídia (imagem, vídeo ou áudio) — opcional</label>
      {url ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-2 bg-gray-50">
          {type === 'image' ? <img src={url} alt="" className="w-12 h-12 rounded object-cover" />
            : type === 'video' ? <video src={url} className="w-12 h-12 rounded object-cover" />
            : <span className="w-12 h-12 rounded bg-purple-100 flex items-center justify-center text-lg">🎵</span>}
          <span className="text-xs text-gray-500 flex-1 truncate">{type} anexado</span>
          <button type="button" onClick={() => onChange(undefined, undefined)} className="text-xs text-red-500 hover:underline">remover</button>
        </div>
      ) : (
        <label className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 py-3 text-xs cursor-pointer hover:border-purple-300 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          {busy ? 'Enviando…' : '📎 Anexar imagem / vídeo / áudio'}
          <input type="file" accept="image/*,video/mp4,video/quicktime,audio/*" className="hidden" onChange={pick} />
        </label>
      )}
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

// ─── Modelo por LIGAÇÕES EXPLÍCITAS ───────────────────────────────────────────
// Cada mensagem é um nó solto. Nada se conecta sozinho: você arrasta as ligações.
//  - next: id da próxima mensagem (saída "continua", bolinha roxa embaixo)
//  - botão de resposta.branch_to: id da mensagem que abre o fluxo do botão (SIM/NÃO)
//  - entryId: a mensagem ligada ao gatilho (a 1ª a disparar)
type UiButton = { title: string; url: string; kind: 'url' | 'reply'; branch_to?: string }
type UiStep = { id: string; label?: string; delay_value: number; delay_unit: 'min' | 'h'; text: string; buttons: UiButton[]; media_url?: string; media_type?: 'image' | 'video' | 'audio'; next?: string }
const emptyStep = (delay = 5): UiStep => ({ id: newId(), delay_value: delay, delay_unit: 'min', text: '', buttons: [] })

const byId = (list: UiStep[], id?: string) => id ? list.find(s => s.id === id) : undefined
const mapById = (list: UiStep[], id: string, fn: (s: UiStep) => UiStep) => list.map(s => s.id === id ? fn(s) : s)
// remove qualquer ligação que aponte pra `id` (usado ao mover/apagar um nó)
function clearIncoming(list: UiStep[], id: string): UiStep[] {
  return list.map(s => ({
    ...s,
    next: s.next === id ? undefined : s.next,
    buttons: s.buttons.map(b => b.branch_to === id ? { ...b, branch_to: undefined } : b),
  }))
}
// existe caminho de `from` até `goal` seguindo as ligações? (evita ciclo)
function reaches(list: UiStep[], from: string, goal: string): boolean {
  const seen = new Set<string>(); const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === goal) return true
    if (seen.has(id)) continue
    seen.add(id)
    const s = byId(list, id); if (!s) continue
    if (s.next) stack.push(s.next)
    s.buttons.forEach(b => b.branch_to && stack.push(b.branch_to))
  }
  return false
}

// ─── Serialização árvore executável ⇄ nós soltos ─────────────────────────────
function serialize(list: UiStep[], entryId?: string): DmStep[] {
  if (!entryId) return []
  const visited = new Set<string>()
  const chainFrom = (startId?: string): DmStep[] => {
    const out: DmStep[] = []
    let cur = startId
    while (cur && !visited.has(cur)) {
      visited.add(cur)
      const s = byId(list, cur); if (!s) break
      out.push({
        id: s.id,
        label: s.label?.trim() || undefined,
        delay_minutes: s.delay_unit === 'h' ? s.delay_value * 60 : s.delay_value,
        text: s.text.trim(),
        buttons: s.buttons
          .filter(b => b.title && (b.kind === 'reply' || b.url))
          .map(b => {
            if (b.kind !== 'reply') return { title: b.title, url: b.url }
            const sub = b.branch_to && !visited.has(b.branch_to) ? chainFrom(b.branch_to) : []
            return sub.length > 0 ? { title: b.title, branch: sub } : { title: b.title }
          }),
        ...(s.media_url ? { media_url: s.media_url, media_type: s.media_type } : {}),
      })
      cur = s.next
    }
    return out
  }
  return chainFrom(entryId)
}
function deserialize(chain: DmStep[]): { list: UiStep[]; entryId?: string } {
  const list: UiStep[] = []
  const build = (dmChain: DmStep[]): string | undefined => {
    let prev: UiStep | undefined; let first: string | undefined
    for (const s of dmChain) {
      const min = s.delay_minutes ?? 0
      const asHours = min >= 60 && min % 60 === 0
      const step: UiStep = {
        id: s.id || newId(),
        label: s.label,
        delay_value: asHours ? min / 60 : min,
        delay_unit: asHours ? 'h' : 'min',
        text: s.text ?? '',
        buttons: (s.buttons ?? []).map(b => ({
          title: b.title, url: b.url ?? '',
          kind: (b.url ? 'url' : 'reply') as 'url' | 'reply',
          branch_to: b.branch && b.branch.length > 0 ? build(b.branch) : undefined,
        })),
        media_url: s.media_url, media_type: s.media_type,
      }
      list.push(step)
      if (prev) prev.next = step.id
      else first = step.id
      prev = step
    }
    return first
  }
  const entryId = build(chain)
  return { list, entryId }
}
function initial(a: IgAutomation): { list: UiStep[]; entryId?: string } {
  const src = (a.dm_steps && a.dm_steps.length > 0)
    ? a.dm_steps as DmStep[]
    : (a.dm_message ? [{ delay_minutes: 0, text: a.dm_message, buttons: [] }] as DmStep[] : [])
  if (src.length === 0) { const s = emptyStep(0); return { list: [s], entryId: s.id } }
  return deserialize(src)
}

// ─── Nodes customizados (estilo ManyChat) ────────────────────────────────────

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as { keywords: string[]; mediaThumb: string | null; mediaLabel: string }
  return (
    <div className={`w-64 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-hidden cursor-pointer`}>
      <div className="px-4 py-2 text-xs font-semibold text-gray-500 flex items-center gap-1.5">✨ Quando…</div>
      <div className="mx-3 mb-3 rounded-xl bg-emerald-50 border border-emerald-100 p-3">
        <div className="flex items-center gap-2">
          {d.mediaThumb
            ? <img src={d.mediaThumb} alt="" className="w-9 h-9 rounded-lg object-cover" />
            : <span className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">📣</span>}
          <p className="text-xs text-gray-700 leading-snug">O usuário {d.mediaLabel}</p>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {d.keywords.length > 0
            ? d.keywords.map(k => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-200/60 text-emerald-800 font-medium">{k}</span>)
            : <span className="text-[10px] text-gray-400">qualquer</span>}
        </div>
      </div>
      <div className="px-4 pb-2 text-right text-[10px] text-gray-400">Então ⟶</div>
      <Handle type="source" position={Position.Right} className="!bg-emerald-500 !w-3 !h-3" />
    </div>
  )
}

function GateNode({ data, selected }: NodeProps) {
  const d = data as { message: string }
  return (
    <div className={`w-60 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-hidden cursor-pointer`}>
      <Handle type="target" position={Position.Left} className="!bg-amber-400 !w-3 !h-3" />
      <div className="px-4 py-2 text-xs font-semibold text-amber-600 flex items-center gap-1.5">🔒 A pessoa segue o perfil?</div>
      <div className="mx-3 mb-2 rounded-xl bg-amber-50 border border-amber-100 p-2.5">
        <p className="text-[11px] text-gray-600 leading-snug">Se não seguir, recebe na DM:</p>
        <p className="text-[11px] text-amber-800 mt-1 italic">“{d.message.slice(0, 90)}{d.message.length > 90 ? '…' : ''}” + botão [JÁ SIGO ✅]</p>
      </div>
      <div className="px-4 pb-2 flex justify-between text-[10px]">
        <span className="text-emerald-600 font-semibold">✅ segue ⟶</span>
        <span className="text-red-400 font-semibold">❌ não segue ⟶</span>
      </div>
      <Handle id="yes" type="source" position={Position.Right} style={{ top: '40%' }} className="!bg-emerald-500 !w-3 !h-3" />
      <Handle id="no" type="source" position={Position.Bottom} className="!bg-red-400 !w-3 !h-3" />
    </div>
  )
}

function GateMsgNode({ selected }: NodeProps) {
  return (
    <div className={`w-56 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-hidden cursor-pointer`}>
      <Handle type="target" position={Position.Top} className="!bg-red-400 !w-3 !h-3" />
      <div className="px-4 py-2 text-xs font-semibold text-red-500 flex items-center gap-1.5">⏳ Aguardando seguir</div>
      <div className="mx-3 mb-3 rounded-xl bg-red-50 border border-red-100 p-2.5">
        <p className="text-[11px] text-gray-600 leading-snug">A pessoa segue o perfil e toca em <strong>[JÁ SIGO ✅]</strong> → o sistema confere de novo e libera as mensagens.</p>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-emerald-500 !w-3 !h-3" />
    </div>
  )
}

function ReplyNode({ data, selected }: NodeProps) {
  const d = data as { replies: string[] }
  return (
    <div className={`w-64 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-hidden cursor-pointer`}>
      <Handle type="target" position={Position.Left} className="!bg-pink-400 !w-3 !h-3" />
      <div className="px-4 py-2 text-xs font-semibold text-pink-600 flex items-center gap-1.5">💬 Responder o comentário</div>
      <div className="mx-3 mb-3 rounded-xl bg-pink-50 border border-pink-100 p-3 flex flex-col gap-1">
        {d.replies.length > 0
          ? d.replies.slice(0, 3).map((r, i) => <p key={i} className="text-xs text-gray-700">“{r}”</p>)
          : <p className="text-xs text-gray-400 italic">sem resposta pública</p>}
        {d.replies.length > 1 && <p className="text-[10px] text-pink-500">sorteia entre {d.replies.length}</p>}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-pink-400 !w-3 !h-3" />
    </div>
  )
}

// Mensagem de DM — cada botão de resposta tem uma SAÍDA própria (arraste pra ligar)
function DmNode({ data, selected }: NodeProps) {
  const d = data as { step: UiStep; label: string; floating: boolean; stat?: IgBlockStat; showMetrics?: boolean }
  const s = d.step
  const title = s.label?.trim() || d.label
  const hasBtns = s.buttons.some(b => b.kind === 'reply')
  return (
    <div className={`w-64 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : d.floating ? 'border-dashed border-amber-300' : 'border-transparent'} overflow-visible cursor-pointer`}>
      <Handle type="target" position={Position.Left} className="!bg-purple-500 !w-3 !h-3" />
      <div className="px-4 py-2 text-xs font-semibold text-purple-600 flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="w-4 h-4 rounded bg-gradient-to-br from-pink-500 to-purple-600 inline-flex items-center justify-center text-white text-[9px] shrink-0">IG</span>
          <span className="truncate">{title}</span>
        </span>
        {d.floating && <span className="text-[9px] font-semibold text-amber-500 shrink-0">● solto</span>}
      </div>
      {/* Métricas do bloco (modo visualização, estilo ManyChat) */}
      {d.showMetrics && (
        <div className="mx-3 mb-2 grid grid-cols-2 gap-1 text-center">
          <div className="rounded-lg bg-purple-50 py-1">
            <p className="text-sm font-bold text-purple-700 leading-none">{d.stat?.sent ?? 0}</p>
            <p className="text-[9px] text-purple-500 mt-0.5">Enviado</p>
          </div>
          <div className="rounded-lg bg-emerald-50 py-1">
            <p className="text-sm font-bold text-emerald-700 leading-none">{d.stat?.clicks ?? 0}</p>
            <p className="text-[9px] text-emerald-500 mt-0.5">{hasBtns ? 'Cliques' : 'Respostas'}</p>
          </div>
        </div>
      )}
      <div className="mx-3 mb-3 rounded-xl bg-purple-50 border border-purple-100 p-3">
        {s.media_url && (
          <div className="mb-2">
            {s.media_type === 'image' ? <img src={s.media_url} alt="" className="w-full h-24 rounded-lg object-cover" />
              : s.media_type === 'video' ? <video src={s.media_url} className="w-full h-24 rounded-lg object-cover" />
              : <div className="w-full py-3 rounded-lg bg-purple-100 flex items-center justify-center text-sm">🎵 áudio</div>}
          </div>
        )}
        <p className="text-xs text-gray-700 whitespace-pre-wrap leading-snug">{s.text ? (s.text.length > 140 ? s.text.slice(0, 140) + '…' : s.text) : (s.media_url ? '' : <span className="italic text-gray-400">mensagem vazia</span>)}</p>
        {s.buttons.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {s.buttons.map((b, i) => (
              <div key={i} className="relative">
                <div className={`text-[10px] text-center py-1.5 rounded-lg border font-medium ${b.kind === 'reply' ? 'border-emerald-300 text-emerald-700 bg-white' : 'border-sky-300 text-sky-700 bg-white'}`}>
                  {b.kind === 'reply' ? '💬' : '🔗'} {b.title || '(sem texto)'}
                </div>
                {/* saída própria pra cada botão de resposta → arraste até uma mensagem */}
                {b.kind === 'reply' && (
                  <Handle id={`b${i}`} type="source" position={Position.Right}
                    style={{ right: -16, top: '50%' }} className="!bg-emerald-500 !w-3.5 !h-3.5 !border-2 !border-white" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* saída "continua" (se ninguém tocar em nada, a sequência segue) */}
      <Handle id="next" type="source" position={Position.Bottom} className="!bg-purple-300 !w-3 !h-3" />
    </div>
  )
}

const nodeTypes = { trigger: TriggerNode, reply: ReplyNode, dm: DmNode, gate: GateNode, gatemsg: GateMsgNode }
const DEFAULT_GATE_MSG = 'Opa! 🔒 Esse conteúdo é exclusivo pra quem me segue. Me segue lá no perfil e toca no botão abaixo que eu libero na hora 👇'
const SPECIAL = ['trigger', 'reply', 'gate', 'gatemsg']
const COL_W = 300
const ROW_H = 230

// ─── Editor ──────────────────────────────────────────────────────────────────

export default function IgFlowEditor({ automation, funnels }: { automation: IgAutomation; funnels: { id: string; name: string }[] }) {
  const router = useRouter()
  const init = useMemo(() => initial(automation), [automation])
  const [name, setName] = useState(automation.name)
  const [status, setStatus] = useState(automation.status)
  const [mediaId, setMediaId] = useState(automation.media_id)
  const [mediaThumb, setMediaThumb] = useState(automation.media_thumb)
  const [mediaCaption, setMediaCaption] = useState(automation.media_caption)
  const [keywords, setKeywords] = useState<string[]>(automation.keywords ?? [])
  const [keywordInput, setKeywordInput] = useState('')
  const [replies, setReplies] = useState((automation.comment_replies ?? []).join('\n'))
  const [steps, setSteps] = useState<UiStep[]>(init.list)
  const [entryId, setEntryId] = useState<string | undefined>(init.entryId)
  const [funnelId, setFunnelId] = useState(automation.funnel_id ?? '')
  const [leadTag, setLeadTag] = useState(automation.lead_tag ?? '')
  const [dmUseAgent, setDmUseAgent] = useState(automation.dm_use_agent)
  const [triggerType, setTriggerType] = useState<'comment' | 'dm' | 'story_reply'>(automation.trigger_type ?? 'comment')
  const [followGate, setFollowGate] = useState(automation.follow_gate ?? false)
  const [followGateMsg, setFollowGateMsg] = useState(automation.follow_gate_message ?? '')
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(automation.canvas ?? {})
  const [selected, setSelected] = useState<string>('trigger')
  const [posts, setPosts] = useState<IgMedia[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [showMetrics, setShowMetrics] = useState(true)
  const [stats, setStats] = useState<Record<string, IgBlockStat>>({})

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([])

  useEffect(() => { listInstagramPosts().then(r => setPosts(r.posts)) }, [])
  useEffect(() => { getIgBlockStats(automation.id).then(r => setStats(r.stats)) }, [automation.id])

  const replyList = replies.split('\n').map(s => s.trim()).filter(Boolean)
  const delayLabel = (s: UiStep) => s.delay_value > 0 ? `⏱ ${s.delay_value}${s.delay_unit === 'h' ? 'h' : 'min'}` : 'na hora'

  // Layout automático a partir do ponto de entrada; nós soltos ficam empilhados embaixo
  const { nodes, edges } = useMemo(() => {
    const isComment = triggerType === 'comment'
    const gateX = isComment ? 680 : 340
    const dmBaseX = (isComment ? 680 : 340) + (followGate ? 320 : 0)
    const triggerLabel = triggerType === 'dm' ? 'manda a palavra-chave na DM'
      : triggerType === 'story_reply' ? 'responde a um Story seu'
      : `comenta em ${mediaId ? 'um post específico' : 'qualquer post/Reel'}`

    // posições calculadas por travessia (override manual sempre vence)
    const auto: Record<string, { x: number; y: number }> = {}
    let rowCursor = 0
    const seen = new Set<string>()
    const place = (id: string | undefined, depth: number) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      auto[id] = { x: dmBaseX + depth * COL_W, y: 40 + rowCursor++ * ROW_H }
      const s = byId(steps, id); if (!s) return
      s.buttons.forEach(b => { if (b.kind === 'reply' && b.branch_to) place(b.branch_to, depth + 1) })
      if (s.next) place(s.next, depth + 1)
    }
    place(entryId, 0)
    // soltos (não alcançados) empilham embaixo
    steps.forEach(s => { if (!seen.has(s.id)) auto[s.id] = { x: dmBaseX, y: 40 + rowCursor++ * ROW_H } })
    const pos = (id: string, def: { x: number; y: number }) => positions[id] ?? auto[id] ?? def

    // conjunto de nós que TÊM entrada (pra marcar os soltos)
    const incoming = new Set<string>()
    if (entryId) incoming.add(entryId)
    steps.forEach(s => { if (s.next) incoming.add(s.next); s.buttons.forEach(b => b.branch_to && incoming.add(b.branch_to)) })

    const ns: Node[] = [
      { id: 'trigger', type: 'trigger', position: pos('trigger', { x: 0, y: 80 }), data: { keywords, mediaThumb: isComment ? mediaThumb : null, mediaLabel: triggerLabel } },
      ...(isComment ? [{ id: 'reply', type: 'reply', position: pos('reply', { x: 340, y: 96 }), data: { replies: replyList } }] : []),
      ...(followGate ? [
        { id: 'gate', type: 'gate', position: pos('gate', { x: gateX, y: 80 }), data: { message: followGateMsg || DEFAULT_GATE_MSG } },
        { id: 'gatemsg', type: 'gatemsg', position: pos('gatemsg', { x: gateX + 10, y: 330 }), data: {} },
      ] : []),
      ...steps.map(s => ({
        id: s.id, type: 'dm', position: pos(s.id, { x: dmBaseX, y: 40 }),
        data: { step: s, label: s.id === entryId ? 'Enviar Mensagem' : 'Mensagem', floating: !incoming.has(s.id), stat: stats[s.id], showMetrics },
      })),
    ]

    const es: Edge[] = []
    const preSource = isComment ? 'reply' : 'trigger'
    if (isComment) es.push({ id: 'e-t-r', source: 'trigger', target: 'reply', animated: true, label: 'Então', style: { stroke: '#94a3b8' } })
    if (followGate) {
      es.push(
        { id: 'e-r-g', source: preSource, target: 'gate', animated: true, label: 'e na DM…', labelStyle: { fontSize: 10, fill: '#d97706', fontWeight: 600 }, style: { stroke: '#fbbf24' } },
        { id: 'e-g-no', source: 'gate', sourceHandle: 'no', target: 'gatemsg', animated: true, label: '❌ não segue', labelStyle: { fontSize: 10, fill: '#ef4444', fontWeight: 600 }, style: { stroke: '#fca5a5' } },
      )
    }
    const entrySource = followGate ? 'gate' : preSource
    const entryHandle = followGate ? 'yes' : undefined
    if (entryId) es.push({
      id: 'e-entry', source: entrySource, sourceHandle: entryHandle, target: entryId, animated: true,
      label: followGate ? '✅ segue' : (isComment ? 'na DM' : 'dispara'),
      labelStyle: { fontSize: 10, fill: '#7c3aed', fontWeight: 600 }, style: { stroke: '#a78bfa' },
    })
    steps.forEach(s => {
      if (s.next && byId(steps, s.next)) es.push({
        id: `e-n-${s.id}`, source: s.id, sourceHandle: 'next', target: s.next, animated: true,
        label: delayLabel(byId(steps, s.next)!), labelStyle: { fontSize: 10, fill: '#7c3aed', fontWeight: 600 }, style: { stroke: '#a78bfa' },
      })
      s.buttons.forEach((b, bi) => {
        if (b.kind === 'reply' && b.branch_to && byId(steps, b.branch_to)) es.push({
          id: `e-b-${s.id}-${bi}`, source: s.id, sourceHandle: `b${bi}`, target: b.branch_to, animated: true,
          label: `💬 ${b.title || 'resposta'}`, labelStyle: { fontSize: 10, fill: '#059669', fontWeight: 600 }, style: { stroke: '#6ee7b7' },
        })
      })
    })
    return { nodes: ns, edges: es }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords, mediaThumb, mediaId, replies, steps, entryId, positions, followGate, followGateMsg, triggerType, stats, showMetrics])

  useEffect(() => {
    setRfNodes(nodes.map(n => ({ ...n, selected: n.id === selected })))
  }, [nodes, selected, setRfNodes])

  // Arrastar uma ligação: da saída de um botão (SIM/NÃO) → fluxo do botão;
  // da saída "continua" → próxima mensagem; do gatilho/gate → 1ª mensagem.
  const onConnect = useCallback((c: Connection) => {
    const { source, sourceHandle, target } = c
    if (!source || !target || source === target || SPECIAL.includes(target)) return
    if (!SPECIAL.includes(source) && reaches(steps, target, source)) return  // evita ciclo
    setSteps(list => {
      const l = clearIncoming(list, target)  // desliga o alvo de onde estava
      if (SPECIAL.includes(source)) return l
      if (sourceHandle && sourceHandle.startsWith('b')) {
        const bi = Number(sourceHandle.slice(1))
        return mapById(l, source, s => ({ ...s, buttons: s.buttons.map((b, j) => j === bi ? { ...b, branch_to: target } : b) }))
      }
      return mapById(l, source, s => ({ ...s, next: target }))  // saída "continua"
    })
    if (SPECIAL.includes(source)) setEntryId(target)
    else if (entryId === target) setEntryId(undefined)  // deixou de ser a entrada
    setSelected(target)
  }, [steps, entryId])

  async function save() {
    setSaving(true)
    const finalKeywords = keywordInput.trim() && !keywords.includes(keywordInput.trim()) ? [...keywords, keywordInput.trim()] : keywords
    if (keywordInput.trim()) { setKeywords(finalKeywords); setKeywordInput('') }
    const db = serialize(steps, entryId)
    await updateIgAutomation(automation.id, {
      name, status,
      media_id: mediaId, media_thumb: mediaThumb, media_caption: mediaCaption,
      keywords: finalKeywords,
      comment_replies: replyList,
      dm_message: db[0]?.text || null,
      dm_steps: db.length > 0 ? db : null,
      dm_use_agent: dmUseAgent,
      funnel_id: funnelId || null,
      lead_tag: leadTag || null,
      trigger_type: triggerType,
      follow_gate: followGate,
      follow_gate_message: followGateMsg || null,
      canvas: Object.keys(positions).length > 0 ? positions : null,
    })
    setSaving(false)
    setSavedAt(Date.now())
  }

  // ── operações ──
  const selStep = !SPECIAL.includes(selected) ? byId(steps, selected) : undefined
  const patchStep = (id: string, patch: Partial<UiStep>) => setSteps(st => mapById(st, id, s => ({ ...s, ...patch })))
  const patchButtons = (id: string, fn: (btns: UiButton[]) => UiButton[]) => setSteps(st => mapById(st, id, s => ({ ...s, buttons: fn(s.buttons) })))
  // cria mensagem SOLTA (sem ligar em nada) — você conecta onde quiser
  const addLoose = () => { const n = emptyStep(); setSteps(st => [...st, n]); setSelected(n.id) }
  // cria mensagem já ligada como próxima desta (atalho do painel)
  const addAfter = (id: string) => {
    const n = emptyStep(); const cur = byId(steps, id)
    if (cur?.next) n.next = cur.next
    setSteps(st => mapById([...st, n], id, s => ({ ...s, next: n.id })))
    setSelected(n.id)
  }
  const removeStep = (id: string) => {
    setSteps(st => clearIncoming(st, id).filter(s => s.id !== id))
    if (entryId === id) setEntryId(undefined)
    setSelected('trigger')
  }
  const openBranch = (parentId: string, btnIdx: number) => {
    const cur = byId(steps, parentId); if (!cur) return
    const b = cur.buttons[btnIdx]
    if (b.branch_to && byId(steps, b.branch_to)) { setSelected(b.branch_to); return }
    const n = emptyStep(0)
    setSteps(st => mapById([...st, n], parentId, s => ({ ...s, buttons: s.buttons.map((x, j) => j === btnIdx ? { ...x, branch_to: n.id } : x) })))
    setSelected(n.id)
  }

  return (
    <div className="fixed inset-0 md:left-0 flex flex-col bg-gray-50" style={{ zIndex: 30 }}>
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b shrink-0">
        <button onClick={() => router.push('/instagram')} className="text-sm text-indigo-600 hover:underline">← Automações</button>
        <input value={name} onChange={e => setName(e.target.value)} className="font-semibold text-gray-900 outline-none bg-transparent border-b border-transparent focus:border-indigo-300 max-w-[200px]" />
        <button onClick={() => setStatus(s => s === 'active' ? 'paused' : 'active')}
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${status === 'active' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
          {status === 'active' ? 'LIVE' : 'PAUSADA'}
        </button>
        <div className="ml-auto flex items-center gap-3">
          {savedAt && <span className="text-xs text-gray-400">✓ Salvo</span>}
          <button onClick={() => setShowMetrics(m => !m)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${showMetrics ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            📊 Métricas
          </button>
          <button onClick={addLoose}
            className="px-3 py-1.5 text-sm border border-purple-200 text-purple-700 rounded-lg hover:bg-purple-50">+ Mensagem</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90 disabled:opacity-60">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <div className="flex-1 relative">
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 text-[11px] text-gray-500 bg-white/90 border border-gray-200 rounded-full px-3 py-1 shadow-sm pointer-events-none">
            💡 Mensagem nova nasce <b>solta</b> — arraste da bolinha (SIM/NÃO ou 🟣 embaixo) até ela pra ligar
          </div>
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelected(n.id)}
            onNodesChange={onRfNodesChange}
            onConnect={onConnect}
            onNodeDragStop={(_, n) => setPositions(p => ({ ...p, [n.id]: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }))}
            fitView
            nodesDraggable
            nodesConnectable
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1.5} color="#e2e8f0" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Painel de edição */}
        <div className="w-[340px] shrink-0 bg-white border-l overflow-y-auto p-4 flex flex-col gap-4">
          {selected === 'trigger' && (
            <>
              <h3 className="font-semibold text-gray-900">✨ Gatilho</h3>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Quando disparar?</label>
                <select className={inputCls} value={triggerType}
                  onChange={e => setTriggerType(e.target.value as 'comment' | 'dm' | 'story_reply')}>
                  <option value="comment">💬 Comentário em post/Reel</option>
                  <option value="dm">📩 Palavra-chave na DM</option>
                  <option value="story_reply">📱 Resposta a um Story</option>
                </select>
                {triggerType === 'dm' && <p className="text-[11px] text-gray-400 mt-1">Alguém manda a palavra-chave no seu Direct → a sequência dispara.</p>}
                {triggerType === 'story_reply' && <p className="text-[11px] text-gray-400 mt-1">Alguém responde qualquer Story seu (ou com a palavra-chave, se definir) → dispara.</p>}
              </div>
              {triggerType === 'comment' && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Post</label>
                <button onClick={() => { setMediaId(null); setMediaThumb(null); setMediaCaption(null) }}
                  className={`text-xs px-3 py-1.5 rounded-full border mb-2 ${!mediaId ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}>
                  🌐 Todos os posts
                </button>
                {posts === null ? <p className="text-xs text-gray-400">Carregando posts…</p> : (
                  <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                    {posts.map(p => (
                      <button key={p.id} onClick={() => { setMediaId(p.id); setMediaThumb(p.thumbnail_url ?? p.media_url ?? null); setMediaCaption(p.caption?.slice(0, 120) ?? null) }}
                        className={`aspect-square rounded-lg overflow-hidden border-2 ${mediaId === p.id ? 'border-indigo-600' : 'border-transparent'}`}>
                        {(p.thumbnail_url || p.media_url)
                          ? <img src={p.thumbnail_url || p.media_url} alt="" className="w-full h-full object-cover" />
                          : <span className="text-[9px] p-0.5">{p.caption?.slice(0, 20)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Palavras-chave</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {keywords.map(k => (
                    <span key={k} className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 flex items-center gap-1">
                      {k}<button onClick={() => setKeywords(ks => ks.filter(x => x !== k))} className="text-indigo-300 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <input className={inputCls} value={keywordInput}
                  onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && keywordInput.trim()) { e.preventDefault(); if (!keywords.includes(keywordInput.trim())) setKeywords(ks => [...ks, keywordInput.trim()]); setKeywordInput('') } }}
                  onBlur={() => { if (keywordInput.trim() && !keywords.includes(keywordInput.trim())) { setKeywords(ks => [...ks, keywordInput.trim()]); setKeywordInput('') } }}
                  placeholder="Digite e aperte Enter" />
              </div>
              <div className="border-t pt-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-800">
                  <input type="checkbox" checked={followGate} onChange={e => { setFollowGate(e.target.checked); if (e.target.checked) setSelected('gate') }} className="w-4 h-4 accent-amber-500" />
                  🔒 Exigir seguir o perfil (só na DM)
                </label>
                <p className="text-[11px] text-gray-500">A resposta pública ao comentário SEMPRE sai. O cadeado segura só o conteúdo da DM — {followGate ? 'clique no nó 🔒 no canvas pra editar a mensagem.' : 'ligue pra ver a ramificação no canvas.'}</p>
              </div>
              <div className="border-t pt-3 flex flex-col gap-3">
                <p className="text-sm font-medium text-gray-700">Depois do disparo</p>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Tag do lead</label>
                  <input className={inputCls} value={leadTag} onChange={e => setLeadTag(e.target.value)} placeholder="Ex: ig-eu-quero" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Matricular num funil</label>
                  <select className={inputCls} value={funnelId} onChange={e => setFunnelId(e.target.value)}>
                    <option value="">Não matricular</option>
                    {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="checkbox" checked={dmUseAgent} onChange={e => setDmUseAgent(e.target.checked)} className="w-4 h-4 accent-purple-600" />
                  🤖 IA assume se a pessoa responder livre
                </label>
              </div>
            </>
          )}

          {(selected === 'gate' || selected === 'gatemsg') && (
            <>
              <h3 className="font-semibold text-gray-900">🔒 Filtro de seguidor</h3>
              <p className="text-xs text-gray-500">Quem comenta mas <strong>não segue</strong> o perfil recebe esta mensagem na DM com o botão <strong>[JÁ SIGO ✅]</strong>. Quando seguir e tocar, o sistema confere na API e libera as mensagens sozinho. A resposta pública ao comentário sai normalmente pra todo mundo.</p>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Mensagem pra quem não segue</label>
                <textarea className={inputCls + ' h-24'} value={followGateMsg} onChange={e => setFollowGateMsg(e.target.value)}
                  placeholder={DEFAULT_GATE_MSG} />
              </div>
              <button onClick={() => { setFollowGate(false); setSelected('trigger') }}
                className="text-xs text-red-500 hover:underline self-start">Remover filtro de seguidor</button>
            </>
          )}

          {selected === 'reply' && (
            <>
              <h3 className="font-semibold text-gray-900">💬 Resposta pública ao comentário</h3>
              <p className="text-xs text-gray-500">Uma por linha — o sistema sorteia entre elas pra não parecer robô.</p>
              <textarea className={inputCls + ' h-32'} value={replies} onChange={e => setReplies(e.target.value)}
                placeholder={'Te chamei na DM! 🚀\nAcabei de te mandar mensagem 📩'} />
            </>
          )}

          {selStep && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">📩 Mensagem</h3>
                <button onClick={() => removeStep(selStep.id)} className="text-xs text-red-500 hover:underline">Excluir</button>
              </div>
              {selStep.id !== entryId && (
                <button onClick={() => setEntryId(selStep.id)}
                  className="text-[11px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-2 py-1.5 text-left font-medium">
                  ▶ Tornar esta a 1ª mensagem (ligar no gatilho)
                </button>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Nome do bloco <span className="text-gray-300">(só pra você se achar)</span></label>
                <input className={inputCls} value={selStep.label ?? ''} placeholder="Ex: Pergunta quer o link"
                  onChange={e => patchStep(selStep.id, { label: e.target.value })} />
              </div>
              {(stats[selStep.id]?.sent || stats[selStep.id]?.clicks) ? (
                <div className="flex gap-2 text-center">
                  <div className="flex-1 rounded-lg bg-purple-50 py-2"><p className="text-base font-bold text-purple-700 leading-none">{stats[selStep.id]?.sent ?? 0}</p><p className="text-[10px] text-purple-500 mt-1">Enviado</p></div>
                  <div className="flex-1 rounded-lg bg-emerald-50 py-2"><p className="text-base font-bold text-emerald-700 leading-none">{stats[selStep.id]?.clicks ?? 0}</p><p className="text-[10px] text-emerald-500 mt-1">Cliques/Respostas</p></div>
                </div>
              ) : null}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Espera antes de enviar</label>
                <div className="flex gap-2">
                  <input type="number" min={0} className={inputCls + ' w-24'} value={selStep.delay_value}
                    onChange={e => patchStep(selStep.id, { delay_value: Math.max(0, Number(e.target.value)) })} />
                  <select className={inputCls + ' w-28'} value={selStep.delay_unit}
                    onChange={e => patchStep(selStep.id, { delay_unit: e.target.value as 'min' | 'h' })}>
                    <option value="min">minutos</option>
                    <option value="h">horas</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Texto da mensagem</label>
                <div className="relative">
                  <textarea className={inputCls + ' h-28 pr-9'} value={selStep.text}
                    onChange={e => patchStep(selStep.id, { text: e.target.value })}
                    placeholder="Oi! Vi seu comentário 👋" />
                  <div className="absolute top-1 right-1"><EmojiPicker onPick={emoji => patchStep(selStep.id, { text: selStep.text + emoji })} /></div>
                </div>
              </div>
              <MediaField url={selStep.media_url} type={selStep.media_type}
                onChange={(u, t) => patchStep(selStep.id, { media_url: u, media_type: t })} />

              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-500">Botões (até 3)</label>
                {selStep.buttons.map((b, bi) => (
                  <div key={bi} className="flex flex-col gap-1.5 border border-gray-100 rounded-lg p-2">
                    <div className="flex gap-1.5 items-center">
                      <span className={`text-[10px] px-1.5 py-1 rounded ${b.kind === 'reply' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{b.kind === 'reply' ? '💬' : '🔗'}</span>
                      <input className={inputCls} value={b.title} placeholder={b.kind === 'reply' ? 'SIM' : 'ACESSAR'}
                        onChange={e => patchButtons(selStep.id, bs => bs.map((x, j) => j === bi ? { ...x, title: e.target.value } : x))} />
                      <button onClick={() => patchButtons(selStep.id, bs => bs.filter((_, j) => j !== bi))}
                        className="text-gray-300 hover:text-red-500">×</button>
                    </div>
                    {b.kind === 'url' && (
                      <input className={inputCls} value={b.url} placeholder="https://…"
                        onChange={e => patchButtons(selStep.id, bs => bs.map((x, j) => j === bi ? { ...x, url: e.target.value } : x))} />
                    )}
                    {b.kind === 'reply' && (
                      <button onClick={() => openBranch(selStep.id, bi)}
                        className="text-[11px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2 py-1.5 text-left font-medium">
                        {b.branch_to && byId(steps, b.branch_to)
                          ? `▶ Ir para o fluxo do "${b.title || 'botão'}" →`
                          : `▶ Criar fluxo do "${b.title || 'este botão'}" →`}
                      </button>
                    )}
                  </div>
                ))}
                {selStep.buttons.length < 3 && (
                  <div className="flex gap-3">
                    <button onClick={() => patchButtons(selStep.id, bs => [...bs, { title: '', url: '', kind: 'url' }])}
                      className="text-xs text-sky-600 hover:underline">+ 🔗 link</button>
                    <button onClick={() => patchButtons(selStep.id, bs => [...bs, { title: '', url: '', kind: 'reply' }])}
                      className="text-xs text-emerald-600 hover:underline">+ 💬 resposta (SIM/NÃO)</button>
                  </div>
                )}
                {selStep.buttons.some(b => b.kind === 'reply') && (
                  <p className="text-[11px] text-emerald-600/80">💡 No canvas, arraste da bolinha verde 👉 do botão até uma mensagem pra ligar o fluxo dele. Ou clique em “Criar fluxo” aqui.</p>
                )}
              </div>

              <button onClick={() => addAfter(selStep.id)}
                className="text-sm text-purple-700 border border-purple-200 rounded-lg py-2 hover:bg-purple-50">+ Mensagem ligada depois desta</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
