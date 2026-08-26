-- ============================================================================
-- Casar venda externa com o lead — FILTRO no banco, decisão no código
-- ----------------------------------------------------------------------------
-- O webhook do Mercos (e qualquer venda externa) encontra o lead por e-mail
-- ou telefone. Duas coisas que isto resolve:
--
--   1. O telefone era comparado com LIKE sobre o texto CRU, e parte da base
--      está gravada formatada ("21 99629-9978"): esses leads nunca casariam
--      e a venda sumiria sem explicação. Aqui os dois lados viram dígitos.
--
--   2. Papéis separados: o banco faz o filtro GROSSO (mesmos 8 dígitos
--      finais, tolerante a formatação e ao DDI) e devolve o contato; quem dá
--      a palavra final é `src/lib/webhooks/contato-match.ts`, que exige o
--      DDD igual quando os dois lados têm DDD — (11) 99999-1234 e
--      (21) 99999-1234 terminam igual, e marcar a venda no lead errado é
--      pior do que não marcar. A regra decisiva fica testável sem banco.
-- ============================================================================

-- Só os dígitos, sem o DDI 55: "+55 (21) 99629-9978" → "21996299978"
CREATE OR REPLACE FUNCTION fone_digitos(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
  IF length(d) IN (12, 13) AND left(d, 2) = '55' THEN
    d := substr(d, 3);
  END IF;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION casar_quiz_leads_por_contato(
  p_tenant uuid,
  p_email  text,
  p_fone   text
)
RETURNS TABLE (id uuid, quiz_id uuid, email text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.quiz_id, l.email, l.phone
  FROM quiz_leads l
  WHERE l.tenant_id = p_tenant
    AND (
      (p_email IS NOT NULL AND p_email <> '' AND lower(l.email) = lower(p_email))
      OR (
        length(fone_digitos(p_fone)) >= 8
        AND fone_digitos(l.phone) LIKE '%' || right(fone_digitos(p_fone), 8)
      )
    )
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION casar_leads_por_contato(
  p_tenant uuid,
  p_email  text,
  p_fone   text
)
RETURNS TABLE (id uuid, email text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.email, l.phone
  FROM leads l
  WHERE l.tenant_id = p_tenant
    AND (
      (p_email IS NOT NULL AND p_email <> '' AND lower(l.email) = lower(p_email))
      OR (
        length(fone_digitos(p_fone)) >= 8
        AND fone_digitos(l.phone) LIKE '%' || right(fone_digitos(p_fone), 8)
      )
    )
  LIMIT 50;
$$;
