# PLANO — Multiatendimento WhatsApp (API Oficial Meta) vendável em BLOCO

> Documento de planejamento. Nada daqui está implementado ainda.
> Referência de mercado a superar: Huggy ("Hub"). Meta: ser mais inteligente
> que qualquer multiatendente do mercado, e vender SOZINHO ou conectado às
> outras ferramentas do FunilPro (quiz, portal, agente IA, kanban).

---

## 1. A tese do produto

O multiatendente comum (Huggy, Zenvia etc.) é uma caixa de entrada com filas.
O nosso nasce DENTRO de um ecossistema que já sabe quem é o lead:

- de qual anúncio veio (UTM + Meta Ads)
- o que respondeu no quiz (respostas página a página)
- o que conversou com o agente IA (transcript + score + gate)
- em que etapa do kanban está e quanto já comprou (Mercos/valor manual)

**O atendente abre a conversa e vê o dossiê completo do lead ao lado.**
Nenhum concorrente genérico tem isso, porque nenhum é dono do funil inteiro.
Essa é a inteligência estrutural; a IA por cima é a segunda camada.

## 2. Arquitetura em BLOCOS (produto modular)

Cada bloco é vendável sozinho e se conecta pelos MESMOS identificadores que
o sistema já usa (lead por telefone/e-mail via `contato-match`, tenant por
RLS). Nenhum bloco importa código de outro — eles conversam por tabelas e
eventos internos.

| Bloco | O que é | Vendável só? |
|---|---|---|
| **B1. Conexão oficial** | WABA + número + templates + webhook Cloud API | interno (base dos demais) |
| **B2. Caixa de entrada multiatendente** | filas, atendentes, atribuição, tags, respostas rápidas | ✅ (o produto "WhatsApp") |
| **B3. Copiloto IA** | resumo, sugestão de resposta, tag automática, detecção de venda | ✅ add-on |
| **B4. Conectores** | quiz ⇄ inbox, portal ⇄ inbox, agente IA ⇄ inbox, kanban ⇄ inbox | grátis quando as duas pontas existem |

Regra de venda: `tenant_addons.addon_type` ganha `whatsapp_inbox` e
`inbox_copilot`. O gate de tela segue o padrão do plano Scale/agentes:
overlay de upgrade quando o addon não está ativo.

## 3. Bloco B1 — Conexão oficial (Cloud API)

- **Embedded Signup** da Meta: o CLIENTE conecta a própria WABA num fluxo
  dentro do painel (OAuth Facebook → escolhe/gera número → token do sistema).
  Sem isso, onboard vira suporte manual — é o que mata os concorrentes.
- Tabelas: `wa_accounts` (tenant, waba_id, phone_number_id, token
  criptografado, quality_rating), `wa_templates` (espelho dos templates
  aprovados, com status de aprovação sincronizado).
- **Webhook único** `/api/webhooks/meta-wa` (assinado com app secret):
  mensagens de entrada, status de entrega/leitura, atualização de template,
  qualidade do número. Roteia por `phone_number_id` → tenant.
- **Janela de 24h**: fora dela só template. O motor marca a janela por
  conversa e a UI mostra o cronômetro — enviar livre fora da janela nem
  aparece como opção (erro da Meta vira UX, não surpresa).
- Custos Meta por conversa: painel mostra o consumo estimado por categoria
  (marketing/utility/service) — transparência que o Huggy não dá.

## 4. Bloco B2 — Caixa de entrada multiatendente (o coração)

Modelo de dados (novo, separado do Evolution — o Evolution continua para
quem não tem API oficial):

```
wa_conversations   (tenant, wa_account, lead_id?, telefone, janela_ate,
                    status: aberta|pendente|resolvida, fila_id, atendente_id,
                    ultima_msg_at, nao_lidas)
wa_messages        (conversa, direcao, tipo, corpo, media_url, template_name,
                    status_entrega, autor: lead|atendente|copiloto|sistema)
wa_filas           (tenant, nome, distribuicao: manual|rodizio|carga)
wa_atendentes      (tenant, nome, whatsapp, filas[], ativo)  ← MESMO desenho
                    do portal_members: sem login individual; identificação
                    por telefone + senha do painel (o padrão que já funciona
                    na equipe do portal)
wa_tags            (tenant, nome, cor) + wa_conversation_tags
wa_respostas_rapidas (tenant, atalho '/preço', texto, mídia)
```

Telas:
- **Inbox** em 3 colunas (lista | conversa | dossiê do lead), responsiva no
  celular com o mesmo padrão de abas do editor de quiz.
- Tempo real: começar com o polling que já provou funcionar no atendimento
  ao vivo (4–5s); evoluir para Supabase Realtime (o projeto já tem) quando o
  volume justificar — decisão adiada de propósito.
