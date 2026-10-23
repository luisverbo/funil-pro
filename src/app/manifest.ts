// PWA do FunilPro — instalável no celular. Abre direto no chat do Estúdio IA
// (o Luís não tem mais o WhatsApp do número do estúdio no celular).
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Estúdio IA · FunilPro',
    short_name: 'Estúdio IA',
    description: 'Conversas do Estúdio IA no WhatsApp oficial.',
    start_url: '/estudio-ia?aba=conversas',
    scope: '/',
    display: 'standalone',
    background_color: '#f0f2f5',
    theme_color: '#075e54',
    icons: [{ src: '/icon-estudio.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
