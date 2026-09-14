-- ============================================================================
-- PLANO "QUIZ" — vender só o quiz
-- ----------------------------------------------------------------------------
-- O dono anuncia o quiz como produto avulso. Quem compra entra num FunilPro
-- enxuto (Páginas só com quiz + Configurações). O CHECK do plano ganha o
-- valor novo; o resto da regra vive em src/lib/planos/acesso.ts.
-- ============================================================================

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('starter', 'pro', 'scale', 'quiz'));
