'use client'

import React, { useState, useCallback, useRef, useLayoutEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import '@xyflow/react/dist/style.css'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type NodeProps,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import { saveQuizQuestions, publishQuizPage, type QuizQuestion, type QuizOption } from '@/app/actions/quiz'

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
  single_choice:  { label: 'Escolha única',   icon: '🔘', color: 'indigo',  hasOptions: true  },
  multi_choice:   { label: 'Múltipla escolha', icon: '☑️',  color: 'purple',  hasOptions: true  },
  text_short:     { label: 'Texto curto',      icon: '📝', color: 'blue',    hasOptions: false },
  text_long:      { label: 'Texto longo',      icon: '📜', color: 'blue',    hasOptions: false },
  email:          { label: 'E-mail',           icon: '✉️',  color: 'teal',    hasOptions: false },
  phone:          { label: 'Telefone',         icon: '📱', color: 'teal',    hasOptions: false },
  scale:          { label: 'Escala 1-10',      icon: '📊', color: 'amber',   hasOptions: false },
  final_capture:  { label: 'Captura final',    icon: '🏆', color: 'emerald', hasOptions: false },
  result:         { label: 'Resultado',        icon: '🎉', color: 'green',   hasOptions: false },
}

const COLOR_MAP: Record<string, { border: string; badge: string; header: string }> = {
  indigo:  { border: '#6366f1', badge: 'bg-indigo-100 text-indigo-700',  header: 'bg-indigo-50'  },
  purple:  { border: '#a855f7', badge: 'bg-purple-100 text-purple-700',  header: 'bg-purple-50'  },
  blue:    { border: '#3b82f6', badge: 'bg-blue-100 text-blue-700',      header: 'bg-blue-50'    },
  teal:    { border: '#14b8a6', badge: 'bg-teal-100 text-teal-700',      header: 'bg-teal-50'    },
  amber:   { border: '#f59e0b', badge: 'bg-amber-100 text-amber-700',    header: 'bg-amber-50'   },
  emerald: { border: '#10b981', badge: 'bg-emerald-100 text-emerald-700',header: 'bg-emerald-50' },
  green:   { border: '#22c55e', badge: 'bg-green-100 text-green-700',    header: 'bg-green-50'   },
}

