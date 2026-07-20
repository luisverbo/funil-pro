'use client'

import React, { useState } from 'react'
import { createIgAutomation, updateIgAutomation, deleteIgAutomation, listInstagramPosts, type IgAutomation } from '@/app/actions/ig-automations'
import type { IgMedia } from '@/lib/instagram'

const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

// Passo da sequência de DM (estado da UI)
// kind 'url' = botão de link; kind 'reply' = resposta rápida ("SIM") — renova a janela de 24h
type UiButton = { title: string; url: string; kind: 'url' | 'reply' }
type UiStep = { delay_value: number; delay_unit: 'min' | 'h'; text: string; buttons: UiButton[] }
const emptyStep = (): UiStep => ({ delay_value: 0, delay_unit: 'min', text: '', buttons: [] })

function stepsToDb(steps: UiStep[]) {
  return steps
    .filter(s => s.text.trim() || s.buttons.some(b => b.title && (b.kind === 'reply' || b.url)))
    .map(s => ({
      delay_minutes: s.delay_unit === 'h' ? s.delay_value * 60 : s.delay_value,
      text: s.text.trim(),
      buttons: s.buttons
        .filter(b => b.title && (b.kind === 'reply' || b.url))
        .map(b => b.kind === 'reply' ? { title: b.title } : { title: b.title, url: b.url }),
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
      buttons: (s.buttons ?? []).map(b => ({ title: b.title, url: (b as { url?: string }).url ?? '', kind: ((b as { url?: string }).url ? 'url' : 'reply') as 'url' | 'reply' })),
    }
  })
}

interface Connection { connected: boolean; username?: string; accountId?: string; error?: string }

