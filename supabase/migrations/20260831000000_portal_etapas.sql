-- ============================================================================
-- PORTAL: etapas do kanban configuráveis pelo gestor
-- ----------------------------------------------------------------------------
-- Cada negócio tem um caminho: um agenda visita, outro manda orçamento, outro
-- faz entrevista. Em vez de impor "Agendado", o gestor liga/desliga etapas e
-- renomeia as que usa.
--
-- Guardado como jsonb no portal (uma linha por cliente), não como tabela nova:
-- é configuração de tela, sempre lida junto com o portal.
--   [{ "chave": "agendado", "rotulo": "Orçamento enviado", "ativo": true }]
-- Chaves ficam FIXAS (novo/contactado/agendado/fechado/perdido) — o que muda
-- é o rótulo e se aparece. Assim o histórico já marcado nunca perde sentido.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.client_portals') IS NOT NULL THEN
    ALTER TABLE client_portals
      ADD COLUMN IF NOT EXISTS etapas jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;
