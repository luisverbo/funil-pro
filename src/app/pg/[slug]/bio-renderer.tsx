'use client'

import React from 'react'
import { BIO_THEMES, type BioData } from '@/lib/bio/types'

const SOCIAL_ICONS: Record<string, { icon: string; prefix: string }> = {
  instagram: { icon: '📷', prefix: 'https://instagram.com/' },
  youtube: { icon: '▶️', prefix: 'https://youtube.com/@' },
  tiktok: { icon: '🎵', prefix: 'https://tiktok.com/@' },
  whatsapp: { icon: '💬', prefix: 'https://wa.me/' },
}

export default function BioRenderer({ data, pageId }: { data: BioData; pageId: string }) {
  const t = BIO_THEMES[data.theme ?? 'gradient'] ?? BIO_THEMES.gradient

  // conta o clique sem atrasar a navegação (keepalive sobrevive à troca de página)
  const trackClick = (buttonId: string) => {
    try {
      fetch(`/api/pages/${pageId}/bio-click`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buttonId }),
      }).catch(() => {})
    } catch {}
  }

  const socials = Object.entries(data.socials ?? {}).filter(([, v]) => v)

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-5 py-10" style={{ background: t.bg }}>
      <div className="w-full max-w-md flex flex-col items-center">
        {data.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.avatar_url} alt="" className="w-24 h-24 rounded-full object-cover ring-4 ring-white/30 shadow-xl" />
        ) : (
          <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-4xl ring-4 ring-white/30">👤</div>
        )}
        {data.display_name && <h1 className="mt-4 text-2xl font-bold text-center" style={{ color: t.text }}>{data.display_name}</h1>}
        {data.bio && <p className="mt-1.5 text-sm text-center leading-relaxed max-w-xs" style={{ color: t.sub }}>{data.bio}</p>}

        {socials.length > 0 && (
          <div className="flex gap-3 mt-4">
            {socials.map(([key, val]) => {
              const s = SOCIAL_ICONS[key]
              if (!s) return null
              const href = val!.startsWith('http') ? val! : s.prefix + val!.replace(/^@/, '').replace(/\D?(?=\d)/, m => key === 'whatsapp' ? m.replace(/\D/g, '') : m)
              return (
                <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                  onClick={() => trackClick(`social_${key}`)}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-xl hover:scale-110 transition-transform"
                  style={{ background: t.btnBg, border: `1px solid ${t.btnBorder}` }}>
                  {s.icon}
                </a>
              )
            })}
          </div>
        )}

        <div className="w-full flex flex-col gap-3.5 mt-7">
          {data.buttons.filter(b => b.label && b.url).map(b => (
            <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer"
              onClick={() => trackClick(b.id)}
              className={`w-full py-4 px-5 rounded-2xl text-center font-semibold shadow-lg hover:scale-[1.03] active:scale-[0.99] transition-transform flex items-center justify-center gap-2 ${b.highlight ? 'animate-pulse' : ''}`}
              style={{ background: t.btnBg, color: t.btnText, border: `1px solid ${t.btnBorder}` }}>
              {b.emoji && <span className="text-lg">{b.emoji}</span>}
              <span>{b.label}</span>
            </a>
          ))}
        </div>

        <p className="mt-10 text-[11px] opacity-60" style={{ color: t.sub }}>feito com FunilPro</p>
      </div>
    </div>
  )
}
