import { NextResponse } from 'next/server'
import { processBlock } from '@/lib/queue/process-block'
import { getFunnelQueue } from '@/lib/queue'

// Called by Vercel Cron every minute to drain the BullMQ queue.
// On VPS the standalone worker (src/server.ts) handles this instead.
export async function GET() {
  try {
    const queue = getFunnelQueue()
    const jobs = await queue.getWaiting(0, 19)
    let processed = 0

    for (const job of jobs) {
      if (!job.data?.funnelId) continue
      const data = job.data as { funnelId: string; blockId: string; leadId: string; tenantId: string }

      try {
        const result = await processBlock(data)
        await job.remove()

        if (result.nextBlockId) {
          await queue.add(
            'execute-block',
            { ...data, blockId: result.nextBlockId },
            result.delayMs ? { delay: result.delayMs } : {}
          )
        }
        processed++
      } catch (e) {
        console.error('[queue/process] job error', e)
      }
    }

    return NextResponse.json({ processed })
  } catch (err) {
    console.error('[queue/process]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
