'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import type { Product } from '@/types'

const PlatformSlideover = dynamic(() => import('./platform-slideover'), { ssr: false })

interface PlatformConfig {
  id: string
  name: string
  color: string
  bgColor: string
  textColor: string
  icon: string
  webhookUrl: string
  instructions: string[]
}

interface Props {
  platforms: PlatformConfig[]
  productsByPlatform: Record<string, Product[]>
  activePlatforms: string[]
}

export default function PaymentPlatformsSection({ platforms, productsByPlatform, activePlatforms }: Props) {
  const [activePlatform, setActivePlatform] = useState<PlatformConfig | null>(null)

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {platforms.map((platform) => {
          const isActive = activePlatforms.includes(platform.id)
          const productCount = productsByPlatform[platform.id]?.length ?? 0
          return (
            <button
              key={platform.id}
              onClick={() => setActivePlatform(platform)}
              className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-gray-300 transition-all text-left group"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-base font-bold mb-3 mx-auto"
                style={{ backgroundColor: platform.color }}
              >
                {platform.icon}
              </div>
              <p className="font-semibold text-gray-900 text-sm text-center">{platform.name}</p>
              <p className="text-xs text-gray-400 text-center mt-0.5">
                {productCount > 0 ? `${productCount} produto${productCount !== 1 ? 's' : ''}` : 'Sem produtos'}
              </p>
              <div className="flex justify-center mt-2">
                {isActive ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    Ativo
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Aguardando</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {activePlatform && (
        <PlatformSlideover
          platform={activePlatform}
          initialProducts={productsByPlatform[activePlatform.id] ?? []}
          onClose={() => setActivePlatform(null)}
        />
      )}
    </>
  )
}
