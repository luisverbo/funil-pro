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
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => (
            <div key={agent.id} className="border rounded-xl p-5 bg-white flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold">{agent.name}</h3>
                  <span className="text-xs text-gray-500">{agent.mode === 'standalone' ? 'Standalone' : 'Bloco de funil'}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{OBJECTIVE_LABELS[agent.objective ?? 'qualify']}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLS[agent.status]}`}>{STATUS_LABELS[agent.status]}</span>
              </div>
              <div className="text-sm text-gray-600">
                {agent.total_conversations} conversas · {agent.rate}% {agent.rate_label}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => openEdit(agent.id)} className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700">Editar</button>
                <button onClick={() => setTestAgentId(agent.id)} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Testar</button>
                <Link href={`/agents/${agent.id}/conversations`} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Conversas</Link>
                <Link href={`/agents/${agent.id}/meetings`} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">📅 Reuniões</Link>
                <button onClick={() => toggleStatus(agent)} className={`px-3 py-1.5 text-sm rounded-lg ${agent.status === 'active' ? 'border hover:bg-gray-50' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                  {agent.status === 'active' ? 'Pausar' : 'Ativar'}
                </button>
                <button onClick={() => setConfirmDelete({ id: agent.id, name: agent.name })} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100">Excluir</button>
              </div>
            </div>
          ))}
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
