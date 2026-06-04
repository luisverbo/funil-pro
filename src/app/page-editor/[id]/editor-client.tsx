'use client'

import dynamic from 'next/dynamic'

const CraftEditor = dynamic(() => import('@/components/page-builder/craft-editor'), { ssr: false })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function EditorClient({ page }: { page: any }) {
  return (
    <CraftEditor
      pageId={page.id}
      published={page.published ?? false}
      slug={page.slug}
      initialJson={page.craft_json && Object.keys(page.craft_json).length > 0 ? page.craft_json : undefined}
    />
  )
}
