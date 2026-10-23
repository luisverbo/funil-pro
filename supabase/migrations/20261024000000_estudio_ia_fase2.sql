-- ============================================================================
-- ESTÚDIO IA — Fase 2: WhatsApp Cloud API (número exclusivo do estúdio)
-- ----------------------------------------------------------------------------
-- Tabelas NOVAS (não renomeia nada da seção 4):
--   estudio_config     conexão do número do estúdio + WhatsApp do Luís p/ avisos
--   estudio_contatos   quem falou com o estúdio (wa_id, nome, origem, janela)
--   estudio_mensagens  histórico de entrada/saída (dedupe por wamid)
--
-- O webhook é o MESMO da aba WhatsApp (/api/webhooks/meta-wa): a Meta manda
-- tudo da WABA para lá, e o phone_number_id do estúdio é desviado ANTES do
-- inbox — as mensagens do estúdio nunca entram em wa_conversations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS estudio_config (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  waba_id          text,
  phone_number_id  text UNIQUE,
  display_number   text,                 -- +55 21 99077-3595 (vai no wa.me do catálogo)
  access_token     text,                 -- token permanente do usuário do sistema
  whatsapp_avisos  text,                 -- WhatsApp pessoal do Luís (novo pedido pago)
  ativo            boolean NOT NULL DEFAULT false,
  resposta_teste   text,                 -- Fase 2: resposta automática de teste
  verificado_em    timestamptz,
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS estudio_contatos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_id            text NOT NULL,        -- dígitos com DDI, como a Meta manda
  nome             text,                 -- profile.name do WhatsApp
  origem           text NOT NULL DEFAULT 'organico' CHECK (origem IN ('anuncio', 'organico')),
  referral         jsonb,                -- dados do anúncio "Converse conosco" (ctwa)
  janela_ate       timestamptz,          -- fim da janela grátis (24h; 72h vindo de anúncio)
  primeira_msg_em  timestamptz NOT NULL DEFAULT now(),
  ultima_msg_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wa_id)
);
CREATE INDEX IF NOT EXISTS idx_estudio_contatos_ultima ON estudio_contatos (tenant_id, ultima_msg_em DESC);

CREATE TABLE IF NOT EXISTS estudio_mensagens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contato_id      uuid NOT NULL REFERENCES estudio_contatos(id) ON DELETE CASCADE,
  wamid           text UNIQUE,
  direcao         text NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  tipo            text NOT NULL DEFAULT 'texto',   -- texto | imagem | audio | video | documento | outro
  texto           text,
  media_id        text,                            -- id da mídia na Meta (baixar na Fase 3)
  status_entrega  text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estudio_mensagens_contato ON estudio_mensagens (contato_id, criado_em);

-- estudio_pedidos.contato_id passa a apontar para o contato.
DO $$ BEGIN
  ALTER TABLE estudio_pedidos ADD CONSTRAINT estudio_pedidos_contato_fk
    FOREIGN KEY (contato_id) REFERENCES estudio_contatos(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE estudio_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_contatos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON estudio_contatos;
DROP POLICY IF EXISTS tenant_isolation ON estudio_mensagens;
CREATE POLICY tenant_isolation ON estudio_contatos  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON estudio_mensagens USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- estudio_config guarda o TOKEN: ninguém lê pela API pública nem logado —
-- só o servidor (service role). Mesma lição do platform_settings (25/09).
REVOKE ALL ON estudio_config FROM anon, authenticated;
REVOKE ALL ON estudio_contatos, estudio_mensagens FROM anon;
