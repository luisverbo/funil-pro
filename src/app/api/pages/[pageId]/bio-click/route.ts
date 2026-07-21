import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Conta clique num botão da Bio Link (público). Só páginas biolink publicadas.
export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params
    const { buttonId } = await req.json().catch(() => ({}))
    if (!buttonId || typeof buttonId !== 'string') return NextResponse.json({ ok: false }, { status: 400 })

    const admin = createAdminClient()
    const { data: page } = await admin.from('pages')
      .select('id, page_type, published').eq('id', pageId).single()
    if (!page || page.page_type !== 'biolink' || !page.published) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }

    await admin.rpc('increment_bio_click', { p_page: pageId, p_button: buttonId.slice(0, 80) }).then(() => {}, () => {})
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
