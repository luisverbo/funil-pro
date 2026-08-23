-- ============================================================================
-- PORTAL: público "deixou contato"
-- ----------------------------------------------------------------------------
-- Em funil que pede telefone ANTES da última página, muita gente deixa o
-- contato e nunca clica no botão final. Pelo status do quiz essa pessoa "não
-- concluiu" — mas para quem vai ligar, é o melhor lead que existe. As três
-- opções antigas escondiam justamente quem podia ser atendido.
--
-- Idempotente: rodar de novo não faz mal. Se a tabela ainda não existir
-- (migration do portal não aplicada), não faz nada.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.client_portal_quizzes') IS NOT NULL THEN
    ALTER TABLE client_portal_quizzes
      DROP CONSTRAINT IF EXISTS client_portal_quizzes_publico_check;

    ALTER TABLE client_portal_quizzes
      ADD CONSTRAINT client_portal_quizzes_publico_check
      CHECK (publico IN ('com_contato', 'concluidos', 'com_resposta', 'todos'));

    ALTER TABLE client_portal_quizzes
      ALTER COLUMN publico SET DEFAULT 'com_contato';
  END IF;
END $$;
