'use client'

// ============================================================================
// Content Studio — formulário de briefing (Fase 2A)
// ----------------------------------------------------------------------------
// Painel recolhível, mas NUNCA some da tela: o cabeçalho com o botão continua
// visível mesmo fechado, e a linha do tempo não interfere nele.
//
// A validação daqui é CONVENIÊNCIA. A que vale roda no servidor, em `brief.ts`.
// Este arquivo compartilha os limites com ele por import — duas listas de
// limites divergiriam no primeiro ajuste, e o usuário veria "ok" na tela para
// um valor que o servidor recusa.
//
// IDEMPOTÊNCIA: a chave nasce aqui, junto com o formulário, e viaja com a
// requisição. Botão desabilitado morre num F5, numa reconexão ou num duplo
// toque com rede ruim; a chave sobrevive a todos os três. Ela não concede
// privilégio nenhum — só diz "este é o mesmo envio de antes".
// ============================================================================

import React, { useCallback, useId, useMemo, useState } from 'react'
import {
  BRIEF_FIELDS,
  BRIEF_LABELS,
  BRIEF_LIMITS,
  type BriefField,
} from '@/lib/content-studio/brief'

/** Campos que merecem área de texto em vez de uma linha. */
const MULTILINHA: readonly BriefField[] = ['objetivo', 'oferta', 'observacoes']

const PLACEHOLDER: Record<BriefField, string> = {
  titulo: 'Carrossel de lançamento — turma de março',
  tema: 'Mentoria de tráfego pago para infoprodutores',
  objetivo: 'Gerar candidaturas para a próxima turma',
  publico: 'Infoprodutores que já faturam mas travaram na escala',
  oferta: 'Acompanhamento semanal com revisão de campanhas',
  tom: 'Direto, sem promessa exagerada',
  cta: 'Chame no direct para saber as condições',
  observacoes: 'Nada a acrescentar',
}

export interface ProductionFormProps {
  onSubmit: (valores: Record<BriefField, string>, idempotencyKey: string) => Promise<void>
  enviando: boolean
  /** Erro devolvido pelo servidor — já é texto seguro. */
  erro: string | null
}

/** Chave opaca por submissão. Sem Math.random: `crypto` existe em todo alvo. */
function novaChave(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function vazio(): Record<BriefField, string> {
  return Object.fromEntries(BRIEF_FIELDS.map(f => [f, ''])) as Record<BriefField, string>
}

export default function ProductionForm({ onSubmit, enviando, erro }: ProductionFormProps) {
  const [aberto, setAberto] = useState(true)
  const [valores, setValores] = useState<Record<BriefField, string>>(vazio)
  const [tocados, setTocados] = useState<Partial<Record<BriefField, boolean>>>({})

  // Uma chave por formulário montado. Só troca DEPOIS de um envio — um retry
  // do mesmo envio precisa repetir a mesma chave para o servidor reconhecê-lo.
  const [chave, setChave] = useState(novaChave)

  const corpoId = useId()

  const problemas = useMemo(() => {
    const out: Partial<Record<BriefField, string>> = {}
    for (const campo of BRIEF_FIELDS) {
      const valor = valores[campo].trim()
      const { min, max } = BRIEF_LIMITS[campo]
      if (!valor) {
        if (min > 0) out[campo] = 'Campo obrigatório'
      } else if (valor.length < min) {
        out[campo] = `Mínimo de ${min} caracteres`
      } else if (valor.length > max) {
        out[campo] = `Máximo de ${max} caracteres`
      }
    }
    return out
  }, [valores])

  const valido = Object.keys(problemas).length === 0
  const bloqueado = enviando || !valido

  const enviar = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (bloqueado) return
    // Marcar tudo como tocado revela os erros de quem tentou enviar em branco.
    setTocados(Object.fromEntries(BRIEF_FIELDS.map(f => [f, true])))
    await onSubmit(valores, chave)
    setChave(novaChave())
  }, [bloqueado, chave, onSubmit, valores])

  return (
    <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-4 sm:p-5 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-gray-900">Nova produção</h2>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
          briefing
        </span>
        <button
          type="button"
          onClick={() => setAberto(a => !a)}
          aria-expanded={aberto}
          aria-controls={corpoId}
          className="ml-auto shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          {aberto ? 'Ocultar briefing' : 'Preencher briefing'}
        </button>
      </div>

      <form id={corpoId} onSubmit={enviar} className={aberto ? '' : 'hidden'} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          {BRIEF_FIELDS.map(campo => {
            const problema = tocados[campo] ? problemas[campo] : undefined
            const largo = MULTILINHA.includes(campo)
            const comum =
              'w-full rounded-xl border px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 ' +
              'focus:outline-none focus:ring-2 focus:ring-indigo-200 ' +
              (problema ? 'border-rose-300 bg-rose-50/40' : 'border-gray-200')

            return (
              <div key={campo} className={largo ? 'sm:col-span-2' : ''}>
                <label
                  htmlFor={`${corpoId}-${campo}`}
                  className="mb-1 block text-[12px] font-semibold text-gray-700"
                >
                  {BRIEF_LABELS[campo]}
                </label>

                {largo ? (
                  <textarea
                    id={`${corpoId}-${campo}`}
                    rows={2}
                    value={valores[campo]}
                    maxLength={BRIEF_LIMITS[campo].max}
                    placeholder={PLACEHOLDER[campo]}
                    onChange={e => setValores(v => ({ ...v, [campo]: e.target.value }))}
                    onBlur={() => setTocados(t => ({ ...t, [campo]: true }))}
                    aria-invalid={!!problema}
                    className={`${comum} resize-y`}
                  />
                ) : (
                  <input
                    id={`${corpoId}-${campo}`}
                    type="text"
                    value={valores[campo]}
                    maxLength={BRIEF_LIMITS[campo].max}
                    placeholder={PLACEHOLDER[campo]}
                    onChange={e => setValores(v => ({ ...v, [campo]: e.target.value }))}
                    onBlur={() => setTocados(t => ({ ...t, [campo]: true }))}
                    aria-invalid={!!problema}
                    className={comum}
                  />
                )}

                {problema && (
                  <p className="mt-1 text-[11px] font-medium text-rose-600">{problema}</p>
                )}
              </div>
            )
          })}
        </div>

        {erro && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {erro}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={bloqueado}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-200 ring-1 ring-inset ring-white/25 transition-all hover:brightness-110 disabled:opacity-60"
          >
            <span aria-hidden>{enviando ? '⏳' : '▶'}</span>
            {enviando ? 'Criando produção...' : 'Iniciar produção'}
          </button>
          <p className="text-[11px] text-gray-400">
            Os agentes desta fase são determinísticos: nenhuma IA é chamada.
          </p>
        </div>
      </form>
    </section>
  )
}