- Transferência entre atendentes/filas com nota interna; notas internas na
  conversa (invisíveis ao lead); visto ✓✓ real dos status da Meta.
- **Na própria conversa**: marcar tag, marcar VENDIDO com valor (mesma
  `lerValorDigitado`), e escolher desfecho — que já move o kanban (B4).

## 5. Bloco B3 — Copiloto IA (o "mais inteligente que todos")

Aproveita 100% do motor de agentes existente (Claude + prompt caching):

1. **Dossiê automático** ao abrir a conversa: resumo do histórico + o que o
   lead respondeu no quiz + score do agente + compras. (Determinístico onde
   der, IA só no resumo.)
2. **Sugestão de resposta** (1 clique para enviar, editável) usando os
   documentos/Q&A/correções que o agente do tenant já tem — o copiloto fala
   com a voz treinada da empresa, não genérico.
3. **Tags e desfecho automáticos**: intenção de compra detectada → sugere
   marcar "Vendido"; a MARCAÇÃO é humana (1 clique), a detecção é da IA —
   auditável, sem kanban fantasma.
4. **Resumo de encerramento** gravado na conversa (`outcome_summary` — mesmo
   campo que o portal do agente já lê).
5. **Agente IA de plantão**: fora do horário, o agente IA (produto existente)
   assume a fila e entrega para humano de manhã — o comando `/` e o
   Assumir/Devolver já existem e valem aqui.

## 6. Bloco B4 — Conectores (o diferencial de ecossistema)

- **Portal → Inbox**: o botão WhatsApp do lead quente, quando o tenant tem o
  addon, abre a conversa NO NOSSO inbox com o template escolhido (fora da
  janela de 24h só template mesmo — a Meta obriga; o botão já oferece a
  lista de templates aprovados). Sem o addon, continua abrindo wa.me como
  hoje — nada quebra.
- **Quiz → Inbox**: lead terminou o quiz → conversa criada/etiquetada com a
  origem e as respostas no dossiê.
- **Inbox → Kanban**: "Vendido" na conversa = upsert em
  `portal_lead_status/portal_agent_status` com valor — o MESMO caminho do
  Mercos, já testado.
- **Agente IA ⇄ Inbox**: handoff bidirecional (IA atende → humano assume →
  devolve), reaproveitando `conversaAssumidaPeloDono`.
- Identidade do lead: sempre por `contato-match` (telefone com DDD) — uma
  autoridade só, já testada.

## 7. Ordem de implementação (cada etapa entrega valor sozinha)

1. **Etapa W1 — Conexão + recepção** (B1): embedded signup, webhook, tabela
   de conversas/mensagens, ver mensagens chegando num inbox mínimo.
2. **Etapa W2 — Atender** (B2 núcleo): enviar texto/mídia/template, janela
   de 24h, filas, atribuição, tags, respostas rápidas, mobile.
3. **Etapa W3 — Conectores** (B4): botão do portal, vendido→kanban com
   valor, dossiê com quiz/agente.
4. **Etapa W4 — Copiloto** (B3): resumo, sugestão, detecção de venda.
5. **Etapa W5 — Billing** dos addons + relatórios (tempo de resposta,
   conversas por atendente, conversão por atendente — números que o portal
   já sabe exibir).

## 8. Riscos e verdades desconfortáveis

- **Burocracia Meta**: verificação de negócio da WABA, App Review para
  `whatsapp_business_messaging`, templates passam por aprovação (horas a
  dias). O produto precisa mostrar status "aguardando aprovação" em vez de
  esconder — o rastreamento de aprovação é feature, não detalhe.
- **Custo por conversa** é da Meta e do cliente (cobrado na WABA dele) — o
  FunilPro não intermedia dinheiro da Meta. Isso simplifica MUITO o billing.
- **Número novo x número em uso**: migrar um número do app WhatsApp Business
  para a API apaga o histórico do aparelho. Precisa estar escrito na tela de
  conexão, senão vira churn com raiva.
- **Evolution (não-oficial) convive**: quem não quer API oficial continua
  como está. São produtos diferentes; o inbox nasce só para a oficial.

## 9. O que já existe e será reaproveitado (nada disso se reescreve)

- equipe sem login individual (portal_members) → wa_atendentes
- kanban + valor de venda + custo por venda → destino do "Vendido"
- `contato-match` → identidade do lead
- motor Claude + docs/Q&A/correções por tenant → copiloto
- comando `/` + Assumir/Devolver → handoff IA⇄humano
- polling do atendimento ao vivo → tempo real da v1
- padrão de abas mobile (editor de quiz) → inbox no celular
