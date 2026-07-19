'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow, Background, Controls, Handle, Position, useNodesState,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { updateIgAutomation, listInstagramPosts, type IgAutomation } from '@/app/actions/ig-automations'
import type { IgMedia } from '@/lib/instagram'

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

type UiButton = { title: string; url: string; kind: 'url' | 'reply' }
type UiStep = { delay_value: number; delay_unit: 'min' | 'h'; text: string; buttons: UiButton[] }
const emptyStep = (): UiStep => ({ delay_value: 5, delay_unit: 'min', text: '', buttons: [] })

function dbToSteps(a: IgAutomation): UiStep[] {
  const src = (a.dm_steps && a.dm_steps.length > 0)
    ? a.dm_steps
    : (a.dm_message ? [{ delay_minutes: 0, text: a.dm_message, buttons: [] }] : [])
  if (src.length === 0) return [{ ...emptyStep(), delay_value: 0 }]
  return src.map(s => {
    const min = s.delay_minutes ?? 0
    const asHours = min >= 60 && min % 60 === 0
    return {
      delay_value: asHours ? min / 60 : min,
      delay_unit: asHours ? 'h' as const : 'min' as const,
      text: s.text ?? '',
      buttons: (s.buttons ?? []).map(b => ({ title: b.title, url: (b as { url?: string }).url ?? '', kind: ((b as { url?: string }).url ? 'url' : 'reply') as 'url' | 'reply' })),
    }
  })
}

function stepsToDb(steps: UiStep[]) {
  return steps
    .filter(s => s.text.trim() || s.buttons.some(b => b.title && (b.kind === 'reply' || b.url)))
    .map(s => ({
      delay_minutes: s.delay_unit === 'h' ? s.delay_value * 60 : s.delay_value,
      text: s.text.trim(),
      buttons: s.buttons
        .filter(b => b.title && (b.kind === 'reply' || b.url))
        .map(b => b.kind === 'reply' ? { title: b.title } : { title: b.title, url: b.url }),
    }))
}

