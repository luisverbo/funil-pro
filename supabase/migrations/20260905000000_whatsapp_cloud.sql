-- ============================================================================
-- MULTIATENDIMENTO WHATSAPP — API OFICIAL (Cloud API da Meta)
-- ----------------------------------------------------------------------------
-- Etapas W1+W2 do PLANO-WHATSAPP-MULTIATENDIMENTO.md. Convive com o
-- Evolution (não-oficial): são produtos diferentes; este inbox nasce só para
-- a Cloud API.
--
--   wa_accounts          conta conectada (WABA + número + token)
--   wa_conversations     uma por telefone/conta — janela de 24h, modo
--                        humano/IA, atendente, tags, vendido com valor
--   wa_messages          histórico (dedupe por wamid — a Meta REENVIA)
--   wa_atendentes        equipe sem login individual (padrão portal_members)
--   wa_respostas_rapidas atalhos "/preço" → texto pronto
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waba_id          text NOT NULL,
  phone_number_id  text NOT NULL UNIQUE,   -- roteia o webhook até o tenant
  display_number   text,
  nome             text,                    -- rótulo interno ("Comercial SP")
  access_token     text NOT NULL,
  -- Agente IA de plantão: responde quando a conversa está em modo 'ia'.
  agente_plantao_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'pausada')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_accounts_tenant ON wa_accounts(tenant_id);

CREATE TABLE IF NOT EXISTS wa_conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
  telefone       text NOT NULL,             -- dígitos, com DDI (formato da Meta)
  nome           text,                      -- profile.name do WhatsApp
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'resolvida')),
  -- 'ia' = o agente de plantão responde; 'humano' = só atendente fala.
  modo           text NOT NULL DEFAULT 'humano' CHECK (modo IN ('humano', 'ia')),
  atendente_id   uuid,                      -- FK solta: wa_atendentes pode ser desativado
  -- Fim da janela de 24h da Meta (última msg do LEAD + 24h). Fora dela, só template.
  janela_ate     timestamptz,
  nao_lidas      int NOT NULL DEFAULT 0,
  ultima_msg     text,
  ultima_msg_at  timestamptz,
  tags           text[] NOT NULL DEFAULT '{}',
  vendido_cents  int,                       -- venda marcada na própria conversa
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, telefone)
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_tenant ON wa_conversations(tenant_id, ultima_msg_at DESC);

CREATE TABLE IF NOT EXISTS wa_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  direcao         text NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  autor           text NOT NULL DEFAULT 'lead' CHECK (autor IN ('lead', 'atendente', 'ia', 'sistema')),
  autor_nome      text,
  tipo            text NOT NULL DEFAULT 'texto',   -- texto | template | imagem | audio | documento | outro
  corpo           text,
  template_name   text,
  wamid           text UNIQUE,               -- id da Meta: dedupe de reentrega
  status_entrega  text,                      -- sent | delivered | read | failed
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_conv ON wa_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS wa_atendentes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_respostas_rapidas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  atalho     text NOT NULL,                  -- sem a barra: 'preço'
  texto      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, atalho)
);

ALTER TABLE wa_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_atendentes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_respostas_rapidas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_accounts','wa_conversations','wa_messages','wa_atendentes','wa_respostas_rapidas']
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
