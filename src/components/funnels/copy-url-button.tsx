'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyUrlButtonProps {
  url: string
  label?: string
}

export default function CopyUrlButton({ url, label = 'Copiar' }: CopyUrlButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 text-green-500" />
          <span className="text-green-600">Copiado!</span>
        </>
      ) : (
        <>
          <Copy className="w-4 h-4 text-gray-500" />
          <span className="text-gray-700">{label}</span>
        </>
      )}
    </button>
  )
}
