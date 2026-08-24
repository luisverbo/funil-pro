-- ============================================================================
-- PORTAL: equipe de vendedores (sem login individual)
-- ----------------------------------------------------------------------------
-- O gestor (cliente do dono) cadastra os vendedores dentro do próprio portal:
-- só nome e WhatsApp — sem senha. Cada lead ganha um responsável; a
-- distribuição pode ser manual ou por rodízio automático. Tudo pelo MESMO
-- link+senha do portal: o vendedor escolhe o próprio nome ao abrir.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id  uuid NOT NULL REFERENCES client_portals(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  whatsapp   text,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_portal_members_portal ON portal_members(portal_id);

ALTER TABLE portal_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_members_tenant_isolation ON portal_members;
CREATE POLICY portal_members_tenant_isolation ON portal_members
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));

-- Responsável pelo lead: mora na MESMA linha do status (uma marcação por
-- lead por portal). Vendedor removido => responsável vira nulo, lead volta
-- para a fila — nunca some.
DO $$
BEGIN
  IF to_regclass('public.portal_lead_status') IS NOT NULL THEN
    ALTER TABLE portal_lead_status
      ADD COLUMN IF NOT EXISTS assigned_member_id uuid
        REFERENCES portal_members(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.client_portals') IS NOT NULL THEN
    -- Mensagem pré-preenchida do WhatsApp ({nome} vira o nome do lead) e o
    -- rodízio automático de leads sem responsável.
    ALTER TABLE client_portals
      ADD COLUMN IF NOT EXISTS msg_whatsapp text,
      ADD COLUMN IF NOT EXISTS auto_distribuir boolean NOT NULL DEFAULT false;
  END IF;
END $$;
