'use client'
// ============================================================================
// Estúdio IA — subaba Atendente: textos da Ana por idioma (Fase 3)
// ----------------------------------------------------------------------------
// Cada chave tem um texto PADRÃO no código; aqui o Luís troca por idioma.
// Campo vazio = volta para o padrão.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { listarTextosAna, salvarTextoAna, lerHumanizarAna, salvarHumanizarAna } from '@/lib/estudio/client'
import { BaseConhecimento } from './base-conhecimento'

type Linha = Awaited<ReturnType<typeof listarTextosAna>>['linhas'][number]
const IDIOMAS = [['pt-BR', '🇧🇷 Português (BR)'], ['pt-PT', '🇵🇹 Português (PT)'], ['es', '🇪🇸 Español'], ['en', '🇺🇸 English']] as const

const GRUPOS: [string, string[]][] = [
  ['Boas-vindas e menu', ['boas_vindas', 'pede_nome', 'menu', 'menu_de_novo', 'outro_tema']],
  ['Sensual (idade)', ['sensual_idade', 'sensual_menor']],
  ['Catálogo e pacotes', ['catalogo_link', 'tabela_precos', 'pacote_de_novo']],
  ['Fotos e poses', ['pede_fotos_poses', 'foto_rosto_ok', 'foto_corpo_ok', 'foto_ruim', 'foto_recusada', 'video_nao', 'poses_invalidas', 'poses_faltam', 'poses_demais', 'falta_foto']],
  ['Idade, preferências e pedido', ['pede_idade_prefs', 'idade_falta', 'resumo_pedido', 'aguardando_pagamento']],
  ['Pix e comprovante', ['pix_dados', 'pede_comprovante', 'conferindo', 'pago_ok', 'comprovante_recusado', 'pedido_pago_duvida']],
  ['Cobranças e prévia', ['cobranca_1', 'cobranca_2', 'cobranca_3', 'previa_pede_fotos', 'previa_na_fila']],
  ['Outros', ['nao_entendi', 'confirmar_equipe', 'humano', 'sou_assistente', 'idioma_trocado']],
  ['Texto no lugar do áudio (quando não houver áudio no idioma)', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']],
]

export function AbaAtendente() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [idioma, setIdioma] = useState<string>('pt-BR')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listarTextosAna().then(r => { if (!vivo) return; setLinhas(r.linhas); if (r.error) setErro(r.error) }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [])

  const doIdioma = useMemo(() => new Map((linhas ?? []).filter(l => l.idioma === idioma).map(l => [l.chave, l])), [linhas, idioma])

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4 text-sm text-violet-950">
        <p className="font-semibold">🤖 A Ana, do Estúdio</p>
        <p className="mt-1 text-xs text-violet-900/80">
          Ela segue o roteiro da venda (nome → tema → catálogo → pacote → fotos e poses → idade e preferências → pedido) e só usa IA para tirar dúvidas dentro de cada etapa.
          Variáveis: {'{nome} {tema} {link} {tabela} {qtd} {faltam} {valor} {poses} {prazo} {recebedor}'}. Campo vazio = texto padrão.
        </p>
      </div>
      <CartaoHumanizar />
      <BaseConhecimento />
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {IDIOMAS.map(([k, l]) => (
          <button key={k} onClick={() => setIdioma(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${idioma === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{l}</button>
        ))}
      </div>
      {!linhas ? <p className="text-sm text-slate-500">Carregando…</p> : GRUPOS.map(([titulo, chaves]) => (
        <section key={titulo} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
          <div className="mt-3 space-y-3">
            {chaves.map(ch => { const l = doIdioma.get(ch); return l ? <CampoTexto key={`${ch}|${idioma}`} l={l} onErro={setErro} /> : null })}
          </div>
        </section>
      ))}
    </div>
  )
}

function CampoTexto({ l, onErro }: { l: Linha; onErro: (e: string) => void }) {
  const [valor, setValor] = useState(l.texto ?? '')
  const [estado, setEstado] = useState<'salvo' | 'sujo' | 'salvando'>('salvo')
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {l.chave}
        <span className="normal-case tracking-normal text-slate-400">{estado === 'sujo' ? 'não salvo' : estado === 'salvando' ? 'salvando…' : l.texto ? 'personalizado' : 'padrão'}</span>
      </span>
      <textarea value={valor} rows={Math.min(8, Math.max(2, (valor || l.padrao).split('\n').length + 1))} placeholder={l.padrao}
        onChange={e => { setValor(e.target.value); setEstado('sujo') }}
        onBlur={async () => {
          if (estado !== 'sujo') return
          setEstado('salvando')
          const r = await salvarTextoAna(l.chave, l.idioma, valor)
          if (!r.success) { onErro(r.error ?? 'falhou'); setEstado('sujo') } else setEstado('salvo')
        }}
        className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none" />
    </label>
  )
}

/** "Digitando…" + atraso humano antes de cada mensagem (ligado por padrão). */
function CartaoHumanizar() {
  const [v, setV] = useState<{ humanizar: boolean; atraso_max_s: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    lerHumanizarAna().then(r => { if (!vivo) return; setV({ humanizar: r.humanizar, atraso_max_s: r.atraso_max_s }); if (r.error) setMsg(r.error) })
    return () => { vivo = false }
  }, [])
  if (!v) return null
  const salvar = async (n: { humanizar: boolean; atraso_max_s: number }) => {
    setV(n)
    const r = await salvarHumanizarAna(n.humanizar, n.atraso_max_s)
    setMsg(r.success ? 'Salvo.' : (r.error ?? 'falhou'))
  }
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" checked={v.humanizar} onChange={e => void salvar({ ...v, humanizar: e.target.checked })} />
        ✍️ Digitando e atraso humano
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        atraso máximo
        <input type="number" min={2} max={15} value={v.atraso_max_s} disabled={!v.humanizar}
          onChange={e => setV({ ...v, atraso_max_s: Number(e.target.value) })} onBlur={() => void salvar(v)}
          className="w-16 rounded-lg border border-slate-200 p-1.5 text-sm" /> s
      </label>
      <p className="text-xs text-slate-500">Texto: 1,2 s + 35 ms por letra (±20%), entre 1,5 s e o máximo · áudio 3–5 s · foto/PDF 1,5–2,5 s. Conta da chegada da mensagem: se já demorou, envia na hora.</p>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </section>
  )
}
