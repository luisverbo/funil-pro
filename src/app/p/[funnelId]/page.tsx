import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import CaptureFormV2 from '@/components/public/capture-form-v2'

export async function generateMetadata({ params }: { params: Promise<{ funnelId: string }> }): Promise<Metadata> {
  const { funnelId } = await params
  const admin = createAdminClient()
  const { data: funnel } = await admin.from('funnels').select('name, page_config').eq('id', funnelId).single()
  const cfg = ((funnel?.page_config ?? {}) as Record<string, string>)
  return {
    title: cfg.headline || funnel?.name || 'Acesse agora',
    description: cfg.subheadline || '',
    openGraph: {
      title: cfg.headline || funnel?.name || 'Acesse agora',
      description: cfg.subheadline || '',
      ...(cfg.bg_image_url ? { images: [cfg.bg_image_url] } : {}),
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
  const headline = (cfg.headline as string) || funnel.name
  const subheadline = (cfg.subheadline as string) || ''
  const ctaText = (cfg.cta_text as string) || 'Quero Acessar Agora'
  const ctaColor = (cfg.cta_color as string) || '#6366f1'
  const logoUrl = cfg.logo_url as string | undefined
  const bgImageUrl = cfg.bg_image_url as string | undefined
  const emailEnabled = (cfg.email_enabled as boolean) ?? false
  const benefits = (cfg.benefits as string[]) ?? ['Acesso imediato', 'Conteúdo exclusivo', 'Sem compromisso']

  const formProps = { funnelId, ctaText, ctaColor, emailEnabled }

  if (template === 'dark') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A2E 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
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
          <div style={{ display: 'inline-block', border: `1px solid ${ctaColor}`, color: ctaColor, fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', padding: '6px 14px', borderRadius: 6, marginBottom: 24 }}>ACESSO EXCLUSIVO</div>
          <h1 style={{ color: 'white', fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 800, lineHeight: 1.1, marginBottom: 16 }}>{headline}</h1>
          {subheadline && <p style={{ color: '#A1A1AA', fontSize: 18, lineHeight: 1.6, marginBottom: 32 }}>{subheadline}</p>}
          <div style={{ marginBottom: 32 }}>
            {benefits.map((b: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 20, height: 20, background: ctaColor, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, color: 'white' }}>✓</div>
                <span style={{ color: '#D1D5DB', fontSize: 15 }}>{b}</span>
              </div>
            ))}
          </div>
          <CaptureFormV2 {...formProps} dark />
          <p style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 16 }}>🔒 Seus dados estão protegidos</p>
        </div>
      </div>
    )
  }

  if (template === 'split') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'system-ui, sans-serif' }}>
        <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          .split-form { animation: fadeIn 0.5s ease forwards; }
          @media (max-width: 768px) { .split-container { flex-direction: column !important; } .split-left { min-height: 220px !important; } .split-right { padding: 32px 20px !important; } }
        `}</style>
        <div className="split-container" style={{ display: 'flex', width: '100%' }}>
          <div className="split-left" style={{ flex: 1, minHeight: '100vh', backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : 'linear-gradient(135deg, #1e1b4b, #312e81)', backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', display: 'flex', alignItems: 'flex-end', padding: '60px 48px' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.3) 100%)' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h1 style={{ color: 'white', fontSize: 'clamp(28px, 3.5vw, 48px)', fontWeight: 800, lineHeight: 1.15, marginBottom: 16 }}>{headline}</h1>
              {subheadline && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, lineHeight: 1.6 }}>{subheadline}</p>}
            </div>
          </div>
          <div className="split-right" style={{ flex: 1, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 48px' }}>
            <div className="split-form" style={{ width: '100%', maxWidth: 420 }}>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 32, display: 'block' }} />
              )}
              <h2 style={{ fontSize: 28, fontWeight: 800, color: '#0F0F0F', marginBottom: 8 }}>Preencha seus dados</h2>
              <p style={{ color: '#6B7280', marginBottom: 32, fontSize: 15 }}>Acesso gratuito e imediato</p>
              <CaptureFormV2 {...formProps} />
              <p style={{ color: '#9CA3AF', fontSize: 12, textAlign: 'center', marginTop: 16 }}>🔒 Seus dados estão seguros</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // minimal (default)
  return (
    <div style={{ minHeight: '100vh', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .minimal-card { animation: fadeIn 0.5s ease forwards; max-width: 520px; width: 100%; text-align: center; }
      `}</style>
      <div className="minimal-card">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, marginBottom: 40, display: 'inline-block' }} />
        )}
        <h1 style={{ fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 800, letterSpacing: '-2px', color: '#0F0F0F', lineHeight: 1.1, marginBottom: 16 }}>{headline}</h1>
        {subheadline && <p style={{ fontSize: 20, color: '#6B7280', maxWidth: 480, margin: '0 auto 40px', lineHeight: 1.6 }}>{subheadline}</p>}
        <div style={{ textAlign: 'left' }}>
          <CaptureFormV2 {...formProps} />
        </div>
        <p style={{ color: '#D1D5DB', fontSize: 13, marginTop: 16 }}>🔒 Seus dados estão seguros e não serão compartilhados</p>
      </div>
    </div>
  )
}
