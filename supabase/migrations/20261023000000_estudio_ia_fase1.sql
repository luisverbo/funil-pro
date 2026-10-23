-- ============================================================================
-- ESTÚDIO IA — Fase 1: tabelas, buckets e catálogo
-- ----------------------------------------------------------------------------
-- Nomes EXATOS da seção 4 do projeto (23/10/2026): o script do PC do Luís
-- (projetos/estudio-ia/producao.py) lê e escreve nestas tabelas e buckets.
-- Mudou nome aqui → avisar o Luís para ajustar o producao.py.
--
-- Convenções:
--   • tenant_id em tudo (padrão do FunilPro) + RLS por current_tenant_id().
--     O script do PC usa a service role (passa por cima do RLS).
--   • slug do tema é único NO BANCO (o projeto pediu "slug unique"), e as poses
--     são únicas por (tema_slug, numero) — numero é texto com zero: '01'.
--   • foto_exemplo_path / foto_*_path guardam o caminho DENTRO do bucket
--     (ex.: 'aniversario/01.jpg'); a tela também aceita URL completa.
-- ============================================================================

-- ─── estudio_temas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_temas (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug      text NOT NULL UNIQUE,
  nome      text NOT NULL,
  sujeito   text NOT NULL DEFAULT 'mulher' CHECK (sujeito IN ('mulher', 'casal', 'criança', 'pet')),
  capa_url  text,
  ativo     boolean NOT NULL DEFAULT true,
  ordem     int NOT NULL DEFAULT 0
);

-- ─── estudio_poses ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_poses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tema_slug         text NOT NULL REFERENCES estudio_temas(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  numero            text NOT NULL CHECK (numero ~ '^[0-9]{2,3}$'),
  cena              text NOT NULL DEFAULT '',
  prompt_catalogo   text NOT NULL DEFAULT '',
  prompt_cliente    text NOT NULL DEFAULT '',
  foto_exemplo_path text,
  ativa             boolean NOT NULL DEFAULT true,
  UNIQUE (tema_slug, numero)
);
CREATE INDEX IF NOT EXISTS idx_estudio_poses_tema ON estudio_poses (tema_slug, numero);

-- ─── estudio_pedidos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_pedidos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contato_id          uuid,
  cliente_nome        text,
  wa_id               text,
  idade               int CHECK (idade IS NULL OR (idade BETWEEN 0 AND 120)),
  cabelo              text,
  tema_slug           text REFERENCES estudio_temas(slug) ON UPDATE CASCADE,
  poses               text[] NOT NULL DEFAULT '{}',
  pacote_qtd          int,
  valor_cents         int,
  preferencias        text,
  foto_rosto_path     text,
  foto_corpo_path     text,
  fotos_extras_paths  text[] NOT NULL DEFAULT '{}',
  asaas_payment_id    text,
  status              text NOT NULL DEFAULT 'novo' CHECK (status IN (
                        'novo', 'aguardando_pagamento', 'pago', 'aguardando_fotos',
                        'aguardando_producao', 'gerando', 'pronto', 'aguardando_aprovacao',
                        'entregue', 'ajuste', 'finalizado', 'cancelado')),
  motor               text NOT NULL DEFAULT 'chatgpt_site',
  previa_enviada      boolean NOT NULL DEFAULT false,
  ajustes_usados      int NOT NULL DEFAULT 0,
  observacoes_ajuste  text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  pago_em             timestamptz,
  entregue_em         timestamptz,
  aprovado_por        text
);
CREATE INDEX IF NOT EXISTS idx_estudio_pedidos_fila   ON estudio_pedidos (status, pago_em);
CREATE INDEX IF NOT EXISTS idx_estudio_pedidos_tenant ON estudio_pedidos (tenant_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_estudio_pedidos_wa     ON estudio_pedidos (wa_id);

-- ─── estudio_entregas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_entregas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid NOT NULL REFERENCES estudio_pedidos(id) ON DELETE CASCADE,
  pose_numero text NOT NULL,
  foto_path   text NOT NULL,
  status      text NOT NULL DEFAULT 'aguardando_aprovacao'
              CHECK (status IN ('aguardando_aprovacao', 'aprovada', 'refazer', 'enviada')),
  nota_rosto  numeric,
  observacao  text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estudio_entregas_pedido ON estudio_entregas (pedido_id, status);

-- ─── estudio_eventos (log de tudo) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estudio_eventos (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid REFERENCES estudio_pedidos(id) ON DELETE CASCADE,
  tipo      text NOT NULL,
  detalhe   jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estudio_eventos_pedido ON estudio_eventos (pedido_id, criado_em);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE estudio_temas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_poses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_pedidos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudio_eventos  ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON estudio_temas   USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON estudio_poses   USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON estudio_pedidos USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
-- entregas/eventos não têm tenant_id (seção 4): herdam do pedido.
CREATE POLICY tenant_isolation ON estudio_entregas
  USING (EXISTS (SELECT 1 FROM estudio_pedidos p WHERE p.id = pedido_id AND p.tenant_id = current_tenant_id()));
CREATE POLICY tenant_isolation ON estudio_eventos
  USING (EXISTS (SELECT 1 FROM estudio_pedidos p WHERE p.id = pedido_id AND p.tenant_id = current_tenant_id()));

-- Nada do estúdio é legível pela chave pública: a página pública do catálogo
-- lê no servidor (service role) só temas/poses ATIVOS.
REVOKE ALL ON estudio_temas, estudio_poses, estudio_pedidos, estudio_entregas, estudio_eventos FROM anon;

-- ─── Buckets ────────────────────────────────────────────────────────────────
-- estudio-clientes: PRIVADO (fotos da cliente: <pedido_id>/rosto.jpg e corpo.jpg)
-- estudio-entregas: PRIVADO (fotos prontas: <pedido_id>/<numero>.png)
-- estudio-catalogo: PÚBLICO (exemplos das poses: <slug>/<numero>.jpg)
INSERT INTO storage.buckets (id, name, public) VALUES
  ('estudio-clientes', 'estudio-clientes', false),
  ('estudio-entregas', 'estudio-entregas', false),
  ('estudio-catalogo', 'estudio-catalogo', true)
ON CONFLICT (id) DO NOTHING;
