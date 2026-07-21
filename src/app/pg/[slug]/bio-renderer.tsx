'use client'

import React from 'react'
import { BIO_THEMES, buttonStyle, type BioData } from '@/lib/bio/types'

// Ícones SVG reais das redes (os emojis ficavam feios)
export const SOCIAL_SVGS: Record<string, { path: React.ReactNode; prefix: string; color: string }> = {
  instagram: {
    color: '#E4405F', prefix: 'https://instagram.com/',
    path: <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />,
  },
  youtube: {
    color: '#FF0000', prefix: 'https://youtube.com/@',
    path: <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />,
  },
  tiktok: {
    color: '#111111', prefix: 'https://tiktok.com/@',
    path: <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />,
  },
  whatsapp: {
    color: '#25D366', prefix: 'https://wa.me/',
    path: <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />,
  },
}

export function SocialIcon({ network, mono }: { network: string; mono?: string }) {
  const s = SOCIAL_SVGS[network]
  if (!s) return null
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill={mono ?? s.color}>{s.path}</svg>
  )
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
              const s = SOCIAL_SVGS[key]
              if (!s) return null
              const clean = key === 'whatsapp' ? val!.replace(/\D/g, '') : val!.replace(/^@/, '')
              const href = val!.startsWith('http') ? val! : s.prefix + clean
              return (
                <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                  onClick={() => trackClick(`social_${key}`)}
                  className="w-11 h-11 rounded-full flex items-center justify-center shadow-md hover:scale-110 transition-transform bg-white">
                  <SocialIcon network={key} />
                </a>
              )
            })}
          </div>
        )}

        <div className="w-full flex flex-col gap-3.5 mt-7">
          {data.buttons.filter(b => b.label && b.url).map(b => (
            <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer"
              onClick={() => trackClick(b.id)}
              className={`w-full py-4 px-5 text-center font-semibold shadow-lg hover:scale-[1.03] active:scale-[0.99] transition-transform flex items-center justify-center gap-2 ${b.highlight ? 'animate-pulse' : ''}`}
              style={buttonStyle(b, t)}>
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
