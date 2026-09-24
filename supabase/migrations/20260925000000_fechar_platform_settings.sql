-- ============================================================================
-- FECHAR platform_settings — segredos estavam legíveis com a chave pública
-- ----------------------------------------------------------------------------
-- A tabela nasceu (20260530060000_admin_panel) com o comentário "No RLS —
-- admin-only access via service role". Mas sem RLS e com os GRANTs padrão do
-- Supabase, os papéis anon e authenticated tinham SELECT: qualquer pessoa com
-- a NEXT_PUBLIC_SUPABASE_ANON_KEY (embutida em toda página do site) podia ler
-- token do Instagram, chaves da Stripe, segredo do cron e as chaves de
-- Meta/Evolution/Resend.
--
-- Todo acesso legítimo usa createAdminClient (service role, ignora RLS):
-- admin/settings, actions/admin, billing/config, instagram/token, webhook da
-- Stripe e a rota do cron. Fechar não quebra nada. APLICADA em 2026-09-25.
-- ============================================================================
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_settings FROM anon, authenticated;

-- O segredo do agendador ficou exposto enquanto a tabela estava aberta:
-- troca por um novo (pg_cron e rota leem daqui a cada chamada).
UPDATE platform_settings
SET value = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
WHERE key = 'conteudos_cron_secret';
