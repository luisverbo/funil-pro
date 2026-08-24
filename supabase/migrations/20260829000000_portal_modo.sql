-- ============================================================================
-- PORTAL: tipo do funil — vendas (leads) ou vaga de emprego (candidatos)
-- ----------------------------------------------------------------------------
-- O mesmo painel serve para entregar lead de venda E currículo de candidato.
-- A estrutura não muda; muda o VOCABULÁRIO que o cliente vê ("Candidatos",
-- "Entrevista marcada", "Contratado"). O dono escolhe por funil.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.client_portal_quizzes') IS NOT NULL THEN
    ALTER TABLE client_portal_quizzes
      ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'vendas'
        CHECK (modo IN ('vendas', 'vagas'));
  END IF;
END $$;
