import { createTenant } from '@/app/actions/onboarding'

interface Props {
  searchParams: Promise<{ error?: string }>
}

export default async function OnboardingPage({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configure seu espaço</h1>
        <p className="mt-1 text-sm text-gray-500">
          Essas informações definem sua conta no FunilPro
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <form action={createTenant} className="space-y-4">
        <div>
          <label htmlFor="business_name" className="block text-sm font-medium text-gray-700 mb-1">
            Nome do negócio
          </label>
          <input
            id="business_name"
            name="business_name"
            type="text"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ex: LC Marketing Digital"
          />
        </div>
        <div>
          <label htmlFor="owner_name" className="block text-sm font-medium text-gray-700 mb-1">
            Seu nome
          </label>
          <input
            id="owner_name"
            name="owner_name"
            type="text"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ex: Luís Carlos"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 text-sm transition-colors"
        >
          Criar meu espaço
        </button>
      </form>
    </div>
  )
}
