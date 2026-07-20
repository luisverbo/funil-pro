'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow, Background, Controls, Handle, Position, useNodesState,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { updateIgAutomation, listInstagramPosts, type IgAutomation } from '@/app/actions/ig-automations'
import { uploadIgMedia } from '@/app/actions/upload'
import type { IgMedia } from '@/lib/instagram'
import type { DmStep } from '@/lib/instagram/sequence'
import EmojiPicker from '@/components/ui/emoji-picker'

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

// ─── Modelo em ÁRVORE ─────────────────────────────────────────────────────────
// Cada botão de RESPOSTA (SIM/NÃO) pode abrir um fluxo próprio (branch = lista de
// mensagens). O caminho até uma mensagem é um array de números de tamanho ímpar:
// [i]            → mensagem i da raiz
// [i, b, j]      → mensagem j do fluxo do botão b da mensagem i
// [i, b, j, c, k]→ e assim por diante (aninhado)
type UiButton = { title: string; url: string; kind: 'url' | 'reply'; branch?: UiStep[] }
type UiStep = { delay_value: number; delay_unit: 'min' | 'h'; text: string; buttons: UiButton[]; media_url?: string; media_type?: 'image' | 'video' | 'audio' }
const emptyStep = (delay = 5): UiStep => ({ delay_value: delay, delay_unit: 'min', text: '', buttons: [] })

const pathId = (path: number[]) => 'dm-' + path.join('-')
const parsePath = (id: string): number[] => id.slice(3).split('-').map(Number)

// Atualiza a lista (chain) num prefixo de caminho de tamanho PAR ([]=raiz, [i,b]=branch do botão b da msg i)
function updateChain(steps: UiStep[], chainPath: number[], fn: (chain: UiStep[]) => UiStep[]): UiStep[] {
  if (chainPath.length === 0) return fn(steps)
  const [si, bi, ...rest] = chainPath
  return steps.map((s, i) => i !== si ? s : {
    ...s,
    buttons: s.buttons.map((b, j) => j !== bi ? b : { ...b, branch: updateChain(b.branch ?? [], rest, fn) }),
  })
}
const getStep = (steps: UiStep[], path: number[]): UiStep | undefined => {
  let chain: UiStep[] | undefined = steps
  for (let k = 0; k + 2 < path.length; k += 2) chain = chain?.[path[k]]?.buttons?.[path[k + 1]]?.branch
  return chain?.[path[path.length - 1]]
}

