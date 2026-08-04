-- ============================================================================
-- Content Studio — Fase 1
-- ----------------------------------------------------------------------------
-- Cria 5 tabelas isoladas (prefixo cs_), a função cs_emit_event, RLS e grants.
--
-- NÃO ALTERA NENHUM OBJETO EXISTENTE. Em especial, não toca em:
--   queue_jobs, leads, funnels, funnel_blocks, ai_agents, ig_*, pages, tenants.
--
-- Tudo roda em UMA transação: se o preflight abortar (ou qualquer statement
-- falhar), NADA é criado. Não há instante em que uma tabela exista sem RLS,
-- pois nada é visível fora da transação até o COMMIT final.
--
-- Aplicação: manual, pelo responsável. Esta migration não foi executada.
--
-- LIMITAÇÃO CONHECIDA (herdada, não introduzida aqui):
--   current_tenant_id() faz `SELECT tenant_id FROM users_tenants
--   WHERE user_id = auth.uid() LIMIT 1`, ou seja, assume que cada usuário está
--   vinculado a UM ÚNICO tenant. Com um usuário em mais de um tenant, o LIMIT 1
--   escolhe uma linha arbitrária e a RLS passa a filtrar por um tenant
--   imprevisível. Toda a RLS deste módulo depende dessa função e herda o
--   comportamento. A função NÃO é alterada por esta migration.
--
-- REQUISITO DE VERSÃO: PostgreSQL 15+ — `ON DELETE SET NULL (coluna)` em
--   cs_events_step_fk usa lista de colunas, sintaxe introduzida no PG 15.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PREFLIGHT ABORTIVO
-- Qualquer objeto cs_* preexistente interrompe a migration informando o nome
-- exato. Não usamos "IF NOT EXISTS" em lugar nenhum: colisão deve FALHAR alto,
-- nunca ser absorvida em silêncio (o objeto existente pode ter outro schema).
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_obj text;
BEGIN
  SELECT 'TABELA public.' || table_name INTO v_obj
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'cs\_%'
   ORDER BY table_name LIMIT 1;
  IF v_obj IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: objeto conflitante -> %', v_obj;
  END IF;

  SELECT 'VIEW public.' || table_name INTO v_obj
    FROM information_schema.views
   WHERE table_schema = 'public' AND table_name LIKE 'cs\_%'
   ORDER BY table_name LIMIT 1;
  IF v_obj IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: objeto conflitante -> %', v_obj;
  END IF;

  SELECT 'INDICE public.' || indexname INTO v_obj
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND (indexname LIKE 'cs\_%' OR indexname LIKE 'uq\_cs\_%' OR indexname LIKE 'idx\_cs\_%')
   ORDER BY indexname LIMIT 1;
  IF v_obj IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: objeto conflitante -> %', v_obj;
  END IF;

  SELECT 'FUNCAO public.' || p.proname INTO v_obj
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'cs\_%'
   ORDER BY p.proname LIMIT 1;
  IF v_obj IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: objeto conflitante -> %', v_obj;
  END IF;

  SELECT 'POLICY ' || policyname || ' EM ' || tablename INTO v_obj
    FROM pg_policies
   WHERE schemaname = 'public' AND (policyname LIKE 'cs\_%' OR tablename LIKE 'cs\_%')
   ORDER BY policyname LIMIT 1;
  IF v_obj IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: objeto conflitante -> %', v_obj;
  END IF;

  SELECT 'TIPO public.' || t.typname INTO v_obj
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typname LIKE 'cs\_%'
   ORDER BY t.typname LIMIT 1;
  IF v_obj IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: objeto conflitante -> %', v_obj;
  END IF;

  -- Dependências obrigatórias do módulo
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'current_tenant_id'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: função current_tenant_id() não existe';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: extensão pgcrypto ausente (gen_random_uuid)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT ABORTADO: tabela tenants não encontrada';
  END IF;

  RAISE NOTICE 'Preflight OK — nenhum objeto cs_* preexistente.';
END
$preflight$;


-- ===========================================================================
-- 1) cs_settings — feature flag / kill switch por tenant
-- ===========================================================================
CREATE TABLE public.cs_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled              boolean     NOT NULL DEFAULT false,
  paused               boolean     NOT NULL DEFAULT false,
  monthly_token_limit  integer,
  monthly_image_limit  integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_settings_token_limit_nonneg
    CHECK (monthly_token_limit IS NULL OR monthly_token_limit >= 0),
  CONSTRAINT cs_settings_image_limit_nonneg
    CHECK (monthly_image_limit IS NULL OR monthly_image_limit >= 0)
);
ALTER TABLE public.cs_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.cs_settings IS
  'Content Studio: flag por tenant. enabled=liga o módulo; paused=kill switch da fila. Escrita exclusiva do backend.';


