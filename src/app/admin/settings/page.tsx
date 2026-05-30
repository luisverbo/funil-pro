import { createAdminClient } from '@/lib/supabase/admin'
import SettingsForm from './settings-form'

export default async function AdminSettingsPage() {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('platform_settings').select('key, value')

  const settings: Record<string, string> = {}
  for (const row of rows ?? []) {
    settings[row.key] = row.value ?? ''
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Configurações da Plataforma</h1>
      <SettingsForm settings={settings} />
    </div>
  )
}
