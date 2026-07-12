'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bot } from 'lucide-react'
import type { AgentWithStats, Agent } from '@/app/actions/ai-agents'
import { activateAgent, pauseAgent, deleteAgent, getAgent } from '@/app/actions/ai-agents'
import AgentWizard from '@/components/agents/agent-wizard'

interface Props {
  agents: AgentWithStats[]
  funnels: { id: string; name: string }[]
  instances: { id: string; instance_name: string; status: string }[]
  isScale: boolean
}

const OBJECTIVE_LABELS: Record<string, string> = {
  qualify: 'Qualificar', route_to_funnel: 'Rotear', sell_direct: 'Vender',
}
const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', active: 'Ativo', paused: 'Pausado',
}
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
}

interface TestDriveResult {
  transcripts: { label: string; exchanges: { lead: string; agent: string }[] }[]
  evaluation?: {
    scores?: Record<string, number>
    nota_geral?: number
    veredito?: string
    melhorias?: string[]
  }
}
const SCORE_LABELS: Record<string, string> = {
  humanizacao: 'Humanização', conducao: 'Condução', objecoes: 'Objeções', clareza: 'Clareza',
}

export default function AgentsClient({ agents, funnels, instances, isScale }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editAgent, setEditAgent] = useState<Agent | null>(null)
  const [editDocs, setEditDocs] = useState<{ id: string; file_name: string; uploaded_at: string }[]>([])
  const [testAgentId, setTestAgentId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [testDrive, setTestDrive] = useState<{ agentId: string; name: string; loading: boolean; result?: TestDriveResult; error?: string; applying?: boolean; applied?: string[]; applyError?: string } | null>(null)

  async function applyFixes() {
    if (!testDrive?.result?.evaluation?.melhorias?.length) return
    setTestDrive(td => td ? { ...td, applying: true, applyError: undefined } : td)
    try {
      const res = await fetch(`/api/agents/${testDrive.agentId}/testdrive/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          melhorias: testDrive.result.evaluation.melhorias,
          transcripts: testDrive.result.transcripts,
        }),
      })
      const data = await res.json() as { applied?: string[]; error?: string }
      setTestDrive(td => td ? { ...td, applying: false, applied: data.applied, applyError: data.error } : td)
    } catch (err) {
      setTestDrive(td => td ? { ...td, applying: false, applyError: String(err) } : td)
    }
  }

  async function runTestDrive(agentId: string, name: string) {
    setTestDrive({ agentId, name, loading: true })
    try {
      const res = await fetch(`/api/agents/${agentId}/testdrive`, { method: 'POST' })
      const data = await res.json()
      if (data.error) setTestDrive({ agentId, name, loading: false, error: String(data.error) })
      else setTestDrive({ agentId, name, loading: false, result: data as TestDriveResult })
    } catch (err) {
      setTestDrive({ agentId, name, loading: false, error: String(err) })
    }
  }

  function refresh() { startTransition(() => router.refresh()) }

  async function openEdit(agentId: string) {
    const { agent, documents } = await getAgent(agentId)
    if (agent) { setEditAgent(agent); setEditDocs(documents ?? []); setWizardOpen(true) }
  }

  async function toggleStatus(a: AgentWithStats) {
    if (a.status === 'active') await pauseAgent(a.id)
    else await activateAgent(a.id)
    refresh()
  }

  async function confirmRemove() {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteAgent(confirmDelete.id)
    setDeleting(false)
    if (!result.success) {
      setDeleteError(result.error ?? 'Erro desconhecido')
      return
    }
    setConfirmDelete(null)
    refresh()
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agentes IA</h1>
          <p className="text-sm text-gray-500">Crie assistentes de vendas treináveis para seus funis e WhatsApp.</p>
        </div>
        {isScale && (
          <button
            onClick={() => { setEditAgent(null); setEditDocs([]); setWizardOpen(true) }}
            className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5"
          >
            + Criar Agente
          </button>
        )}
      </div>

      {!isScale ? (
        <div className="relative border rounded-2xl overflow-hidden">
          <div className="filter blur-sm pointer-events-none select-none p-8 grid grid-cols-3 gap-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="border rounded-xl p-5 bg-white h-40" />
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/60">
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-600 text-white">Scale</span>
            <p className="text-gray-700 font-medium text-center max-w-sm">
              O módulo de Agentes IA é exclusivo do plano Scale.
            </p>
            <Link href="/settings" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
              Fazer upgrade
            </Link>
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center text-gray-500">
          <Bot className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Nenhum agente ainda</p>
          <p className="text-sm">Clique em &quot;Criar Agente&quot; para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {agents.map(agent => {
            const avatar = (agent.landing_config as Record<string, unknown> | null | undefined)?.avatar_url as string | undefined
            const channels = (agent as AgentWithStats & { channels?: string[] }).channels ?? ['whatsapp', 'web']
            return (
              <div key={agent.id} className="group rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col">
                {/* Faixa superior com gradiente */}
                <div className="h-14 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 relative">
                  <span className={`absolute top-3 right-3 text-[11px] font-medium px-2.5 py-1 rounded-full backdrop-blur bg-white/90 ${
                    agent.status === 'active' ? 'text-emerald-600' : agent.status === 'paused' ? 'text-amber-600' : 'text-gray-500'
                  }`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                      agent.status === 'active' ? 'bg-emerald-500' : agent.status === 'paused' ? 'bg-amber-500' : 'bg-gray-400'
                    }`} />
                    {STATUS_LABELS[agent.status]}
                  </span>
                </div>
                <div className="px-5 pb-5 flex flex-col gap-3 flex-1">
                  {/* Só o avatar sobrepõe a faixa; nome fica abaixo (a faixa tampava o texto) */}
                  <div className="-mt-7">
                    {avatar
                      ? <img src={avatar} alt="" className="w-14 h-14 rounded-2xl object-cover ring-4 ring-white shadow-md" />
                      : <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 ring-4 ring-white shadow-md flex items-center justify-center">
                          <Bot className="w-7 h-7 text-white" />
                        </div>}
                  </div>
                  <div className="min-w-0 -mt-1">
                    <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
                    <p className="text-xs text-gray-400">
                      {OBJECTIVE_LABELS[agent.objective ?? 'qualify']} · {channels.includes('whatsapp') && channels.includes('web') ? 'WhatsApp + Web' : channels.includes('web') ? 'Chat Web' : 'WhatsApp'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-lg font-bold text-gray-900 leading-tight">{agent.total_conversations}</p>
                      <p className="text-[11px] text-gray-500">conversas</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-lg font-bold text-gray-900 leading-tight">{agent.rate}%</p>
                      <p className="text-[11px] text-gray-500">{agent.rate_label}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    <button onClick={() => openEdit(agent.id)} className="px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-xl hover:bg-gray-700 transition-colors">✏️ Editar</button>
                    <button onClick={() => setTestAgentId(agent.id)} className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">💬 Testar</button>
                    <Link href={`/agents/${agent.id}/conversations`} className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 text-center transition-colors">🗂 Conversas</Link>
                    <Link href={`/agents/${agent.id}/meetings`} className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 text-center transition-colors">📅 Reuniões</Link>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-gray-50">
                    <button onClick={() => toggleStatus(agent)} className={`text-xs font-medium ${agent.status === 'active' ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'}`}>
                      {agent.status === 'active' ? '⏸ Pausar' : '▶ Ativar'}
                    </button>
                    <button onClick={() => runTestDrive(agent.id, agent.name)} className="text-xs font-medium text-violet-600 hover:text-violet-700">
                      🧪 Test drive
                    </button>
                    <button onClick={() => setConfirmDelete({ id: agent.id, name: agent.name })} className="text-xs text-gray-300 hover:text-red-500 transition-colors">
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {wizardOpen && (
        <AgentWizard
          agent={editAgent}
          documents={editDocs}
          funnels={funnels}
          instances={instances}
          onClose={() => setWizardOpen(false)}
          onSaved={refresh}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Excluir agente</h2>
            <p className="text-sm text-gray-600 mb-1">
              Tem certeza que deseja excluir o agente <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="text-sm text-red-600 mb-4">Esta ação não pode ser desfeita.</p>
            {deleteError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                Erro: {deleteError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmDelete(null); setDeleteError(null) }}
                disabled={deleting}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmRemove}
                disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {testDrive && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !testDrive.loading && setTestDrive(null)}>
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">🧪 Test drive — {testDrive.name}</h2>
              {!testDrive.loading && <button onClick={() => setTestDrive(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>}
            </div>

            {testDrive.loading && (
              <div className="py-10 text-center">
                <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm font-medium text-gray-700">Simulando 3 leads difíceis contra o agente…</p>
                <p className="text-xs text-gray-400 mt-1">lead frio · lead com objeção · lead apressado (~30s)</p>
              </div>
            )}

            {testDrive.error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{testDrive.error}</div>
            )}

            {testDrive.result && (
              <div className="flex flex-col gap-4">
                {testDrive.result.evaluation?.nota_geral != null && (
                  <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 p-4">
                    <div className={`text-3xl font-extrabold ${(testDrive.result.evaluation.nota_geral ?? 0) >= 7 ? 'text-emerald-600' : (testDrive.result.evaluation.nota_geral ?? 0) >= 5 ? 'text-amber-600' : 'text-red-600'}`}>
                      {testDrive.result.evaluation.nota_geral}/10
                    </div>
                    <p className="text-sm text-gray-700">{testDrive.result.evaluation.veredito}</p>
                  </div>
                )}
                {testDrive.result.evaluation?.scores && (
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(testDrive.result.evaluation.scores).map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">{SCORE_LABELS[k] ?? k}</span>
                          <span className="text-sm font-bold text-gray-900">{v}/10</span>
                        </div>
                        <div className="h-1.5 mt-1 rounded-full bg-gray-200 overflow-hidden">
                          <div className={`h-full rounded-full ${v >= 7 ? 'bg-emerald-500' : v >= 5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${v * 10}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(testDrive.result.evaluation?.melhorias?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-gray-800 mb-1.5">O que melhorar:</p>
                    <ul className="flex flex-col gap-1.5">
                      {testDrive.result.evaluation!.melhorias!.map((m, i) => (
                        <li key={i} className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">💡 {m}</li>
                      ))}
                    </ul>

                    {/* Aplicar correções com 1 clique — viram "correções aprendidas" (prioridade máx, removíveis) */}
                    {!testDrive.applied ? (
                      <div className="mt-3">
                        <button onClick={applyFixes} disabled={testDrive.applying}
                          className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:opacity-90 disabled:opacity-60 shadow-md shadow-emerald-100 transition-all">
                          {testDrive.applying ? '✨ Aplicando correções…' : '✨ Aplicar correções automaticamente'}
                        </button>
                        <p className="text-[11px] text-gray-400 mt-1.5 text-center">
                          As melhorias viram regras que o agente segue com prioridade máxima. Elas ficam nos documentos do agente e você pode remover quando quiser.
                        </p>
                        {testDrive.applyError && <p className="text-xs text-red-600 mt-1 text-center">{testDrive.applyError}</p>}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                        <p className="text-sm font-semibold text-emerald-800 mb-1.5">✅ Correções aplicadas — o agente já segue estas regras:</p>
                        <ul className="flex flex-col gap-1">
                          {testDrive.applied.map((r, i) => (
                            <li key={i} className="text-xs text-emerald-700">✓ {r}</li>
                          ))}
                        </ul>
                        <p className="text-[11px] text-emerald-600/70 mt-2">Rode o test drive de novo para ver a evolução da nota.</p>
                      </div>
                    )}
                  </div>
                )}
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer font-medium text-gray-600">Ver as conversas simuladas</summary>
                  <div className="mt-2 flex flex-col gap-3">
                    {testDrive.result.transcripts.map((t, i) => (
                      <div key={i} className="rounded-xl border border-gray-100 p-3">
                        <p className="font-semibold text-gray-700 mb-1">{t.label}</p>
                        {t.exchanges.map((e, j) => (
                          <div key={j} className="mb-1.5">
                            <p><span className="text-indigo-600 font-medium">Lead:</span> {e.lead}</p>
                            <p><span className="text-gray-700 font-medium">Agente:</span> {e.agent}</p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
                <button onClick={() => runTestDrive(testDrive.agentId, testDrive.name)} className="text-xs text-indigo-600 hover:underline self-start">
                  🔁 Rodar de novo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {testAgentId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setTestAgentId(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Testar agente</h2>
              <button onClick={() => setTestAgentId(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <TestChatLazy agentId={testAgentId} />
          </div>
        </div>
      )}
    </div>
  )
}

import AgentTestChat from '@/components/agents/agent-test-chat'
function TestChatLazy({ agentId }: { agentId: string }) {
  return <AgentTestChat agentId={agentId} />
}