-- ===========================================================================
-- 2) cs_productions — a peça de conteúdo (entidade raiz)
-- ===========================================================================
CREATE TABLE public.cs_productions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pipeline_key    text NOT NULL DEFAULT 'stub_v1',
  title           text,
  brief           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text  NOT NULL DEFAULT 'draft',
  next_event_seq  bigint NOT NULL DEFAULT 0,
  -- created_by NÃO é preenchido pelo cliente: o DEFAULT deriva da sessão.
  created_by      uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cs_productions_status_chk CHECK (status IN (
    'draft','queued','running','waiting_input','review','awaiting_approval',
    'approved','scheduled','publishing','published','failed','canceled'
  )),
  CONSTRAINT cs_productions_seq_nonneg CHECK (next_event_seq >= 0),

  -- Alvo da FK composta das tabelas filhas (garante tenant_id coerente).
  CONSTRAINT cs_productions_id_tenant_uq UNIQUE (id, tenant_id)
);
ALTER TABLE public.cs_productions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_cs_productions_tenant
  ON public.cs_productions (tenant_id, created_at DESC);
CREATE INDEX idx_cs_productions_open
  ON public.cs_productions (status)
  WHERE status NOT IN ('published','canceled','failed');

COMMENT ON COLUMN public.cs_productions.next_event_seq IS
  'Contador atômico de eventos. Incrementado APENAS por cs_emit_event().';
COMMENT ON COLUMN public.cs_productions.created_by IS
  'Derivado de auth.uid() via DEFAULT; o cliente não tem privilégio de INSERT nesta coluna.';


-- ===========================================================================
-- 3) cs_steps — um passo do pipeline
-- ===========================================================================
CREATE TABLE public.cs_steps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id  uuid NOT NULL,
  tenant_id      uuid NOT NULL,
  agent_key      text NOT NULL,
  step_index     integer NOT NULL,
  depends_on     text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'pending',
  input          jsonb,
  output         jsonb,
  attempt        integer NOT NULL DEFAULT 0,
  error          text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cs_steps_status_chk CHECK (status IN (
    'pending','queued','running','waiting','completed','failed','skipped','stale','retrying'
  )),
  CONSTRAINT cs_steps_index_nonneg  CHECK (step_index >= 0),
  CONSTRAINT cs_steps_attempt_nonneg CHECK (attempt >= 0),

  -- INTEGRIDADE DE TENANT: a FK composta impede que tenant_id divirja da produção.
  CONSTRAINT cs_steps_production_fk FOREIGN KEY (production_id, tenant_id)
    REFERENCES public.cs_productions (id, tenant_id) ON DELETE CASCADE,

  -- Alvo da FK composta de cs_jobs/cs_events (step sempre da mesma produção).
  CONSTRAINT cs_steps_id_production_uq UNIQUE (id, production_id)
);
ALTER TABLE public.cs_steps ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX uq_cs_steps_prod_index
  ON public.cs_steps (production_id, step_index);
CREATE INDEX idx_cs_steps_prod_status
  ON public.cs_steps (production_id, status);


-- ===========================================================================
-- 4) cs_jobs — fila própria do Content Studio
--    Isolada de queue_jobs de propósito: o processador dos funis varre TODOS
--    os pending sem filtro de tipo e marcaria um job de conteúdo como 'done'.
-- ===========================================================================
CREATE TABLE public.cs_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  production_id  uuid NOT NULL,
  step_id        uuid NOT NULL,
  dedupe_key     text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  scheduled_for  timestamptz NOT NULL DEFAULT now(),
  attempt        integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 3,
  lock_token     uuid,
  locked_until   timestamptz,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cs_jobs_status_chk CHECK (status IN ('pending','running','done','failed','canceled')),
  CONSTRAINT cs_jobs_attempt_nonneg   CHECK (attempt >= 0),
  CONSTRAINT cs_jobs_max_attempts_pos CHECK (max_attempts > 0),

  CONSTRAINT cs_jobs_production_fk FOREIGN KEY (production_id, tenant_id)
    REFERENCES public.cs_productions (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT cs_jobs_step_fk FOREIGN KEY (step_id, production_id)
    REFERENCES public.cs_steps (id, production_id) ON DELETE CASCADE
);
ALTER TABLE public.cs_jobs ENABLE ROW LEVEL SECURITY;

