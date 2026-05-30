import { createAdminClient } from '@/lib/supabase/admin'
import TemplateAdminActions from './template-admin-actions'
import CreateOfficialTemplateButton from './create-official-template-button'

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR')
}

export default async function AdminTemplatesPage() {
  const admin = createAdminClient()
  const { data: templates } = await admin
    .from('funnel_templates')
    .select('id, name, category, downloads_count, is_public, created_at')
    .is('tenant_id', null)
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Templates Oficiais</h1>
        <CreateOfficialTemplateButton />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Categoria</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Downloads</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Público</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Criado em</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(templates ?? []).map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 font-medium text-gray-900">{t.name}</td>
                <td className="px-6 py-3 text-gray-500">{t.category ?? '—'}</td>
                <td className="px-6 py-3 text-gray-700">{t.downloads_count}</td>
                <td className="px-6 py-3">
                  {t.is_public ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">Sim</span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-500">Não</span>
                  )}
                </td>
                <td className="px-6 py-3 text-gray-500">{fmtDate(t.created_at)}</td>
                <td className="px-6 py-3">
                  <TemplateAdminActions templateId={t.id} isPublic={t.is_public} />
                </td>
              </tr>
            ))}
            {(templates ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">Nenhum template oficial ainda</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