export default function InstagramClient({ initialAutomations, connection, funnels = [] }: { initialAutomations: IgAutomation[]; connection?: Connection; funnels?: { id: string; name: string }[] }) {
  const [automations, setAutomations] = useState(initialAutomations)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // form
  const [name, setName] = useState('')
  const [posts, setPosts] = useState<IgMedia[] | null>(null)
  const [postsError, setPostsError] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<IgMedia | 'all' | null>(null)
  const [keywordInput, setKeywordInput] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [commentReplies, setCommentReplies] = useState('')
  const [dmSteps, setDmSteps] = useState<UiStep[]>([emptyStep()])
  const [dmUseAgent, setDmUseAgent] = useState(true)
  const [funnelId, setFunnelId] = useState('')
  const [leadTag, setLeadTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function loadPosts() {
    setPosts(null); setPostsError(null)
    const { posts: p, error } = await listInstagramPosts()
    if (error) setPostsError(error)
    setPosts(p)
  }

  async function openModal() {
    setModalOpen(true); setEditingId(null)
    setName(''); setSelectedPost(null); setKeywords([]); setKeywordInput('')
    setCommentReplies(''); setDmSteps([emptyStep()]); setDmUseAgent(true); setFunnelId(''); setLeadTag(''); setSaveError(null)
    await loadPosts()
  }

  async function openEdit(a: IgAutomation) {
    setModalOpen(true); setEditingId(a.id)
    setName(a.name)
    setSelectedPost(a.media_id ? { id: a.media_id, caption: a.media_caption ?? undefined, thumbnail_url: a.media_thumb ?? undefined } : 'all')
    setKeywords(a.keywords ?? []); setKeywordInput('')
    setCommentReplies((a.comment_replies ?? []).join('\n'))
    setDmSteps(dbToSteps(a))
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
    if (steps.length === 0 && !commentReplies.trim()) { setSaveError('Defina ao menos a resposta do comentário ou um passo de DM'); return }
    setSaving(true); setSaveError(null)
    const media = selectedPost && selectedPost !== 'all' ? selectedPost : null
    const payload = {
      name: name || 'Automação',
      media_id: media?.id ?? null,
      media_caption: media?.caption?.slice(0, 120) ?? null,
      media_thumb: media?.thumbnail_url ?? media?.media_url ?? null,
      keywords: finalKeywords,
      comment_replies: commentReplies.split('\n').map(s => s.trim()).filter(Boolean),
      dm_message: steps[0]?.text || null,
      dm_steps: steps.length > 0 ? steps : null,
      dm_use_agent: dmUseAgent,
      funnel_id: funnelId || null,
      lead_tag: leadTag || null,
    }

    if (editingId) {
      const { success, error } = await updateIgAutomation(editingId, payload)
      setSaving(false)
      if (!success) { setSaveError(error ?? 'Erro ao salvar'); return }
      setAutomations(a => a.map(x => x.id === editingId ? { ...x, ...payload } : x))
      setModalOpen(false)
      return
    }

    const { id, error } = await createIgAutomation(payload)
    setSaving(false)
    if (error) { setSaveError(error); return }
    setAutomations(a => [{
      id: id!, status: 'active', triggers_count: 0, created_at: new Date().toISOString(),
      follow_gate: false, follow_gate_message: null, canvas: null, trigger_type: 'comment' as const, ...payload,
    }, ...a])
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
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automações do Instagram</h1>
          <p className="text-sm text-gray-500">Comentou a palavra-chave no post → responde o comentário e manda DM. A IA pode assumir a conversa.</p>
        </div>
        <button onClick={openModal}
          className="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-pink-200 transition-all hover:-translate-y-0.5">
          + Nova automação
        </button>
      </div>

      {/* Status da conexão */}
      {connection?.connected ? (
        <div className="mt-4 mb-2 flex items-center gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <p className="text-sm text-emerald-800">
            Conectado como <strong>@{connection.username}</strong>
            {connection.accountId ? <span className="text-emerald-600/70"> · ID {connection.accountId}</span> : null}
          </p>
        </div>
      ) : (
        <div className="mt-4 mb-2 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">⚠️ Instagram ainda não conectado</p>
          <ol className="text-sm text-amber-800/90 flex flex-col gap-1.5 list-decimal list-inside">
            <li>No painel da Meta (developers.facebook.com → seu app → caso de uso do Instagram), vá no passo <strong>&quot;2. Gerar tokens de acesso&quot;</strong>, conecte sua conta profissional e clique em <strong>Gerar token</strong>.</li>
            <li>Na <strong>Vercel</strong> → projeto funil-pro → Settings → Environment Variables, adicione: <code className="bg-amber-100 px-1 rounded">IG_ACCESS_TOKEN</code> (o token gerado) e <code className="bg-amber-100 px-1 rounded">IG_APP_SECRET</code> (chave secreta do app do Instagram).</li>
            <li>Faça <strong>Redeploy</strong> na Vercel e recarregue esta página — o status fica verde com o seu @.</li>
          </ol>
          {connection?.error && connection.error !== 'token_missing' && (
            <p className="text-xs text-amber-600 mt-2">Detalhe técnico: {connection.error.slice(0, 140)}</p>
          )}
        </div>
      )}

      {automations.length === 0 ? (
        <div className="border-2 border-dashed rounded-2xl p-12 text-center text-gray-500 mt-6">
          <p className="text-3xl mb-2">📸</p>
          <p className="font-medium">Nenhuma automação ainda</p>
          <p className="text-sm mt-1">Ex: quem comentar <span className="font-semibold">&quot;EU QUERO&quot;</span> no seu post recebe o link na DM automaticamente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {automations.map(a => (
            <div key={a.id} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                {a.media_thumb
                  ? <img src={a.media_thumb} alt="" className="w-14 h-14 rounded-xl object-cover" />
                  : <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-xl">📣</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">{a.name}</h3>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${a.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {a.status === 'active' ? 'Ativa' : 'Pausada'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{a.media_id ? (a.media_caption || 'Post específico') : 'Todos os posts'}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {a.keywords.length > 0
                  ? a.keywords.map(k => <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">{k}</span>)
                  : <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">qualquer comentário</span>}
              </div>
              <div className="text-xs text-gray-500 flex flex-col gap-1">
                {a.comment_replies.length > 0 && <p>💬 Responde: “{a.comment_replies[0]}”{a.comment_replies.length > 1 ? ` (+${a.comment_replies.length - 1})` : ''}</p>}
                {(() => {
                  const n = a.dm_steps?.length ?? (a.dm_message ? 1 : 0)
                  const first = a.dm_steps?.[0]?.text ?? a.dm_message
                  return n > 0 ? <p>📩 Sequência: {n} passo(s){first ? ` — “${first.slice(0, 45)}${first.length > 45 ? '…' : ''}”` : ''}</p> : null
                })()}
                {a.dm_use_agent && <p>🤖 IA assume a conversa na DM</p>}
                {a.funnel_id && <p>🔀 Lead entra num funil</p>}
                {a.lead_tag && <p>🏷 Tag: {a.lead_tag}</p>}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-50 mt-auto">
                <span className="text-xs text-gray-400">{a.triggers_count} disparo(s)</span>
                <div className="flex gap-3">
                  <a href={`/instagram/${a.id}/editor`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">🎨 Abrir no editor</a>
                  <button onClick={() => toggle(a)} className={`text-xs font-medium ${a.status === 'active' ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {a.status === 'active' ? '⏸ Pausar' : '▶ Ativar'}
                  </button>
                  <button onClick={() => remove(a.id)} className="text-xs text-gray-300 hover:text-red-500">Excluir</button>
                </div>
              </div>
            </div>
          ))}
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Em qual post?</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  <button type="button" onClick={() => setSelectedPost('all')}
                    className={`text-xs px-3 py-1.5 rounded-full border ${selectedPost === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}>
                    🌐 Todos os posts
                  </button>
                </div>
                {posts === null && !postsError && <p className="text-xs text-gray-400">Carregando seus posts…</p>}
                {postsError && <p className="text-xs text-amber-600">Não consegui listar os posts ({postsError.slice(0, 80)}). Você ainda pode usar &quot;Todos os posts&quot;.</p>}
                {posts && posts.length > 0 && (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto">
                    {posts.map(p => (
                      <button key={p.id} type="button" onClick={() => setSelectedPost(p)}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 ${selectedPost !== 'all' && (selectedPost as IgMedia | null)?.id === p.id ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-transparent'}`}>
                        {(p.thumbnail_url || p.media_url)
                          ? <img src={p.thumbnail_url || p.media_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full bg-gray-100 flex items-center justify-center text-xs text-gray-400 p-1 text-center">{p.caption?.slice(0, 30) || 'Post'}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Palavras-chave (Enter para adicionar — vazio = qualquer comentário)</label>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Resposta pública ao comentário (uma por linha — sorteia entre elas)</label>
                <textarea className={inputCls + ' h-20'} value={commentReplies} onChange={e => setCommentReplies(e.target.value)}
                  placeholder={'Te chamei na DM! 🚀\nAcabei de te mandar mensagem 📩\nOlha a DM 😉'} />
              </div>

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
                      <textarea className={inputCls + ' h-16 bg-white'} value={s.text}
                        onChange={e => setDmSteps(list => list.map((x, xi) => xi === i ? { ...x, text: e.target.value } : x))}
                        placeholder={i === 0 ? 'Oi! Vi seu comentário 👋 Toma o link:' : 'E aí, conseguiu ver? Qualquer dúvida me chama!'} />
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
    </div>
  )
}
