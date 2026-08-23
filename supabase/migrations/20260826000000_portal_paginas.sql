-- ============================================================================
-- PORTAL: quais PÁGINAS do quiz têm as respostas mostradas ao cliente
-- ----------------------------------------------------------------------------
-- O dono escolhe, por funil, as páginas cujas respostas aparecem em cada lead
-- do portal (mais de uma, na ordem do quiz). Lista vazia = mostrar só o
-- contato, como era antes — nada muda para portal já criado.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.client_portal_quizzes') IS NOT NULL THEN
    ALTER TABLE client_portal_quizzes
      ADD COLUMN IF NOT EXISTS paginas jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;
