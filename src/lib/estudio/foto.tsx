'use client'
// Foto com fallback: se não carregar (arquivo ainda não subiu, link errado),
// mostra o placeholder em vez do ícone de imagem quebrada. O ref cobre o caso
// de a imagem falhar ANTES da hidratação (onError não dispara de novo).
import { useState } from 'react'

export function FotoOuPlaceholder({ src, alt, className, placeholder }: {
  src: string | null; alt: string; className?: string; placeholder: React.ReactNode
}) {
  const [falhou, setFalhou] = useState<string | null>(null)
  if (!src || falhou === src) return <>{placeholder}</>
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className={className}
      ref={el => { if (el && el.complete && el.naturalWidth === 0) setFalhou(src) }}
      onError={() => setFalhou(src)} />
  )
}
