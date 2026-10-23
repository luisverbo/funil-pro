-- ============================================================================
-- ESTÚDIO IA — rastreio de vendas por anúncio (Click-to-WhatsApp) + envio dos
-- eventos para a Meta (Conversions API for Business Messaging).
-- Só colunas/tabelas NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- ─── Origem do contato: último clique + o primeiro guardado ────────────────
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ad_id               text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ctwa_clid           text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ad_headline         text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ad_body             text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ad_media_url        text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS origem_em           timestamptz;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ad_id_primeiro      text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS ctwa_clid_primeiro  text;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS origem_primeiro_em  timestamptz;
CREATE INDEX IF NOT EXISTS estudio_contatos_ad_idx ON estudio_contatos (tenant_id, ad_id);

-- Quem já veio de anúncio antes desta migration: puxa do referral guardado.
UPDATE estudio_contatos
   SET ad_id = coalesce(ad_id, referral->>'source_id'),
       ctwa_clid = coalesce(ctwa_clid, referral->>'ctwa_clid'),
       ad_headline = coalesce(ad_headline, referral->>'headline'),
       ad_body = coalesce(ad_body, referral->>'body'),
       ad_media_url = coalesce(ad_media_url, referral->>'image_url', referral->>'video_url'),
       origem_em = coalesce(origem_em, primeira_msg_em),
       ad_id_primeiro = coalesce(ad_id_primeiro, referral->>'source_id'),
       ctwa_clid_primeiro = coalesce(ctwa_clid_primeiro, referral->>'ctwa_clid'),
       origem_primeiro_em = coalesce(origem_primeiro_em, primeira_msg_em)
 WHERE referral IS NOT NULL AND referral ? 'source_id';

-- ─── Pedido: clique do anúncio + estado dos eventos enviados à Meta ─────────
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS ctwa_clid                text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS meta_lead_enviado_em     timestamptz;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS meta_purchase_enviado_em timestamptz;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS meta_erro                text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS meta_tentativas          int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS estudio_pedidos_ad_idx ON estudio_pedidos (tenant_id, ad_id);

-- ─── Nome do anúncio / conjunto / campanha (cache da Graph API) ────────────
CREATE TABLE IF NOT EXISTS estudio_anuncios (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_id       text NOT NULL,
  nome        text,
  conjunto    text,
  campanha    text,
  headline    text,
  erro        text,                 -- ex.: token sem permissão de anúncios
  buscado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ad_id)
);
ALTER TABLE estudio_anuncios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_anuncios;
CREATE POLICY tenant_isolation ON estudio_anuncios USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_anuncios FROM anon;

-- ─── Dataset do WhatsApp (CAPI para mensagens) ──────────────────────────────
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS meta_dataset_id       text;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS meta_test_event_code  text;   -- "Testar eventos" do Gerenciador
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS meta_capi_erro        text;   -- último erro (aparece no painel)
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS meta_capi_erro_em     timestamptz;
REVOKE ALL ON estudio_config FROM anon, authenticated;

-- ─── O robô da produção também reenvia evento da Meta que falhou (até 3×) ───
CREATE OR REPLACE FUNCTION disparar_producao_estudio()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_segredo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM estudio_pedidos p
    WHERE (p.status = 'pronto' AND p.entrega_iniciada_em IS NULL)
       OR (p.status IN ('aguardando_producao', 'ajuste') AND p.motor = 'api_gemini'
           AND (p.api_iniciada_em IS NULL OR p.api_iniciada_em < now() - interval '6 minutes'))
       OR (p.status IN ('aguardando_producao', 'gerando') AND p.atraso_avisado_em IS NULL
           AND coalesce(p.fila_em, p.pago_em) < now() - interval '60 minutes')
       OR (p.ctwa_clid IS NOT NULL AND p.meta_erro IS NOT NULL AND p.meta_tentativas < 3)
  ) THEN RETURN; END IF;
  SELECT value INTO v_segredo FROM platform_settings WHERE key = 'conteudos_cron_secret';
  PERFORM net.http_get(
    url := 'https://funil-pro.vercel.app/api/cron/estudio-producao',
    headers := jsonb_build_object('x-funilpro-cron', coalesce(v_segredo, '')),
    timeout_milliseconds := 300000
  );
END;
$$;