// ─── Nodes customizados (estilo ManyChat) ────────────────────────────────────

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as { keywords: string[]; mediaThumb: string | null; mediaLabel: string; followGate?: boolean }
  return (
    <div className={`w-64 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-hidden cursor-pointer`}>
      <div className="px-4 py-2 text-xs font-semibold text-gray-500 flex items-center gap-1.5">✨ Quando…</div>
      <div className="mx-3 mb-3 rounded-xl bg-emerald-50 border border-emerald-100 p-3">
        <div className="flex items-center gap-2">
          {d.mediaThumb
            ? <img src={d.mediaThumb} alt="" className="w-9 h-9 rounded-lg object-cover" />
            : <span className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">📣</span>}
          <p className="text-xs text-gray-700 leading-snug">O usuário comenta em <strong>{d.mediaLabel}</strong></p>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {d.keywords.length > 0
            ? d.keywords.map(k => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-200/60 text-emerald-800 font-medium">{k}</span>)
            : <span className="text-[10px] text-gray-400">qualquer comentário</span>}
        </div>
      </div>
      {d.followGate && (
        <div className="mx-3 mb-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[10px] text-amber-700 font-medium">
          🔒 Só libera pra quem SEGUE o perfil
        </div>
      )}
      <div className="px-4 pb-2 text-right text-[10px] text-gray-400">Então ⟶</div>
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

function DmNode({ data, selected }: NodeProps) {
  const d = data as { step: UiStep; index: number }
  const s = d.step
  return (
    <div className={`w-64 rounded-2xl bg-white shadow-lg border-2 ${selected ? 'border-indigo-500' : 'border-transparent'} overflow-hidden cursor-pointer`}>
      <Handle type="target" position={Position.Left} className="!bg-purple-500 !w-3 !h-3" />
      <div className="px-4 py-2 text-xs font-semibold text-purple-600 flex items-center gap-1.5">
        <span className="w-4 h-4 rounded bg-gradient-to-br from-pink-500 to-purple-600 inline-flex items-center justify-center text-white text-[9px]">IG</span>
        Enviar Mensagem
      </div>
      <div className="mx-3 mb-3 rounded-xl bg-purple-50 border border-purple-100 p-3">
        <p className="text-xs text-gray-700 whitespace-pre-wrap leading-snug">{s.text ? (s.text.length > 140 ? s.text.slice(0, 140) + '…' : s.text) : <span className="italic text-gray-400">mensagem vazia</span>}</p>
        {s.buttons.length > 0 && (
          <div className="flex flex-col gap-1 mt-2">
            {s.buttons.map((b, i) => (
              <div key={i} className={`text-[10px] text-center py-1 rounded-lg border font-medium ${b.kind === 'reply' ? 'border-emerald-300 text-emerald-700 bg-white' : 'border-sky-300 text-sky-700 bg-white'}`}>
                {b.kind === 'reply' ? '💬' : '🔗'} {b.title || '(sem texto)'}
              </div>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-purple-500 !w-3 !h-3" />
    </div>
  )
}

const nodeTypes = { trigger: TriggerNode, reply: ReplyNode, dm: DmNode }

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
  const [followGate, setFollowGate] = useState(automation.follow_gate ?? false)
  const [followGateMsg, setFollowGateMsg] = useState(automation.follow_gate_message ?? '')
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(automation.canvas ?? {})
  const [selected, setSelected] = useState<string>('trigger')
  const [posts, setPosts] = useState<IgMedia[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // useNodesState cuida das mudanças internas do React Flow (medição + arrasto);
  // ao soltar o nó, gravamos a posição em `positions` (persistida no Salvar)
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([])

  useEffect(() => { listInstagramPosts().then(r => setPosts(r.posts)) }, [])

  const replyList = replies.split('\n').map(s => s.trim()).filter(Boolean)

  const nodes: Node[] = useMemo(() => {
    const pos = (id: string, def: { x: number; y: number }) => positions[id] ?? def
    const list: Node[] = [
      { id: 'trigger', type: 'trigger', position: pos('trigger', { x: 0, y: 80 }), data: { keywords, mediaThumb, mediaLabel: mediaId ? 'um post específico' : 'qualquer post/Reel', followGate } },
      { id: 'reply', type: 'reply', position: pos('reply', { x: 340, y: 96 }), data: { replies: replyList } },
      ...steps.map((s, i) => ({
        id: `dm-${i}`, type: 'dm', position: pos(`dm-${i}`, { x: 680 + i * 340, y: 60 }), data: { step: s, index: i },
      })),
    ]
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords, mediaThumb, mediaId, replies, steps, positions, followGate, selected])

  // Sincroniza os nós computados com o estado interno do React Flow
  useEffect(() => {
    setRfNodes(nodes.map(n => ({ ...n, selected: n.id === selected })))
  }, [nodes, selected, setRfNodes])

  const edges: Edge[] = useMemo(() => {
    const delayLabel = (s: UiStep) => s.delay_value > 0 ? `⏱ espera ${s.delay_value}${s.delay_unit === 'h' ? 'h' : 'min'}` : 'na hora'
    const e: Edge[] = [
      { id: 'e-t-r', source: 'trigger', target: 'reply', animated: true, label: 'Então', style: { stroke: '#94a3b8' } },
    ]
    steps.forEach((s, i) => {
      e.push({
        id: `e-${i}`, source: i === 0 ? 'reply' : `dm-${i - 1}`, target: `dm-${i}`,
        animated: true, label: delayLabel(s),
        labelStyle: { fontSize: 10, fill: '#7c3aed', fontWeight: 600 },
        style: { stroke: '#a78bfa' },
      })
    })
    return e
  }, [steps])

  async function save() {
    setSaving(true)
    const finalKeywords = keywordInput.trim() && !keywords.includes(keywordInput.trim()) ? [...keywords, keywordInput.trim()] : keywords
    if (keywordInput.trim()) { setKeywords(finalKeywords); setKeywordInput('') }
    const db = stepsToDb(steps)
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
      follow_gate: followGate,
      follow_gate_message: followGateMsg || null,
      canvas: Object.keys(positions).length > 0 ? positions : null,
    })
    setSaving(false)
    setSavedAt(Date.now())
  }

  const selStepIdx = selected.startsWith('dm-') ? Number(selected.slice(3)) : -1
  const setStep = (i: number, patch: Partial<UiStep>) => setSteps(list => list.map((x, xi) => xi === i ? { ...x, ...patch } : x))

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
          <button onClick={() => setSteps(list => [...list, emptyStep()])}
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
                  <input type="checkbox" checked={followGate} onChange={e => setFollowGate(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                  🔒 Exigir seguir o perfil antes de liberar
                </label>
                {followGate && (
                  <>
                    <p className="text-[11px] text-gray-500">Quem não segue recebe esta mensagem na DM com o botão &quot;JÁ SIGO ✅&quot;. Quando seguir e tocar, a sequência libera sozinha.</p>
                    <textarea className={inputCls + ' h-20'} value={followGateMsg} onChange={e => setFollowGateMsg(e.target.value)}
                      placeholder="Opa! 🔒 Esse conteúdo é exclusivo pra quem me segue. Me segue lá e toca no botão que eu libero na hora 👇" />
                  </>
                )}
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

          {selected === 'reply' && (
            <>
              <h3 className="font-semibold text-gray-900">💬 Resposta pública ao comentário</h3>
              <p className="text-xs text-gray-500">Uma por linha — o sistema sorteia entre elas pra não parecer robô.</p>
              <textarea className={inputCls + ' h-32'} value={replies} onChange={e => setReplies(e.target.value)}
                placeholder={'Te chamei na DM! 🚀\nAcabei de te mandar mensagem 📩'} />
            </>
          )}

          {selStepIdx >= 0 && steps[selStepIdx] && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">📩 Mensagem {selStepIdx + 1}</h3>
                {steps.length > 1 && (
                  <button onClick={() => { setSteps(list => list.filter((_, i) => i !== selStepIdx)); setSelected('reply') }}
                    className="text-xs text-red-500 hover:underline">Excluir</button>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">{selStepIdx === 0 ? 'Espera após o comentário' : 'Espera após a mensagem anterior'}</label>
                <div className="flex gap-2">
                  <input type="number" min={0} className={inputCls + ' w-24'} value={steps[selStepIdx].delay_value}
                    onChange={e => setStep(selStepIdx, { delay_value: Math.max(0, Number(e.target.value)) })} />
                  <select className={inputCls + ' w-28'} value={steps[selStepIdx].delay_unit}
                    onChange={e => setStep(selStepIdx, { delay_unit: e.target.value as 'min' | 'h' })}>
                    <option value="min">minutos</option>
                    <option value="h">horas</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Texto da mensagem</label>
                <textarea className={inputCls + ' h-28'} value={steps[selStepIdx].text}
                  onChange={e => setStep(selStepIdx, { text: e.target.value })}
                  placeholder="Oi! Vi seu comentário 👋" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-500">Botões (até 3)</label>
                {steps[selStepIdx].buttons.map((b, bi) => (
                  <div key={bi} className="flex gap-1.5 items-center">
                    <span className={`text-[10px] px-1.5 py-1 rounded ${b.kind === 'reply' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{b.kind === 'reply' ? '💬' : '🔗'}</span>
                    <input className={inputCls} value={b.title} placeholder={b.kind === 'reply' ? 'SIM' : 'ACESSAR'}
                      onChange={e => setStep(selStepIdx, { buttons: steps[selStepIdx].buttons.map((bb, bbi) => bbi === bi ? { ...bb, title: e.target.value } : bb) })} />
                    {b.kind === 'url' && (
                      <input className={inputCls} value={b.url} placeholder="https://…"
                        onChange={e => setStep(selStepIdx, { buttons: steps[selStepIdx].buttons.map((bb, bbi) => bbi === bi ? { ...bb, url: e.target.value } : bb) })} />
                    )}
                    <button onClick={() => setStep(selStepIdx, { buttons: steps[selStepIdx].buttons.filter((_, bbi) => bbi !== bi) })}
                      className="text-gray-300 hover:text-red-500">×</button>
                  </div>
                ))}
                {steps[selStepIdx].buttons.length < 3 && (
                  <div className="flex gap-3">
                    <button onClick={() => setStep(selStepIdx, { buttons: [...steps[selStepIdx].buttons, { title: '', url: '', kind: 'url' }] })}
                      className="text-xs text-sky-600 hover:underline">+ 🔗 link</button>
                    <button onClick={() => setStep(selStepIdx, { buttons: [...steps[selStepIdx].buttons, { title: '', url: '', kind: 'reply' }] })}
                      className="text-xs text-emerald-600 hover:underline">+ 💬 resposta (SIM)</button>
                  </div>
                )}
                {steps[selStepIdx].buttons.some(b => b.kind === 'reply') && (
                  <p className="text-[11px] text-emerald-600/80">💡 Botão de resposta renova a janela de 24h — o próximo passo dispara na hora quando a pessoa toca.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
