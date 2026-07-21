'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { savePage, publishPage, unpublishPage } from '@/app/actions/pages'
import { BIO_THEMES, emptyBio, type BioData, type BioButton } from '@/lib/bio/types'
import { ImageInput } from '@/components/page-builder/image-input'

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'b' + Math.random().toString(36).slice(2))
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function BioEditorClient({ page, clicks }: { page: any; clicks: Record<string, number> }) {
  const router = useRouter()
  const initial: BioData = (page.craft_json && (page.craft_json as BioData).version === 1)
    ? page.craft_json as BioData
    : { ...emptyBio(), display_name: page.title }
  const [bio, setBio] = useState<BioData>(initial)
  const [published, setPublished] = useState<boolean>(page.published)
  const [slug, setSlug] = useState<string | null>(page.slug)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const t = BIO_THEMES[bio.theme ?? 'gradient'] ?? BIO_THEMES.gradient
  const patch = (p: Partial<BioData>) => setBio(b => ({ ...b, ...p }))
  const patchBtn = (id: string, p: Partial<BioButton>) => setBio(b => ({ ...b, buttons: b.buttons.map(x => x.id === id ? { ...x, ...p } : x) }))
  const moveBtn = (id: string, dir: -1 | 1) => setBio(b => {
    const i = b.buttons.findIndex(x => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= b.buttons.length) return b
    const arr = [...b.buttons]; [arr[i], arr[j]] = [arr[j], arr[i]]
    return { ...b, buttons: arr }
  })

  async function save() {
    setSaving(true)
    await savePage(page.id, bio as unknown as object)
    setSaving(false)
    setSavedAt(Date.now())
  }
  async function togglePublish() {
    await save()
    if (published) { await unpublishPage(page.id); setPublished(false) }
    else { const s = await publishPage(page.id); setSlug(s); setPublished(true) }
  }

  const publicUrl = slug ? `${typeof window !== 'undefined' ? window.location.origin : ''}/pg/${slug}` : null

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50" style={{ zIndex: 30 }}>
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b shrink-0">
        <button onClick={() => router.push('/pages')} className="text-sm text-indigo-600 hover:underline">← Páginas</button>
        <span className="font-semibold text-gray-900">🔗 Bio Link</span>
        {published && publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline truncate max-w-[220px]">{publicUrl.replace(/^https?:\/\//, '')}</a>
        )}
        <div className="ml-auto flex items-center gap-2">
          {savedAt && <span className="text-xs text-gray-400">✓ Salvo</span>}
          {published && publicUrl && (
            <button onClick={() => { navigator.clipboard.writeText(publicUrl).catch(() => {}) }}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">📋 Copiar link</button>
          )}
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-sm border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-60">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          <button onClick={togglePublish}
            className={`px-4 py-1.5 text-sm font-semibold text-white rounded-lg ${published ? 'bg-gray-500 hover:bg-gray-600' : 'bg-gradient-to-r from-violet-500 to-pink-500 hover:opacity-90'}`}>
            {published ? 'Despublicar' : 'Publicar'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Painel de edição */}
        <div className="w-[420px] shrink-0 bg-white border-r overflow-y-auto p-5 flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Perfil</h3>
            <div className="flex flex-col gap-3">
              <ImageInput label="Foto de perfil" value={bio.avatar_url} onChange={url => patch({ avatar_url: url })} />
              <div>
                <label className="text-xs text-gray-500 block mb-1">Nome</label>
                <input className={inputCls} value={bio.display_name ?? ''} onChange={e => patch({ display_name: e.target.value })} placeholder="Seu nome ou @usuario" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Bio curta</label>
                <textarea className={inputCls + ' h-16'} value={bio.bio ?? ''} onChange={e => patch({ bio: e.target.value })} placeholder="Ex: Ajudo empreendedores a vender todos os dias 🚀" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-2">🎨 Tema</h3>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(BIO_THEMES).map(([key, th]) => (
                <button key={key} onClick={() => patch({ theme: key as BioData['theme'] })}
                  className={`h-14 rounded-xl border-2 ${bio.theme === key ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-transparent'}`}
                  style={{ background: th.bg }} title={key} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Redes sociais <span className="font-normal text-gray-400">(só o @ ou número)</span></h3>
            <div className="grid grid-cols-2 gap-2">
              {([['instagram', '📷 Instagram'], ['youtube', '▶️ YouTube'], ['tiktok', '🎵 TikTok'], ['whatsapp', '💬 WhatsApp']] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500 block mb-1">{label}</label>
                  <input className={inputCls} value={bio.socials?.[key] ?? ''}
                    placeholder={key === 'whatsapp' ? '5511999999999' : '@seuperfil'}
                    onChange={e => patch({ socials: { ...bio.socials, [key]: e.target.value } })} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-900">Botões</h3>
              <button onClick={() => setBio(b => ({ ...b, buttons: [...b.buttons, { id: newId(), emoji: '🔗', label: '', url: '' }] }))}
                className="text-xs font-semibold text-indigo-600 hover:underline">+ Adicionar botão</button>
            </div>
            <div className="flex flex-col gap-2.5">
              {bio.buttons.length === 0 && (
                <p className="text-xs text-gray-400 border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
                  Adicione botões pro seu quiz, página de captura, WhatsApp, chat da IA…
                </p>
              )}
              {bio.buttons.map((b, i) => (
                <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex flex-col gap-2 bg-gray-50">
                  <div className="flex items-center gap-1.5">
                    <input className={inputCls + ' !w-14 text-center'} value={b.emoji ?? ''} maxLength={4}
                      onChange={e => patchBtn(b.id, { emoji: e.target.value })} placeholder="🔗" />
                    <input className={inputCls} value={b.label} onChange={e => patchBtn(b.id, { label: e.target.value })} placeholder="Texto do botão (ex: Faça o teste grátis)" />
                    <div className="flex flex-col">
                      <button onClick={() => moveBtn(b.id, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none">▲</button>
                      <button onClick={() => moveBtn(b.id, 1)} disabled={i === bio.buttons.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none">▼</button>
                    </div>
                    <button onClick={() => setBio(x => ({ ...x, buttons: x.buttons.filter(y => y.id !== b.id) }))}
                      className="text-gray-300 hover:text-red-500">×</button>
                  </div>
                  <input className={inputCls} value={b.url} onChange={e => patchBtn(b.id, { url: e.target.value })}
                    placeholder="https://… (link do quiz, página, wa.me, chat da IA)" />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                      <input type="checkbox" checked={b.highlight ?? false} onChange={e => patchBtn(b.id, { highlight: e.target.checked })} className="accent-pink-500" />
                      ✨ Destacar (pulsa)
                    </label>
                    <span className="text-[11px] text-gray-400">👆 {clicks[b.id] ?? 0} clique{(clicks[b.id] ?? 0) === 1 ? '' : 's'}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-emerald-600 bg-emerald-50 rounded-lg p-2 mt-3">
              💡 Aponte os botões pros SEUS links do FunilPro: quiz (/pg/…), página de captura, chat da IA (/a/…) ou wa.me — cada clique é contado aqui.
            </p>
          </div>
        </div>

        {/* Prévia ao vivo (celular) */}
        <div className="flex-1 overflow-y-auto flex items-start justify-center py-8 bg-gray-100">
          <div className="w-[375px] rounded-[2rem] border-8 border-gray-900 overflow-hidden shadow-2xl shrink-0">
            <div className="h-[640px] overflow-y-auto" style={{ background: t.bg }}>
              <div className="flex flex-col items-center px-5 py-10">
                {bio.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bio.avatar_url} alt="" className="w-24 h-24 rounded-full object-cover ring-4 ring-white/30 shadow-xl" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-4xl ring-4 ring-white/30">👤</div>
                )}
                {bio.display_name && <h1 className="mt-4 text-2xl font-bold text-center" style={{ color: t.text }}>{bio.display_name}</h1>}
                {bio.bio && <p className="mt-1.5 text-sm text-center leading-relaxed" style={{ color: t.sub }}>{bio.bio}</p>}
                {Object.values(bio.socials ?? {}).some(Boolean) && (
                  <div className="flex gap-3 mt-4">
                    {Object.entries(bio.socials ?? {}).filter(([, v]) => v).map(([key]) => (
                      <span key={key} className="w-11 h-11 rounded-full flex items-center justify-center text-xl"
                        style={{ background: t.btnBg, border: `1px solid ${t.btnBorder}` }}>
                        {key === 'instagram' ? '📷' : key === 'youtube' ? '▶️' : key === 'tiktok' ? '🎵' : '💬'}
                      </span>
                    ))}
                  </div>
                )}
                <div className="w-full flex flex-col gap-3.5 mt-7">
                  {bio.buttons.filter(b => b.label).map(b => (
                    <div key={b.id}
                      className={`w-full py-4 px-5 rounded-2xl text-center font-semibold shadow-lg flex items-center justify-center gap-2 ${b.highlight ? 'animate-pulse' : ''}`}
                      style={{ background: t.btnBg, color: t.btnText, border: `1px solid ${t.btnBorder}` }}>
                      {b.emoji && <span className="text-lg">{b.emoji}</span>}
                      <span>{b.label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-10 text-[11px] opacity-60" style={{ color: t.sub }}>feito com FunilPro</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
