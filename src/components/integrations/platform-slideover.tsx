'use client'

import React, { useState, useTransition } from 'react'
import { addProduct, deleteProduct } from '@/app/actions/products'
import type { Product } from '@/types'

interface Platform {
  id: string
  name: string
  color: string
  bgColor: string
  icon: string
  webhookUrl: string
  instructions: string[]
}

interface Props {
  platform: Platform
  initialProducts: Product[]
  onClose: () => void
}

const TYPE_LABELS: Record<string, string> = {
  main: 'Principal',
  order_bump: 'Order Bump',
  upsell: 'Upsell',
}

export default function PlatformSlideover({ platform, initialProducts, onClose }: Props) {
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [formExtId, setFormExtId] = useState('')
  const [formType, setFormType] = useState<'main' | 'order_bump' | 'upsell'>('main')
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [formError, setFormError] = useState<string | null>(null)

  const handleCopy = () => {
    navigator.clipboard.writeText(platform.webhookUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const fd = new FormData()
    fd.set('name', formName)
    fd.set('platform', platform.id)
    fd.set('product_id_external', formExtId)
    fd.set('price_cents', formPrice)
    fd.set('type', formType)

    startTransition(async () => {
      const result = await addProduct(fd)
      if (!result.success) {
        setFormError(result.error ?? 'Erro ao salvar produto')
        return
      }
      // Optimistically add (server will revalidate)
      setProducts((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          tenant_id: '',
          platform: platform.id,
          product_id_external: formExtId,
          name: formName,
          price_cents: Math.round(parseFloat(formPrice || '0') * 100),
          type: formType,
          created_at: new Date().toISOString(),
        },
      ])
      setFormName('')
      setFormPrice('')
      setFormExtId('')
      setFormType('main')
      setShowForm(false)
    })
  }

  const handleDelete = (productId: string) => {
    startTransition(async () => {
      await deleteProduct(productId)
      setProducts((prev) => prev.filter((p) => p.id !== productId))
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between" style={{ borderLeftColor: platform.color, borderLeftWidth: 4 }}>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold"
              style={{ backgroundColor: platform.color }}
            >
              {platform.icon}
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{platform.name}</h2>
              <p className="text-xs text-gray-500">Configurações de integração</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Webhook URL */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">URL do Webhook</p>
            <div className="bg-gray-50 rounded-xl p-3 flex items-start gap-2">
              <p className="text-xs font-mono text-gray-700 break-all flex-1 leading-relaxed">
                {platform.webhookUrl}
              </p>
              <button
                onClick={handleCopy}
                className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Como configurar</p>
            <ol className="space-y-2">
              {platform.instructions.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span
                    className="shrink-0 w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-semibold mt-0.5"
                    style={{ backgroundColor: platform.color }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Produtos</p>
              <button
                onClick={() => setShowForm((v) => !v)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-colors"
                style={{ backgroundColor: platform.color }}
              >
                {showForm ? 'Cancelar' : '+ Adicionar produto'}
              </button>
            </div>

            {/* Add Product Form */}
            {showForm && (
              <form onSubmit={handleAddProduct} className="bg-gray-50 rounded-xl p-4 mb-3 space-y-3">
                {formError && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nome do produto *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ex: Curso de Emagrecimento"
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Preço (R$)</label>
                    <input
                      type="number"
                      value={formPrice}
                      onChange={(e) => setFormPrice(e.target.value)}
                      placeholder="197.00"
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as 'main' | 'order_bump' | 'upsell')}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option value="main">Principal</option>
                      <option value="order_bump">Order Bump</option>
                      <option value="upsell">Upsell</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ID externo ({platform.name}) *</label>
                  <input
                    type="text"
                    value={formExtId}
                    onChange={(e) => setFormExtId(e.target.value)}
                    placeholder="ID do produto na plataforma"
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
                  style={{ backgroundColor: platform.color }}
                >
                  {isPending ? 'Salvando…' : 'Salvar produto'}
                </button>
              </form>
            )}

            {products.length === 0 ? (
              <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl">
                <p className="text-sm">Nenhum produto cadastrado</p>
                <p className="text-xs mt-1">Adicione produtos para melhorar o rastreamento de order bumps e upsells</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Produto</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Preço</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Tipo</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={p.id} className={i < products.length - 1 ? 'border-b border-gray-100' : ''}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-gray-800 truncate max-w-[120px]">{p.name}</p>
                          <p className="text-xs text-gray-400 font-mono truncate max-w-[120px]">{p.product_id_external}</p>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                          {p.price_cents > 0 ? `R$ ${(p.price_cents / 100).toFixed(2).replace('.', ',')}` : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            p.type === 'main' ? 'bg-blue-50 text-blue-700' :
                            p.type === 'order_bump' ? 'bg-orange-50 text-orange-700' :
                            'bg-purple-50 text-purple-700'
                          }`}>
                            {TYPE_LABELS[p.type]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => handleDelete(p.id)}
                            disabled={isPending}
                            className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                              <polyline points="3,6 5,6 21,6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6m4-6v6" /><path d="M9 6V4h6v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Link to orphans */}
          <a
            href="/integrations/orphans"
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            Ver compras não vinculadas
          </a>
        </div>
      </div>
    </div>
  )
}
