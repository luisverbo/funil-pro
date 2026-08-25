-- Lead sem funil: agente standalone, quiz e Instagram criam leads que não
-- nasceram dentro de um funil. O código sempre mandou funnel_id: null, mas a
-- coluna era NOT NULL — o insert falhava calado, a conversa ficava sem lead
-- ligado e o painel mostrava "Anônimo" mesmo com o nome digitado.
alter table leads alter column funnel_id drop not null;