-- Idempotência: um job por (produção, step, tentativa).
CREATE UNIQUE INDEX uq_cs_jobs_dedupe ON public.cs_jobs (dedupe_key);
-- No máximo um job ATIVO por step.
CREATE UNIQUE INDEX uq_cs_jobs_active ON public.cs_jobs (step_id)
  WHERE status IN ('pending','running');
-- Claim da fila.
CREATE INDEX idx_cs_jobs_claim ON public.cs_jobs (scheduled_for) WHERE status = 'pending';
-- Recuperação de locks vencidos (crash).
CREATE INDEX idx_cs_jobs_stale ON public.cs_jobs (locked_until) WHERE status = 'running';


-- ===========================================================================
-- 5) cs_events — camada de eventos (append-only)
-- ===========================================================================
CREATE TABLE public.cs_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  production_id  uuid NOT NULL,
  step_id        uuid,
  agent_key      text,
  type           text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  seq            bigint  NOT NULL,
  payload        jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ui_hint        jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cs_events_seq_positive CHECK (seq > 0),
  CONSTRAINT cs_events_schema_version_positive CHECK (schema_version > 0),

  CONSTRAINT cs_events_production_fk FOREIGN KEY (production_id, tenant_id)
    REFERENCES public.cs_productions (id, tenant_id) ON DELETE CASCADE,
  -- MATCH SIMPLE: com step_id NULL a FK não é verificada (evento de produção).
  --
  -- SET NULL com LISTA DE COLUNAS (Postgres 15+): apagar um step anula APENAS
  -- step_id. Sem a lista, o Postgres tentaria anular também production_id, que
  -- é NOT NULL — o DELETE do step falharia e, pior, o evento perderia o vínculo
  -- com a produção. Aqui o evento sobrevive, órfão de step mas ainda na
  -- produção e no tenant certos: a auditoria não tem buraco.
  CONSTRAINT cs_events_step_fk FOREIGN KEY (step_id, production_id)
    REFERENCES public.cs_steps (id, production_id) ON DELETE SET NULL (step_id)
);
ALTER TABLE public.cs_events ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX uq_cs_events_seq  ON public.cs_events (production_id, seq);
CREATE INDEX        idx_cs_events_tail ON public.cs_events (production_id, seq DESC);

COMMENT ON TABLE public.cs_events IS
  'Append-only. Escrita exclusiva via cs_emit_event(). É o contrato entre backend e qualquer interface.';


-- ===========================================================================
-- FUNÇÃO cs_emit_event — emissão atômica de evento
-- ===========================================================================
CREATE FUNCTION public.cs_emit_event(
  p_production_id uuid,
  p_type          text,
  p_step_id       uuid  DEFAULT NULL,
  p_agent_key     text  DEFAULT NULL,
  p_payload       jsonb DEFAULT '{}'::jsonb,
  p_ui_hint       jsonb DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $cs_emit_event$
DECLARE
  v_seq       bigint;
  v_tenant_id uuid;
BEGIN
  IF p_type IS NULL OR btrim(p_type) = '' THEN
    RAISE EXCEPTION 'cs_emit_event: type é obrigatório';
  END IF;

  -- O UPDATE ... RETURNING trava a LINHA da produção: duas transações
  -- concorrentes serializam aqui e recebem seq distintos. tenant_id é DERIVADO
  -- do recurso persistido — nunca recebido por parâmetro.
  UPDATE public.cs_productions
     SET next_event_seq = next_event_seq + 1,
         updated_at     = now()
   WHERE id = p_production_id
  RETURNING next_event_seq, tenant_id INTO v_seq, v_tenant_id;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'cs_emit_event: produção % não encontrada', p_production_id;
  END IF;

  -- O step, quando informado, PRECISA pertencer à mesma produção.
  IF p_step_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cs_steps
       WHERE id = p_step_id AND production_id = p_production_id
    ) THEN
      RAISE EXCEPTION
        'cs_emit_event: step % não pertence à produção %', p_step_id, p_production_id;
    END IF;
  END IF;

  INSERT INTO public.cs_events
    (tenant_id, production_id, step_id, agent_key, type, seq, payload, ui_hint)
  VALUES
    (v_tenant_id, p_production_id, p_step_id, p_agent_key, p_type,
     v_seq, COALESCE(p_payload, '{}'::jsonb), p_ui_hint);

  RETURN v_seq;
