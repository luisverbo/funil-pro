import { Queue } from 'bullmq'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
const url = new URL(redisUrl)

export const redisConnection = {
  host: url.hostname,
  port: Number(url.port) || 6379,
  password: url.password || undefined,
  maxRetriesPerRequest: null as null,
}

export const funnelQueue = new Queue('funnel-execution', {
  connection: redisConnection,
})
