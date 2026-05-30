import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Funnel } from '@/types'
import ClearCapturePageButton from './clear-capture-page-button'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

const TEMPLATE_LABELS: Record<string, string> = {
  minimal: 'Minimalista',
  dark: 'Dark Premium',
  split: 'Split Screen',
}

export default async function CapturePagesPage() {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/login')

  const { data: funnels } = await supabase
    .from('funnels')
    .select('id, name, status, page_config, page_template, created_at')
    .eq('tenant_id', userTenant.tenant_id)
    .not('page_config', 'is', null)
    .order('created_at', { ascending: false })

  const pages = (funnels ?? []) as Funnel[]

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Páginas de Captura</h1>
          <p className="text-sm text-gray-500 mt-1">Gerencie as páginas de captura dos seus funis</p>
        </div>
        <Link
          href="/funnels"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Nova página
        </Link>
      </div>

      {pages.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-indigo-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold text-base mb-1">Nenhuma página de captura criada</p>
          <p className="text-gray-400 text-sm mb-4">Abra um funil no builder e configure uma página de captura.</p>
          <Link
            href="/funnels"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Ir para Funis
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {pages.map((funnel) => {
            const template = (funnel.page_template ?? 'minimal') as string
            const isActive = funnel.status === 'published'
            return (
              <div
                key={funnel.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
              >
                {/* Mini preview */}
                <a href={`/p/${funnel.id}`} target="_blank" rel="noopener noreferrer" className="block h-28 overflow-hidden cursor-pointer group relative">
                  {template === 'minimal' && (
                    <div className="h-full bg-white flex flex-col items-center justify-center gap-2 px-6">
                      <div className="h-3 rounded bg-gray-800 w-3/4" />
                      <div className="h-2 rounded bg-gray-300 w-2/3" />
                      <div className="h-7 rounded bg-indigo-500 w-1/2 mt-1" />
                    </div>
                  )}
                  {template === 'dark' && (
                    <div className="h-full bg-gray-900 flex flex-col items-center justify-center gap-2 px-6">
                      <div className="h-3 rounded bg-white w-3/4" />
                      <div className="h-2 rounded bg-gray-500 w-2/3" />
                      <div className="h-7 rounded bg-indigo-500 w-1/2 mt-1" />
                    </div>
                  )}
                  {template === 'split' && (
                    <div className="h-full flex">
                      <div className="w-1/2 bg-gray-800 flex items-center justify-center">
                        <div className="h-3 rounded bg-white/40 w-2/3" />
                      </div>
                      <div className="w-1/2 bg-white flex flex-col items-center justify-center gap-2 px-3">
                        <div className="h-2 rounded bg-gray-700 w-3/4" />
                        <div className="h-6 rounded bg-indigo-500 w-2/3" />
                      </div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 bg-black/50 px-3 py-1 rounded-full transition-opacity">
                      Ver página
                    </span>
                  </div>
                </a>

                <div className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-gray-900 text-base leading-snug">{funnel.name}</h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                        {TEMPLATE_LABELS[template] ?? template}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className={`text-xs font-medium ${isActive ? 'text-green-600' : 'text-gray-400'}`}>
                      {isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>

                <div className="px-4 pb-4 flex items-center gap-2">
                  <Link
                    href={`/funnels/${funnel.id}/builder`}
                    className="flex-1 text-center px-3 py-2 border border-indigo-600 text-indigo-600 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    Editar
                  </Link>
                  <a
                    href={`/p/${funnel.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Ver
                  </a>
                  <ClearCapturePageButton funnelId={funnel.id} funnelName={funnel.name} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
