import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import PageRenderer from './page-renderer'

export const dynamic = 'force-dynamic'

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: page } = await supabase
    .from('pages')
    .select('*')
    .eq('slug', slug)
    .eq('published', true)
    .limit(1)
    .single()

  if (!page) notFound()

  // Increment view count async
  supabase.from('pages').update({ views_count: (page.views_count ?? 0) + 1 }).eq('id', page.id).then(() => {})

  return (
    <div className="max-w-full overflow-x-hidden">
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        body { overflow-x: hidden; max-width: 100vw; }
        img, video, iframe { max-width: 100%; }
      `}</style>
      <title>{page.meta_title || page.title || 'Página'}</title>
      {page.meta_description && <meta name="description" content={page.meta_description} />}
      {page.og_image_url && <meta property="og:image" content={page.og_image_url} />}
      <PageRenderer craftJson={page.craft_json} pageId={page.id} />
    </div>
  )
}
