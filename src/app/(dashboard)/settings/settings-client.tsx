'use client'

import { useState, useTransition } from 'react'
import { updateProfile, updateTenant, updateMetaPixel } from '@/app/actions/settings'

interface Props {
  user: { id: string; email: string; name: string }
  tenant: { id: string; name: string; slug: string; plan: string; emailQuotaUsed: number; emailQuotaLimit: number }
  metaPixelId: string
  waInstancesCount: number
  waInstancesLimit: number
}

const PLAN_META: Record<string, { label: string; color: string; bg: string }> = {
  starter: { label: 'Starter', color: '#6b7280', bg: '#f3f4f6' },
  pro:     { label: 'Pro',     color: '#7c3aed', bg: '#f5f3ff' },
  scale:   { label: 'Scale',   color: '#059669', bg: '#ecfdf5' },
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 mb-5">{title}</h2>
      {children}
    </div>
  )
}

function SaveButton({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
    >
      {pending ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar'}
    </button>
  )
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="mt-1">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{value.toLocaleString('pt-BR')}</span>
        <span>{max.toLocaleString('pt-BR')}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function SettingsClient({ user, tenant, metaPixelId, waInstancesCount, waInstancesLimit }: Props) {
  const [isPending, startTransition] = useTransition()
  const [profileSaved, setProfileSaved] = useState(false)
  const [tenantSaved, setTenantSaved] = useState(false)
  const [pixelSaved, setPixelSaved] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)
  const [profileErr, setProfileErr] = useState('')
  const [tenantErr, setTenantErr] = useState('')
  const [pixelErr, setPixelErr] = useState('')

  // Notification toggles (UI only)
  const [notifs, setNotifs] = useState({ leads: true, purchase: true, published: false })

  function handleProfile(formData: FormData) {
    setProfileErr('')
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (res.success) { setProfileSaved(true); setTimeout(() => setProfileSaved(false), 2000) }
      else setProfileErr(res.error ?? 'Erro')
    })
  }

  function handleTenant(formData: FormData) {
    setTenantErr('')
    startTransition(async () => {
      const res = await updateTenant(formData)
      if (res.success) { setTenantSaved(true); setTimeout(() => setTenantSaved(false), 2000) }
      else setTenantErr(res.error ?? 'Erro')
    })
  }

  function handlePixel(formData: FormData) {
    setPixelErr('')
    startTransition(async () => {
      const res = await updateMetaPixel(formData)
      if (res.success) { setPixelSaved(true); setTimeout(() => setPixelSaved(false), 2000) }
      else setPixelErr(res.error ?? 'Erro')
    })
  }

  const planMeta = PLAN_META[tenant.plan] ?? PLAN_META.starter

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="text-sm text-gray-500 mt-1">Gerencie sua conta e preferências</p>
      </div>

      {/* Meu Perfil */}
      <SectionCard title="Meu Perfil">
        <form action={handleProfile} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
            <input
              name="display_name"
              defaultValue={user.name}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Seu nome completo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              value={user.email}
              readOnly
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500 cursor-not-allowed"
            />
          </div>
          {profileErr && <p className="text-sm text-red-600">{profileErr}</p>}
          <SaveButton pending={isPending} saved={profileSaved} />
        </form>
      </SectionCard>

      {/* Meu Negócio */}
      <SectionCard title="Meu Negócio">
        <form action={handleTenant} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do negócio</label>
            <input
              name="name"
              defaultValue={tenant.name}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Nome da sua empresa"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug (subdomínio)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">funil.pro/</span>
              <span className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-500 flex-1">{tenant.slug}</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">O slug não pode ser alterado após o cadastro.</p>
          </div>
          {tenantErr && <p className="text-sm text-red-600">{tenantErr}</p>}
          <SaveButton pending={isPending} saved={tenantSaved} />
        </form>
      </SectionCard>

      {/* Meta Pixel */}
      <SectionCard title="Meta Pixel">
        <form action={handlePixel} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pixel ID</label>
            <input
              name="meta_pixel_id"
              defaultValue={metaPixelId}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              placeholder="123456789012345"
            />
            <p className="text-xs text-gray-400 mt-1">
              Encontre o Pixel ID no Gerenciador de Eventos do Meta. Será disparado automaticamente nas páginas de captura.
            </p>
          </div>
          {pixelErr && <p className="text-sm text-red-600">{pixelErr}</p>}
          <SaveButton pending={isPending} saved={pixelSaved} />
        </form>
      </SectionCard>

      {/* Meu Plano */}
      <SectionCard title="Meu Plano">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className="text-sm font-bold px-3 py-1 rounded-full"
              style={{ color: planMeta.color, backgroundColor: planMeta.bg }}
            >
              {planMeta.label}
            </span>
            <span className="text-sm text-gray-500">Plano atual</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Instâncias WhatsApp</span>
                <span className="text-gray-500">{waInstancesCount} / {waInstancesLimit}</span>
              </div>
              <ProgressBar value={waInstancesCount} max={waInstancesLimit} />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">E-mails no mês</span>
                <span className="text-gray-500">{tenant.emailQuotaUsed.toLocaleString('pt-BR')} / {tenant.emailQuotaLimit.toLocaleString('pt-BR')}</span>
              </div>
              <ProgressBar value={tenant.emailQuotaUsed} max={tenant.emailQuotaLimit} />
            </div>
          </div>

          <div className="pt-2">
            <div className="relative inline-block">
              <button
                disabled
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg opacity-50 cursor-not-allowed"
                title="Em breve"
              >
                Fazer Upgrade
              </button>
              <span className="absolute -top-2 -right-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full border border-gray-200">Em breve</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Notificações */}
      <SectionCard title="Notificações por E-mail">
        <div className="space-y-4">
          {[
            { key: 'leads' as const, label: 'Novos leads', desc: 'Receba um e-mail quando um novo lead entrar em seu funil' },
            { key: 'purchase' as const, label: 'Compra realizada', desc: 'Notificação quando uma compra for confirmada' },
            { key: 'published' as const, label: 'Funil publicado', desc: 'Confirmação ao publicar ou pausar um funil' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-start gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={notifs[key]}
                onClick={() => setNotifs(n => ({ ...n, [key]: !n[key] }))}
                className={`mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${notifs[key] ? 'bg-indigo-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${notifs[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <div>
                <p className="text-sm font-medium text-gray-800">{label}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => { setNotifSaved(true); setTimeout(() => setNotifSaved(false), 2000) }}
            className="mt-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {notifSaved ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
      </SectionCard>
    </div>
  )
}
