-- ============================================================================
-- PORTAL: público "preencheu as páginas marcadas"
-- ----------------------------------------------------------------------------
-- O dono marca as páginas (ex.: 4 e 6) e o cliente só vê o lead que respondeu
-- algo em CADA uma delas — quem não cumpriu não aparece.
-- Idempotente; não faz nada se a tabela do portal ainda não existir.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.client_portal_quizzes') IS NOT NULL THEN
    ALTER TABLE client_portal_quizzes
      DROP CONSTRAINT IF EXISTS client_portal_quizzes_publico_check;

    ALTER TABLE client_portal_quizzes
      ADD CONSTRAINT client_portal_quizzes_publico_check
      CHECK (publico IN ('com_contato', 'paginas', 'concluidos', 'com_resposta', 'todos'));
  END IF;
END $$;