END;
$cs_emit_event$;

COMMENT ON FUNCTION public.cs_emit_event(uuid,text,uuid,text,jsonb,jsonb) IS
  'Emissão atômica de evento do Content Studio: incrementa next_event_seq e insere na mesma transação. Uso exclusivo do backend (service_role).';


-- ===========================================================================
-- RLS — POLÍTICAS
-- Regra geral: o cliente autenticado LÊ o que é do seu tenant. Toda ESCRITA de
-- orquestração (steps, jobs, events) é exclusiva do backend (service_role, que
-- por natureza ignora RLS). Ausência de política = negado por padrão.
-- ===========================================================================

-- cs_settings: somente leitura. Alterar flags/limites será feito por Server
-- Action segura (service_role) — permitir UPDATE aqui deixaria o próprio
-- tenant elevar monthly_token_limit e burlar a cota.
CREATE POLICY cs_settings_select ON public.cs_settings
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

-- cs_productions: leitura + criação controlada do próprio tenant.
CREATE POLICY cs_productions_select ON public.cs_productions
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

-- INSERT: além do tenant, o WITH CHECK trava o estado inicial. Combinado com o
-- GRANT por coluna (abaixo), o cliente não consegue nascer 'published' nem
-- adulterar next_event_seq/created_by.
CREATE POLICY cs_productions_insert ON public.cs_productions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND status = 'draft'
    AND next_event_seq = 0
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- Sem política de UPDATE/DELETE para authenticated:
--   * UPDATE  -> apenas backend (transição de status é da máquina de estados)
--   * DELETE  -> proibido; o CASCADE apagaria steps/jobs/eventos de auditoria.
--                Cancelamento é lógico (status='canceled') via Server Action.

-- cs_steps / cs_jobs / cs_events: SOMENTE LEITURA para o cliente.
CREATE POLICY cs_steps_select ON public.cs_steps
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY cs_jobs_select ON public.cs_jobs
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY cs_events_select ON public.cs_events
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());


-- ===========================================================================
-- GRANTS / REVOKES
-- O Supabase concede privilégios amplos por default a anon/authenticated em
-- tabelas novas do schema public. Revogamos tudo e concedemos o mínimo.
-- ===========================================================================
REVOKE ALL ON public.cs_settings    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cs_productions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cs_steps       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cs_jobs        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cs_events      FROM PUBLIC, anon, authenticated;

-- Leitura para o app autenticado (a RLS filtra por tenant).
GRANT SELECT ON public.cs_settings    TO authenticated;
GRANT SELECT ON public.cs_productions TO authenticated;
GRANT SELECT ON public.cs_steps       TO authenticated;
GRANT SELECT ON public.cs_jobs        TO authenticated;
GRANT SELECT ON public.cs_events      TO authenticated;

-- INSERT POR COLUNA em cs_productions: o cliente só informa estas quatro.
-- status, next_event_seq, created_by, created_at e updated_at ficam no DEFAULT
-- (created_by = auth.uid()). Privilégio de coluna é o que a RLS não faz sozinha.
GRANT INSERT (tenant_id, pipeline_key, title, brief)
  ON public.cs_productions TO authenticated;

-- Backend: acesso total (service_role já ignora RLS, o GRANT é explícito).
GRANT ALL ON public.cs_settings    TO service_role;
GRANT ALL ON public.cs_productions TO service_role;
GRANT ALL ON public.cs_steps       TO service_role;
GRANT ALL ON public.cs_jobs        TO service_role;
GRANT ALL ON public.cs_events      TO service_role;

-- Função: ninguém executa, exceto o backend.
REVOKE ALL ON FUNCTION public.cs_emit_event(uuid,text,uuid,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cs_emit_event(uuid,text,uuid,text,jsonb,jsonb)
  TO service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK NÃO DESTRUTIVO (referência — não executar automaticamente)
--   Nível 0: env CONTENT_STUDIO_ENABLED=false
--   Nível 1: UPDATE public.cs_settings SET enabled=false, paused=true;
--   Nível 2: git revert do código (as tabelas permanecem íntegras)
--   Nível 3 (só com autorização): ALTER TABLE public.cs_x RENAME TO zz_archived_cs_x
--   DROP TABLE não faz parte de nenhum nível.
-- ============================================================================
