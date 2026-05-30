import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import UseTemplateButton from '@/components/templates/use-template-button'
import type { FunnelTemplate } from '@/types'

const CATEGORIES = [
  { value: '', label: 'Todos' },
  { value: 'captacao', label: 'Captação' },
  { value: 'lancamento', label: 'Lançamento' },
  { value: 'mentoria', label: 'Mentoria' },
  { value: 'cart_abandoned', label: 'Carrinho Abandonado' },
  { value: 'produto_fisico', label: 'Produto Físico' },
]

const BLOCK_COLORS: Record<string, string> = {
  entry: '#6366f1',
  message: '#22c55e',
  condition: '#f59e0b',
  delay: '#8b5cf6',
  tag: '#06b6d4',
  sale: '#ec4899',
  cart_abandoned: '#6366f1',
  form: '#14b8a6',
  page: '#f97316',
}

function BlockDots({ blocks }: { blocks: Array<{ block_type: string }> }) {
  const typeMap: Record<string, number> = {}
  blocks.forEach((b) => { typeMap[b.block_type] = (typeMap[b.block_type] ?? 0) + 1 })
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(typeMap).map(([type, count]) => (
        <span
          key={type}
          title={`${count}x ${type}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: `${BLOCK_COLORS[type] ?? '#6b7280'}20`, color: BLOCK_COLORS[type] ?? '#6b7280' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BLOCK_COLORS[type] ?? '#6b7280' }} />
          {count}x {type}
        </span>
      ))}
    </div>
  )
}

interface PageProps {
  searchParams: Promise<{ category?: string; free?: string; sort?: string }>
}

export default async function TemplatesPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const category = params.category ?? ''
  const onlyFree = params.free === 'true'
  const sort = params.sort ?? 'downloads'

  const admin = createAdminClient()
  let query = admin
    .from('funnel_templates')
    .select('*')
    .eq('is_public', true)

  if (category) query = query.eq('category', category)
  if (onlyFree) query = query.eq('price_cents', 0)

  const orderCol = sort === 'recent' ? 'created_at' : 'downloads_count'
  query = query.order(orderCol, { ascending: false })

  const { data: templates } = await query
  const list = (templates ?? []) as FunnelTemplate[]

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams()
    if (category) p.set('category', category)
    if (onlyFree) p.set('free', 'true')
    if (sort !== 'downloads') p.set('sort', sort)
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) p.set(k, v)
      else p.delete(k)
    })
    const s = p.toString()
    return `/templates${s ? '?' + s : ''}`
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketplace de Templates</h1>
          <p className="text-gray-500 text-sm mt-1">Copie um funil pronto e personalize para o seu negócio</p>
        </div>
        <Link
          href="/templates/my"
          className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
        >
          Meus Templates
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center mb-6">
        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <Link
              key={c.value}
              href={buildUrl({ category: c.value })}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                category === c.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Free toggle */}
          <Link
            href={buildUrl({ free: onlyFree ? '' : 'true' })}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
              onlyFree ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Gratuitos
          </Link>

          {/* Sort */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            <Link
              href={buildUrl({ sort: 'downloads' })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${sort === 'downloads' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Mais usados
            </Link>
            <Link
              href={buildUrl({ sort: 'recent' })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${sort === 'recent' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Recentes
            </Link>
          </div>
        </div>
      </div>

      {/* Grid */}
      {list.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl">
          <p className="text-gray-400 text-sm">Nenhum template encontrado com esses filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((tmpl) => {
            const funnelJson = tmpl.funnel_json as { blocks?: Array<{ block_type: string }> }
            const blocks = funnelJson?.blocks ?? []
            const isOfficial = tmpl.tenant_id === null

            return (
              <div key={tmpl.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                {/* Card header */}
                <div className="p-4 border-b border-gray-100">
                  <div className="flex items-center gap-2 mb-2">
                    {tmpl.category && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        {CATEGORIES.find((c) => c.value === tmpl.category)?.label ?? tmpl.category}
                      </span>
                    )}
                    {isOfficial ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Oficial
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Comunidade
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm leading-snug">{tmpl.name}</h3>
                  {tmpl.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tmpl.description}</p>
                  )}
                </div>

                {/* Block preview */}
                <div className="px-4 py-3 flex-1">
                  <BlockDots blocks={blocks} />
                  <p className="text-xs text-gray-400 mt-2">{blocks.length} blocos</p>
                </div>

                {/* Card footer */}
                <div className="px-4 pb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                      <path d="M12 16V4m0 12l-4-4m4 4l4-4" />
                      <path d="M4 20h16" />
                    </svg>
                    {tmpl.downloads_count} usos
                  </div>
                  {tmpl.price_cents === 0 ? (
                    <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Gratuito</span>
                  ) : (
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      R$ {(tmpl.price_cents / 100).toFixed(2).replace('.', ',')}
                    </span>
                  )}
                  <UseTemplateButton templateId={tmpl.id} priceCents={tmpl.price_cents} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
