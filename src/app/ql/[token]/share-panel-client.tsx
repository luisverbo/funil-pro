'use client'

// ============================================================================
// Painel compartilhado de leads — a tela que o CLIENTE do dono do quiz vê
// ----------------------------------------------------------------------------
// Quem abre isto não conhece o FunilPro: recebeu um link e uma senha. Por
// isso a tela é autoexplicativa, sem jargão do sistema, e só mostra UM quiz.
//
// A senha fica apenas na memória do componente e é reenviada a cada consulta;
// nada dela vai para URL, localStorage ou cookie — fechar a aba desloga.
// ============================================================================

import { useMemo, useState } from 'react'
import type { ExportTable, QuizMetricas } from '@/lib/quiz/leads-core'
import { abrirPdf, baixarCsv } from '@/components/quiz/export-files'

interface Painel {
  titulo: string
  metricas: QuizMetricas
  paginas: { id: string; titulo: string }[]
  tabela: ExportTable | null
}

type Publico = 'todos' | 'concluidos' | 'com_resposta'

const PUBLICOS: { valor: Publico; rotulo: string; dica: string }[] = [
  { valor: 'todos', rotulo: 'Todos', dica: 'inclui quem só abriu' },
  { valor: 'com_resposta', rotulo: 'Responderam algo', dica: 'ao menos uma resposta' },
  { valor: 'concluidos', rotulo: 'Concluíram', dica: 'chegaram ao fim' },
]

export default function SharePanelClient({ token }: { token: string }) {
  const [senha, setSenha] = useState('')
  const [senhaOk, setSenhaOk] = useState<string | null>(null)  // senha aceita, mantida em memória
  const [painel, setPainel] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [publico, setPublico] = useState<Publico>('todos')

  const consultar = async (senhaUsada: string, publicoUsado: Publico) => {
    setCarregando(true)
    setErro(null)
    try {
      const resp = await fetch(`/api/quiz-share/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: senhaUsada, publico: publicoUsado }),
      })
      const dados = await resp.json()
      if (!resp.ok) {
        setErro(dados?.error ?? 'Não foi possível abrir o painel')
        if (resp.status === 401) { setSenhaOk(null); setPainel(null) }
        return
      }
      setSenhaOk(senhaUsada)
      setPainel(dados as Painel)
    } catch {
      setErro('Falha de conexão. Tente de novo.')
    } finally {
      setCarregando(false)
    }
  }

  const trocarPublico = (p: Publico) => {
    setPublico(p)
    if (senhaOk) void consultar(senhaOk, p)
  }

  const m = painel?.metricas
  const t = painel?.tabela

  // Prévia limitada: a tabela completa vai no arquivo — na tela, rolagem
  // infinita sem paginação só travaria o navegador do cliente.
  const previa = useMemo(() => (t ? t.linhas.slice(0, 100) : []), [t])

  if (!painel) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-4">
        <form
          onSubmit={e => { e.preventDefault(); void consultar(senha, publico) }}
          className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl"
        >
          <div className="mb-1 text-3xl">🔐</div>
          <h1 className="text-xl font-bold text-gray-900">Painel de leads</h1>
          <p className="mt-1 text-sm text-gray-500">
            Digite a senha que você recebeu para ver e baixar os leads deste quiz.
          </p>
          <input
            type="password"
            value={senha}
            onChange={e => setSenha(e.target.value)}
            placeholder="Senha"
            autoFocus
            className="mt-5 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
          <button
            type="submit"
            disabled={carregando || senha.trim().length === 0}
            className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {carregando ? 'Abrindo…' : 'Entrar'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Cabeçalho */}
      <header className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-4 py-8 text-white">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-medium uppercase tracking-widest text-indigo-100">Painel de leads</p>
          <h1 className="mt-1 text-2xl font-bold">{painel.titulo}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Métricas */}
        {m && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { r: 'Leads', v: m.total, n: `${m.hoje} hoje` },
              { r: 'Concluíram', v: m.completed, n: `${m.completionRate}% de conclusão` },
              { r: 'Com contato', v: m.comContato, n: 'e-mail ou telefone' },
              { r: 'Últimos 7 dias', v: m.ultimos7d, n: null },
              { r: 'Em andamento', v: m.inProgress, n: null },
            ].map(c => (
              <div key={c.r} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.r}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{c.v}</p>
                {c.n && <p className="mt-0.5 text-xs text-slate-400">{c.n}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Funil por página */}
        {m && m.funil.length > 1 && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Onde as pessoas param</h2>
            <div className="mt-3 space-y-2">
              {m.funil.map(e => (
                <div key={e.pageId} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs text-slate-600" title={e.titulo}>{e.titulo}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                      style={{ width: `${Math.max(e.pct, e.leads > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-xs tabular-nums text-slate-600">
                    {e.leads} · {e.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filtro + downloads */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {PUBLICOS.map(p => (
              <button
                key={p.valor}
                onClick={() => trocarPublico(p.valor)}
                title={p.dica}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  publico === p.valor ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { if (t) baixarCsv(t, `leads-${painel.titulo.slice(0, 20)}`) }}
              disabled={!t || t.linhas.length === 0}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              ⬇ Baixar CSV
            </button>
            <button
              onClick={() => { if (t) { const b = abrirPdf(t); if (b) setErro(b) } }}
              disabled={!t || t.linhas.length === 0}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              📄 PDF
            </button>
          </div>
        </div>

        {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}

        {/* Tabela */}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {carregando ? (
            <div className="p-10 text-center text-sm text-slate-500">Carregando…</div>
          ) : !t || t.linhas.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Nenhum lead neste filtro ainda.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>{t.colunas.map(c => <th key={c.chave} className="whitespace-nowrap px-4 py-3">{c.rotulo}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previa.map((l, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {l.map((v, j) => <td key={j} className="max-w-[240px] truncate px-4 py-2.5 text-slate-700" title={v}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {t && t.linhas.length > previa.length && (
          <p className="mt-2 text-xs text-slate-400">
            Mostrando {previa.length} de {t.linhas.length} — o arquivo baixado vem completo.
          </p>
        )}

        <p className="mt-8 pb-6 text-center text-xs text-slate-400">
          Painel gerado com FunilPro
        </p>
      </main>
    </div>
  )
}
