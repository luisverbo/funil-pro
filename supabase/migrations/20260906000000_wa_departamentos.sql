-- ============================================================================
-- MULTIATENDIMENTO: departamentos, distribuição automática e papel de gestor
-- ----------------------------------------------------------------------------
--   • wa_departamentos: Vendas, Suporte, Financeiro… cada um com seu modo de
--     distribuição (manual | rodizio | menos_ocupado — o "inteligente" soma
--     afinidade: o lead volta para quem já o atendeu)
--   • wa_atendentes ganha departamento e papel (gestor | atendente)
--   • wa_conversations ganha departamento
--   • wa_accounts ganha o departamento PADRÃO (conversa nova cai nele)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_departamentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  emoji        text NOT NULL DEFAULT '💼',
  -- manual: gestor distribui | rodizio: um para cada |
  -- menos_ocupado: quem tem menos conversas abertas recebe (com afinidade)
  distribuicao text NOT NULL DEFAULT 'menos_ocupado'
               CHECK (distribuicao IN ('manual', 'rodizio', 'menos_ocupado')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

ALTER TABLE wa_atendentes
  ADD COLUMN IF NOT EXISTS departamento_id uuid REFERENCES wa_departamentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS papel text NOT NULL DEFAULT 'atendente'
    CHECK (papel IN ('gestor', 'atendente')),
  -- rodízio: quem recebeu há mais tempo é o próximo
  ADD COLUMN IF NOT EXISTS ultima_atribuicao_at timestamptz;

ALTER TABLE wa_conversations
  ADD COLUMN IF NOT EXISTS departamento_id uuid REFERENCES wa_departamentos(id) ON DELETE SET NULL;

ALTER TABLE wa_accounts
  ADD COLUMN IF NOT EXISTS departamento_padrao_id uuid REFERENCES wa_departamentos(id) ON DELETE SET NULL;

ALTER TABLE wa_departamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_departamentos_tenant_isolation ON wa_departamentos;
CREATE POLICY wa_departamentos_tenant_isolation ON wa_departamentos
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
