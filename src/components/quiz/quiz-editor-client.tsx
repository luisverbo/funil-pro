'use client'

import React, { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import '@xyflow/react/dist/style.css'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Handle, Position,
  type NodeProps, type Connection, type Edge, type Node,
} from '@xyflow/react'
import {
  saveQuizQuestions, publishQuizPage,
  type QuizQuestion, type QuizOption, type ScoreRange,
} from '@/app/actions/quiz'

type QuestionType = QuizQuestion['question_type']

interface NodeData extends Record<string, unknown> {
  question_text: string
  question_type: QuestionType
  subtitle?: string | null
  options: QuizOption[]
  required: boolean
  next_question_id?: string | null
  config: QuizQuestion['config']
}

const QUESTION_TYPE_META: Record<QuestionType, { label: string; icon: string; color: string; hasOptions: boolean }> = {
  single_choice: { label: 'Escolha única',    icon: '🔘', color: 'indigo',  hasOptions: true  },
  multi_choice:  { label: 'Múltipla escolha', icon: '☑️',  color: 'purple',  hasOptions: true  },
  text_short:    { label: 'Texto curto',       icon: '📝', color: 'blue',    hasOptions: false },
  text_long:     { label: 'Texto longo',       icon: '📜', color: 'blue',    hasOptions: false },
  email:         { label: 'E-mail',            icon: '✉️',  color: 'teal',    hasOptions: false },
  phone:         { label: 'Telefone',          icon: '📱', color: 'teal',    hasOptions: false },
  scale:         { label: 'Escala 1-10',       icon: '📊', color: 'amber',   hasOptions: false },
  final_capture: { label: 'Captura final',     icon: '🏆', color: 'emerald', hasOptions: false },
  result:        { label: 'Resultado',         icon: '🎉', color: 'green',   hasOptions: false },
  calc:          { label: 'Cálculo',           icon: '🔢', color: 'orange',  hasOptions: false },
}

const COLOR_MAP: Record<string, { border: string; badge: string; header: string }> = {
  indigo:  { border: '#6366f1', badge: 'bg-indigo-100 text-indigo-700',   header: 'bg-indigo-50'   },
  purple:  { border: '#a855f7', badge: 'bg-purple-100 text-purple-700',   header: 'bg-purple-50'   },
  blue:    { border: '#3b82f6', badge: 'bg-blue-100 text-blue-700',       header: 'bg-blue-50'     },
  teal:    { border: '#14b8a6', badge: 'bg-teal-100 text-teal-700',       header: 'bg-teal-50'     },
  amber:   { border: '#f59e0b', badge: 'bg-amber-100 text-amber-700',     header: 'bg-amber-50'    },
  emerald: { border: '#10b981', badge: 'bg-emerald-100 text-emerald-700', header: 'bg-emerald-50'  },
  green:   { border: '#22c55e', badge: 'bg-green-100 text-green-700',     header: 'bg-green-50'    },
  orange:  { border: '#f97316', badge: 'bg-orange-100 text-orange-700',   header: 'bg-orange-50'   },
}

// ─── Canvas Node ─────────────────────────────────────────────────────────────

