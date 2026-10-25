// Risquinhos de entrega estilo WhatsApp, desenhados (mais grossos que o ✓ de texto):
// ✓ enviado · ✓✓ cinza entregue · ✓✓ azul visto/ouvido · ⚠ não entregue · 🕓 enviando.
import { tick } from '@/lib/estudio/chat'

const LEGENDA: Record<string, string> = { read: 'Visto', played: 'Ouvido', delivered: 'Entregue (não visto)', sent: 'Enviado', failed: 'Não entregue' }

export function Risquinhos({ status, claro = false }: { status: string | null | undefined; claro?: boolean }) {
  const t = tick(status)
  const titulo = LEGENDA[status ?? ''] ?? 'Enviando'
  if (t.falhou) return <span title={titulo} aria-label={titulo} className={`ml-1 text-xs font-bold ${claro ? 'text-red-200' : 'text-red-600'}`}>⚠</span>
  if (t.simbolo === '🕓') return <span title={titulo} aria-label={titulo} className="ml-1 text-[11px]">🕓</span>
  const duplo = t.simbolo === '✓✓'
  // Balão colorido (inbox): os risquinhos vão numa "pílula" branca, para o azul
  // e o cinza ficarem bem visíveis em cima do verde/roxo.
  const cor = t.azul ? '#0ea5e9' : '#64748b'
  const svg = (
    <svg role="img" aria-label={titulo} viewBox="0 0 22 12" width={duplo ? 21 : 14} height={12} className="inline-block shrink-0 align-[-1px]">
      <title>{titulo}</title>
      {/* dois vês separados, como no WhatsApp; traço grosso para ver de longe */}
      <path d="M1.5 6.2 L4.8 9.5 L10.8 2.5" fill="none" stroke={cor} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {duplo && <path d="M8.6 8.4 L9.8 9.5 L15.8 2.5" fill="none" stroke={cor} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
  return claro
    ? <span className="ml-1 inline-flex items-center rounded-full bg-white/95 px-1 py-px align-middle">{svg}</span>
    : <span className="ml-1 inline-flex items-center align-middle">{svg}</span>
}
