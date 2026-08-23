-- ============================================================================
-- PORTAL DO CLIENTE — um acesso por cliente, vários funis dentro
-- ----------------------------------------------------------------------------
-- Substitui o compartilhamento 1-link-por-quiz (quiz_share_links) por um
-- portal por CLIENTE: o dono escolhe quais quizzes entram e o que o cliente
-- vê em cada um (por padrão, só quem concluiu — o lead quente). O cliente
-- marca o desfecho de cada lead (contactado, agendado, fechado...), e isso
-- fica gravado para o dono ver.
--
-- Se quiz_share_links já existir (migration anterior aplicada), os links
-- ativos são migrados automaticamente — token e senha continuam valendo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_portals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Nome do CLIENTE que vai abrir o portal ("Clínica Sorriso") — aparece no topo.
  nome             text NOT NULL DEFAULT 'Cliente',
  token            text NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  mostrar_metricas boolean NOT NULL DEFAULT true,
  mostrar_funil    boolean NOT NULL DEFAULT true,
  permitir_status  boolean NOT NULL DEFAULT true,
  access_count     int NOT NULL DEFAULT 0,
  last_access_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_portals_token ON client_portals(token);
CREATE INDEX IF NOT EXISTS idx_client_portals_tenant ON client_portals(tenant_id);

-- Quais quizzes o portal mostra, e O QUE mostra de cada um.
CREATE TABLE IF NOT EXISTS client_portal_quizzes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id  uuid NOT NULL REFERENCES client_portals(id) ON DELETE CASCADE,
  page_id    uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- 'concluidos' = só o lead quente (padrão). O dono decide por funil.
  publico    text NOT NULL DEFAULT 'com_contato'
             CHECK (publico IN ('com_contato', 'paginas', 'concluidos', 'com_resposta', 'todos')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_quizzes_portal ON client_portal_quizzes(portal_id);

-- O desfecho que o CLIENTE marca em cada lead. Lista fechada de status.
CREATE TABLE IF NOT EXISTS portal_lead_status (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id  uuid NOT NULL REFERENCES client_portals(id) ON DELETE CASCADE,
  lead_id    uuid NOT NULL REFERENCES quiz_leads(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'novo'
             CHECK (status IN ('novo', 'contactado', 'agendado', 'fechado', 'perdido')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_lead_status_portal ON portal_lead_status(portal_id);

-- RLS: o dono só enxerga os portais do próprio tenant. A rota pública usa a
-- service role e valida token+senha por conta própria.
ALTER TABLE client_portals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portal_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_lead_status   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_portals','client_portal_quizzes','portal_lead_status']
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I_tenant_isolation ON %1$I;
      CREATE POLICY %1$I_tenant_isolation ON %1$I
        FOR ALL
        USING (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()))
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM users_tenants WHERE user_id = auth.uid()));
    $f$, t);
  END LOOP;
END $$;

-- Contador de acesso, incrementado pela rota pública sem corrida.
CREATE OR REPLACE FUNCTION increment_portal_access(p_token text)
RETURNS void AS $$
  UPDATE client_portals
  SET access_count = access_count + 1, last_access_at = now()
  WHERE token = p_token;
$$ LANGUAGE sql SECURITY DEFINER;

-- Migração dos links antigos (se a tabela existir): token e senha CONTINUAM
-- valendo — link já enviado a cliente não pode morrer numa atualização.
DO $$
BEGIN
  IF to_regclass('public.quiz_share_links') IS NOT NULL THEN
    INSERT INTO client_portals (tenant_id, nome, token, password_hash, enabled, access_count, last_access_at, created_at)
    SELECT tenant_id, 'Cliente', token, password_hash, enabled, access_count, last_access_at, created_at
    FROM quiz_share_links
    ON CONFLICT (token) DO NOTHING;

    INSERT INTO client_portal_quizzes (tenant_id, portal_id, page_id, publico)
    SELECT s.tenant_id, p.id, s.page_id, 'todos'
    FROM quiz_share_links s
    JOIN client_portals p ON p.token = s.token
    ON CONFLICT (portal_id, page_id) DO NOTHING;
  END IF;
END $$;
