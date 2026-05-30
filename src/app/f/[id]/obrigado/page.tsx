import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

export default async function ObrigadoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-10">
          <div className="flex justify-center mb-6">
            <CheckCircle className="w-16 h-16 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Obrigado!</h1>
          <p className="text-gray-600 mb-6">
            Recebemos seus dados com sucesso. Em breve entraremos em contato pelo WhatsApp.
          </p>
          <Link
            href={`/f/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700"
          >
            ← Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  )
}
