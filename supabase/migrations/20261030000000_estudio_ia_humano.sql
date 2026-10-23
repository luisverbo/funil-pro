-- ============================================================================
-- ESTÚDIO IA — Ana humanizada: voz nativa, "digitando…", trava por conversa
-- (fim da corrida das 2 fotos), fotos recebidas classificadas, preferências
-- uma por vez, avisos registrados e tempos por mensagem.
-- Só tabelas/colunas NOVAS — nada da seção 4 muda de nome.
-- ============================================================================

-- ─── Atraso humano (Atendente) ──────────────────────────────────────────────
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS humanizar     boolean NOT NULL DEFAULT true;
ALTER TABLE estudio_config ADD COLUMN IF NOT EXISTS atraso_max_s  int NOT NULL DEFAULT 6;
REVOKE ALL ON estudio_config FROM anon, authenticated;

-- ─── Trava por conversa + fotos recebidas ───────────────────────────────────
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS processando_ate timestamptz;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS fotos_recebidas jsonb NOT NULL DEFAULT '[]';

-- Pega a conversa para UMA execução por vez (as 2 fotos chegam em 2 webhooks).
CREATE OR REPLACE FUNCTION estudio_travar_conversa(p_contato uuid, p_segundos int DEFAULT 90)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE estudio_contatos SET processando_ate = now() + make_interval(secs => p_segundos)
   WHERE id = p_contato AND (processando_ate IS NULL OR processando_ate < now())
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END;
$$;
REVOKE ALL ON FUNCTION estudio_travar_conversa(uuid, int) FROM anon, authenticated;

-- Acrescenta UMA foto à lista, sem sobrescrever a anterior (atômico).
CREATE OR REPLACE FUNCTION estudio_add_foto(p_contato uuid, p_foto jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE estudio_contatos
     SET fotos_recebidas = CASE WHEN fotos_recebidas @> jsonb_build_array(jsonb_build_object('path', p_foto->>'path'))
                                THEN fotos_recebidas ELSE fotos_recebidas || jsonb_build_array(p_foto) END
   WHERE id = p_contato
  RETURNING fotos_recebidas;
$$;
REVOKE ALL ON FUNCTION estudio_add_foto(uuid, jsonb) FROM anon, authenticated;

-- ─── Mensagens: processada (fila da conversa) e tempos ──────────────────────
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS processada_em timestamptz;
ALTER TABLE estudio_mensagens ADD COLUMN IF NOT EXISTS tempos jsonb;
-- O que já existia não volta a ser processado.
UPDATE estudio_mensagens SET processada_em = criado_em WHERE processada_em IS NULL;
CREATE INDEX IF NOT EXISTS estudio_mensagens_pendentes_idx ON estudio_mensagens (contato_id, criado_em) WHERE processada_em IS NULL AND direcao = 'entrada';

-- ─── Pedido: fotos e preferências separadas ─────────────────────────────────
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS fotos_recebidas  jsonb NOT NULL DEFAULT '[]';
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS rosto_origem     text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS corpo_origem     text;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS rosto_recortado  boolean NOT NULL DEFAULT false;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS maquiagem        boolean;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS decote           boolean;
ALTER TABLE estudio_pedidos ADD COLUMN IF NOT EXISTS cores_acessorios text;

-- ─── Cache do media_id da Meta (áudio como mensagem de voz; vale 30 dias) ───
CREATE TABLE IF NOT EXISTS estudio_midia_cache (
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id  text NOT NULL,
  path             text NOT NULL,            -- caminho no Storage (ou url)
  media_id         text NOT NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_number_id, path)
);
ALTER TABLE estudio_midia_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON estudio_midia_cache FROM anon, authenticated;

-- ─── Avisos ao Luís (cada tentativa registrada, com o motivo do erro) ───────
CREATE TABLE IF NOT EXISTS estudio_avisos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pedido_id  uuid REFERENCES estudio_pedidos(id) ON DELETE SET NULL,
  canal      text NOT NULL,                  -- whatsapp | modelo | push
  destino    text,
  texto      text,
  status     text NOT NULL,                  -- enviado | erro | pulado
  erro       text,
  wamid      text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estudio_avisos_tenant_idx ON estudio_avisos (tenant_id, criado_em DESC);
ALTER TABLE estudio_avisos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON estudio_avisos;
CREATE POLICY tenant_isolation ON estudio_avisos USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON estudio_avisos FROM anon;

-- ─── Textos reescritos nesta rodada voltam para o padrão novo do código ─────
-- (só o TEXTO; os áudios gravados continuam). Personalize de novo no Atendente.
UPDATE estudio_textos SET texto = NULL
 WHERE chave IN ('tabela_precos', 'pede_fotos_poses', 'poses_faltam', 'poses_demais', 'foto_rosto_ok',
                 'foto_corpo_ok', 'falta_foto', 'video_nao', 'pede_idade_prefs', 'idade_falta', 'pacote_de_novo');
