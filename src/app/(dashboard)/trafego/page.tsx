// ============================================================================
// Painel do Gestor de Tráfego
// ----------------------------------------------------------------------------
// O servidor só confere sessão e se o banco está pronto; o painel (uma conta
// por vez, KPIs, gráfico, Mesa de estrategistas e tabela) é o PainelTrafego.
//
// ZERO NUNCA É MOSTRADO COMO RESPOSTA: banco sem tabela, conta nunca lida,
// token caído (token_expired) e venda sem origem (semAtr) têm texto próprio.
// ============================================================================
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'
import { PainelTrafego } from './painel-client'

export const dynamic = 'force-dynamic'

const NIVEIS: NivelAnuncio[] = ['campaign', 'adset', 'ad']

export default async function TrafegoPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const nivel = (NIVEIS.includes(sp.nivel as NivelAnuncio) ? sp.nivel : 'campaign') as NivelAnuncio
  // Período livre: `p` (hoje/ontem/7/14/30/mes/custom) + `de`/`ate`. `dias` antigo vira preset.
  const periodo = { p: sp.p ?? (sp.dias ? String(sp.dias) : undefined), de: sp.de, ate: sp.ate }
  const conta = /^[0-9a-f-]{36}$/i.test(sp.conta ?? '') ? sp.conta : null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut) redirect('/onboarding')

  const { data: contas, error } = await createAdminClient().from('ad_accounts')
    .select('last_sync_at').eq('tenant_id', ut.tenant_id).eq('provider', 'meta')
  const migrationPendente = Boolean(error)
  const nuncaSincronizou = (contas ?? []).length > 0 && (contas ?? []).every(c => !c.last_sync_at)

  if (migrationPendente) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <strong>Banco ainda não preparado.</strong> As tabelas de tráfego não existem neste projeto — um painel
          zerado aqui seria mentira. Aplique a migration <code>20260818000000_trafego_fase1.sql</code> no Supabase.
        </div>
      </div>
    )
  }

  return (
    <>
      {nuncaSincronizou && (
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <strong>Aguardando a primeira leitura.</strong> Clique em &quot;Atualizar&quot; ou aguarde a rodada automática —
            isto aqui não é &quot;zero vendas&quot;.
          </div>
        </div>
      )}
      <PainelTrafego contaInicial={conta} periodoInicial={periodo} nivel={nivel} />
    </>
  )
}
