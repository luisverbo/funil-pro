import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

interface Props {
  params: Promise<{ funnelId: string }>
}

export default async function ThankYouPage({ params }: Props) {
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
  const thankYouMessage = (cfg.thank_you_message as string) || 'Obrigado! Verifique seu WhatsApp em instantes.'
  const redirectUrl = cfg.redirect_url as string | undefined
  const ctaColor = (cfg.cta_color as string) || '#6366f1'

  if (template === 'dark') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A2E 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
        <style>{`
          @keyframes pop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
          .ty-icon { animation: pop 0.5s ease forwards; }
          .ty-content { animation: fadeIn 0.5s ease 0.2s both; }
          .grid-bg { position: fixed; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 50px 50px; pointer-events: none; }
        `}</style>
        <div className="grid-bg" />
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div className="ty-icon" style={{ width: 80, height: 80, borderRadius: '50%', background: `${ctaColor}22`, border: `2px solid ${ctaColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px', fontSize: 36, color: ctaColor }}>✓</div>
          <div className="ty-content">
            <h1 style={{ color: 'white', fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, marginBottom: 16, lineHeight: 1.2 }}>Cadastro confirmado!</h1>
            <p style={{ color: '#A1A1AA', fontSize: 18, lineHeight: 1.6, marginBottom: 32 }}>{thankYouMessage}</p>
            {redirectUrl && (
              <Link href={redirectUrl} style={{ display: 'inline-block', padding: '14px 32px', background: ctaColor, color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 16, textDecoration: 'none' }}>
                Continuar →
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (template === 'split') {
    return (
      <div style={{ minHeight: '100vh', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
        <style>{`
          @keyframes pop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
          .ty-icon { animation: pop 0.5s ease forwards; }
          .ty-content { animation: fadeIn 0.5s ease 0.2s both; }
        `}</style>
        <div style={{ textAlign: 'center', maxWidth: 480, background: 'white', borderRadius: 24, padding: '48px 40px', boxShadow: '0 4px 40px rgba(0,0,0,0.08)' }}>
          <div className="ty-icon" style={{ width: 80, height: 80, borderRadius: '50%', background: '#F0FDF4', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px', fontSize: 36, color: '#22c55e' }}>✓</div>
          <div className="ty-content">
            <h1 style={{ color: '#0F0F0F', fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, marginBottom: 16, lineHeight: 1.2 }}>Cadastro confirmado!</h1>
            <p style={{ color: '#6B7280', fontSize: 17, lineHeight: 1.6, marginBottom: 32 }}>{thankYouMessage}</p>
            {redirectUrl && (
              <Link href={redirectUrl} style={{ display: 'inline-block', padding: '14px 32px', background: ctaColor, color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 16, textDecoration: 'none' }}>
                Continuar →
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  // minimal (default)
  return (
    <div style={{ minHeight: '100vh', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @keyframes pop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .ty-icon { animation: pop 0.5s ease forwards; }
        .ty-content { animation: fadeIn 0.5s ease 0.2s both; }
      `}</style>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div className="ty-icon" style={{ width: 80, height: 80, borderRadius: '50%', background: '#F0FDF4', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px', fontSize: 36, color: '#22c55e' }}>✓</div>
        <div className="ty-content">
          <h1 style={{ color: '#0F0F0F', fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-1px', marginBottom: 16, lineHeight: 1.15 }}>Cadastro confirmado!</h1>
          <p style={{ color: '#6B7280', fontSize: 18, lineHeight: 1.6, marginBottom: 32 }}>{thankYouMessage}</p>
          {redirectUrl && (
            <Link href={redirectUrl} style={{ display: 'inline-block', padding: '16px 40px', background: ctaColor, color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 17, textDecoration: 'none' }}>
              Continuar →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
