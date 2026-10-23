// Service worker do Estúdio IA: deixa o FunilPro instalável e mostra as
// notificações — inclusive com o app FECHADO (Web Push). O push chega sem
// conteúdo; aqui buscamos o resumo no FunilPro (com o cookie da sessão).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let n = { titulo: 'Estúdio IA', corpo: 'Nova mensagem no WhatsApp do estúdio', url: '/estudio-ia?aba=conversas', tag: 'estudio' }
    try {
      const r = await fetch('/api/estudio/push/resumo', { credentials: 'include', cache: 'no-store' })
      if (r.ok) n = { ...n, ...(await r.json()) }
    } catch (_) { /* sem rede: mostra o aviso genérico */ }
    // iOS exige mostrar uma notificação a cada push.
    await self.registration.showNotification(n.titulo, { body: n.corpo, tag: n.tag, data: { url: n.url }, icon: '/icon-estudio.svg', badge: '/icon-estudio.svg', renotify: true })
  })())
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/estudio-ia?aba=conversas'
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const a of abas) { if ('focus' in a) { await a.navigate(url).catch(() => {}); return a.focus() } }
    return self.clients.openWindow(url)
  })())
})
