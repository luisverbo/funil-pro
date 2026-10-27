'use client'
// Contas do Instagram conectadas pelo login do Instagram ("Conectar Instagram").
import { situacaoDaConta } from '@/lib/instagram/contas'

export interface ContaTela {
  id: string
  username: string | null
  nome: string | null
  foto_url: string | null
  status: 'ativa' | 'erro'
  erro: string | null
  token_expira_em: string | null
}

export const AVISO_DA_VOLTA: Record<string, { ok: boolean; texto: string }> = {
  ok: { ok: true, texto: 'Conta do Instagram conectada.' },
  cancelado: { ok: false, texto: 'Conexão cancelada no Instagram.' },
  expirou: { ok: false, texto: 'O link de conexão venceu. Clique em Conectar de novo.' },
  falhou: { ok: false, texto: 'O Instagram recusou a conexão. Confira se a conta é Profissional e, enquanto o app não for aprovado, se ela está como testadora.' },
  sem_app: { ok: false, texto: 'Falta o ID do app do Instagram em Admin → Configurações → Instagram.' },
}

export default function ContasInstagram({ contas, onRemover, onUsarNosSemConta }: {
  contas: ContaTela[]
  onRemover: (c: ContaTela) => void
  onUsarNosSemConta: (c: ContaTela) => void
}) {
  return (
    <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Contas do Instagram</h2>
          <p className="text-xs text-gray-500">Cada post publica na conta escolhida nele. Sem conta escolhida, vale a conta da plataforma.</p>
        </div>
        <a href="/api/instagram/conectar"
          className="rounded-full px-4 py-2 text-xs font-semibold text-white shadow"
          style={{ background: 'linear-gradient(135deg,#f58529,#dd2a7b 50%,#8134af)' }}>
          + Conectar Instagram
        </a>
      </div>
      {contas.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhuma conta conectada ainda.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {contas.map(c => {
            const s = situacaoDaConta(c)
            return (
              <li key={c.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-100 px-3 py-2">
                {c.foto_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.foto_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fuchsia-100 text-sm font-bold text-fuchsia-700">{(c.username ?? '?')[0]?.toUpperCase()}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">@{c.username ?? 'sem nome'}</p>
                  <p className={`truncate text-xs ${s.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{s.texto}</p>
                </div>
                <button onClick={() => onUsarNosSemConta(c)} className="shrink-0 text-xs font-semibold text-indigo-600 hover:underline">Usar nos posts sem conta</button>
                <button onClick={() => onRemover(c)} className="shrink-0 text-xs text-gray-400 hover:text-rose-600" title="Desconectar">✕</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
