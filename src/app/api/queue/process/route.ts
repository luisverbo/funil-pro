import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processJob, type QueueJob } from '@/lib/queue/processor'

export const maxDuration = 60

export async function GET() {
  const admin = createAdminClient()

  const { data: jobs } = await admin
    .from('queue_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(10)

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let processed = 0
  let failed = 0

  for (const job of jobs as QueueJob[]) {
    // Mark as processing
    await admin.from('queue_jobs').update({ status: 'processing', attempts: job.attempts + 1 }).eq('id', job.id)

    try {
      await processJob(job)
      await admin.from('queue_jobs').update({ status: 'done' }).eq('id', job.id)
      processed++
    } catch (err) {
      await admin.from('queue_jobs').update({ status: 'failed', error: String(err) }).eq('id', job.id)
      failed++
    }
  }

  return NextResponse.json({ processed, failed })
}

export async function POST() {
  return GET()
}
