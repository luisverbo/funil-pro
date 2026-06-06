import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import PageRenderer from './page-renderer'

export const dynamic = 'force-dynamic'

export default async function PublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[]>>
}) {
  const { slug } = await params
  const sp = await searchParams

  const variables: Record<string, string> = {}
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string') variables[key] = value
  }
  if (variables.nome && !variables.primeiro_nome) {
    variables.primeiro_nome = variables.nome.split(' ')[0]
  }
  if (variables.name && !variables.primeiro_nome) {
    variables.primeiro_nome = variables.name.split(' ')[0]
  }

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

  return (
    <>
      <title>{page.meta_title || page.title || 'Página'}</title>
      {page.meta_description && <meta name="description" content={page.meta_description} />}
      {page.og_image_url && <meta property="og:image" content={page.og_image_url} />}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        body { overflow-x: hidden; max-width: 100vw; margin: 0; }
        img, video, iframe { max-width: 100%; }
      `}</style>
      <PageRenderer craftJson={page.craft_json} pageId={page.id} variables={variables} />
    </>
  )
}