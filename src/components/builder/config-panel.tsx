'use client'

import React, { useCallback } from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

interface Props {
  selectedNodeId: string | null
  nodes: Node[]
  onClose: () => void
  funnelId: string
  onOpenCaptureEditor?: () => void
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  entry: {
    label: 'Entrada',
    color: '#6366f1',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  },
  message: {
    label: 'Mensagem',
    color: '#0ea5e9',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  condition: {
    label: 'Condição',
    color: '#f59e0b',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 6H8a2 2 0 0 0-2 2v7" />
        <circle cx="6" cy="18" r="3" />
      </svg>
    ),
  },
  delay: {
    label: 'Atraso',
    color: '#8b5cf6',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
      </svg>
    ),
  },
  tag: {
    label: 'Tag',
    color: '#10b981',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
  },
  sale: {
    label: 'Venda',
    color: '#f97316',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  cart_abandoned: {
    label: 'Carr. Abandonado',
    color: '#6366f1',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
}

const CONDITIONS = [
  { value: 'opened', label: 'Abriu mensagem' },
  { value: 'not_opened', label: 'Não abriu' },
  { value: 'clicked', label: 'Clicou no link' },
  { value: 'not_clicked', label: 'Não clicou' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'purchased', label: 'Comprou' },
  { value: 'tag', label: 'Tem tag' },
]

const ENTRY_TYPES = [
  { value: 'link_utm', label: 'Link UTM' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'form', label: 'Formulário' },
]

const MEDIA_LABELS = {
  none: 'Sem anexo',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'PDF / Arquivo',
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 block mb-1.5">{children}</label>
}

function FieldWrap({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>
}

const inputClass =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow'

const selectClass =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow'

export default function ConfigPanel({ selectedNodeId, nodes, onClose, funnelId, onOpenCaptureEditor }: Props) {
  const { setNodes } = useReactFlow()

  const node = nodes.find((n) => n.id === selectedNodeId)
  if (!node) return null

  const nodeData = node.data as unknown as FunnelNodeData
  const blockType = (nodeData.blockType as string) ?? node.type ?? 'message'
  const config = (nodeData.config ?? {}) as Record<string, unknown>
  const meta = TYPE_META[blockType] ?? TYPE_META.message

  const update = (patch: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, config: { ...config, ...patch } } }
          : n
      )
    )
  }

  const handleDelete = () => {
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
    onClose()
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'
  const activateUrl = funnelId
    ? `${appUrl}/api/funnels/${funnelId}/activate`
    : `${appUrl}/api/funnels/{id}/activate`

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-gray-100">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
        >
          {meta.icon}
        </div>
        <span className="flex-1 text-sm font-semibold text-gray-800">{meta.label}</span>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors font-medium"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" />
            <path d="M10,11v6M14,11v6" />
            <path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V6" />
          </svg>
          Deletar
        </button>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {blockType === 'entry' && (
          <>
            <FieldWrap>
              <Label>Tipo de entrada</Label>
              <select
                value={(config.entry_type as string) ?? 'link_utm'}
                onChange={(e) => update({ entry_type: e.target.value })}
                className={selectClass}
              >
                {ENTRY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </FieldWrap>
            <FieldWrap>
              <Label>URL de ativação</Label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500 font-mono break-all leading-relaxed select-all">
                  POST {activateUrl}
                </p>
              </div>
            </FieldWrap>
            <FieldWrap>
              <Label>Campos esperados</Label>
              <div className="flex flex-wrap gap-1.5">
                {['nome', 'email', 'telefone', 'utm_source', 'utm_ad_id'].map((f) => (
                  <span key={f} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md font-mono">
                    {f}
                  </span>
                ))}
              </div>
            </FieldWrap>
            {(config.entry_type as string) === 'form' && (
              <FieldWrap>
                <Label>Página de captura</Label>
                {(config.page_configured as boolean) ? (
                  <div className="space-y-2">
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-green-500 shrink-0">
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                      <span className="text-xs text-green-700 font-medium">
                        Página configurada ✓{(config.page_template as string) ? ` — ${config.page_template as string}` : ''}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={onOpenCaptureEditor}
                        className="flex-1 text-xs px-3 py-2 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium"
                      >
                        Editar página
                      </button>
                      {funnelId && (
                        <a
                          href={`/p/${funnelId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-3 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                        >
                          Ver
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <p className="text-xs text-gray-500">Nenhuma página configurada.</p>
                    </div>
                    <button
                      onClick={onOpenCaptureEditor}
                      className="w-full text-xs px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                    >
                      Criar página de captura
                    </button>
                  </div>
                )}
              </FieldWrap>
            )}
          </>
        )}

        {blockType === 'message' && (
          <>
            <FieldWrap>
              <Label>Canal</Label>
              <select
                value={(config.channel as string) ?? 'whatsapp'}
                onChange={(e) => update({ channel: e.target.value })}
                className={selectClass}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </select>
            </FieldWrap>
            <FieldWrap>
              <Label>
                {(config.media_type ?? 'none') !== 'none' ? 'Legenda / Texto' : 'Mensagem'}
              </Label>
              <textarea
                value={(config.body as string) ?? ''}
                onChange={(e) => update({ body: e.target.value })}
                placeholder="Digite o texto da mensagem..."
                rows={5}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none transition-shadow"
              />
            </FieldWrap>
            {((config.channel as string) ?? 'whatsapp') === 'whatsapp' && (
              <>
                <FieldWrap>
                  <Label>Tipo de mídia</Label>
                  <select
                    value={(config.media_type as string) ?? 'none'}
                    onChange={(e) => update({ media_type: e.target.value, media_url: '' })}
                    className={selectClass}
                  >
                    {(Object.entries(MEDIA_LABELS) as [string, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </FieldWrap>
                {(config.media_type as string) && config.media_type !== 'none' && (
                  <FieldWrap>
                    <Label>URL da mídia</Label>
                    <input
                      type="url"
                      value={(config.media_url as string) ?? ''}
                      onChange={(e) => update({ media_url: e.target.value })}
                      placeholder="https://..."
                      className={inputClass}
                    />
                    <p className="text-xs text-gray-400 mt-1">Use um link público direto para o arquivo.</p>
                  </FieldWrap>
                )}
              </>
            )}
          </>
        )}

        {blockType === 'condition' && (
          <FieldWrap>
            <Label>Verificar se o lead</Label>
            <select
              value={(config.condition as string) ?? 'opened'}
              onChange={(e) => update({ condition: e.target.value })}
              className={selectClass}
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              Saída <span className="text-emerald-600 font-semibold">Sim</span> = condição verdadeira.
              Saída <span className="text-red-500 font-semibold">Não</span> = condição falsa.
            </p>
          </FieldWrap>
        )}

        {blockType === 'delay' && (
          <div className="flex gap-3">
            <FieldWrap>
              <Label>Duração</Label>
              <input
                type="number"
                min={1}
                value={(config.duration as number) ?? 1}
                onChange={(e) => update({ duration: Number(e.target.value) })}
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Unidade</Label>
              <select
                value={(config.unit as string) ?? 'horas'}
                onChange={(e) => update({ unit: e.target.value })}
                className={selectClass}
              >
                <option value="minutos">Minutos</option>
                <option value="horas">Horas</option>
                <option value="dias">Dias</option>
              </select>
            </FieldWrap>
          </div>
        )}

        {blockType === 'tag' && (
          <>
            <FieldWrap>
              <Label>Nome da tag</Label>
              <input
                type="text"
                value={(config.tag_name as string) ?? ''}
                onChange={(e) => update({ tag_name: e.target.value })}
                placeholder="Ex: cliente-quente"
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Ação</Label>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm">
                {(['add', 'remove'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => update({ action: a })}
                    className={`flex-1 py-2 transition-colors font-medium ${
                      ((config.action as string) ?? 'add') === a
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {a === 'add' ? 'Adicionar' : 'Remover'}
                  </button>
                ))}
              </div>
            </FieldWrap>
          </>
        )}

        {blockType === 'cart_abandoned' && (
          <>
            <FieldWrap>
              <Label>Plataforma de origem</Label>
              <select
                value={(config.platform as string) ?? 'all'}
                onChange={(e) => update({ platform: e.target.value })}
                className={selectClass}
              >
                <option value="all">Todas as plataformas</option>
                <option value="hotmart">Hotmart</option>
                <option value="kiwify">Kiwify</option>
                <option value="eduzz">Eduzz</option>
                <option value="yampi">Yampi</option>
              </select>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                Este bloco é ativado automaticamente quando a plataforma envia um evento de carrinho abandonado.
              </p>
            </FieldWrap>
          </>
        )}

        {blockType === 'sale' && (
          <>
            <FieldWrap>
              <Label>Nome do produto</Label>
              <input
                type="text"
                value={(config.product_name as string) ?? ''}
                onChange={(e) => update({ product_name: e.target.value })}
                placeholder="Nome do produto"
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>URL de pagamento</Label>
              <input
                type="url"
                value={(config.payment_link as string) ?? ''}
                onChange={(e) => update({ payment_link: e.target.value })}
                placeholder="https://..."
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Mensagem de venda</Label>
              <textarea
                value={(config.sale_message as string) ?? ''}
                onChange={(e) => update({ sale_message: e.target.value })}
                placeholder="Ex: Aproveite! Link exclusivo para você..."
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none transition-shadow"
              />
            </FieldWrap>
          </>
        )}
      </div>
    </div>
  )
}
