-- ============================================================================
-- ESTÚDIO IA — Fase 2b: chat do estúdio (estilo WhatsApp Web)
-- ----------------------------------------------------------------------------
-- O Luís não tem mais o WhatsApp do número do estúdio no celular: o chat vive
-- dentro do FunilPro. Só COLUNAS NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- ─── Contato: lista do chat, quem está atendendo, idioma ────────────────────
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS pais           text;   -- ISO: BR, PT, ES, MX, AR, CO, US…
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS idioma         text;   -- pt-BR, pt-PT, es-ES, es-MX, es-AR, es-CO, en-US, en
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS nao_lidas      int NOT NULL DEFAULT 0;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ultima_msg     text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS modo           text NOT NULL DEFAULT 'ana';  -- ana | humano
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS humano_desde   timestamptz;  -- última mensagem manual do Luís
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS humano_fixo    boolean NOT NULL DEFAULT false; -- "Assumir" = não devolve sozinho
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS etapa          text;          -- etapa da Ana (Fase 3)
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS notas          text;          -- notas internas do Luís
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS precisa_humano boolean NOT NULL DEFAULT false; -- "passou para humano"

DO $$ BEGIN
  ALTER TABLE estudio_contatos ADD CONSTRAINT estudio_contatos_modo_ck CHECK (modo IN ('ana', 'humano'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Mensagem: mídia guardada no Storage (a URL da Meta expira) e autor ─────
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS media_path text;   -- estudio-clientes/conversas/<contato>/<arquivo>
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS media_mime text;
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS media_nome text;
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS autor      text NOT NULL DEFAULT 'cliente'; -- cliente | ana | luis | sistema
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS erro       text;

-- ─── Config: devolve para a Ana após N horas sem mensagem manual ────────────
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS pausa_humano_horas int NOT NULL DEFAULT 2;

-- Quem já respondeu automaticamente na Fase 2 foi a Ana, não a cliente.
UPDATE estudio_mensagens SET autor = 'ana' WHERE direcao = 'saida' AND autor = 'cliente';

-- Contatos que já existem: país/idioma pelo DDI do wa_id.
UPDATE estudio_contatos SET pais = CASE
    WHEN wa_id LIKE '55%'  THEN 'BR' WHEN wa_id LIKE '351%' THEN 'PT' WHEN wa_id LIKE '34%' THEN 'ES'
    WHEN wa_id LIKE '52%'  THEN 'MX' WHEN wa_id LIKE '54%'  THEN 'AR' WHEN wa_id LIKE '57%' THEN 'CO'
    WHEN wa_id LIKE '1%'   THEN 'US' ELSE NULL END
WHERE pais IS NULL;
UPDATE estudio_contatos SET idioma = CASE pais
    WHEN 'BR' THEN 'pt-BR' WHEN 'PT' THEN 'pt-PT' WHEN 'ES' THEN 'es-ES' WHEN 'MX' THEN 'es-MX'
    WHEN 'AR' THEN 'es-AR' WHEN 'CO' THEN 'es-CO' WHEN 'US' THEN 'en-US' ELSE 'en' END
WHERE idioma IS NULL;

CREATE INDEX IF NOT EXISTS idx_estudio_mensagens_wamid ON estudio_mensagens (wamid);
