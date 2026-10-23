-- ============================================================================
-- ESTÚDIO IA — Fase 2b: webhook por número (override) com o app Cobrazap
-- ----------------------------------------------------------------------------
-- O app que tem acesso à WABA 2250778325757289 é o Cobrazap (webhook do APP
-- aponta para cobrarzap.com.br e não pode mudar). Só o número do estúdio é
-- desviado para o FunilPro com webhook_configuration.override_callback_uri.
-- A Meta assina esse POST com o App Secret do COBRAZAP e verifica o GET com o
-- verify_token que mandamos no override — os dois ficam aqui, só no servidor.
-- ============================================================================
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS app_secret   text;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS verify_token text;

-- verify_token aleatório para quem já tem config (o servidor gera para os novos).
UPDATE estudio_config SET verify_token = encode(extensions.gen_random_bytes(24), 'hex')
WHERE verify_token IS NULL;

REVOKE ALL ON estudio_config FROM anon, authenticated;
