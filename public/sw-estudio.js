// Service worker do Estúdio IA: deixa o FunilPro instalável e mostra as
// notificações de mensagem nova. Não faz cache (o chat é sempre ao vivo).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/estudio-ia?aba=conversas'
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const a of abas) { if ('focus' in a) { await a.navigate(url).catch(() => {}); return a.focus() } }
    return self.clients.openWindow(url)
  })())
})
