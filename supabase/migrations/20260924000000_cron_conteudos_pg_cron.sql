-- ============================================================================
-- CRON DOS CONTEÚDOS NO SUPABASE (pg_cron + pg_net)
-- ----------------------------------------------------------------------------
-- CAUSA RAIZ do reel de 24/09 06:00 não publicado: o cron agendado do GitHub
-- Actions ("a cada 10 min") rodou só 4 vezes em 9 horas — o GitHub atrasa e
-- DESCARTA execuções agendadas quando a fila está cheia, sem aviso. A última
-- foi às 03:44 (Brasília); a das 06:00 nunca veio.
--
-- Agora quem dispara é o próprio banco, a cada 5 minutos, com horário exato.
-- O GitHub Actions continua como reserva (a reserva atômica impede post
-- duplicado).
--
-- Autenticação: um segredo gerado AQUI, guardado em platform_settings
-- ('conteudos_cron_secret'), enviado no header x-funilpro-cron. A rota aceita
-- esse header OU o Bearer CRON_SECRET de sempre. Nenhuma variável nova.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

INSERT INTO platform_settings (key, value)
VALUES ('conteudos_cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- Função chamada pelo pg_cron: só dispara se houver algo vencido (evita 288
-- chamadas por dia à toa) OU uma vez por hora, para manter o token renovado.
CREATE OR REPLACE FUNCTION disparar_publicacao_instagram()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_segredo text;
  v_ha_vencido boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM conteudos_instagram WHERE status = 'agendado' AND data_agendada <= now()
  ) INTO v_ha_vencido;

  IF NOT v_ha_vencido AND extract(minute FROM now()) >= 5 THEN
    RETURN;   -- nada vencido: só a rodada do minuto 0–4 de cada hora passa
  END IF;

  SELECT value INTO v_segredo FROM platform_settings WHERE key = 'conteudos_cron_secret';

  PERFORM net.http_get(
    url := 'https://funil-pro.vercel.app/api/cron/publicar-instagram',
    headers := jsonb_build_object('x-funilpro-cron', coalesce(v_segredo, '')),
    timeout_milliseconds := 290000
  );
END;
$$;

-- Troca o job se já existir (migration idempotente).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'publicar-conteudos-instagram';
SELECT cron.schedule('publicar-conteudos-instagram', '*/5 * * * *', $$SELECT disparar_publicacao_instagram()$$);

-- Dispara já: o reel de hoje está vencido.
SELECT disparar_publicacao_instagram();

-- ─── Item preso em 'publicando' volta para a fila ───────────────────────────
-- Se a função da Vercel cair no meio (timeout, deploy), o item ficava em
-- 'publicando' para sempre. Agora a própria reserva devolve à fila quem está
-- publicando há mais de 15 minutos, contando a tentativa.
ALTER TABLE conteudos_instagram ADD COLUMN IF NOT EXISTS publicando_desde timestamptz;

CREATE OR REPLACE FUNCTION reservar_conteudos_para_publicar(p_limite int DEFAULT 5)
RETURNS SETOF conteudos_instagram LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conteudos_instagram
  SET status = CASE WHEN tentativas + 1 >= 3 THEN 'erro' ELSE 'agendado' END,
      tentativas = tentativas + 1,
      erro = 'a publicação anterior não terminou (tempo esgotado) — tentando de novo',
      publicando_desde = NULL
  WHERE status = 'publicando'
    AND publicando_desde IS NOT NULL
    AND publicando_desde < now() - interval '15 minutes';

  RETURN QUERY
  UPDATE conteudos_instagram
  SET status = 'publicando', publicando_desde = now()
  WHERE id IN (
    SELECT id FROM conteudos_instagram
    WHERE status = 'agendado' AND data_agendada <= now()
    ORDER BY data_agendada
    LIMIT p_limite
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

UPDATE conteudos_instagram SET publicando_desde = now()
WHERE status = 'publicando' AND publicando_desde IS NULL;
