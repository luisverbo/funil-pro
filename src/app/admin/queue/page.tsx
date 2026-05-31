'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Clock, CheckCircle, XCircle, Loader2, RefreshCw, Play } from 'lucide-react'

interface QueueJob {
  id: string
  tenant_id: string | null
  lead_id: string | null
  funnel_id: string | null
  block_id: string | null
  status: string
  scheduled_for: string
  attempts: number
  error: string | null
  created_at: string
  leads?: { name: string | null } | null
  funnel_blocks?: { block_type: string; label: string | null } | null
}

interface Stats {
  pending: number
  done_today: number
  failed: number
}

function statusBadge(status: string) {
  if (status === 'pending') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">pendente</span>
  if (status === 'processing') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">processando</span>
  if (status === 'done') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">concluído</span>
  if (status === 'failed') return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">falhou</span>
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{status}</span>
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AdminQueuePage() {
  const [jobs, setJobs] = useState<QueueJob[]>([])
  const [stats, setStats] = useState<Stats>({ pending: 0, done_today: 0, failed: 0 })
  const [loading, setLoading] = useState(true)
  const [processing, startProcess] = useTransition()
  const [retrying, startRetry] = useTransition()
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [{ data: jobsData }, { count: pending }, { count: failed }, { count: done_today }] = await Promise.all([
      supabase.from('queue_jobs').select('*, leads(name), funnel_blocks(block_type, label)').order('created_at', { ascending: false }).limit(50),
      supabase.from('queue_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('queue_jobs').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase.from('queue_jobs').select('*', { count: 'exact', head: true }).eq('status', 'done').gte('created_at', todayStart.toISOString()),
    ])

    setJobs((jobsData ?? []) as QueueJob[])
    setStats({ pending: pending ?? 0, failed: failed ?? 0, done_today: done_today ?? 0 })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function processNow() {
    startProcess(async () => {
      setMessage('')
      const res = await fetch('/api/queue/process', { method: 'POST' })
      const data = await res.json()
      setMessage(`Processados: ${data.processed ?? 0}, Falhas: ${data.failed ?? 0}`)
      await load()
    })
  }

  function retryFailed() {
    startRetry(async () => {
      setMessage('')
      const supabase = createClient()
      await supabase.from('queue_jobs').update({ status: 'pending', error: null }).eq('status', 'failed')
      setMessage('Jobs falhos resetados para pendente.')
      await load()
    })
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fila de Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor e controle da fila Supabase</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={retryFailed}
            disabled={retrying || stats.failed === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reprocessar falhos ({stats.failed})
          </button>
          <button
            onClick={processNow}
            disabled={processing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Processar agora
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-indigo-50 text-indigo-700 text-sm font-medium">{message}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
            <Clock className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
            <p className="text-xs text-gray-500 mt-0.5">Pendentes</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.done_today}</p>
            <p className="text-xs text-gray-500 mt-0.5">Concluídos hoje</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.failed}</p>
            <p className="text-xs text-gray-500 mt-0.5">Com falha</p>
          </div>
        </div>
      </div>

      {/* Jobs table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Últimos 50 jobs</h2>
          <button onClick={load} className="text-xs text-indigo-600 hover:underline">Atualizar</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">Nenhum job na fila.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bloco</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Agendado para</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tentativas</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">{statusBadge(job.status)}</td>
                    <td className="px-5 py-3 text-gray-700">{job.leads?.name ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-3">
                      {job.funnel_blocks ? (
                        <span className="text-gray-700">
                          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1">{job.funnel_blocks.block_type}</span>
                          {job.funnel_blocks.label && <span className="text-gray-500">{job.funnel_blocks.label}</span>}
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(job.scheduled_for)}</td>
                    <td className="px-5 py-3 text-gray-500">{job.attempts}</td>
                    <td className="px-5 py-3 text-red-600 text-xs max-w-xs truncate">{job.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
