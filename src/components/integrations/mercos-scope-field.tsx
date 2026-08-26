'use client'

// ============================================================================
// Mercos — a QUAL funil esta conta do ERP pertence
// ----------------------------------------------------------------------------
// Sem recorte, uma venda do Mercos procura o telefone em TODOS os funis e
// agentes da conta: a venda de um cliente fecharia o lead de outro funil onde
// a mesma pessoa apareceu. Aqui o dono marca os funis/agentes daquela conta
// do Mercos e recebe a URL já recortada para colar lá.
//
// Cada cliente com Mercos próprio recebe a SUA URL — as contas nunca se
// cruzam, e não é preciso guardar configuração nenhuma no banco.
// ============================================================================

import { useEffect, useState } from 'react'
import { listarQuizzesDoTenant, listarAgentesDoTenant } from '@/lib/quiz/painel-client'

export default function MercosScopeField({ webhookUrl }: { webhookUrl: string }) {
  const [quizzes, setQuizzes] = useState<{ id: string; titulo: string }[]>([])
  const [agentes, setAgentes] = useState<{ id: string; titulo: string }[]>([])
  const [marcadosQuiz, setMarcadosQuiz] = useState<string[]>([])
  const [marcadosAgente, setMarcadosAgente] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [q, a] = await Promise.all([listarQuizzesDoTenant(), listarAgentesDoTenant()])
        if (Array.isArray(q)) setQuizzes(q)
        if (Array.isArray(a)) setAgentes(a)
      } catch { /* lista vazia: a URL sem recorte continua valendo */ }
      finally { setCarregando(false) }
    })()
  }, [])

  const alternar = (lista: string[], set: (v: string[]) => void, id: string) =>
    set(lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id])

  const params = new URLSearchParams()
  if (marcadosQuiz.length > 0) params.set('quiz', marcadosQuiz.join(','))
  if (marcadosAgente.length > 0) params.set('agente', marcadosAgente.join(','))
  const urlFinal = params.toString() ? `${webhookUrl}?${params}` : webhookUrl
  const temRecorte = marcadosQuiz.length + marcadosAgente.length > 0

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-700">De qual funil é esta conta do Mercos?</p>
      <p className="mt-0.5 text-[11px] text-gray-400">
        Marque só o funil (ou agente) deste cliente. Sem marcar nada, a venda é
        procurada em TODOS os seus funis — e pode fechar o lead errado.
      </p>

      {carregando ? (
        <p className="mt-2 text-xs text-gray-400">Carregando seus funis…</p>
      ) : (
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
          {quizzes.map(q => (
            <label key={q.id} className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={marcadosQuiz.includes(q.id)}
                onChange={() => alternar(marcadosQuiz, setMarcadosQuiz, q.id)} />
              🧠 {q.titulo}
            </label>
          ))}
          {agentes.map(a => (
            <label key={a.id} className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={marcadosAgente.includes(a.id)}
                onChange={() => alternar(marcadosAgente, setMarcadosAgente, a.id)} />
              🤖 {a.titulo}
            </label>
          ))}
          {quizzes.length + agentes.length === 0 && (
            <p className="text-xs text-gray-400">Nenhum funil ou agente encontrado.</p>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] font-semibold text-gray-500">
        {temRecorte ? 'Cole ESTA URL no Mercos (já recortada):' : 'URL sem recorte — vale para todos os funis:'}
      </p>
      <div className="mt-1 flex gap-2">
        <input readOnly value={urlFinal}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-[11px] text-gray-700" />
        <button
          onClick={() => { void navigator.clipboard.writeText(urlFinal).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }) }}
          className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">
          {copiado ? '✓' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}