function QuestionNode({ id, data, selected }: NodeProps) {
  const nd = data as NodeData
  const meta = QUESTION_TYPE_META[nd.question_type] ?? QUESTION_TYPE_META.single_choice
  const colors = COLOR_MAP[meta.color] ?? COLOR_MAP.indigo
  const isChoice = meta.hasOptions
  const isResult = nd.question_type === 'result'

  const containerRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const [handleTops, setHandleTops] = useState<number[]>([])

  // Run after mount and when option count changes to position handles
  useLayoutEffect(() => {
    if (!containerRef.current || !isChoice) return
    const containerTop = containerRef.current.getBoundingClientRect().top
    const tops = optionRefs.current.map(el => {
      if (!el) return 0
      const r = el.getBoundingClientRect()
      return r.top - containerTop + r.height / 2
    })
    // Only update state if values actually changed to avoid infinite loop
    setHandleTops(prev => {
      if (prev.length === tops.length && prev.every((v, i) => Math.abs(v - tops[i]) < 0.5)) return prev
      return tops
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChoice, nd.options.length])

  return (
    <div
      ref={containerRef}
      style={{ borderColor: selected ? colors.border : '#e5e7eb', width: 260 }}
      className="bg-white rounded-xl border-2 shadow-md overflow-hidden select-none"
    >
      {!isResult && (
        <Handle type="target" position={Position.Left} id="in"
          style={{ background: colors.border, border: '2px solid white', width: 10, height: 10 }}
        />
      )}

      <div className={`px-3 py-2 flex items-center gap-2 ${colors.header}`}>
        <span className="text-base">{meta.icon}</span>
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${colors.badge}`}>{meta.label}</span>
        {nd.required && <span className="ml-auto text-[10px] text-gray-400">obrigatória</span>}
      </div>

      <div className="px-3 py-2.5 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
          {nd.question_text || <span className="text-gray-400 italic">Pergunta sem texto</span>}
        </p>
        {nd.subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{nd.subtitle}</p>}
      </div>

      {isChoice && nd.options.length > 0 && (
        <div className="py-1">
          {nd.options.map((opt, i) => (
            <div
              key={opt.id}
              ref={el => { optionRefs.current[i] = el }}
              className="relative flex items-center gap-2 px-3 h-9 hover:bg-gray-50"
            >
              {opt.emoji && <span className="text-sm shrink-0">{opt.emoji}</span>}
              <span className="text-xs text-gray-700 truncate flex-1">{opt.label || `Opção ${i + 1}`}</span>
              {handleTops[i] !== undefined && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`opt-${opt.id}`}
                  style={{
                    background: colors.border,
                    border: '2px solid white',
                    width: 10, height: 10,
                    position: 'absolute',
                    right: -6,
                    top: handleTops[i],
                    transform: 'translateY(-50%)',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!isChoice && !isResult && (
        <Handle
          type="source" position={Position.Right} id="out"
          style={{ background: colors.border, border: '2px solid white', width: 10, height: 10 }}
        />
      )}

      {isResult && nd.config?.result_profile && (
        <div className="px-3 py-2">
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
            Perfil: {nd.config.result_profile}
          </span>
        </div>
      )}
    </div>
  )
}

const nodeTypes = { questionNode: QuestionNode }

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
      for (const opt of (q.options ?? [])) {
        if (opt.next_question_id) {
          edges.push({
            id: `${q.id}-${opt.id}`,
            source: q.id,
            sourceHandle: `opt-${opt.id}`,
            target: opt.next_question_id,
            targetHandle: 'in',
            type: 'smoothstep',
            animated: true,
            label: opt.label ? opt.label.slice(0, 18) : undefined,
            style: { stroke: '#6366f1', strokeWidth: 1.5 },
            labelStyle: { fontSize: 10, fill: '#6b7280' },
            labelBgStyle: { fill: 'white', fillOpacity: 0.8 },
          })
        }
      }
    } else if (q.next_question_id) {
      edges.push({
        id: `${q.id}-out`,
        source: q.id,
        sourceHandle: 'out',
        target: q.next_question_id,
        targetHandle: 'in',
        type: 'smoothstep',
        animated: true,
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

function newQuestionId() { return crypto.randomUUID() }
function newOptionId()   { return crypto.randomUUID() }

const DEFAULT_QUESTIONS: Omit<QuizQuestion, 'tenant_id' | 'page_id'>[] = [
  {
    id: newQuestionId(),
    order_index: 0,
    question_type: 'single_choice',
    question_text: 'Qual é o seu principal objetivo?',
    subtitle: 'Escolha uma opção',
    options: [
      { id: newOptionId(), label: 'Opção A', emoji: '🎯', next_question_id: null },
      { id: newOptionId(), label: 'Opção B', emoji: '💪', next_question_id: null },
    ],
    required: true,
    next_question_id: null,
    config: {},
    pos_x: 80,
    pos_y: 100,
  },
  {
    id: newQuestionId(),
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

function RightPanel({
  nodeId, nodes, setNodes, funnels, onClose,
}: {
  nodeId: string
  nodes: Node[]
  setNodes: (fn: (prev: Node[]) => Node[]) => void
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
    update({ options: [...nd.options, { id: newOptionId(), label: '', emoji: '', next_question_id: null }] })
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

  const isChoice = QUESTION_TYPE_META[nd.question_type]?.hasOptions
  const isResult = nd.question_type === 'result'

  return (
    <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Editar nó</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Tipo</label>
          <select value={nd.question_type} onChange={e => update({ question_type: e.target.value as QuestionType })}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            {Object.entries(QUESTION_TYPE_META).map(([type, m]) => (
              <option key={type} value={type}>{m.icon} {m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Texto da pergunta</label>
          <textarea value={nd.question_text} onChange={e => update({ question_text: e.target.value })} rows={3}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Digite a pergunta..." />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Subtítulo (opcional)</label>
          <input value={nd.subtitle ?? ''} onChange={e => update({ subtitle: e.target.value || null })}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Ex: Escolha uma opção" />
        </div>
        {!isResult && (
          <label className="flex items-center gap-2 cursor-pointer">
            <div onClick={() => update({ required: !nd.required })}
              className={`w-9 h-5 rounded-full transition-colors ${nd.required ? 'bg-indigo-500' : 'bg-gray-200'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${nd.required ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-gray-600">Resposta obrigatória</span>
          </label>
        )}
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
                      <button onClick={() => moveOption(i, -1)} className="p-0.5 text-gray-400 hover:text-gray-600">↑</button>
                      <button onClick={() => moveOption(i, 1)}  className="p-0.5 text-gray-400 hover:text-gray-600">↓</button>
                      <button onClick={() => removeOption(opt.id)} className="p-0.5 text-red-400 hover:text-red-600">×</button>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">Conecte a saída desta opção no canvas →</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {nd.question_type === 'scale' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Mín</label>
              <input type="number" value={nd.config?.scale_min ?? 1} onChange={e => updateConfig({ scale_min: Number(e.target.value) })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Máx</label>
              <input type="number" value={nd.config?.scale_max ?? 10} onChange={e => updateConfig({ scale_max: Number(e.target.value) })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>
        )}
        {isResult && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Identificador do perfil</label>
              <input value={nd.config?.result_profile ?? ''} onChange={e => updateConfig({ result_profile: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ex: qualificado, produto-a..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Texto do resultado</label>
              <textarea value={nd.config?.result_text ?? ''} onChange={e => updateConfig({ result_text: e.target.value })} rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Baseado nas suas respostas..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Texto do botão CTA</label>
              <input value={nd.config?.cta_text ?? ''} onChange={e => updateConfig({ cta_text: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Quero acessar agora!" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">URL do CTA</label>
              <input value={nd.config?.cta_url ?? ''} onChange={e => updateConfig({ cta_url: e.target.value })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="https://..." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Ativar funil (opcional)</label>
              <select value={nd.config?.funnel_id ?? ''} onChange={e => updateConfig({ funnel_id: e.target.value || undefined })}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">Nenhum</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-2">Cor de fundo</label>
          <div className="flex gap-2">
            {['#ffffff','#f8f7ff','#f0fdf4','#fffbeb','#fdf2f8'].map(c => (
              <button key={c} onClick={() => updateConfig({ bg_color: c })}
                style={{ background: c, borderColor: nd.config?.bg_color === c ? '#6366f1' : '#e5e7eb' }}
                className="w-7 h-7 rounded-full border-2 transition" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Props {
  page: { id: string; title: string; slug: string | null; published: boolean }
  initialQuestions: QuizQuestion[]
  funnels: { id: string; name: string }[]
  tenantId: string
}

export default function QuizEditorClient({ page, initialQuestions, funnels, tenantId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const seed = initialQuestions.length > 0 ? initialQuestions : DEFAULT_QUESTIONS
  const { nodes: initNodes, edges: initEdges } = questionsToFlow(seed as QuizQuestion[])

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', animated: true, style: { stroke: '#6366f1', strokeWidth: 1.5 } }, eds))
  }, [setEdges])

  function addNode(type: QuestionType) {
    const id = newQuestionId()
    const meta = QUESTION_TYPE_META[type]
    const isChoice = meta.hasOptions
    const lastNode = nodes[nodes.length - 1]
    const x = lastNode ? lastNode.position.x + 320 : 80
    const y = lastNode ? lastNode.position.y : 100
    const newNode: Node = {
      id,
      type: 'questionNode',
      position: { x, y },
      data: {
        question_type: type,
        question_text: '',
        subtitle: null,
        options: isChoice
          ? [
              { id: newOptionId(), label: 'Opção A', emoji: '', next_question_id: null },
              { id: newOptionId(), label: 'Opção B', emoji: '', next_question_id: null },
            ]
          : [],
        required: type !== 'result',
        next_question_id: null,
        config: type === 'result' ? { is_result: true, result_profile: '', result_text: '', cta_text: 'Continuar', cta_url: '' } : {},
      } as NodeData,
    }
    setNodes(nds => [...nds, newNode])
    setSelectedNodeId(id)
  }

  async function handleSave() {
    setSaveStatus('saving')
    const questions = flowToQuestions(nodes, edges)
    const result = await saveQuizQuestions(page.id, questions)
    setSaveStatus(result.success ? 'saved' : 'error')
    setTimeout(() => setSaveStatus('idle'), 2500)
  }

  async function handlePublish() {
    setSaveStatus('saving')
    const questions = flowToQuestions(nodes, edges)
    const saveResult = await saveQuizQuestions(page.id, questions)
    if (!saveResult.success) { setSaveStatus('error'); return }
    const pubResult = await publishQuizPage(page.id)
    setSaveStatus(pubResult.success ? 'saved' : 'error')
    setTimeout(() => { setSaveStatus('idle'); router.refresh() }, 1500)
  }

  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? '✓ Salvo!' : saveStatus === 'error' ? 'Erro' : 'Salvar'

  return (
    <div style={{ height: '100vh' }} className="flex flex-col bg-gray-50">
      <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0">
        <button onClick={() => router.push('/pages')} className="text-gray-500 hover:text-gray-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1 className="text-sm font-semibold text-gray-900 truncate flex-1">{page.title}</h1>
        <span className="text-xs text-gray-400">Editor de Quiz</span>
        <div className="flex items-center gap-2">
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
        <div className="w-48 bg-white border-r border-gray-200 overflow-y-auto shrink-0">
          <div className="px-3 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Adicionar</p>
            <div className="space-y-1">
              {(Object.entries(QUESTION_TYPE_META) as [QuestionType, typeof QUESTION_TYPE_META[QuestionType]][]).map(([type, meta]) => (
                <button key={type} onClick={() => addNode(type)}
                  className="w-full flex items-center gap-2 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition text-left">
                  <span className="text-base w-5 text-center">{meta.icon}</span>
                  {meta.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 relative">
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
        </div>

        {selectedNodeId && (
          <RightPanel
            nodeId={selectedNodeId}
            nodes={nodes}
            setNodes={setNodes}
            funnels={funnels}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  )
}
