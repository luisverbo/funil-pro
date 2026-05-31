import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processJob, type QueueJob } from '@/lib/queue/processor'

export const maxDuration = 60

async function run() {
  const admin = createAdminClient()

  const { data: jobs, error: fetchError } = await admin
    .from('queue_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(10)

  if (fetchError) {
    console.error('[queue/process] Erro ao buscar jobs:', fetchError)
    return { processed: 0, failed: 0, error: fetchError.message, details: [] }
  }

  if (!jobs || jobs.length === 0) {
    console.log('[queue/process] Nenhum job pendente.')
    return { processed: 0, failed: 0, details: [] }
  }

  console.log(`[queue/process] Encontrados ${jobs.length} jobs pendentes.`)

  const details: Array<{ id: string; block_type?: string; status: string; error?: string }> = []
  let processed = 0
  let failed = 0

  for (const job of jobs as QueueJob[]) {
    console.log(`[queue/process] Processando job ${job.id} | block_id: ${job.block_id}`)

    // Fetch block type for logging
    const { data: block } = await admin.from('funnel_blocks').select('block_type').eq('id', job.block_id).single()
    const blockType = block?.block_type ?? 'unknown'

    // Mark as processing
    await admin.from('queue_jobs')
      .update({ status: 'processing', attempts: (job.attempts ?? 0) + 1 })
      .eq('id', job.id)

    try {
      await processJob(job)
      await admin.from('queue_jobs').update({ status: 'done' }).eq('id', job.id)
      console.log(`[queue/process] Job ${job.id} [${blockType}] concluído.`)
      details.push({ id: job.id, block_type: blockType, status: 'done' })
      processed++
    } catch (err) {
      const errMsg = String(err)
      await admin.from('queue_jobs').update({ status: 'failed', error: errMsg }).eq('id', job.id)
      console.error(`[queue/process] Job ${job.id} [${blockType}] falhou:`, errMsg)
      details.push({ id: job.id, block_type: blockType, status: 'failed', error: errMsg })
      failed++
    }
  }

  return { processed, failed, details }
}

export async function GET() {
  try {
    const result = await run()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[queue/process] Erro fatal:', err)
    return NextResponse.json({ processed: 0, failed: 0, error: String(err) }, { status: 500 })
  }
}

export async function POST() {
  return GET()
}
