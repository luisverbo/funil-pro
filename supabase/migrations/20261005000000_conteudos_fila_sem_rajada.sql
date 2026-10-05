-- ============================================================================
-- CONTEÚDOS — fim das "rajadas" de posts no mesmo horário
-- ----------------------------------------------------------------------------
-- CAUSA RAIZ (04/10 e 05/10): "Descartar e puxar a fila" (puxar_fila) recuava
-- TODOS os itens seguintes do tipo em 1 dia, às cegas:
--   • item que estava em 05/10 12:00 ia para 04/10 12:00 — já no PASSADO —
--     e o cron, que publica tudo que está vencido, postava na hora;
--   • descartar 3 vezes seguidas empilhava 3–4 reels no mesmo 05/10 06:00.
-- Resultado: 4 reels postados em sequência às 09:20–09:32 do dia 05/10 (e 3
-- no 04/10 06:00, saindo às 06:00, 12:55 e 13:00).
--
-- Correção em três travas:
--   1. puxar_fila vira "corrente": o 1º item seguinte herda a data do
--      descartado, o 2º herda a do 1º, e assim por diante. O conjunto de datas
--      não muda (nunca empilha) e ninguém vai para o passado. Se a vaga
--      liberada já passou, nada anda.
--   2. reservar_conteudos_para_publicar só publica o que venceu há no máximo
--      60 minutos. Mais atrasado que isso vira 'erro' com o motivo — o dono
--      reagenda. Nunca mais "posta tudo que ficou para trás de uma vez".
--   3. no máximo UM item por tipo por rodada: mesmo que dois vençam juntos,
--      o segundo espera a próxima rodada (5 min) — e só sai se ainda estiver
--      dentro da janela.
-- ============================================================================

-- ─── 1. puxar_fila em corrente ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION puxar_fila(p_tenant_id uuid, p_tipo text, p_a_partir_de timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_vaga timestamptz := p_a_partir_de;
  v_qtd  int := 0;
  r      record;
BEGIN
  -- Vaga no passado (ou em cima da hora): não puxa nada para trás.
  IF v_vaga <= now() + interval '10 minutes' THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id, data_agendada FROM conteudos_instagram
    WHERE tenant_id = p_tenant_id
      AND tipo = p_tipo
      AND status IN ('pendente', 'agendado')
      AND data_agendada > p_a_partir_de
    ORDER BY data_agendada, created_at
    FOR UPDATE
  LOOP
    UPDATE conteudos_instagram SET data_agendada = v_vaga WHERE id = r.id;
    v_vaga := r.data_agendada;   -- a data que este liberou vai para o próximo
    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN v_qtd;
END;
$$;

-- ─── 2 e 3. reserva com janela de 60 min e 1 por tipo por rodada ────────────
CREATE OR REPLACE FUNCTION reservar_conteudos_para_publicar(p_limite int DEFAULT 5)
RETURNS SETOF conteudos_instagram LANGUAGE plpgsql AS $$
BEGIN
  -- Preso em 'publicando' há mais de 15 min volta para a fila.
  UPDATE conteudos_instagram
  SET status = CASE WHEN tentativas + 1 >= 3 THEN 'erro' ELSE 'agendado' END,
      tentativas = tentativas + 1,
      erro = 'a publicação anterior não terminou (tempo esgotado) — tentando de novo',
      publicando_desde = NULL
  WHERE status = 'publicando'
    AND publicando_desde IS NOT NULL
    AND publicando_desde < now() - interval '15 minutes';

  -- Vencido há mais de 60 min NÃO é publicado: vira erro com o motivo.
  UPDATE conteudos_instagram
  SET status = 'erro',
      erro = 'O horário (' || to_char(data_agendada AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
             || ') passou sem publicar. Para não postar fora de hora, ele não saiu sozinho — reagende ou use "Tentar de novo".'
  WHERE status = 'agendado'
    AND data_agendada < now() - interval '60 minutes';

  RETURN QUERY
  UPDATE conteudos_instagram
  SET status = 'publicando', publicando_desde = now()
  WHERE id IN (
    -- DISTINCT ON não aceita FOR UPDATE: escolhe o 1º de cada tipo por fora
    -- e trava só esses por dentro.
    SELECT c.id FROM conteudos_instagram c
    WHERE c.id IN (
      SELECT DISTINCT ON (tenant_id, tipo) id
      FROM conteudos_instagram
      WHERE status = 'agendado'
        AND data_agendada <= now()
        AND data_agendada >= now() - interval '60 minutes'
      ORDER BY tenant_id, tipo, data_agendada, created_at
    )
    AND c.status = 'agendado'
    LIMIT p_limite
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
