'use client'

// ============================================================================
// Content Studio — Criação rápida (Fase 3 MVP)
// ----------------------------------------------------------------------------
// O modo PADRÃO: um campo grande, um objetivo, dois opcionais e um botão. O
// briefing completo continua atrás de "Usar briefing avançado".
//
// PREFERÊNCIAS DA MARCA: cs_settings não tem coluna de configuração JSON e
// migration não está autorizada — então o perfil (público, tom, negócio, CTA
// padrão, descrição) vive no localStorage DESTE NAVEGADOR, como preferência
// local de MVP. Ele viaja junto do pedido e passa pela mesma validação de
// lista branca no servidor: preferência não é privilégio.
// ============================================================================

import React, { useCallback, useId, useState, useSyncExternalStore } from 'react'
import {
  QUICK_OBJETIVO_LABELS,
  QUICK_OBJETIVOS,
  type QuickObjetivo,
} from '@/lib/content-studio/quick/schema'

/** Preferência LOCAL do navegador (MVP). Nada disso vai para cs_settings. */
export const BRAND_PROFILE_KEY = 'content-studio:brand-profile'

export interface BrandProfile {
  publico: string
  tom: string
  negocio: string
  ctaPadrao: string
  descricao: string
}

const PERFIL_VAZIO: BrandProfile = { publico: '', tom: '', negocio: '', ctaPadrao: '', descricao: '' }

// Store externo (mesmo padrão da preferência da timeline): snapshot do
// servidor é o perfil vazio — primeira pintura idêntica à hidratação.
const ouvintesPerfil = new Set<() => void>()
let cachePerfil: BrandProfile | null = null

function lerPerfil(): BrandProfile {
  try {
    const bruto = window.localStorage.getItem(BRAND_PROFILE_KEY)
    if (!bruto) return { ...PERFIL_VAZIO }
    const p = JSON.parse(bruto) as Partial<BrandProfile>
    return {
      publico: typeof p.publico === 'string' ? p.publico : '',
      tom: typeof p.tom === 'string' ? p.tom : '',
      negocio: typeof p.negocio === 'string' ? p.negocio : '',
      ctaPadrao: typeof p.ctaPadrao === 'string' ? p.ctaPadrao : '',
      descricao: typeof p.descricao === 'string' ? p.descricao : '',
    }
  } catch {
    return { ...PERFIL_VAZIO }
  }
}

function snapshotPerfil(): BrandProfile {
  if (!cachePerfil) cachePerfil = lerPerfil()
  return cachePerfil
}

function assinarPerfil(notificar: () => void) {
  ouvintesPerfil.add(notificar)
  return () => { ouvintesPerfil.delete(notificar) }
}

function gravarPerfil(p: BrandProfile): void {
  cachePerfil = p
  try { window.localStorage.setItem(BRAND_PROFILE_KEY, JSON.stringify(p)) } catch { /* storage bloqueado */ }
  for (const n of ouvintesPerfil) n()
}

export interface QuickCreateFormProps {
  onSubmit: (dados: {
    tema: string
    objetivo: QuickObjetivo
    oferta: string
    cta: string
    marca: BrandProfile
  }) => Promise<void>
  enviando: boolean
  erro: string | null
  /** Abre o briefing completo da 2A/2B. */
  onBriefingAvancado: () => void
}

export default function QuickCreateForm({ onSubmit, enviando, erro, onBriefingAvancado }: QuickCreateFormProps) {
  const [tema, setTema] = useState('')
  const [objetivo, setObjetivo] = useState<QuickObjetivo>('educar')
  const [oferta, setOferta] = useState('')
  const [cta, setCta] = useState('')

  const perfil = useSyncExternalStore(assinarPerfil, snapshotPerfil, () => PERFIL_VAZIO)
  const [perfilAberto, setPerfilAberto] = useState(false)
  const perfilId = useId()

  const salvarPerfil = useCallback((novo: BrandProfile) => { gravarPerfil(novo) }, [])

  const pronto = tema.trim().length >= 3
  const enviar = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pronto || enviando) return
    await onSubmit({ tema: tema.trim(), objetivo, oferta: oferta.trim(), cta: cta.trim(), marca: perfil })
  }, [pronto, enviando, onSubmit, tema, objetivo, oferta, cta, perfil])

  return (
    <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-4 sm:p-6 mb-4">
      <form onSubmit={enviar} noValidate>
        <label htmlFor="quick-tema" className="block text-base sm:text-lg font-bold text-gray-900 mb-2">
          Sobre o que você quer criar?
        </label>
        <textarea
          id="quick-tema"
          rows={3}
          value={tema}
          maxLength={300}
          onChange={e => setTema(e.target.value)}
          placeholder="Ex.: como organizar o atendimento de leads em pequenas empresas"
          className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-y"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Objetivo">
          {QUICK_OBJETIVOS.map(op => (
            <button
              key={op}
              type="button"
              onClick={() => setObjetivo(op)}
              aria-pressed={objetivo === op}
              className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                objetivo === op
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {QUICK_OBJETIVO_LABELS[op]}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={oferta}
            maxLength={300}
            onChange={e => setOferta(e.target.value)}
            placeholder="Oferta ou produto (opcional)"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <input
            type="text"
            value={cta}
            maxLength={160}
            onChange={e => setCta(e.target.value)}
            placeholder="CTA (opcional)"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        {erro && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {erro}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!pronto || enviando}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-indigo-500 to-violet-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-indigo-200 ring-1 ring-inset ring-white/25 transition-all hover:brightness-110 disabled:opacity-60"
          >
            <span aria-hidden>{enviando ? '⏳' : '✦'}</span>
            {enviando ? 'Criando...' : 'Criar carrossel com IA'}
          </button>
          <button
            type="button"
            onClick={onBriefingAvancado}
            className="text-sm font-semibold text-indigo-600 underline-offset-2 hover:underline"
          >
            Usar briefing avançado
          </button>
          <button
            type="button"
            onClick={() => setPerfilAberto(a => !a)}
            aria-expanded={perfilAberto}
            aria-controls={perfilId}
            className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            Preferências da marca
          </button>
        </div>
      </form>

      {/* Preferência LOCAL deste navegador — usada como contexto da geração. */}
      <div id={perfilId} className={perfilAberto ? 'mt-4 border-t border-gray-100 pt-4' : 'hidden'}>
        <p className="mb-2 text-[12px] text-gray-500">
          Salvo apenas neste navegador. Usado como contexto em todas as criações rápidas.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['negocio', 'Nome do negócio', 120],
            ['publico', 'Público principal', 200],
            ['tom', 'Tom de voz', 120],
            ['ctaPadrao', 'CTA padrão', 160],
          ] as const).map(([campo, rotulo, max]) => (
            <input
              key={campo}
              type="text"
              value={perfil[campo]}
              maxLength={max}
              onChange={e => salvarPerfil({ ...perfil, [campo]: e.target.value })}
              placeholder={rotulo}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
            />
          ))}
          <textarea
            rows={2}
            value={perfil.descricao}
            maxLength={400}
            onChange={e => salvarPerfil({ ...perfil, descricao: e.target.value })}
            placeholder="Descrição curta do produto"
            className="sm:col-span-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 resize-y"
          />
        </div>
      </div>
    </section>
  )
}
