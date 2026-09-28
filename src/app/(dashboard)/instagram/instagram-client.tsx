'use client'

import { explicarErroDeToken } from '@/lib/instagram/token'

import React, { useEffect, useState } from 'react'
import { createIgAutomation, updateIgAutomation, deleteIgAutomation, listInstagramPosts, listAutomationContacts, listConteudosParaAutomacao, type ConteudoAgendavel, type IgAutomation, type IgAutomationContact, type IgAutomationInput } from '@/app/actions/ig-automations'
import type { IgMedia } from '@/lib/instagram'
import EmojiPicker from '@/components/ui/emoji-picker'
import { uploadIgMedia } from '@/app/actions/upload'

function StepMedia({ url, type, onChange }: { url?: string; type?: 'image' | 'video' | 'audio'; onChange: (u?: string, t?: 'image' | 'video' | 'audio') => void }) {
  const [busy, setBusy] = useState(false)
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await uploadIgMedia(fd)
    setBusy(false)
    if (!r.error) onChange(r.url, r.kind)
    else alert(r.error)
  }
  return url ? (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-1.5 bg-white text-xs">
      {type === 'image' ? <img src={url} alt="" className="w-8 h-8 rounded object-cover" /> : <span className="w-8 h-8 rounded bg-purple-100 flex items-center justify-center">{type === 'video' ? '🎬' : '🎵'}</span>}
      <span className="text-gray-500 flex-1 truncate">{type} anexado</span>
      <button type="button" onClick={() => onChange(undefined, undefined)} className="text-red-500 hover:underline">remover</button>
    </div>
  ) : (
    <label className={`text-xs text-purple-600 hover:underline cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      {busy ? 'enviando…' : '📎 anexar mídia (img/vídeo/áudio)'}
      <input type="file" accept="image/*,video/mp4,video/quicktime,audio/*" className="hidden" onChange={pick} />
    </label>
  )
}

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

// Passo da sequência de DM (estado da UI)
// kind 'url' = botão de link; kind 'reply' = resposta rápida ("SIM") — renova a janela de 24h
type UiButton = { title: string; url: string; kind: 'url' | 'reply'; branch?: unknown }
type UiStep = { delay_value: number; delay_unit: 'min' | 'h'; text: string; buttons: UiButton[]; media_url?: string; media_type?: 'image' | 'video' | 'audio' }
const emptyStep = (): UiStep => ({ delay_value: 0, delay_unit: 'min', text: '', buttons: [] })

function stepsToDb(steps: UiStep[]) {
  return steps
    .filter(s => s.text.trim() || s.media_url || s.buttons.some(b => b.title && (b.kind === 'reply' || b.url)))
    .map(s => ({
      delay_minutes: s.delay_unit === 'h' ? s.delay_value * 60 : s.delay_value,
      text: s.text.trim(),
      buttons: s.buttons
        .filter(b => b.title && (b.kind === 'reply' || b.url))
        .map(b => b.kind === 'reply' ? { title: b.title, ...(b.branch ? { branch: b.branch } : {}) } : { title: b.title, url: b.url }),
      ...(s.media_url ? { media_url: s.media_url, media_type: s.media_type } : {}),
    }))
}

function dbToSteps(a: IgAutomation): UiStep[] {
  const src = (a.dm_steps && a.dm_steps.length > 0)
    ? a.dm_steps
    : (a.dm_message ? [{ delay_minutes: 0, text: a.dm_message, buttons: [] }] : [])
  if (src.length === 0) return [emptyStep()]
  return src.map(s => {
    const min = s.delay_minutes ?? 0
    const asHours = min >= 60 && min % 60 === 0
    return {
      delay_value: asHours ? min / 60 : min,
      delay_unit: asHours ? 'h' as const : 'min' as const,
      text: s.text ?? '',
      buttons: (s.buttons ?? []).map(b => ({ title: b.title, url: (b as { url?: string }).url ?? '', kind: ((b as { url?: string }).url ? 'url' : 'reply') as 'url' | 'reply', branch: (b as { branch?: unknown }).branch })),
      media_url: s.media_url, media_type: s.media_type,
    }
  })
}

interface Connection { connected: boolean; username?: string; accountId?: string; name?: string; profilePic?: string; followers?: number; posts?: number; error?: string }

/** 12.4 mil, 1,2 mi — número curto como o Instagram mostra. */
function numeroCurto(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} mi`
  if (n >= 10_000) return `${Math.round(n / 1000)} mil`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '').replace('.', ',')} mil`
  return String(n)
}

const IG_GRADIENTE = 'linear-gradient(135deg,#feda75 0%,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5 100%)'

/** Foto com anel do Instagram; se a URL do CDN expirar, mostra a inicial. */
function AvatarIg({ src, nome, tamanho = 64 }: { src?: string; nome?: string; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false)
  const inicial = (nome ?? '?').trim().charAt(0).toUpperCase()
  return (
    <span className="relative inline-flex shrink-0 rounded-full p-[3px]" style={{ background: IG_GRADIENTE, width: tamanho, height: tamanho }}>
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white p-[2px]">
        {src && !falhou
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={src} alt="" onError={() => setFalhou(true)} ref={el => { if (el && el.complete && el.naturalWidth === 0) setFalhou(true) }} className="h-full w-full rounded-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: IG_GRADIENTE }}>{inicial}</span>}
      </span>
    </span>
  )
}

/** Capa do card: miniatura do post (se ainda válida) ou degradê com o ícone do gatilho. */
function CapaAutomacao({ thumb, icone }: { thumb: string | null; icone: string }) {
  const [falhou, setFalhou] = useState(false)
  return (
    <div className="absolute inset-0">
      {thumb && !falhou
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb} alt="" onError={() => setFalhou(true)} ref={el => { if (el && el.complete && el.naturalWidth === 0) setFalhou(true) }} className="h-full w-full object-cover" />
        : (
          <div className="relative h-full w-full" style={{ background: IG_GRADIENTE }}>
            <span className="absolute bottom-3 right-4 text-4xl opacity-90 drop-shadow-lg">{icone}</span>
          </div>
        )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30" />
    </div>
  )
}

/** '29/09 · 06:00' no horário de Brasília. */
function quandoEmBrasilia(iso: string): string {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return f.format(new Date(iso)).replace(', ', ' · ')
}

export default function InstagramClient({ initialAutomations, connection, funnels = [] }: { initialAutomations: IgAutomation[]; connection?: Connection; funnels?: { id: string; name: string }[] }) {
  const [automations, setAutomations] = useState(initialAutomations)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // form
  const [name, setName] = useState('')
  const [posts, setPosts] = useState<IgMedia[] | null>(null)
  const [postsError, setPostsError] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<IgMedia | 'all' | null>(null)
  // Post AGENDADO no /conteudos (estilo ManyChat): a automação fica pronta e
  // passa a valer sozinha quando o post for publicado.
  const [agendados, setAgendados] = useState<ConteudoAgendavel[]>([])
  const [selectedAgendado, setSelectedAgendado] = useState<ConteudoAgendavel | null>(null)
  useEffect(() => {
    listConteudosParaAutomacao().then(r => setAgendados(r.itens)).catch(() => {})
  }, [])
  const [keywordInput, setKeywordInput] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [commentReplies, setCommentReplies] = useState('')
  const [dmSteps, setDmSteps] = useState<UiStep[]>([emptyStep()])
  const [triggerType, setTriggerType] = useState<'comment' | 'dm' | 'story_reply'>('comment')
  const [dmUseAgent, setDmUseAgent] = useState(true)
  const [funnelId, setFunnelId] = useState('')
  const [leadTag, setLeadTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [contactsOf, setContactsOf] = useState<{ name: string; loading: boolean; list: IgAutomationContact[] } | null>(null)

  async function openContacts(a: IgAutomation) {
    setContactsOf({ name: a.name, loading: true, list: [] })
    const { contacts } = await listAutomationContacts(a.id)
    setContactsOf({ name: a.name, loading: false, list: contacts })
  }

  async function loadPosts() {
    setPosts(null); setPostsError(null)
    const { posts: p, error } = await listInstagramPosts()
    if (error) setPostsError(error)
    setPosts(p)
  }

  async function openModal() {
    setModalOpen(true); setEditingId(null)
    setName(''); setSelectedPost(null); setSelectedAgendado(null); setKeywords([]); setKeywordInput('')
    setCommentReplies(''); setDmSteps([emptyStep()]); setTriggerType('comment'); setDmUseAgent(true); setFunnelId(''); setLeadTag(''); setSaveError(null)
    await loadPosts()
  }

  async function openEdit(a: IgAutomation) {
    setModalOpen(true); setEditingId(a.id)
    setName(a.name)
    const esperando = a.conteudo_id && !a.media_id ? agendados.find(c => c.id === a.conteudo_id) ?? null : null
    setSelectedAgendado(esperando)
    setSelectedPost(esperando ? null : a.media_id ? { id: a.media_id, caption: a.media_caption ?? undefined, thumbnail_url: a.media_thumb ?? undefined } : 'all')
    setKeywords(a.keywords ?? []); setKeywordInput('')
    setCommentReplies((a.comment_replies ?? []).join('\n'))
    setDmSteps(dbToSteps(a))
    setTriggerType(a.trigger_type ?? 'comment')
    setDmUseAgent(a.dm_use_agent)
    setFunnelId(a.funnel_id ?? ''); setLeadTag(a.lead_tag ?? '')
    setSaveError(null)
    await loadPosts()
  }

  async function save() {
    const steps = stepsToDb(dmSteps)
    // Captura a palavra digitada que ainda não virou chip (sem Enter)
    const finalKeywords = keywordInput.trim() && !keywords.includes(keywordInput.trim())
      ? [...keywords, keywordInput.trim()]
      : keywords
    if (keywordInput.trim()) { setKeywords(finalKeywords); setKeywordInput('') }
    if (steps.length === 0 && !(triggerType === 'comment' && commentReplies.trim())) { setSaveError('Defina ao menos um passo de mensagem (DM)'); return }
    if (triggerType !== 'comment' && finalKeywords.length === 0 && triggerType === 'dm') { setSaveError('No gatilho de DM, defina ao menos uma palavra-chave'); return }
    setSaving(true); setSaveError(null)
    const media = selectedPost && selectedPost !== 'all' ? selectedPost : null
    const agendado = triggerType === 'comment' && !media ? selectedAgendado : null
    const payload = {
      name: name || 'Automação',
      media_id: media?.id ?? null,
      conteudo_id: agendado?.id ?? null,
      media_caption: (agendado ? agendado.descricao : media?.caption)?.slice(0, 120) ?? null,
      media_thumb: agendado ? agendado.thumb : (media?.thumbnail_url ?? media?.media_url ?? null),
      keywords: finalKeywords,
      comment_replies: commentReplies.split('\n').map(s => s.trim()).filter(Boolean),
      dm_message: steps[0]?.text || null,
      dm_steps: (steps.length > 0 ? steps : null) as IgAutomationInput['dm_steps'],
      dm_use_agent: dmUseAgent,
      funnel_id: funnelId || null,
      lead_tag: leadTag || null,
      trigger_type: triggerType,
    }

    if (editingId) {
      const { success, error } = await updateIgAutomation(editingId, payload)
      setSaving(false)
      if (!success) { setSaveError(error ?? 'Erro ao salvar'); return }
      setAutomations(a => a.map(x => x.id === editingId ? { ...x, ...payload } as IgAutomation : x))
      setModalOpen(false)
      return
    }

    const { id, error } = await createIgAutomation(payload)
    setSaving(false)
    if (error) { setSaveError(error); return }
    setAutomations(a => [{
      id: id!, status: 'active', triggers_count: 0, created_at: new Date().toISOString(),
      follow_gate: false, follow_gate_message: null, canvas: null, ...payload,
    } as IgAutomation, ...a])
    setModalOpen(false)
  }

  async function toggle(a: IgAutomation) {
    const status = a.status === 'active' ? 'paused' : 'active'
    await updateIgAutomation(a.id, { status })
    setAutomations(list => list.map(x => x.id === a.id ? { ...x, status } : x))
  }

  async function remove(id: string) {
    if (!confirm('Excluir esta automação?')) return
    await deleteIgAutomation(id)
    setAutomations(list => list.filter(x => x.id !== id))
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Cabeçalho */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-500">Automações</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900">Instagram</h1>
          <p className="mt-1 text-sm text-gray-500">Comentou ou mandou a palavra-chave, o FunilPro responde e conversa sozinho.</p>
        </div>
        <div className="flex gap-2">
          <a href="/instagram/inbox"
            className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
            Inbox
          </a>
          <button onClick={openModal}
            className="inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-all hover:-translate-y-0.5 hover:shadow-xl"
            style={{ background: 'linear-gradient(135deg,#d62976,#962fbf 60%,#4f5bd5)' }}>
            <span className="text-base leading-none">＋</span> Nova automação
          </button>
        </div>
      </div>

      {/* Conta conectada */}
      {connection?.connected ? (() => {
        const ativas = automations.filter(a => a.status === 'active').length
        const disparos = automations.reduce((soma, a) => soma + (a.triggers_count ?? 0), 0)
        return (
          <div className="mb-8 rounded-[28px] p-[1.5px] shadow-sm" style={{ background: IG_GRADIENTE }}>
            <div className="flex flex-col gap-5 rounded-[27px] bg-white p-5 sm:flex-row sm:items-center sm:p-6">
              <div className="flex min-w-0 items-center gap-4">
                <AvatarIg src={connection.profilePic} nome={connection.name ?? connection.username} tamanho={68} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-bold text-gray-900">{connection.name || `@${connection.username}`}</h2>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      Conectado
                    </span>
                  </div>
                  <a href={`https://instagram.com/${connection.username}`} target="_blank" rel="noopener noreferrer"
                    title={connection.accountId ? `ID ${connection.accountId}` : undefined}
                    className="text-sm font-medium text-fuchsia-600 hover:underline">@{connection.username}</a>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:grid-cols-4 sm:gap-3">
                {[
                  { n: numeroCurto(connection.followers), r: 'seguidores' },
                  { n: numeroCurto(connection.posts), r: 'posts' },
                  { n: String(ativas), r: ativas === 1 ? 'ativa' : 'ativas' },
                  { n: numeroCurto(disparos), r: 'disparos' },
                ].map(k => (
                  <div key={k.r} className="min-w-0 rounded-2xl bg-gray-50 px-1.5 py-2.5 text-center sm:min-w-[84px] sm:px-3">
                    <p className="whitespace-nowrap text-base font-extrabold leading-none text-gray-900 sm:text-lg">{k.n}</p>
                    <p className="mt-1 truncate text-[10px] font-medium text-gray-500 sm:text-[11px]">{k.r}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })() : (
        <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            {connection?.error && connection.error !== 'token_missing' ? '⚠️ Instagram desconectado — o token venceu ou foi recusado' : '⚠️ Instagram ainda não conectado'}
          </p>
          {explicarErroDeToken(connection?.error) && (
            <p className="mb-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{explicarErroDeToken(connection?.error)}</p>
          )}
          <ol className="text-sm text-amber-800/90 flex flex-col gap-1.5 list-decimal list-inside">
            <li>No painel da Meta (developers.facebook.com → seu app → caso de uso do Instagram), vá no passo <strong>&quot;2. Gerar tokens de acesso&quot;</strong>, conecte sua conta profissional e clique em <strong>Gerar token</strong>.</li>
            <li>Cole o token em <a href="/admin/settings" className="font-semibold underline">Admin → Configurações → Instagram</a> e salve. Vale na hora, sem redeploy.</li>
            <li>Recarregue esta página — o status fica verde com o seu @. A partir daí o FunilPro renova o token sozinho a cada 24h (ele vale 60 dias).</li>
          </ol>
          {connection?.error && connection.error !== 'token_missing' && (
            <p className="text-xs text-amber-600 mt-2">Detalhe técnico: {connection.error.slice(0, 140)}</p>
          )}
        </div>
      )}

      {automations.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-3xl p-14 text-center text-gray-500">
          <p className="text-4xl mb-3">📸</p>
          <p className="font-semibold text-gray-700">Nenhuma automação ainda</p>
          <p className="text-sm mt-1">Ex: quem comentar <span className="font-semibold">&quot;EU QUERO&quot;</span> no seu post recebe o link na DM automaticamente.</p>
          <button onClick={openModal} className="mt-5 px-5 py-2.5 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-pink-200">+ Criar primeira automação</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {automations.map(a => {
            const seqN = a.dm_steps?.length ?? (a.dm_message ? 1 : 0)
            const trigger = a.trigger_type === 'dm' ? { icon: '📩', label: 'DM com palavra-chave' }
              : a.trigger_type === 'story_reply' ? { icon: '📱', label: 'Resposta a Story' }
              : a.conteudo_id && !a.media_id
                ? (() => {
                    const c = agendados.find(x => x.id === a.conteudo_id)
                    return { icon: '📅', label: c ? `Post agendado · ${quandoEmBrasilia(c.data_agendada)} — liga quando publicar` : 'Post agendado — liga quando publicar' }
                  })()
                : { icon: '💬', label: a.media_id ? 'Comentário em post' : 'Comentário em qualquer post' }
            const active = a.status === 'active'
            const first = a.dm_steps?.[0]?.text ?? a.dm_message
            const etapas = [
              a.comment_replies.length > 0 && { i: '💬', t: 'Responde' },
              a.follow_gate && { i: '🔒', t: 'Pede follow' },
              seqN > 0 && { i: '📨', t: `${seqN} DM${seqN > 1 ? 's' : ''}` },
              a.dm_use_agent && { i: '🤖', t: 'IA assume' },
              a.funnel_id && { i: '🔀', t: 'Funil' },
            ].filter(Boolean) as { i: string; t: string }[]
            return (
            <article key={a.id} className={`group flex flex-col overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-fuchsia-500/10 ${active ? '' : 'opacity-90'}`}>
              {/* Capa */}
              <div className="relative h-36 overflow-hidden">
                <CapaAutomacao thumb={a.media_thumb} icone={trigger.icon} />
                <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
                  <span className="max-w-[70%] truncate rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/30 backdrop-blur-md">
                    {trigger.icon} {trigger.label}
                  </span>
                  {/* Liga/desliga */}
                  <button onClick={() => toggle(a)} title={active ? 'Pausar' : 'Ativar'}
                    className={`relative h-7 w-12 shrink-0 rounded-full ring-1 ring-white/40 backdrop-blur-md transition-colors ${active ? 'bg-emerald-500' : 'bg-white/25'}`}>
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${active ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <h3 className="truncate text-lg font-bold text-white drop-shadow">{a.name}</h3>
                  <p className="text-[11px] font-medium text-white/80">{active ? '● No ar' : '❚❚ Pausada'}</p>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-4 p-5">
                {/* Palavras-chave */}
                <div className="flex flex-wrap gap-1.5">
                  {a.keywords.length > 0
                    ? a.keywords.slice(0, 4).map(k => (
                        <span key={k} className="rounded-full bg-gradient-to-r from-fuchsia-50 to-violet-50 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-700 ring-1 ring-fuchsia-100">&ldquo;{k}&rdquo;</span>
                      ))
                    : <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500 ring-1 ring-gray-100">Qualquer comentário</span>}
                  {a.keywords.length > 4 && <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] text-gray-400">+{a.keywords.length - 4}</span>}
                </div>

                {/* O que acontece, em ordem */}
                {etapas.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[11px] font-medium text-gray-600">
                    {etapas.map((e, i) => (
                      <React.Fragment key={e.t}>
                        {i > 0 && <span className="text-gray-300">›</span>}
                        <span className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1">{e.i} {e.t}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {/* Prévia da 1ª DM, como balão do Direct */}
                {first && (
                  <div className="flex items-end gap-2">
                    <AvatarIg src={connection?.profilePic} nome={connection?.name ?? connection?.username} tamanho={26} />
                    <p className="line-clamp-3 rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-[13px] leading-snug text-gray-700">{first}</p>
                  </div>
                )}

                {a.lead_tag && (
                  <p className="text-[11px] text-gray-400">🏷 marca o lead como <span className="font-semibold text-gray-600">{a.lead_tag}</span></p>
                )}

                {/* Rodapé */}
                <div className="mt-auto flex items-center gap-2 border-t border-gray-100 pt-4">
                  <button onClick={() => openContacts(a)} className="group/stat mr-auto min-w-0 text-left">
                    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                      <span className="text-xl font-extrabold leading-none text-gray-900 group-hover/stat:text-fuchsia-600">{a.triggers_count}</span>
                      <span className="text-xs font-medium text-gray-500">disparo{a.triggers_count === 1 ? '' : 's'}</span>
                    </span>
                    <span className="block whitespace-nowrap text-[11px] font-semibold text-fuchsia-600/80 group-hover/stat:text-fuchsia-600">👥 ver contatos</span>
                  </button>
                  <button onClick={() => remove(a.id)} title="Excluir"
                    className="grid h-10 w-10 place-items-center rounded-xl text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                  <a href={`/instagram/${a.id}/editor`}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-black">
                    Editar <span aria-hidden>→</span>
                  </a>
                </div>
              </div>
            </article>
          )})}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 bg-gradient-to-r from-pink-500 to-purple-600 rounded-t-3xl flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{editingId ? 'Editar automação' : 'Nova automação do Instagram'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-white/70 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da automação</label>
                <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Lançamento — palavra EU QUERO" />
              </div>

              {/* Seletor de GATILHO — o que dispara a automação */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Quando disparar?</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'comment' as const, icon: '💬', label: 'Comentário', desc: 'em post/Reel' },
                    { key: 'dm' as const, icon: '📩', label: 'Direct (DM)', desc: 'palavra-chave' },
                    { key: 'story_reply' as const, icon: '📱', label: 'Story', desc: 'resposta' },
                  ].map(t => (
                    <button key={t.key} type="button" onClick={() => setTriggerType(t.key)}
                      className={`rounded-xl border-2 p-2.5 text-center transition-all ${triggerType === t.key ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="text-xl">{t.icon}</div>
                      <p className="text-xs font-semibold text-gray-800 mt-0.5">{t.label}</p>
                      <p className="text-[10px] text-gray-400">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {triggerType === 'comment' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Em qual post?</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  <button type="button" onClick={() => { setSelectedPost('all'); setSelectedAgendado(null) }}
                    className={`text-xs px-3 py-1.5 rounded-full border ${selectedPost === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}>
                    🌐 Todos os posts
                  </button>
                </div>
                {agendados.some(c => c.status !== 'publicado') && (
                  <div className="mb-3 rounded-xl border border-violet-100 bg-violet-50/50 p-2.5">
                    <p className="mb-2 text-xs font-semibold text-violet-800">📅 Agendados no Conteúdos <span className="font-normal text-violet-500">— a automação liga sozinha quando o post cair</span></p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {agendados.filter(c => c.status !== 'publicado').map(c => {
                        const marcado = selectedAgendado?.id === c.id
                        return (
                          <button key={c.id} type="button" title={c.descricao.slice(0, 100)}
                            onClick={() => { setSelectedAgendado(c); setSelectedPost(null) }}
                            className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 ${marcado ? 'border-violet-600 ring-2 ring-violet-200' : 'border-transparent'}`}
                            style={{ background: 'linear-gradient(160deg,#833ab4,#c13584 50%,#fd1d1d)' }}>
                            {c.thumb
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={c.thumb} alt="" className="h-full w-full object-cover" />
                              : c.video
                                ? <video src={`${c.video}#t=0.5`} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                                : null}
                            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1 pb-1 pt-3 text-[9px] font-semibold leading-tight text-white">
                              {quandoEmBrasilia(c.data_agendada)}
                              {c.status === 'pendente' && <span className="block font-normal text-amber-200">pendente</span>}
                            </span>
                            <span className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white">{c.tipo === 'reel' ? '🎬' : '🖼️'}</span>
                          </button>
                        )
                      })}
                    </div>
                    {selectedAgendado && (
                      <p className="mt-2 text-[11px] text-violet-700">
                        ✓ Pronta para o post de <b>{quandoEmBrasilia(selectedAgendado.data_agendada)}</b>. Até ele ser publicado, a automação fica esperando e não responde a outros posts.
                        {selectedAgendado.status === 'pendente' && <span className="block text-amber-700">Esse post ainda está pendente: aprove em Conteúdos para ele ser publicado.</span>}
                      </p>
                    )}
                  </div>
                )}
                <p className="mb-1.5 text-xs font-medium text-gray-500">Já publicados</p>
                {posts === null && !postsError && <p className="text-xs text-gray-400">Carregando seus posts…</p>}
                {postsError && <p className="text-xs text-amber-600">Não consegui listar os posts ({postsError.slice(0, 80)}). Você ainda pode usar &quot;Todos os posts&quot;.</p>}
                {posts && posts.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto">
                    {posts.map(p => (
                      <button key={p.id} type="button" onClick={() => { setSelectedPost(p); setSelectedAgendado(null) }}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 ${selectedPost !== 'all' && (selectedPost as IgMedia | null)?.id === p.id ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-transparent'}`}>
                        {(p.thumbnail_url || p.media_url)
                          ? <img src={p.thumbnail_url || p.media_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full bg-gray-100 flex items-center justify-center text-xs text-gray-400 p-1 text-center">{p.caption?.slice(0, 30) || 'Post'}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {triggerType === 'comment' ? 'Palavras-chave (Enter — vazio = qualquer comentário)'
                    : triggerType === 'dm' ? 'Palavras-chave da DM (Enter — obrigatório)'
                    : 'Palavras-chave (Enter — vazio = qualquer resposta ao story)'}
                </label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {keywords.map(k => (
                    <span key={k} className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 flex items-center gap-1">
                      {k}<button onClick={() => setKeywords(ks => ks.filter(x => x !== k))} className="text-indigo-300 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <input className={inputCls} value={keywordInput}
                  onChange={e => {
                    const v = e.target.value
                    // vírgula também adiciona (além do Enter)
                    if (v.includes(',')) {
                      const parts = v.split(',').map(s => s.trim()).filter(Boolean)
                      setKeywords(ks => [...ks, ...parts.filter(p => !ks.includes(p))])
                      setKeywordInput('')
                    } else setKeywordInput(v)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && keywordInput.trim()) { e.preventDefault(); if (!keywords.includes(keywordInput.trim())) setKeywords(ks => [...ks, keywordInput.trim()]); setKeywordInput('') } }}
                  onBlur={() => { if (keywordInput.trim() && !keywords.includes(keywordInput.trim())) { setKeywords(ks => [...ks, keywordInput.trim()]); setKeywordInput('') } }}
                  placeholder="Digite e aperte Enter (ex: EU QUERO)" />
              </div>

              {triggerType === 'comment' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resposta pública ao comentário (uma por linha — sorteia entre elas)</label>
                <div className="relative">
                  <textarea className={inputCls + ' h-20 pr-9'} value={commentReplies} onChange={e => setCommentReplies(e.target.value)}
                    placeholder={'Te chamei na DM! 🚀\nAcabei de te mandar mensagem 📩\nOlha a DM 😉'} />
                  <div className="absolute top-1 right-1"><EmojiPicker onPick={emoji => setCommentReplies(t => t + emoji)} /></div>
                </div>
              </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sequência de DMs (com espera entre as mensagens)</label>
                <div className="flex flex-col gap-3">
                  {dmSteps.map((s, i) => (
                    <div key={i} className="rounded-xl border border-purple-100 bg-purple-50/40 p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <span className="font-semibold text-purple-700">Passo {i + 1}</span>
                          {i === 0 ? <span className="text-xs text-gray-400">— espera após o comentário:</span> : <span className="text-xs text-gray-400">— espera após o passo anterior:</span>}
                          <input type="number" min={0} className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm" value={s.delay_value}
                            onChange={e => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, delay_value: Math.max(0, Number(e.target.value)) } : x))} />
                          <select className="px-2 py-1 border border-gray-200 rounded-lg text-sm" value={s.delay_unit}
                            onChange={e => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, delay_unit: e.target.value as 'min' | 'h' } : x))}>
                            <option value="min">min</option>
                            <option value="h">horas</option>
                          </select>
                        </div>
                        {dmSteps.length > 1 && (
                          <button type="button" onClick={() => setDmSteps(list => list.filter((_, xi) => xi !== i))} className="text-gray-300 hover:text-red-500">×</button>
                        )}
                      </div>
                      <div className="relative">
                        <textarea className={inputCls + ' h-16 bg-white pr-9'} value={s.text}
                          onChange={e => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, text: e.target.value } : x))}
                          placeholder={i === 0 ? 'Oi! Vi seu comentário 👋 Toma o link:' : 'E aí, conseguiu ver? Qualquer dúvida me chama!'} />
                        <div className="absolute top-1 right-1"><EmojiPicker onPick={emoji => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, text: x.text + emoji } : x))} /></div>
                      </div>
                      <StepMedia url={s.media_url} type={s.media_type}
                        onChange={(u, t) => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, media_url: u, media_type: t } : x))} />
                      {/* Botões: link (abre URL) ou resposta rápida ("SIM" — renova a janela de 24h) */}
                      {s.buttons.map((b, bi) => (
                        <div key={bi} className="flex gap-2 items-center">
                          <span className={`text-[10px] font-bold px-1.5 py-1 rounded ${b.kind === 'reply' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                            {b.kind === 'reply' ? '💬' : '🔗'}
                          </span>
                          <input className={inputCls + ' bg-white flex-1'} value={b.title}
                            placeholder={b.kind === 'reply' ? 'Texto da resposta (ex: SIM)' : 'Texto do botão (ex: ACESSAR)'}
                            onChange={e => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, buttons: x.buttons.map((bb, bbi) => bbi === bi ? { ...bb, title: e.target.value } : bb) } : x))} />
                          {b.kind === 'url' && (
                            <input className={inputCls + ' bg-white flex-[2]'} value={b.url} placeholder="https://..."
                              onChange={e => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, buttons: x.buttons.map((bb, bbi) => bbi === bi ? { ...bb, url: e.target.value } : bb) } : x))} />
                          )}
                          <button type="button" onClick={() => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, buttons: x.buttons.filter((_, bbi) => bbi !== bi) } : x))}
                            className="text-gray-300 hover:text-red-500 px-1">×</button>
                        </div>
                      ))}
                      <div className="flex gap-3">
                        {s.buttons.length < 3 && (
                          <button type="button" onClick={() => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, buttons: [...x.buttons, { title: '', url: '', kind: 'url' as const }] } : x))}
                            className="text-xs text-sky-600 hover:underline">+ 🔗 botão com link</button>
                        )}
                        {s.buttons.length < 3 && (
                          <button type="button" onClick={() => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, buttons: [...x.buttons, { title: '', url: '', kind: 'reply' as const }] } : x))}
                            className="text-xs text-emerald-600 hover:underline">+ 💬 botão de resposta (ex: SIM)</button>
                        )}
                      </div>
                      {s.buttons.some(b => b.kind === 'reply') && (
                        <p className="text-[11px] text-emerald-600/80">💡 Quando a pessoa toca no botão de resposta, ela &quot;fala&quot; com você — isso renova a janela de 24h e permite os próximos passos chegarem.</p>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setDmSteps(list => [...list, { ...emptyStep(), delay_value: 5 }])}
                    className="text-sm text-purple-600 font-medium hover:underline self-start">+ adicionar passo (mensagem com espera)</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Matricular o lead num funil (opcional)</label>
                  <select className={inputCls} value={funnelId} onChange={e => setFunnelId(e.target.value)}>
                    <option value="">Não matricular</option>
                    {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tag do lead (opcional)</label>
                  <input className={inputCls} value={leadTag} onChange={e => setLeadTag(e.target.value)} placeholder="Ex: ig-eu-quero" />
                </div>
              </div>
              <p className="text-xs text-gray-400 -mt-2">Quem comentar vira lead automaticamente (aparece em Leads com o @ do Instagram). A tag ajuda a filtrar; o funil dispara a sequência.</p>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={dmUseAgent} onChange={e => setDmUseAgent(e.target.checked)} className="w-4 h-4 accent-purple-600" />
                <span className="text-sm text-gray-700">🤖 Deixar o agente IA assumir a conversa se a pessoa responder a DM</span>
              </label>

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              <button onClick={save} disabled={saving}
                className="w-full px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-xl font-semibold disabled:opacity-60">
                {saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Criar automação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {contactsOf && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setContactsOf(null)}>
          <div className="bg-white rounded-3xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 bg-gradient-to-r from-pink-500 to-purple-600 flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold">👥 Contatos da automação</h2>
                <p className="text-white/70 text-xs">{contactsOf.name}</p>
              </div>
              <button onClick={() => setContactsOf(null)} className="text-white/70 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {contactsOf.loading ? (
                <p className="text-center text-sm text-gray-400 py-10">Carregando…</p>
              ) : contactsOf.list.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-10">Ninguém entrou nesta automação ainda.</p>
              ) : contactsOf.list.map(c => (
                <a key={c.ig_user_id} href={c.username ? `https://instagram.com/${c.username}` : undefined} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50">
                  {c.profile_pic
                    ? <img src={c.profile_pic} alt="" className="w-10 h-10 rounded-full object-cover" />
                    : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 text-white flex items-center justify-center font-bold">{(c.name ?? c.username ?? '?').charAt(0).toUpperCase()}</div>}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.name ?? (c.username ? `@${c.username}` : 'Contato')}</p>
                    {c.username && <p className="text-xs text-purple-500 truncate">@{c.username}</p>}
                  </div>
                  <span className="ml-auto text-[10px] text-gray-400">{new Date(c.last_at).toLocaleDateString('pt-BR')}</span>
                </a>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 text-center">
              <a href="/instagram/inbox" className="text-xs text-indigo-600 hover:underline">Abrir no Inbox para conversar →</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
