import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Script from 'next/script'
import PageRenderer from './page-renderer'
import QuizRenderer from './quiz-renderer'
import QuizRendererV2 from './quiz-renderer-v2'
import type { QuizData } from '@/app/actions/quiz-v2'

export const dynamic = 'force-dynamic'

function MetaPixel({ pixelId }: { pixelId: string }) {
  return (
    <Script id="meta-pixel" strategy="afterInteractive">{`
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixelId}');
      fbq('track', 'PageView');
    `}</Script>
  )
}

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

  supabase.from('pages').update({ views_count: (page.views_count ?? 0) + 1 }).eq('id', page.id).then(() => {})

  // Pixel: específico do quiz (settings.pixel_id) > pixel global do tenant
  const quizPixelId = (page.quiz_data as QuizData | null)?.settings?.pixel_id ?? null
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('meta_pixel_id')
    .eq('id', page.tenant_id)
    .single()
  const pixelId = quizPixelId || ((tenantData as unknown as { meta_pixel_id?: string } | null)?.meta_pixel_id ?? null)

  if (page.page_type === 'interactive') {
    // v2 format: quiz_data column with pages/blocks structure
    if (page.quiz_data && (page.quiz_data as QuizData).version === 2) {
      return (
        <>
          <title>{page.meta_title || page.title || 'Quiz'}</title>
          {page.meta_description && <meta name="description" content={page.meta_description} />}
          {pixelId && <MetaPixel pixelId={pixelId} />}
          <QuizRendererV2 data={page.quiz_data as QuizData} pageId={page.id} tenantId={page.tenant_id} />
        </>
      )
    }

    // v1 fallback: old interactive_questions table
    const { data: questions } = await supabase
      .from('interactive_questions')
      .select('*')
      .eq('page_id', page.id)
      .order('order_index')

    return (
      <>
        <title>{page.meta_title || page.title || 'Quiz'}</title>
        {page.meta_description && <meta name="description" content={page.meta_description} />}
        {pixelId && <MetaPixel pixelId={pixelId} />}
        <QuizRenderer questions={questions ?? []} pageId={page.id} tenantId={page.tenant_id} />
      </>
    )
  }

  return (
    <>
      <title>{page.meta_title || page.title || 'Página'}</title>
      {page.meta_description && <meta name="description" content={page.meta_description} />}
      {page.og_image_url && <meta property="og:image" content={page.og_image_url} />}
      {pixelId && <MetaPixel pixelId={pixelId} />}
      <PageRenderer craftJson={page.craft_json} pageId={page.id} />
    </>
  )
}
