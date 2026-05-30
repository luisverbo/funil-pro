import { Queue } from 'bullmq'

export function parseRedisUrl(raw: string) {
  // Strip surrounding quotes and "KEY=" prefix that may appear when env is set incorrectly
  const cleaned = raw.trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '')
  const url = new URL(cleaned)
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: cleaned.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: null as null,
  }
}

// redisConnection: lazy-evaluated so module load never calls new URL() at build time
let _conn: ReturnType<typeof parseRedisUrl> | null = null
export function getRedisConnection() {
  if (!_conn) _conn = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379')
  return _conn
}

// Named export for backward compat with worker.ts
// worker.ts runs via tsx (not Next.js build), so getRedisConnection() is safe at import time there
export const redisConnection: ReturnType<typeof parseRedisUrl> = new Proxy(
  {} as ReturnType<typeof parseRedisUrl>,
  { get: (_t, k) => getRedisConnection()[k as keyof ReturnType<typeof parseRedisUrl>] }
)

// funnelQueue: lazy singleton, never instantiated at module load
let _queue: Queue | null = null
export function getFunnelQueue(): Queue {
  if (!_queue) _queue = new Queue('funnel-execution', { connection: getRedisConnection() })
  return _queue
}

// API routes call getFunnelQueue() directly; this re-export is for worker.ts which calls .add()
export const funnelQueue: Queue = new Proxy(
  {} as Queue,
  { get: (_t, k) => getFunnelQueue()[k as keyof Queue] }
)
