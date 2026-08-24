-- ============================================================================
-- PORTAL: data de corte por funil ("mostrar a partir de")
-- ----------------------------------------------------------------------------
-- Formulário reformulado deixa para trás leads que não interessam mais ao
-- cliente. Em vez de APAGAR (o dono perderia histórico e as métricas de
-- tráfego), o portal esconde o que é anterior à data escolhida.
-- O dono continua vendo tudo no painel dele.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.client_portal_quizzes') IS NOT NULL THEN
    ALTER TABLE client_portal_quizzes
      ADD COLUMN IF NOT EXISTS desde date;
  END IF;
END $$;
