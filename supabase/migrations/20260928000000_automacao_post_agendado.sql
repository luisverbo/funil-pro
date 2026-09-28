-- ============================================================================
-- AUTOMAÇÃO DO INSTAGRAM EM POST AGENDADO (estilo ManyChat)
-- ----------------------------------------------------------------------------
-- Pedido do dono: "no ManyChat eu configuro a automação num vídeo que ainda
-- está agendado; quando ele cai, já está pronta".
--
-- A automação guardava só `media_id` — o ID do post no Instagram, que só
-- EXISTE depois de publicado. Agora ela pode apontar para um conteúdo do
-- painel /conteudos (`conteudo_id`). No instante em que o publicador grava o
-- `ig_media_id` do conteúdo, o gatilho abaixo copia esse ID para as
-- automações que esperavam por ele. Vale para o cron e para "Publicar agora".
--
-- Enquanto espera (conteudo_id preenchido, media_id vazio), a automação NÃO
-- responde a nenhum comentário — senão viraria "qualquer post" por engano.
-- Essa regra fica no webhook.
-- ============================================================================
ALTER TABLE ig_automations
  ADD COLUMN IF NOT EXISTS conteudo_id uuid REFERENCES conteudos_instagram(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ig_automations_conteudo ON ig_automations (conteudo_id) WHERE conteudo_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ligar_automacoes_ao_post_publicado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ig_media_id IS NOT NULL AND (OLD.ig_media_id IS DISTINCT FROM NEW.ig_media_id) THEN
    UPDATE ig_automations
    SET media_id = NEW.ig_media_id
    WHERE conteudo_id = NEW.id
      AND tenant_id = NEW.tenant_id
      AND media_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ligar_automacoes_ao_post ON conteudos_instagram;
CREATE TRIGGER trg_ligar_automacoes_ao_post
  AFTER UPDATE OF ig_media_id ON conteudos_instagram
  FOR EACH ROW EXECUTE FUNCTION ligar_automacoes_ao_post_publicado();