// ─── Conversão árvore ⇄ banco ─────────────────────────────────────────────────
function chainToDb(chain: UiStep[]): DmStep[] {
  return chain
    .filter(s => s.text.trim() || s.media_url || s.buttons.some(b => b.title && (b.kind === 'reply' || b.url)))
    .map(s => ({
      delay_minutes: s.delay_unit === 'h' ? s.delay_value * 60 : s.delay_value,
      text: s.text.trim(),
      buttons: s.buttons
        .filter(b => b.title && (b.kind === 'reply' || b.url))
        .map(b => {
          if (b.kind !== 'reply') return { title: b.title, url: b.url }
          const sub = b.branch ? chainToDb(b.branch) : []
          return sub.length > 0 ? { title: b.title, branch: sub } : { title: b.title }
        }),
      ...(s.media_url ? { media_url: s.media_url, media_type: s.media_type } : {}),
    }))
}
function dbChainToUi(chain: DmStep[]): UiStep[] {
  return chain.map(s => {
    const min = s.delay_minutes ?? 0
    const asHours = min >= 60 && min % 60 === 0
    return {
      delay_value: asHours ? min / 60 : min,
      delay_unit: asHours ? 'h' as const : 'min' as const,
      text: s.text ?? '',
      buttons: (s.buttons ?? []).map(b => ({
        title: b.title, url: b.url ?? '',
        kind: (b.url ? 'url' : 'reply') as 'url' | 'reply',
        branch: b.branch ? dbChainToUi(b.branch) : undefined,
      })),
      media_url: s.media_url, media_type: s.media_type,
    }
  })
}
function dbToSteps(a: IgAutomation): UiStep[] {
  const src = (a.dm_steps && a.dm_steps.length > 0)
    ? a.dm_steps
    : (a.dm_message ? [{ delay_minutes: 0, text: a.dm_message, buttons: [] }] : [])
  if (src.length === 0) return [emptyStep(0)]
  return dbChainToUi(src as DmStep[])
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

// Mensagem de DM — agora com uma SAÍDA por botão de resposta (ramificação real)
function DmNode({ data, selected }: NodeProps) {
  const d = data as { step: UiStep; label: string }
  const s = d.step
  const replyBtns = s.buttons.map((b, i) => ({ b, i })).filter(x => x.b.kind === 'reply')
  return (
    <div className={`w-64 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-visible cursor-pointer`}>
      <Handle type="target" position={Position.Left} className="!bg-purple-500 !w-3 !h-3" />
      <div className="px-4 py-2 text-xs font-semibold text-purple-600 flex items-center gap-1.5">
        <span className="w-4 h-4 rounded bg-gradient-to-br from-pink-500 to-purple-600 inline-flex items-center justify-center text-white text-[9px]">IG</span>
        {d.label}
      </div>
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
          <div className="flex flex-col gap-1 mt-2">
            {s.buttons.map((b, i) => {
              const ri = replyBtns.findIndex(x => x.i === i)
              return (
                <div key={i} className="relative">
                  <div className={`text-[10px] text-center py-1 rounded-lg border font-medium ${b.kind === 'reply' ? 'border-emerald-300 text-emerald-700 bg-white' : 'border-sky-300 text-sky-700 bg-white'}`}>
                    {b.kind === 'reply' ? '💬' : '🔗'} {b.title || '(sem texto)'}
                  </div>
                  {/* saída própria pra cada botão de resposta → seu fluxo (SIM aqui, NÃO ali) */}
                  {b.kind === 'reply' && (
                    <Handle id={`b${ri}`} type="source" position={Position.Right}
                      style={{ right: -14, top: '50%' }} className="!bg-emerald-500 !w-3 !h-3" />
                  )}
                </div>
              )
            })}
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
const COL_W = 300
const ROW_H = 230

// ─── Editor ──────────────────────────────────────────────────────────────────

export default function IgFlowEditor({ automation, funnels }: { automation: IgAutomation; funnels: { id: string; name: string }[] }) {
  const router = useRouter()
  const [name, setName] = useState(automation.name)
  const [status, setStatus] = useState(automation.status)
  const [mediaId, setMediaId] = useState(automation.media_id)
  const [mediaThumb, setMediaThumb] = useState(automation.media_thumb)
  const [mediaCaption, setMediaCaption] = useState(automation.media_caption)
  const [keywords, setKeywords] = useState<string[]>(automation.keywords ?? [])
  const [keywordInput, setKeywordInput] = useState('')
  const [replies, setReplies] = useState((automation.comment_replies ?? []).join('\n'))
  const [steps, setSteps] = useState<UiStep[]>(dbToSteps(automation))
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

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([])

  useEffect(() => { listInstagramPosts().then(r => setPosts(r.posts)) }, [])

  const replyList = replies.split('\n').map(s => s.trim()).filter(Boolean)
  const delayLabel = (s: UiStep) => s.delay_value > 0 ? `⏱ ${s.delay_value}${s.delay_unit === 'h' ? 'h' : 'min'}` : 'na hora'

  // Percorre a árvore gerando nós + arestas com layout automático (chains → direita, branches → baixo)
  const { nodes, edges } = useMemo(() => {
    const isComment = triggerType === 'comment'
    const gateX = isComment ? 680 : 340
    const dmBaseX = (isComment ? 680 : 340) + (followGate ? 320 : 0)
    const triggerLabel = triggerType === 'dm' ? 'manda a palavra-chave na DM'
      : triggerType === 'story_reply' ? 'responde a um Story seu'
      : `comenta em ${mediaId ? 'um post específico' : 'qualquer post/Reel'}`
    const pos = (id: string, def: { x: number; y: number }) => positions[id] ?? def

    const ns: Node[] = [
      { id: 'trigger', type: 'trigger', position: pos('trigger', { x: 0, y: 80 }), data: { keywords, mediaThumb: isComment ? mediaThumb : null, mediaLabel: triggerLabel } },
      ...(isComment ? [{ id: 'reply', type: 'reply', position: pos('reply', { x: 340, y: 96 }), data: { replies: replyList } }] : []),
      ...(followGate ? [
        { id: 'gate', type: 'gate', position: pos('gate', { x: gateX, y: 80 }), data: { message: followGateMsg || DEFAULT_GATE_MSG } },
        { id: 'gatemsg', type: 'gatemsg', position: pos('gatemsg', { x: gateX + 10, y: 330 }), data: {} },
      ] : []),
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
    const rootSource = followGate ? { id: 'gate', handle: 'yes' as string | undefined } : { id: (followGate ? 'gate' : preSource), handle: undefined as string | undefined }
    const rootFirstLabel = followGate ? '✅ segue' : (isComment ? 'na DM' : 'dispara')

    let rowCursor = 0
    const walk = (chain: UiStep[], chainPath: number[], depth: number, parent: { id: string; handle?: string; label: string }) => {
      chain.forEach((step, idx) => {
        const path = [...chainPath, idx]
        const id = pathId(path)
        const myRow = rowCursor++
        const label = chainPath.length === 0 && idx === 0 ? 'Enviar Mensagem' : `Mensagem`
        ns.push({ id, type: 'dm', position: pos(id, { x: dmBaseX + depth * COL_W, y: 40 + myRow * ROW_H }), data: { step, label } })
        // aresta de entrada
        const src = idx === 0
          ? parent
          : { id: pathId([...chainPath, idx - 1]), handle: 'next', label: delayLabel(step) }
        const inLabel = idx === 0 ? parent.label : delayLabel(step)
        es.push({
          id: 'e-' + id, source: src.id, sourceHandle: src.handle, target: id, animated: true,
          label: inLabel, labelStyle: { fontSize: 10, fill: '#7c3aed', fontWeight: 600 }, style: { stroke: '#a78bfa' },
        })
        // ramificações: cada botão de resposta com fluxo próprio vira uma sub-árvore
        let ri = -1
        step.buttons.forEach((b, bi) => {
          if (b.kind !== 'reply') return
          ri++
          if (b.branch && b.branch.length > 0) {
            walk(b.branch, [...path, bi], depth + 1, { id, handle: `b${ri}`, label: `💬 ${b.title || 'resposta'}` })
          }
        })
      })
    }
    walk(steps, [], 0, { id: rootSource.id, handle: rootSource.handle, label: rootFirstLabel })
    return { nodes: ns, edges: es }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords, mediaThumb, mediaId, replies, steps, positions, followGate, followGateMsg, triggerType])

  useEffect(() => {
    setRfNodes(nodes.map(n => ({ ...n, selected: n.id === selected })))
  }, [nodes, selected, setRfNodes])

  async function save() {
    setSaving(true)
    const finalKeywords = keywordInput.trim() && !keywords.includes(keywordInput.trim()) ? [...keywords, keywordInput.trim()] : keywords
    if (keywordInput.trim()) { setKeywords(finalKeywords); setKeywordInput('') }
    const db = chainToDb(steps)
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

  // ── operações na árvore ──
  const selPath = selected.startsWith('dm-') ? parsePath(selected) : null
  const selStep = selPath ? getStep(steps, selPath) : undefined
  const chainOf = (p: number[]) => p.slice(0, -1)
  const idxOf = (p: number[]) => p[p.length - 1]

  const patchStep = (path: number[], patch: Partial<UiStep>) =>
    setSteps(st => updateChain(st, chainOf(path), ch => ch.map((s, i) => i === idxOf(path) ? { ...s, ...patch } : s)))
  const patchButtons = (path: number[], fn: (btns: UiButton[]) => UiButton[]) => {
    const cur = getStep(steps, path); if (!cur) return
    patchStep(path, { buttons: fn(cur.buttons) })
  }
  const addAfter = (path: number[]) => {
    const cp = chainOf(path), at = idxOf(path)
    setSteps(st => updateChain(st, cp, ch => [...ch.slice(0, at + 1), emptyStep(), ...ch.slice(at + 1)]))
    setSelected(pathId([...cp, at + 1]))
  }
  const removeStep = (path: number[]) => {
    const cp = chainOf(path), at = idxOf(path)
    setSteps(st => updateChain(st, cp, ch => ch.filter((_, i) => i !== at)))
    setSelected(cp.length === 0 ? (at > 0 ? pathId([at - 1]) : 'trigger') : pathId(cp))
  }
  // abre/entra no fluxo de um botão de resposta (branch)
  const openBranch = (path: number[], btnIdx: number) => {
    const cur = getStep(steps, path); if (!cur) return
    const b = cur.buttons[btnIdx]
    if (!b.branch || b.branch.length === 0) {
      patchButtons(path, bs => bs.map((x, j) => j === btnIdx ? { ...x, branch: [emptyStep(0)] } : x))
    }
    setSelected(pathId([...path, btnIdx, 0]))
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
          <button onClick={() => { setSteps(list => [...list, emptyStep()]); setSelected(pathId([steps.length])) }}
            className="px-3 py-1.5 text-sm border border-purple-200 text-purple-700 rounded-lg hover:bg-purple-50">+ Mensagem</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90 disabled:opacity-60">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelected(n.id)}
            onNodesChange={onRfNodesChange}
            onNodeDragStop={(_, n) => setPositions(p => ({ ...p, [n.id]: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }))}
            fitView
            nodesDraggable
            nodesConnectable={false}
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

          {selPath && selStep && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">📩 {selPath.length > 1 ? 'Mensagem do fluxo' : `Mensagem ${idxOf(selPath) + 1}`}</h3>
                <button onClick={() => removeStep(selPath)} className="text-xs text-red-500 hover:underline">Excluir</button>
              </div>
              {selPath.length > 1 && (
                <p className="text-[11px] text-emerald-600 bg-emerald-50 rounded-lg px-2 py-1.5">↳ Esta mensagem faz parte de um fluxo de resposta (ramo SIM/NÃO). Continue adicionando mensagens aqui que elas seguem só neste caminho.</p>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">{idxOf(selPath) === 0 && selPath.length === 1 ? 'Espera após o gatilho' : 'Espera após a mensagem anterior'}</label>
                <div className="flex gap-2">
                  <input type="number" min={0} className={inputCls + ' w-24'} value={selStep.delay_value}
                    onChange={e => patchStep(selPath, { delay_value: Math.max(0, Number(e.target.value)) })} />
                  <select className={inputCls + ' w-28'} value={selStep.delay_unit}
                    onChange={e => patchStep(selPath, { delay_unit: e.target.value as 'min' | 'h' })}>
                    <option value="min">minutos</option>
                    <option value="h">horas</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Texto da mensagem</label>
                <div className="relative">
                  <textarea className={inputCls + ' h-28 pr-9'} value={selStep.text}
                    onChange={e => patchStep(selPath, { text: e.target.value })}
                    placeholder="Oi! Vi seu comentário 👋" />
                  <div className="absolute top-1 right-1"><EmojiPicker onPick={emoji => patchStep(selPath, { text: selStep.text + emoji })} /></div>
                </div>
              </div>
              <MediaField url={selStep.media_url} type={selStep.media_type}
                onChange={(u, t) => patchStep(selPath, { media_url: u, media_type: t })} />

              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-500">Botões (até 3)</label>
                {selStep.buttons.map((b, bi) => (
                  <div key={bi} className="flex flex-col gap-1.5 border border-gray-100 rounded-lg p-2">
                    <div className="flex gap-1.5 items-center">
                      <span className={`text-[10px] px-1.5 py-1 rounded ${b.kind === 'reply' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{b.kind === 'reply' ? '💬' : '🔗'}</span>
                      <input className={inputCls} value={b.title} placeholder={b.kind === 'reply' ? 'SIM' : 'ACESSAR'}
                        onChange={e => patchButtons(selPath, bs => bs.map((x, j) => j === bi ? { ...x, title: e.target.value } : x))} />
                      <button onClick={() => patchButtons(selPath, bs => bs.filter((_, j) => j !== bi))}
                        className="text-gray-300 hover:text-red-500">×</button>
                    </div>
                    {b.kind === 'url' && (
                      <input className={inputCls} value={b.url} placeholder="https://…"
                        onChange={e => patchButtons(selPath, bs => bs.map((x, j) => j === bi ? { ...x, url: e.target.value } : x))} />
                    )}
                    {/* Ramificação real: cada botão de resposta abre seu próprio fluxo no canvas */}
                    {b.kind === 'reply' && (
                      <button onClick={() => openBranch(selPath, bi)}
                        className="text-[11px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2 py-1.5 text-left font-medium">
                        {b.branch && b.branch.length > 0
                          ? `▶ Ir para o fluxo do "${b.title || 'botão'}" (${b.branch.length} msg) →`
                          : `▶ Criar fluxo pra quem tocar em "${b.title || 'este botão'}" →`}
                      </button>
                    )}
                  </div>
                ))}
                {selStep.buttons.length < 3 && (
                  <div className="flex gap-3">
                    <button onClick={() => patchButtons(selPath, bs => [...bs, { title: '', url: '', kind: 'url' }])}
                      className="text-xs text-sky-600 hover:underline">+ 🔗 link</button>
                    <button onClick={() => patchButtons(selPath, bs => [...bs, { title: '', url: '', kind: 'reply' }])}
                      className="text-xs text-emerald-600 hover:underline">+ 💬 resposta (SIM/NÃO)</button>
                  </div>
                )}
                {selStep.buttons.some(b => b.kind === 'reply') && (
                  <p className="text-[11px] text-emerald-600/80">💡 Cada botão de resposta tem uma saída no card 👉 — abra o fluxo dele pra montar o que acontece se a pessoa tocar. Sem fluxo, o botão só adianta a próxima mensagem.</p>
                )}
              </div>

              <button onClick={() => addAfter(selPath)}
                className="text-sm text-purple-700 border border-purple-200 rounded-lg py-2 hover:bg-purple-50">+ Mensagem depois desta</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
