-- ============================================================================
-- TOKEN DO INSTAGRAM NO BANCO + RENOVAÇÃO AUTOMÁTICA
-- ----------------------------------------------------------------------------
-- O token de longa duração da Instagram API vale 60 dias e o FunilPro só o
-- lia da variável de ambiente — sem renovar. Venceu em 17/09/2026 e derrubou
-- DMs, automações e conteúdos. Agora o token pode ser colado em
-- /admin/settings (sem redeploy) e o cron renova a cada 24h.
-- ============================================================================
INSERT INTO platform_settings (key, value) VALUES
  ('ig_access_token', null),
  ('ig_token_renovado_em', null)
ON CONFLICT (key) DO NOTHING;