function QuestionNode({ data, selected }: NodeProps) {
  const nd = data as NodeData
  const meta = QUESTION_TYPE_META[nd.question_type] ?? QUESTION_TYPE_META.single_choice
  const colors = COLOR_MAP[meta.color] ?? COLOR_MAP.indigo
  const isChoice = meta.hasOptions
  const isResult = nd.question_type === 'result'
  const isCalc   = nd.question_type === 'calc'

  return (
    <div
      style={{ borderColor: selected ? colors.border : '#e5e7eb', width: 260 }}
      className="bg-white rounded-xl border-2 shadow-md select-none"
    >
      {/* Target handle — all except result */}
      {!isResult && (
        <Handle type="target" position={Position.Left} id="in"
          style={{ background: colors.border, border: '2px solid white', width: 10, height: 10 }}
        />
      )}

      <div className={`px-3 py-2 flex items-center gap-2 ${colors.header} rounded-t-xl`}>
        <span className="text-base">{meta.icon}</span>
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${colors.badge}`}>{meta.label}</span>
        {nd.required && !isResult && !isCalc && (
          <span className="ml-auto text-[10px] text-gray-400">obrigatória</span>
        )}
      </div>

      <div className="px-3 py-2.5 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
          {nd.question_text || <span className="text-gray-400 italic">Sem texto</span>}
        </p>
        {nd.subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{nd.subtitle}</p>}
        {isCalc && nd.config?.formula && (
          <code className="text-xs text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded mt-1 block truncate">
            {nd.config.formula}
          </code>
        )}
      </div>

      {/* Per-option source handles for choice nodes */}
      {isChoice && nd.options.length > 0 && (
        <div className="py-1">
          {nd.options.map((opt, i) => (
            <div key={opt.id} className="relative flex items-center gap-2 px-3 h-9 hover:bg-gray-50">
              {opt.emoji && <span className="text-sm shrink-0">{opt.emoji}</span>}
              <span className="text-xs text-gray-700 truncate flex-1">{opt.label || `Opção ${i + 1}`}</span>
              {!!opt.points && (
                <span className={`text-[10px] font-medium ${opt.points > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {opt.points > 0 ? '+' : ''}{opt.points}
                </span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id={`opt-${opt.id}`}
                style={{ background: colors.border, border: '2px solid white', width: 10, height: 10 }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Single source handle for non-choice, non-result */}
      {!isChoice && !isResult && (
        <Handle type="source" position={Position.Right} id="out"
          style={{ background: colors.border, border: '2px solid white', width: 10, height: 10 }}
        />
      )}

      {/* Result node badges */}
      {isResult && (nd.config?.result_profile || (nd.config?.score_ranges ?? []).length > 0) && (
        <div className="px-3 py-2 flex flex-wrap gap-1">
          {nd.config?.result_profile && (
            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
              {nd.config.result_profile}
            </span>
          )}
          {(nd.config?.score_ranges ?? []).length > 0 && (
            <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
              {nd.config!.score_ranges!.length} faixa(s)
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { questionNode: QuestionNode }

// ─── Data conversions ────────────────────────────────────────────────────────

function questionsToFlow(questions: QuizQuestion[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = questions.map(q => ({
    id: q.id,
    type: 'questionNode',
    position: { x: q.pos_x, y: q.pos_y },
    data: {
      question_text: q.question_text,
      question_type: q.question_type,
      subtitle: q.subtitle,
      options: q.options ?? [],
      required: q.required,
      next_question_id: q.next_question_id,
      config: q.config ?? {},
    } as NodeData,
  }))

  const edges: Edge[] = []
  for (const q of questions) {
    const isChoice = QUESTION_TYPE_META[q.question_type]?.hasOptions
    if (isChoice) {
      for (const opt of q.options ?? []) {
        if (opt.next_question_id) {
          edges.push({
            id: `${q.id}-${opt.id}`,
            source: q.id, sourceHandle: `opt-${opt.id}`,
            target: opt.next_question_id, targetHandle: 'in',
            type: 'smoothstep', animated: true,
            label: opt.label?.slice(0, 18),
            style: { stroke: '#6366f1', strokeWidth: 1.5 },
            labelStyle: { fontSize: 10, fill: '#6b7280' },
            labelBgStyle: { fill: 'white', fillOpacity: 0.8 },
          })
        }
      }
    } else if (q.next_question_id) {
      edges.push({
        id: `${q.id}-out`,
        source: q.id, sourceHandle: 'out',
        target: q.next_question_id, targetHandle: 'in',
        type: 'smoothstep', animated: true,
        style: { stroke: '#6366f1', strokeWidth: 1.5 },
      })
    }
  }

  return { nodes, edges }
}

function flowToQuestions(nodes: Node[], edges: Edge[]): Omit<QuizQuestion, 'tenant_id' | 'page_id'>[] {
  return nodes.map((node, idx) => {
    const nd = node.data as NodeData
    const isChoice = QUESTION_TYPE_META[nd.question_type]?.hasOptions
    const updatedOptions = nd.options.map(opt => {
      const edge = edges.find(e => e.source === node.id && e.sourceHandle === `opt-${opt.id}`)
      return { ...opt, next_question_id: edge?.target ?? null }
    })
    const outEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'out')
    return {
      id: node.id,
      order_index: idx,
      question_type: nd.question_type,
      question_text: nd.question_text,
      subtitle: nd.subtitle ?? null,
      options: isChoice ? updatedOptions : [],
      required: nd.required,
      next_question_id: !isChoice ? (outEdge?.target ?? null) : null,
      config: nd.config ?? {},
      pos_x: node.position.x,
      pos_y: node.position.y,
    }
  })
}

function newId() { return crypto.randomUUID() }

// ─── Right Panel ─────────────────────────────────────────────────────────────

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div onClick={onToggle}
        className={`w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-indigo-500' : 'bg-gray-200'}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-xs text-gray-600">{label}</span>
    </label>
  )
}

function RightPanel({
  nodeId, nodes, setNodes, edges, funnels, onClose,
}: {
  nodeId: string
  nodes: Node[]
  setNodes: (fn: (prev: Node[]) => Node[]) => void
  edges: Edge[]
  funnels: { id: string; name: string }[]
  onClose: () => void
}) {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return null
  const nd = node.data as NodeData

  function update(patch: Partial<NodeData>) {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
  }
  function updateConfig(patch: Partial<QuizQuestion['config']>) {
    update({ config: { ...nd.config, ...patch } })
  }
  function addOption() {
    update({ options: [...nd.options, { id: newId(), label: '', emoji: '', next_question_id: null, points: 0 }] })
  }
  function removeOption(optId: string) {
    update({ options: nd.options.filter(o => o.id !== optId) })
  }
  function updateOption(optId: string, patch: Partial<QuizOption>) {
    update({ options: nd.options.map(o => o.id === optId ? { ...o, ...patch } : o) })
  }
  function moveOption(idx: number, dir: -1 | 1) {
    const opts = [...nd.options]
    const swap = idx + dir
    if (swap < 0 || swap >= opts.length) return
    ;[opts[idx], opts[swap]] = [opts[swap], opts[idx]]
    update({ options: opts })
  }
  function addScoreRange() {
    const ranges = nd.config?.score_ranges ?? []
    updateConfig({ score_ranges: [...ranges, { min: 0, max: 100, result_node_id: '' }] })
  }
  function updateScoreRange(idx: number, key: keyof ScoreRange, val: string | number) {
    const ranges = [...(nd.config?.score_ranges ?? [])]
    ranges[idx] = { ...ranges[idx], [key]: val }
    updateConfig({ score_ranges: ranges })
  }
  function removeScoreRange(idx: number) {
    const ranges = (nd.config?.score_ranges ?? []).filter((_, i) => i !== idx)
    updateConfig({ score_ranges: ranges })
  }

  const isChoice = QUESTION_TYPE_META[nd.question_type]?.hasOptions
  const isResult = nd.question_type === 'result'
  const isCalc   = nd.question_type === 'calc'
  const resultNodes = nodes.filter(n => (n.data as NodeData).question_type === 'result')

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300'

  return (
    <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Editar bloco</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Type selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Tipo</label>
          <select value={nd.question_type}
            onChange={e => update({ question_type: e.target.value as QuestionType, options: QUESTION_TYPE_META[e.target.value as QuestionType]?.hasOptions ? nd.options : [] })}
            className={inputCls}>
            {Object.entries(QUESTION_TYPE_META).map(([type, m]) => (
              <option key={type} value={type}>{m.icon} {m.label}</option>
            ))}
          </select>
        </div>

        {/* Question text + subtitle */}
        {!isCalc && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Texto da pergunta</label>
              <textarea value={nd.question_text} onChange={e => update({ question_text: e.target.value })} rows={3}
                className={inputCls + ' resize-none'} placeholder="Digite a pergunta..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Subtítulo (opcional)</label>
              <input value={nd.subtitle ?? ''} onChange={e => update({ subtitle: e.target.value || null })}
                className={inputCls} placeholder="Ex: Escolha uma opção" />
            </div>
          </>
        )}

        {/* Required toggle */}
        {!isResult && !isCalc && (
          <Toggle on={nd.required} onToggle={() => update({ required: !nd.required })} label="Resposta obrigatória" />
        )}

        {/* Choice options */}
        {isChoice && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500">Opções</label>
              <button onClick={addOption} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">+ Adicionar</button>
            </div>
            <div className="space-y-2">
              {nd.options.map((opt, i) => (
                <div key={opt.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input value={opt.emoji ?? ''} onChange={e => updateOption(opt.id, { emoji: e.target.value })}
                      className="w-10 text-center text-sm border border-gray-200 rounded-lg py-1 focus:outline-none" placeholder="😀" />
                    <input value={opt.label} onChange={e => updateOption(opt.id, { label: e.target.value })}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      placeholder="Texto da opção" />
                    <div className="flex gap-0.5">
                      <button onClick={() => moveOption(i, -1)} className="p-0.5 text-gray-400 hover:text-gray-600 text-xs">↑</button>
                      <button onClick={() => moveOption(i, 1)}  className="p-0.5 text-gray-400 hover:text-gray-600 text-xs">↓</button>
                      <button onClick={() => removeOption(opt.id)} className="p-0.5 text-red-400 hover:text-red-600">×</button>
                    </div>
                  </div>
                  {/* Points field */}
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-gray-400 shrink-0">Pontos:</label>
                    <input type="number" value={opt.points ?? 0}
                      onChange={e => updateOption(opt.id, { points: Number(e.target.value) })}
                      className="w-20 text-xs border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    <span className="text-[10px] text-gray-400">(+ ou -)</span>
                  </div>
                  <p className="text-[10px] text-gray-400">Conecte a saída desta opção no canvas →</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scale config */}
        {nd.question_type === 'scale' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Mín</label>
              <input type="number" value={nd.config?.scale_min ?? 1}
                onChange={e => updateConfig({ scale_min: Number(e.target.value) })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Máx</label>
              <input type="number" value={nd.config?.scale_max ?? 10}
                onChange={e => updateConfig({ scale_max: Number(e.target.value) })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>
        )}

        {/* Calc node config */}
        {isCalc && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Rótulo (interno)</label>
              <input value={nd.question_text} onChange={e => update({ question_text: e.target.value })}
                className={inputCls} placeholder="Ex: Calcular resultado final" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Fórmula</label>
              <input value={nd.config?.formula ?? ''} onChange={e => updateConfig({ formula: e.target.value })}
                className={inputCls + ' font-mono'} placeholder="({{score}} * 2) + 10" />
              <p className="text-[10px] text-gray-400 mt-1">
                Use <code>{'{{score}}'}</code> para pontos acumulados e <code>{'{{id_pergunta}}'}</code> para respostas anteriores
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Nome da variável resultado</label>
              <input value={nd.config?.result_var ?? 'calc_resultado'} onChange={e => updateConfig({ result_var: e.target.value })}
                className={inputCls + ' font-mono'} placeholder="calc_resultado" />
              <p className="text-[10px] text-gray-400 mt-1">
                Use <code>{'{{calc_resultado}}'}</code> nos textos para exibir o valor
              </p>
            </div>
          </div>
        )}

        {/* Result node config */}
        {isResult && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Identificador do perfil</label>
              <input value={nd.config?.result_profile ?? ''} onChange={e => updateConfig({ result_profile: e.target.value })}
                className={inputCls} placeholder="Ex: qualificado, produto-a..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Título do resultado</label>
              <input value={nd.question_text} onChange={e => update({ question_text: e.target.value })}
                className={inputCls} placeholder="Seu resultado está pronto!" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Texto do resultado</label>
              <textarea value={nd.config?.result_text ?? ''} onChange={e => updateConfig({ result_text: e.target.value })} rows={3}
                className={inputCls + ' resize-none'} placeholder="Baseado nas suas respostas... Use {{score}} para exibir pontuação." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Texto do botão CTA</label>
              <input value={nd.config?.cta_text ?? ''} onChange={e => updateConfig({ cta_text: e.target.value })}
                className={inputCls} placeholder="Quero acessar agora!" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">URL do CTA</label>
              <input value={nd.config?.cta_url ?? ''} onChange={e => updateConfig({ cta_url: e.target.value })}
                className={inputCls} placeholder="https://..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Ativar funil (opcional)</label>
              <select value={nd.config?.funnel_id ?? ''} onChange={e => updateConfig({ funnel_id: e.target.value || undefined })}
                className={inputCls}>
                <option value="">Nenhum</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            {/* Score display */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Pontuação</p>
              <Toggle on={!!nd.config?.show_score} onToggle={() => updateConfig({ show_score: !nd.config?.show_score })} label="Mostrar pontuação ao lead" />
              {nd.config?.show_score && (
                <div className="mt-2">
                  <input value={nd.config?.score_display_text ?? 'Você fez {{score}} pontos!'}
                    onChange={e => updateConfig({ score_display_text: e.target.value })}
                    className={inputCls} placeholder="Você fez {{score}} pontos!" />
                  <p className="text-[10px] text-gray-400 mt-1">Use <code>{'{{score}}'}</code> para exibir a pontuação</p>
                </div>
              )}
            </div>

            {/* Score ranges */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500">Roteamento por pontuação</p>
                <button onClick={addScoreRange} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">+ Faixa</button>
              </div>
              {(nd.config?.score_ranges ?? []).length > 0 ? (
                <div className="space-y-2">
                  {(nd.config!.score_ranges!).map((range, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <input type="number" value={range.min}
                          onChange={e => updateScoreRange(i, 'min', Number(e.target.value))}
                          className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none" placeholder="0" />
                        <span className="text-xs text-gray-400">—</span>
                        <input type="number" value={range.max}
                          onChange={e => updateScoreRange(i, 'max', Number(e.target.value))}
                          className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none" placeholder="100" />
                        <span className="text-xs text-gray-400 shrink-0">pts →</span>
                        <button onClick={() => removeScoreRange(i)} className="ml-auto text-red-400 hover:text-red-600">×</button>
                      </div>
                      <select value={range.result_node_id}
                        onChange={e => updateScoreRange(i, 'result_node_id', e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none">
                        <option value="">Selecionar nó resultado</option>
                        {resultNodes.map(n => {
                          const rnd = n.data as NodeData
                          return (
                            <option key={n.id} value={n.id}>
                              {rnd.config?.result_profile || rnd.question_text?.slice(0, 30) || n.id.slice(0, 8)}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-gray-400">Direciona o lead para diferentes resultados baseado na pontuação total.</p>
              )}
            </div>
          </div>
        )}

        {/* Background color */}
        {!isCalc && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Cor de fundo</label>
            <div className="flex gap-2 flex-wrap">
              {['#ffffff', '#f8f7ff', '#f0fdf4', '#fffbeb', '#fdf2f8', '#f0f9ff'].map(c => (
                <button key={c} onClick={() => updateConfig({ bg_color: c })}
                  style={{ background: c, borderColor: nd.config?.bg_color === c ? '#6366f1' : '#e5e7eb' }}
                  className="w-7 h-7 rounded-full border-2 transition" />
              ))}
            </div>
          </div>
        )}

        {/* Show progress toggle (on any non-calc node) */}
        {!isCalc && (
          <div className="border-t border-gray-100 pt-3">
            <Toggle on={!!nd.config?.show_progress} onToggle={() => updateConfig({ show_progress: !nd.config?.show_progress })} label="Mostrar barra de progresso" />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Linear Mode Editor ───────────────────────────────────────────────────────

function LinearEditor({
  nodes, setNodes, edges, setEdges, funnels, onSelectNode, selectedNodeId,
}: {
  nodes: Node[]
  setNodes: (fn: (prev: Node[]) => Node[]) => void
  edges: Edge[]
  setEdges: (fn: (prev: Edge[]) => Edge[]) => void
  funnels: { id: string; name: string }[]
  onSelectNode: (id: string) => void
  selectedNodeId: string | null
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  function onDragStart(e: React.DragEvent, idx: number) {
    e.dataTransfer.effectAllowed = 'move'
    setDragIdx(idx)
  }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    setOverIdx(idx)
  }
  function onDrop(e: React.DragEvent, targetIdx: number) {
    e.preventDefault()
    if (dragIdx !== null && dragIdx !== targetIdx) {
      setNodes(nds => {
        const arr = [...nds]
        const [item] = arr.splice(dragIdx, 1)
        arr.splice(targetIdx, 0, item)
        return arr
      })
    }
    setDragIdx(null)
    setOverIdx(null)
  }
  function onDragEnd() { setDragIdx(null); setOverIdx(null) }

  function togglePageBreak(afterIdx: number) {
    const nextIdx = afterIdx + 1
    if (nextIdx >= nodes.length) return
    setNodes(nds => nds.map((n, i) => {
      if (i !== nextIdx) return n
      const nd = n.data as NodeData
      return { ...n, data: { ...n.data, config: { ...nd.config, starts_new_page: !nd.config?.starts_new_page } } }
    }))
  }

  function setOptionGoTo(nodeId: string, optId: string, targetId: string | null) {
    setEdges(eds => {
      const filtered = eds.filter(e => !(e.source === nodeId && e.sourceHandle === `opt-${optId}`))
      if (!targetId) return filtered
      const srcNode = nodes.find(n => n.id === nodeId)
      const opt = (srcNode?.data as NodeData)?.options?.find(o => o.id === optId)
      return [...filtered, {
        id: `${nodeId}-${optId}`,
        source: nodeId, sourceHandle: `opt-${optId}`,
        target: targetId, targetHandle: 'in',
        type: 'smoothstep', animated: true,
        label: opt?.label?.slice(0, 18),
        style: { stroke: '#6366f1', strokeWidth: 1.5 },
      }]
    })
    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n
      const nd = n.data as NodeData
      return { ...n, data: { ...nd, options: nd.options.map(o => o.id === optId ? { ...o, next_question_id: targetId } : o) } }
    }))
  }

  function setNodeGoTo(nodeId: string, targetId: string | null) {
    setEdges(eds => {
      const filtered = eds.filter(e => !(e.source === nodeId && e.sourceHandle === 'out'))
      if (!targetId) return filtered
      return [...filtered, {
        id: `${nodeId}-out`,
        source: nodeId, sourceHandle: 'out',
        target: targetId, targetHandle: 'in',
        type: 'smoothstep', animated: true,
        style: { stroke: '#6366f1', strokeWidth: 1.5 },
      }]
    })
  }

  // Compute page numbers
  const pageOf: Record<string, number> = {}
  let page = 1
  nodes.forEach((n, i) => {
    if (i > 0 && (n.data as NodeData).config?.starts_new_page) page++
    pageOf[n.id] = page
  })
  const totalPages = page

  const nodeOptions = nodes.map(n => ({ id: n.id, label: (n.data as NodeData).question_text?.slice(0, 35) || `Bloco ${n.id.slice(0, 6)}` }))

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
      {totalPages > 1 && (
        <div className="max-w-2xl mx-auto mb-4 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-600 font-medium">
          {totalPages} páginas configuradas. No quiz publicado, cada página é exibida de uma vez com botão "Próximo".
        </div>
      )}
      <div className="max-w-2xl mx-auto space-y-1">
        {nodes.map((node, idx) => {
          const nd = node.data as NodeData
          const meta = QUESTION_TYPE_META[nd.question_type] ?? QUESTION_TYPE_META.single_choice
          const colors = COLOR_MAP[meta.color] ?? COLOR_MAP.indigo
          const isChoice = meta.hasOptions
          const isResult = nd.question_type === 'result'
          const isCalc   = nd.question_type === 'calc'
          const goToEdge = edges.find(e => e.source === node.id && e.sourceHandle === 'out')

          return (
            <React.Fragment key={node.id}>
              {/* Page break separator */}
              {nd.config?.starts_new_page && idx > 0 && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 border-t-2 border-dashed border-indigo-300" />
                  <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
                    📄 Página {pageOf[node.id]}
                  </span>
                  <div className="flex-1 border-t-2 border-dashed border-indigo-300" />
                </div>
              )}

              {/* Card */}
              <div
                draggable
                onDragStart={e => onDragStart(e, idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDrop={e => onDrop(e, idx)}
                onDragEnd={onDragEnd}
                onClick={() => onSelectNode(node.id)}
                className={`bg-white border-2 rounded-xl shadow-sm cursor-pointer transition-all ${
                  selectedNodeId === node.id ? 'border-indigo-400 shadow-md' :
                  overIdx === idx && dragIdx !== idx ? 'border-indigo-300' :
                  'border-gray-200 hover:border-gray-300'
                } ${dragIdx === idx ? 'opacity-40' : ''}`}
              >
                {/* Card header */}
                <div className={`px-4 py-2.5 flex items-center gap-3 ${colors.header} rounded-t-xl`}>
                  <span className="cursor-grab text-gray-400 text-base select-none" title="Arrastar para reordenar">⠿</span>
                  <span className="text-base">{meta.icon}</span>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${colors.badge} shrink-0`}>{meta.label}</span>
                  <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                    {nd.question_text || <span className="text-gray-400 italic">Sem texto</span>}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">#{idx + 1}</span>
                </div>

                {/* Calc formula preview */}
                {isCalc && nd.config?.formula && (
                  <div className="px-4 py-2 border-b border-gray-100">
                    <code className="text-xs text-orange-700 bg-orange-50 px-2 py-1 rounded block truncate">
                      {nd.config.formula} → {'{{'}{nd.config.result_var || 'calc_resultado'}{'}}'}
                    </code>
                  </div>
                )}

                {/* Choice options with Go-to dropdowns */}
                {isChoice && nd.options.length > 0 && (
                  <div className="px-4 py-2 space-y-1.5 border-b border-gray-100">
                    {nd.options.map(opt => {
                      const optEdge = edges.find(e => e.source === node.id && e.sourceHandle === `opt-${opt.id}`)
                      return (
                        <div key={opt.id} className="flex items-center gap-2">
                          {opt.emoji && <span className="text-sm shrink-0">{opt.emoji}</span>}
                          <span className="text-xs text-gray-700 flex-1 truncate min-w-0">{opt.label || 'Opção'}</span>
                          {!!opt.points && (
                            <span className={`text-[10px] font-medium shrink-0 ${opt.points > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {opt.points > 0 ? '+' : ''}{opt.points}pts
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 shrink-0">→</span>
                          <select
                            value={optEdge?.target ?? ''}
                            onChange={e => setOptionGoTo(node.id, opt.id, e.target.value || null)}
                            onClick={e => e.stopPropagation()}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 max-w-[140px]"
                          >
                            <option value="">Próximo da lista</option>
                            {nodeOptions.filter(o => o.id !== node.id).map(o => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Non-choice go-to */}
                {!isChoice && !isResult && (
                  <div className="px-4 py-2 flex items-center gap-2">
                    <span className="text-xs text-gray-400 shrink-0">Ir para:</span>
                    <select
                      value={goToEdge?.target ?? ''}
                      onChange={e => setNodeGoTo(node.id, e.target.value || null)}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                    >
                      <option value="">Próximo da lista</option>
                      {nodeOptions.filter(o => o.id !== node.id).map(o => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Result node summary */}
                {isResult && nd.config?.result_profile && (
                  <div className="px-4 py-2 flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                      Perfil: {nd.config.result_profile}
                    </span>
                    {nd.config?.show_score && (
                      <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                        Exibe pontuação
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Between-card controls */}
              {idx < nodes.length - 1 && (
                <div className="flex justify-center py-0.5">
                  <button
                    onClick={e => { e.stopPropagation(); togglePageBreak(idx) }}
                    className={`text-[10px] px-3 py-0.5 rounded-full border transition ${
                      (nodes[idx + 1]?.data as NodeData)?.config?.starts_new_page
                        ? 'border-indigo-300 text-indigo-500 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500'
                    }`}
                  >
                    {(nodes[idx + 1]?.data as NodeData)?.config?.starts_new_page ? '📄 Nova página aqui' : '+ Nova página'}
                  </button>
                </div>
              )}
            </React.Fragment>
          )
        })}

        {nodes.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🧩</p>
            <p className="text-sm font-medium">Nenhum bloco ainda</p>
            <p className="text-xs mt-1">Use a barra lateral para adicionar perguntas</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Default quiz scaffold ────────────────────────────────────────────────────

const DEFAULT_QUESTIONS: Omit<QuizQuestion, 'tenant_id' | 'page_id'>[] = [
  {
    id: newId(),
    order_index: 0,
    question_type: 'single_choice',
    question_text: 'Qual é o seu principal objetivo?',
    subtitle: 'Escolha uma opção',
    options: [
      { id: newId(), label: 'Opção A', emoji: '🎯', next_question_id: null, points: 10 },
      { id: newId(), label: 'Opção B', emoji: '💪', next_question_id: null, points: 5 },
    ],
    required: true,
    next_question_id: null,
    config: {},
    pos_x: 80,
    pos_y: 100,
  },
  {
    id: newId(),
    order_index: 1,
    question_type: 'result',
    question_text: 'Seu resultado está pronto!',
    subtitle: null,
    options: [],
    required: false,
    next_question_id: null,
    config: { is_result: true, result_profile: 'perfil-a', result_text: 'Baseado nas suas respostas…', cta_text: 'Acessar agora', cta_url: '' },
    pos_x: 500,
    pos_y: 100,
  },
]

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  page: { id: string; title: string; slug: string | null; published: boolean }
  initialQuestions: QuizQuestion[]
  funnels: { id: string; name: string }[]
  tenantId: string
}

export default function QuizEditorClient({ page, initialQuestions, funnels }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [mode, setMode] = useState<'canvas' | 'linear'>('canvas')

  const seed = initialQuestions.length > 0 ? initialQuestions : DEFAULT_QUESTIONS
  const { nodes: initNodes, edges: initEdges } = questionsToFlow(seed as QuizQuestion[])

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({
      ...params,
      type: 'smoothstep', animated: true,
      style: { stroke: '#6366f1', strokeWidth: 1.5 },
    }, eds))
  }, [setEdges])

  function addNode(type: QuestionType) {
    const id = newId()
    const meta = QUESTION_TYPE_META[type]
    const lastNode = nodes[nodes.length - 1]
    const x = lastNode ? lastNode.position.x + 320 : 80
    const y = lastNode ? lastNode.position.y : 100
    const newNode: Node = {
      id, type: 'questionNode',
      position: { x, y },
      data: {
        question_type: type,
        question_text: '',
        subtitle: null,
        options: meta.hasOptions
          ? [
              { id: newId(), label: 'Opção A', emoji: '', next_question_id: null, points: 0 },
              { id: newId(), label: 'Opção B', emoji: '', next_question_id: null, points: 0 },
            ]
          : [],
        required: type !== 'result' && type !== 'calc',
        next_question_id: null,
        config: type === 'result'
          ? { is_result: true, result_profile: '', result_text: '', cta_text: 'Continuar', cta_url: '' }
          : type === 'calc'
          ? { formula: '', result_var: 'calc_resultado' }
          : {},
      } as NodeData,
    }
    setNodes(nds => [...nds, newNode])
    setSelectedNodeId(id)
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return
    setNodes(nds => nds.filter(n => n.id !== selectedNodeId))
    setEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId))
    setSelectedNodeId(null)
  }

  async function handleSave() {
    setSaveStatus('saving')
    startTransition(async () => {
      const questions = flowToQuestions(nodes, edges)
      const result = await saveQuizQuestions(page.id, questions)
      setSaveStatus(result.success ? 'saved' : 'error')
      setTimeout(() => setSaveStatus('idle'), 2500)
    })
  }

  async function handlePublish() {
    setSaveStatus('saving')
    startTransition(async () => {
      const questions = flowToQuestions(nodes, edges)
      const saveResult = await saveQuizQuestions(page.id, questions)
      if (!saveResult.success) { setSaveStatus('error'); return }
      const pubResult = await publishQuizPage(page.id)
      setSaveStatus(pubResult.success ? 'saved' : 'error')
      setTimeout(() => { setSaveStatus('idle'); router.refresh() }, 1500)
    })
  }

  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? '✓ Salvo!' : saveStatus === 'error' ? 'Erro' : 'Salvar'

  return (
    <div style={{ height: '100vh' }} className="flex flex-col bg-gray-50">
      {/* Top bar */}
      <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0">
        <button onClick={() => router.push('/pages')} className="text-gray-500 hover:text-gray-700 shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-gray-900 truncate flex-1 min-w-0">{page.title}</h1>

        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setMode('canvas')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${mode === 'canvas' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            🗺️ Canvas
          </button>
          <button
            onClick={() => setMode('linear')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${mode === 'linear' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
          >
            📋 Lista
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedNodeId && (
            <button onClick={deleteSelectedNode}
              className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition">
              Excluir
            </button>
          )}
          {page.published && page.slug && (
            <a href={`/pg/${page.slug}`} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
              Visualizar ↗
            </a>
          )}
          <button onClick={handleSave} disabled={saveStatus === 'saving'}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              saveStatus === 'saved' ? 'bg-emerald-100 text-emerald-700' :
              saveStatus === 'error' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}>
            {saveLabel}
          </button>
          <button onClick={handlePublish} disabled={saveStatus === 'saving'}
            className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
            {page.published ? 'Republicar' : 'Publicar'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left palette */}
        <div className="w-44 bg-white border-r border-gray-200 overflow-y-auto shrink-0">
          <div className="px-3 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Adicionar</p>
            <div className="space-y-0.5">
              {(Object.entries(QUESTION_TYPE_META) as [QuestionType, typeof QUESTION_TYPE_META[QuestionType]][]).map(([type, meta]) => (
                <button key={type} onClick={() => addNode(type)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition text-left">
                  <span className="text-base w-5 text-center shrink-0">{meta.icon}</span>
                  <span className="truncate">{meta.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {mode === 'canvas' ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              nodeTypes={nodeTypes}
              fitView
              deleteKeyCode="Delete"
            >
              <Background gap={20} color="#e5e7eb" />
              <Controls />
              <MiniMap nodeColor={() => '#6366f1'} maskColor="rgba(0,0,0,0.05)" />
            </ReactFlow>
          ) : (
            <LinearEditor
              nodes={nodes}
              setNodes={setNodes}
              edges={edges}
              setEdges={setEdges}
              funnels={funnels}
              onSelectNode={setSelectedNodeId}
              selectedNodeId={selectedNodeId}
            />
          )}
        </div>

        {/* Right panel */}
        {selectedNodeId && (
          <RightPanel
            nodeId={selectedNodeId}
            nodes={nodes}
            setNodes={setNodes}
            edges={edges}
            funnels={funnels}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  )
}
