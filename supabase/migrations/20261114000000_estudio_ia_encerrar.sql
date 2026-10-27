-- Estúdio IA: ENCERRAR conversa (Ana para de responder até o Luís reabrir).
-- Fechada à mão ou sozinha quando o outro lado é um robô (ana/robo.ts).
-- Sem este SQL o encerrar ainda funciona (vira "Assumir" fixo), só sem o selo.
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS encerrada_em     timestamptz;
ALTER TABLE estudio_contatos ADD COLUMN IF NOT EXISTS encerrada_motivo text;
