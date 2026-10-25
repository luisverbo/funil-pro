'use client'
// ============================================================================
// Estúdio IA — base de conhecimento da Ana (subaba Atendente, Fase 4)
// Perguntas e respostas, regras e "o que não dizer". A IA só responde com o
// que está aqui + os fatos fixos; fora disso diz "vou confirmar com a equipe"
// e te avisa.
// ============================================================================
import { useEffect, useState } from 'react'
import { listarConhecimento, salvarConhecimento, excluirConhecimento } from '@/lib/estudio/client'

type Item = Awaited<ReturnType<typeof listarConhecimento>>['itens'][number]
type Tipo = Item['tipo']

const GRUPOS: [Tipo, string, string][] = [
  ['faq', 'Perguntas e respostas', 'Ex.: "Posso usar as fotos no LinkedIn?" → "Pode sim, as fotos são suas!"'],
  ['regra', 'Regras', 'Ex.: "Não fazemos fotos de casal por enquanto."'],
  ['nao_dizer', 'O que NÃO dizer', 'Ex.: "Nunca diga que as fotos são de um fotógrafo de verdade."'],
]

export function BaseConhecimento() {
  const [itens, setItens] = useState<Item[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  useEffect(() => {
    let vivo = true
    listarConhecimento().then(r => { if (!vivo) return; setItens(r.itens); if (r.error) setErro(r.error) }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [versao])

  return (
    <section className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">📚 Base de conhecimento</h3>
      <p className="text-xs text-slate-500">A IA nunca inventa preço, prazo, desconto ou promessa. Ela responde só com os fatos do estúdio + o que estiver aqui. Fora disso: &quot;vou confirmar com a equipe&quot; e você recebe o aviso.</p>
      {erro && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      {!itens ? <p className="mt-2 text-sm text-slate-500">Carregando…</p> : (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {GRUPOS.map(([tipo, titulo, dica]) => (
            <div key={tipo}>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{titulo}</p>
              <div className="mt-2 space-y-2">
                {itens.filter(i => i.tipo === tipo).map(i => <Linha key={i.id} item={i} onMudou={() => setVersao(v => v + 1)} onErro={setErro} />)}
                <Linha item={{ id: '', tipo, pergunta: '', resposta: '', ativo: true, ordem: 0 }} dica={dica} onMudou={() => setVersao(v => v + 1)} onErro={setErro} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Linha({ item, dica, onMudou, onErro }: { item: Item; dica?: string; onMudou: () => void; onErro: (e: string) => void }) {
  const [p, setP] = useState(item.pergunta ?? '')
  const [r, setR] = useState(item.resposta)
  const novo = !item.id
  const sujo = p !== (item.pergunta ?? '') || r !== item.resposta
  const salvar = async () => {
    const res = await salvarConhecimento({ id: item.id || null, tipo: item.tipo, pergunta: p, resposta: r })
    if (!res.success) { onErro(res.error ?? 'falhou'); return }
    if (novo) { setP(''); setR('') }
    onMudou()
  }
  return (
    <div className={`rounded-lg border p-2 ${novo ? 'border-dashed border-slate-300' : 'border-slate-200'}`}>
      {item.tipo === 'faq' && <input value={p} onChange={e => setP(e.target.value)} placeholder={novo ? 'Nova pergunta…' : 'Pergunta'} className="w-full rounded border border-slate-200 p-1.5 text-xs font-medium" />}
      <textarea value={r} onChange={e => setR(e.target.value)} rows={2} placeholder={novo ? (dica ?? 'Novo item…') : ''} className="mt-1 w-full rounded border border-slate-200 p-1.5 text-xs" />
      <div className="flex justify-end gap-2">
        {!novo && <button onClick={async () => { const x = await excluirConhecimento(item.id); if (!x.success) onErro(x.error ?? 'falhou'); else onMudou() }} className="text-[11px] text-slate-400 hover:text-red-600">excluir</button>}
        {sujo && <button onClick={salvar} className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">{novo ? 'Adicionar' : 'Salvar'}</button>}
      </div>
    </div>
  )
}
