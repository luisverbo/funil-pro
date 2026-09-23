-- ============================================================================
-- CONTEÚDOS INSTAGRAM — aprovação e publicação automática de Reels/carrosséis
-- ----------------------------------------------------------------------------
-- O conteúdo é produzido FORA do FunilPro (skills no PC do dono), que sobem os
-- arquivos no bucket e inserem aqui com a service role. O painel /conteudos só
-- exibe, deixa aprovar e publica no horário.
--
-- Identificação: tenant_id (padrão de todo o banco). conta_instagram_id é
-- opcional na inserção — o publicador pergunta o ID à Meta com o token que a
-- plataforma já tem e grava aqui.
--
-- Regra de horário (Brasília): reel às 06:00, carrossel às 15:00, UM por dia
-- de cada tipo. Descartado não ocupa vaga.
-- ============================================================================

CREATE TABLE IF NOT EXISTS conteudos_instagram (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conta_instagram_id  text,

  tipo                text NOT NULL CHECK (tipo IN ('reel', 'carrossel')),
  status              text NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'agendado', 'publicando', 'publicado', 'erro', 'descartado')),
  data_agendada       timestamptz NOT NULL,

  midia_urls          text[] NOT NULL CHECK (array_length(midia_urls, 1) >= 1),
  capa_url            text,
  descricao           text NOT NULL DEFAULT '',
  alt_text            text,
  hashtags            text[] NOT NULL DEFAULT '{}',
  palavra_chave       text,

  tema                text,
  origem_url          text,
  origem_trecho       text,
  nota                int CHECK (nota IS NULL OR (nota >= 0 AND nota <= 10)),

  ig_container_id     text,
  ig_media_id         text,
  ig_permalink        text,
  erro                text,
  tentativas          int NOT NULL DEFAULT 0,

  created_at          timestamptz NOT NULL DEFAULT now(),
  aprovado_em         timestamptz,
  publicado_em        timestamptz,

  -- reel = 1 vídeo; carrossel = 2 a 10 imagens (limite da Meta)
  CONSTRAINT conteudos_ig_midia_por_tipo CHECK (
    (tipo = 'reel' AND array_length(midia_urls, 1) = 1)
    OR (tipo = 'carrossel' AND array_length(midia_urls, 1) BETWEEN 2 AND 10)
  )
);

CREATE INDEX IF NOT EXISTS idx_conteudos_ig_tenant_status ON conteudos_instagram (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_conteudos_ig_agenda        ON conteudos_instagram (status, data_agendada);
CREATE INDEX IF NOT EXISTS idx_conteudos_ig_tenant_tipo_data ON conteudos_instagram (tenant_id, tipo, data_agendada);

ALTER TABLE conteudos_instagram ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation        ON conteudos_instagram USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_insert ON conteudos_instagram FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_update ON conteudos_instagram FOR UPDATE USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation_delete ON conteudos_instagram FOR DELETE USING (tenant_id = current_tenant_id());

-- ─── Bucket público: a Meta baixa o arquivo pela URL ────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('conteudos-instagram', 'conteudos-instagram', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "conteudos ig upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conteudos-instagram');
CREATE POLICY "conteudos ig update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'conteudos-instagram');
CREATE POLICY "conteudos ig delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'conteudos-instagram');

-- ─── Hora do slot por tipo (Brasília) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION conteudo_ig_hora_do_slot(p_tipo text)
RETURNS time LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tipo WHEN 'reel' THEN time '06:00' ELSE time '15:00' END;
$$;

-- ─── proxima_data_livre(tenant, tipo) ───────────────────────────────────────
-- Próximo dia (a partir de hoje, se o horário ainda não passou) sem item do
-- mesmo tipo neste tenant, ignorando descartados. Devolve timestamptz no
-- instante exato do slot em America/Sao_Paulo.
CREATE OR REPLACE FUNCTION proxima_data_livre(p_tenant_id uuid, p_tipo text)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_agora     timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  v_dia       date;
  v_slot      timestamptz;
BEGIN
  IF p_tipo NOT IN ('reel', 'carrossel') THEN
    RAISE EXCEPTION 'tipo inválido: %', p_tipo;
  END IF;

  -- Se o slot de hoje já passou, começa amanhã.
  v_dia := v_hoje;
  IF (v_hoje + conteudo_ig_hora_do_slot(p_tipo)) <= v_agora THEN
    v_dia := v_hoje + 1;
  END IF;

  -- Anda dia a dia até achar um sem item do tipo (teto de 2 anos).
  FOR i IN 0..730 LOOP
    v_slot := ((v_dia + i) + conteudo_ig_hora_do_slot(p_tipo)) AT TIME ZONE 'America/Sao_Paulo';
    IF NOT EXISTS (
      SELECT 1 FROM conteudos_instagram c
      WHERE c.tenant_id = p_tenant_id
        AND c.tipo = p_tipo
        AND c.status <> 'descartado'
        AND (c.data_agendada AT TIME ZONE 'America/Sao_Paulo')::date = (v_dia + i)
    ) THEN
      RETURN v_slot;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'sem vaga livre nos próximos 2 anos';
END;
$$;

-- ─── puxar_fila(tenant, tipo, a_partir_de) ──────────────────────────────────
-- Depois de descartar um item, os seguintes do mesmo tipo (pendentes ou
-- agendados, com data DEPOIS da vaga liberada) sobem UM dia. Só mexe em quem
-- ainda não foi publicado. Devolve quantos andaram.
CREATE OR REPLACE FUNCTION puxar_fila(p_tenant_id uuid, p_tipo text, p_a_partir_de timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_qtd int;
BEGIN
  UPDATE conteudos_instagram
  SET data_agendada = data_agendada - interval '1 day'
  WHERE tenant_id = p_tenant_id
    AND tipo = p_tipo
    AND status IN ('pendente', 'agendado')
    AND data_agendada > p_a_partir_de;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END;
$$;

-- ─── reservar_conteudos_para_publicar(limite) ───────────────────────────────
-- O cron marca como 'publicando' de forma ATÔMICA antes de começar: dois crons
-- em paralelo nunca pegam o mesmo item. Só o service role chama.
CREATE OR REPLACE FUNCTION reservar_conteudos_para_publicar(p_limite int DEFAULT 5)
RETURNS SETOF conteudos_instagram LANGUAGE sql AS $$
  UPDATE conteudos_instagram
  SET status = 'publicando'
  WHERE id IN (
    SELECT id FROM conteudos_instagram
    WHERE status = 'agendado' AND data_agendada <= now()
    ORDER BY data_agendada
    LIMIT p_limite
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
