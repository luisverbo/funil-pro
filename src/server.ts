import './lib/queue/worker'

console.log('[server] FunilPro worker iniciado')

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM recebido, encerrando gracefully...')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[server] SIGINT recebido, encerrando...')
  process.exit(0)
})
