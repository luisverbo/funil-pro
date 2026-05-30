import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import CaptureFormV2 from '@/components/public/capture-form-v2'

export async function generateMetadata({ params }: { params: Promise<{ funnelId: string }> }): Promise<Metadata> {
  const { funnelId } = await params
  const admin = createAdminClient()
  const { data: funnel } = await admin.from('funnels').select('name, page_config').eq('id', funnelId).single()
  const cfg = ((funnel?.page_config ?? {}) as Record<string, string>)
  const headline = cfg.headline || funnel?.name || 'Garanta seu acesso gratuito'
  const subheadline = cfg.subheadline || ''
  const logoUrl = cfg.logo_url as string | undefined
  return {
    title: headline,
    description: subheadline,
    openGraph: {
      title: headline,
      description: subheadline,
      images: logoUrl ? [logoUrl] : [],
    },
  }
}

export default async function CapturePage({ params }: { params: Promise<{ funnelId: string }> }) {
  const { funnelId } = await params
  const admin = createAdminClient()
  const { data: funnel } = await admin
    .from('funnels')
    .select('id, name, page_template, page_config')
    .eq('id', funnelId)
    .single()

  if (!funnel) notFound()

  const cfg = ((funnel as unknown as Record<string, unknown>).page_config ?? {}) as Record<string, unknown>
  const template = ((funnel as unknown as Record<string, unknown>).page_template as string) ?? 'minimal'
  const headline = (cfg.headline as string) || 'Garanta seu acesso gratuito'
  const subheadline = (cfg.subheadline as string) || 'Preencha seus dados e receba o acesso imediatamente'
  const ctaText = (cfg.cta_text as string) || 'Quero Acesso Agora →'
  const ctaColor = (cfg.cta_color as string) || '#0F0F0F'
  const logoUrl = cfg.logo_url as string | undefined
  const bgImageUrl = cfg.bg_image_url as string | undefined
  const emailEnabled = !!(cfg.fields_enabled && (cfg.fields_enabled as Record<string, boolean>).email)

  const formProps = { funnelId, ctaText, ctaColor, emailEnabled }

  if (template === 'dark') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #000000 0%, #0a0a1a 50%, #000000 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
        <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          .dark-card { animation: fadeIn 0.5s ease forwards; max-width: 480px; width: 100%; }
          .grid-bg { position: fixed; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 50px 50px; pointer-events: none; }
        `}</style>
        <div className="grid-bg" />
        <div className="dark-card">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 32, display: 'block' }} />
          )}
          <h1 style={{ color: 'white', fontSize: 52, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-2px', marginBottom: 16 }}>{headline}</h1>
          {subheadline && <p style={{ color: '#A1A1AA', fontSize: 18, lineHeight: 1.6, marginBottom: 32 }}>{subheadline}</p>}
          <CaptureFormV2 {...formProps} dark />
          <p style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 16 }}>🔒 Seus dados estão protegidos</p>
        </div>
      </div>
    )
  }

  if (template === 'split') {
    return (
      <div style={{ minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          .split-form { animation: fadeIn 0.5s ease forwards; }
          .split-grid { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
          @media (max-width: 768px) { .split-grid { grid-template-columns: 1fr !important; } .split-left { min-height: 240px !important; } .split-right { padding: 32px 20px !important; } }
        `}</style>
        <div className="split-grid">
          <div className="split-left" style={{ backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : 'linear-gradient(135deg, #1a1a2e, #16213e)', backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', display: 'flex', alignItems: 'flex-end', padding: '60px 48px' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.3) 100%)' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h1 style={{ color: 'white', fontSize: 42, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-2px', marginBottom: 16 }}>{headline}</h1>
              {subheadline && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, lineHeight: 1.6 }}>{subheadline}</p>}
            </div>
          </div>
          <div className="split-right" style={{ background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 48px' }}>
            <div className="split-form" style={{ width: '100%', maxWidth: 420 }}>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 32, display: 'block' }} />
              )}
              <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-2px', color: '#0F0F0F', lineHeight: 1.1, marginBottom: 8 }}>Preencha seus dados</h2>
              <p style={{ color: '#6B7280', marginBottom: 32, fontSize: 15 }}>Acesso gratuito e imediato</p>
              <CaptureFormV2 {...formProps} />
              <p style={{ color: '#9CA3AF', fontSize: 12, textAlign: 'center', marginTop: 16 }}>🔒 Seus dados estão seguros</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // minimal (default) — Minimalista Elegante
  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .minimal-card { animation: fadeIn 0.5s ease forwards; max-width: 480px; width: 100%; text-align: center; }
      `}</style>
      <div className="minimal-card">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 40, display: 'inline-block' }} />
        )}
        <h1 style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-2px', color: '#0F0F0F', lineHeight: 1.1, marginBottom: 16 }}>{headline}</h1>
        {subheadline && <p style={{ fontSize: 18, color: '#6b7280', maxWidth: 480, margin: '0 auto', marginBottom: 40, lineHeight: 1.6 }}>{subheadline}</p>}
        <div style={{ textAlign: 'left' }}>
          <CaptureFormV2 {...formProps} />
        </div>
        <p style={{ color: '#D1D5DB', fontSize: 13, marginTop: 16 }}>🔒 Seus dados estão seguros e não serão compartilhados</p>
      </div>
    </div>
  )
}
