-- ============================================================================
-- ESTÚDIO IA — tema "Ensaio de Casal" (slug casal, sujeito casal)
-- ----------------------------------------------------------------------------
-- O tema e as 30 poses JÁ estão no banco (gravados pelo Claude do PC, ativo =
-- false). Aqui só o que o APP precisa: dados da 2ª pessoa no pedido e a base
-- de conhecimento atualizada. Nada da seção 4 muda de nome; tudo opcional —
-- os pedidos dos outros temas continuam iguais.
--
-- Convenção: foto_rosto_path / foto_corpo_path = pessoa 1 (quem conversa);
--            foto_rosto2_path / foto_corpo2_path = pessoa 2.
-- Arquivos: estudio-clientes/<pedido>/rosto.jpg, corpo.jpg, rosto2.jpg, corpo2.jpg
-- ============================================================================
ALTER TABLE estudio_pedidos
  ADD COLUMN IF NOT EXISTS pessoa2_nome     text,
  ADD COLUMN IF NOT EXISTS pessoa2_idade    int CHECK (pessoa2_idade IS NULL OR (pessoa2_idade BETWEEN 0 AND 120)),
  ADD COLUMN IF NOT EXISTS pessoa2_cabelo   text,
  ADD COLUMN IF NOT EXISTS foto_rosto2_path text,
  ADD COLUMN IF NOT EXISTS foto_corpo2_path text,
  -- de qual foto recebida saiu cada arquivo da pessoa 2 (troca manual no painel)
  ADD COLUMN IF NOT EXISTS rosto2_origem    text,
  ADD COLUMN IF NOT EXISTS corpo2_origem    text;

-- ─── Base de conhecimento: FAQs do casal ────────────────────────────────────
-- FAQ "Posso mandar foto com outra pessoa?" → explica o casal.
UPDATE estudio_conhecimento
   SET resposta = 'Nos temas individuais, não: precisa ser foto só sua. Para o ENSAIO DE CASAL, mande fotos dos dois (rosto e corpo inteiro de cada um, cada foto com uma pessoa só). Nunca foto de criança, famoso ou terceiro sem autorização.'
 WHERE tipo = 'faq' AND pergunta ILIKE '%outra pessoa%';

-- FAQ do infantil: agora são 5 temas.
UPDATE estudio_conhecimento
   SET resposta = regexp_replace(resposta, '(trabalhamos com|temos)\s+4\s+temas[^.]*\.?', 'trabalhamos com 5 temas: aniversário, corporativo, casual, sensual e casal.', 'i')
 WHERE tipo = 'faq' AND (pergunta ILIKE '%infantil%' OR pergunta ILIKE '%crian%');

-- Regra antiga "só temos 4 temas / casal em breve" sai.
UPDATE estudio_conhecimento SET ativo = false
 WHERE tipo IN ('regra', 'nao_dizer') AND resposta ILIKE '%casal%' AND (resposta ILIKE '%4 temas%' OR resposta ILIKE '%em breve%' OR resposta ILIKE '%por enquanto%');

-- FAQs novas (uma por tenant que tem o estúdio; não duplica).
INSERT INTO estudio_conhecimento (tenant_id, tipo, pergunta, resposta, ordem)
SELECT c.tenant_id, 'faq', v.pergunta, v.resposta, v.ordem
FROM estudio_config c
CROSS JOIN (VALUES
  ('Como funciona o ensaio de casal?', 'Os dois aparecem juntos na mesma foto. Você manda rosto e corpo inteiro de cada um (cada foto com uma pessoa só), escolhe as poses do catálogo de casal e recebe o ensaio feito com IA — mesmo preço e prazo dos outros temas.', 50),
  ('Pode ser casal do mesmo sexo?', 'Sim! Qualquer casal de adultos.', 51),
  ('Só tenho uma foto dos dois juntos', 'Peça uma foto de cada um separadamente (rosto e corpo inteiro). A foto dos dois juntos pode ser enviada como referência extra, mas não substitui as individuais: é isso que mantém o rosto de cada um fiel.', 52),
  ('Dá pra incluir filhos ou pets?', 'Por enquanto o ensaio de casal é só para os dois adultos.', 53),
  ('O ensaio de casal é sensual?', 'É romântico e elegante, com os dois vestidos. Para um ensaio mais ousado existe o tema sensual (individual).', 54)
) AS v(pergunta, resposta, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM estudio_conhecimento k WHERE k.tenant_id = c.tenant_id AND k.tipo = 'faq' AND lower(k.pergunta) = lower(v.pergunta)
);
