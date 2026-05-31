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
  lead_name?: string | null
  block_type?: string | null
  block_label?: string | null
}

interface Stats {
  pending: number
  done_today: number
  failed: number
}

interface ProcessResult {
  processed: number
  failed: number
  details?: Array<{ id: string; block_type?: string; status: string; error?: string }>
  error?: string
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
  const [lastResult, setLastResult] = useState<ProcessResult | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 100))
  }

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Fetch jobs without FK join (no FK constraints on table)
    const { data: rawJobs, error: jobsError } = await supabase
      .from('queue_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (jobsError) {
      addLog(`Erro ao buscar jobs: ${jobsError.message}`)
    }

    // Enrich with lead names and block info
    const enriched: QueueJob[] = []
    for (const job of rawJobs ?? []) {
      let lead_name: string | null = null
      let block_type: string | null = null
      let block_label: string | null = null

      if (job.lead_id) {
        const { data: lead } = await supabase.from('leads').select('name').eq('id', job.lead_id).single()
        lead_name = lead?.name ?? null
      }
      if (job.block_id) {
        const { data: block } = await supabase.from('funnel_blocks').select('block_type, label').eq('id', job.block_id).single()
        block_type = block?.block_type ?? null
        block_label = block?.label ?? null
      }
      enriched.push({ ...job, lead_name, block_type, block_label })
    }

    setJobs(enriched)

    const [{ count: pending }, { count: failed }, { count: done_today }] = await Promise.all([
      supabase.from('queue_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('queue_jobs').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
      supabase.from('queue_jobs').select('*', { count: 'exact', head: true }).eq('status', 'done').gte('created_at', todayStart.toISOString()),
    ])

    setStats({ pending: pending ?? 0, failed: failed ?? 0, done_today: done_today ?? 0 })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function processNow() {
    startProcess(async () => {
      addLog('Chamando /api/queue/process...')
      try {
        const res = await fetch('/api/queue/process', { method: 'POST' })
        const data: ProcessResult = await res.json()
        setLastResult(data)
        if (data.error) {
          addLog(`Erro: ${data.error}`)
        } else {
          addLog(`Processados: ${data.processed}, Falhas: ${data.failed}`)
          if (data.details) {
            data.details.forEach((d) => {
              addLog(`  Job ${d.id.slice(0, 8)} [${d.block_type ?? '?'}] → ${d.status}${d.error ? ': ' + d.error : ''}`)
            })
          }
        }
      } catch (e) {
        addLog(`Erro de rede: ${e}`)
      }
      await load()
    })
  }

  function retryFailed() {
    startRetry(async () => {
      addLog('Resetando jobs com falha para pendente...')
      const supabase = createClient()
      const { error } = await supabase.from('queue_jobs').update({ status: 'pending', error: null, attempts: 0 }).eq('status', 'failed')
      if (error) addLog(`Erro: ${error.message}`)
      else addLog('Jobs resetados.')
      await load()
    })
  }

  async function retrySingle(jobId: string) {
    const supabase = createClient()
    await supabase.from('queue_jobs').update({ status: 'pending', error: null, attempts: 0 }).eq('id', jobId)
    addLog(`Job ${jobId.slice(0, 8)} resetado para pendente.`)
    await load()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fila de Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor e controle do motor de execução</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
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

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
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

      {/* Last result */}
      {lastResult && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${lastResult.error ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700'}`}>
          {lastResult.error
            ? `❌ Erro: ${lastResult.error}`
            : `✅ Processados: ${lastResult.processed} | Falhas: ${lastResult.failed}`
          }
        </div>
      )}

      {/* Jobs table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Últimos 50 jobs</h2>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bloco</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Agendado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Erros</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{job.id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{statusBadge(job.status)}</td>
                    <td className="px-4 py-3 text-gray-700">{job.lead_name ?? <span className="text-gray-400 text-xs font-mono">{job.lead_id?.slice(0, 8)}</span>}</td>
                    <td className="px-4 py-3">
                      {job.block_type ? (
                        <span>
                          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1">{job.block_type}</span>
                          {job.block_label && <span className="text-gray-500 text-xs">{job.block_label}</span>}
                        </span>
                      ) : <span className="text-gray-400 text-xs font-mono">{job.block_id?.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(job.scheduled_for)}</td>
                    <td className="px-4 py-3">
                      {job.error ? (
                        <span className="text-red-600 text-xs" title={job.error}>{job.error.slice(0, 60)}{job.error.length > 60 ? '…' : ''}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(job.status === 'failed' || job.status === 'pending') && (
                        <button
                          onClick={() => retrySingle(job.id)}
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          Reprocessar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Logs */}
      <div className="bg-gray-900 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-300 text-sm">Log de execução</h2>
          <button onClick={() => setLogs([])} className="text-xs text-gray-500 hover:text-gray-300">Limpar</button>
        </div>
        {logs.length === 0 ? (
          <p className="text-gray-600 text-xs">Clique em &quot;Processar agora&quot; para ver os logs.</p>
        ) : (
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {logs.map((log, i) => (
              <p key={i} className="text-xs font-mono text-gray-400">{log}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
