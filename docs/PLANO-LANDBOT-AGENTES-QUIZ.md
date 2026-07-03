# Plano de Arquitetura — Landing Conversacional, Agentes IA v2 e Bug Audit do Quiz

> Documento de planejamento (2026-07-03). Nada aqui foi executado ainda.
> Legenda usada em todo o documento: **[NOVO]** componente/código novo · **[REFACTOR]** código existente que muda · **[BUGFIX]** correção.

---

## PARTE 1 — Landing Page Conversacional (estilo Landbot)

### 1.1 O que existe hoje (base para reuso)

| Peça | Onde | Estado |
|------|------|--------|
| Motor de conversa | `src/lib/agents/chat.ts` → `processAgentMessage()` | Pronto. Modelo `claude-sonnet-5` (env `AGENT_MODEL`), system prompt dinâmico (produto, preços, docs, objetivo, tom), ações via tag `\|\|\|ACTION:{...}\|\|\|`, multi-balão via `[QUEBRA]` |
| Endpoint de chat | `POST /api/agents/[agentId]/chat` | Funciona, mas **exige sessão logada** (middleware `proxy.ts`) e **não valida tenant** — inadequado para página pública como está |
| UI de chat | `src/components/agents/agent-test-chat.tsx` | Chat funcional com typing animation proporcional — vira a base visual |
| Tema visual | `src/lib/quiz/theme.ts` (`resolveTheme`, 5 presets) | Reusar para o tema da landing |
| Página pública | `/pg/[slug]` (quiz) | Padrão de rota pública + `PUBLIC_PREFIXES` já resolvido no `proxy.ts` |

### 1.2 Arquitetura proposta

```
Visitante                     Next.js (Vercel)                      Supabase
   │                                │                                   │
   │  GET /a/[slug]                 │                                   │
   ├───────────────────────────────►│ SSR: carrega agente por slug ────►│ ai_agents (public_slug)
   │  ◄── página com tema + saudação│                                   │
   │                                │                                   │
   │  POST /api/agents/public/      │                                   │
   │       [slug]/chat              │ resolve agente pelo slug          │
   ├───────────────────────────────►│ (tenant derivado no server) ─────►│ agent_conversations
   │                                │ processAgentMessage(testMode-like)│ agent_messages
   │  ◄── { parts, action, convId } │ rate-limit por IP+conversa        │
   │                                │                                   │
   │  action=sell ──► botão de pagamento (payment_link)                 │
   │  action=route ─► matricula lead no funil (target_funnel_id)        │
   │  captura ──────► cria lead + lead_source (UTMs da URL)             │
```

**Decisões-chave:**
- **Rota pública própria** `/a/[slug]` (agent), separada de `/pg/` (quiz). Slug guardado em `ai_agents`.
- **Endpoint público novo** `POST /api/agents/public/[slug]/chat` — NÃO reusar o endpoint autenticado: o público resolve o agente pelo slug (nunca aceita `agentId` nem `tenantId` do cliente — lição do bug #1 do quiz), entra em `PUBLIC_PREFIXES`, tem rate limit e não expõe `testMode`.
- **Contexto da conversa**: `conversationId` retornado no primeiro POST e persistido em `localStorage` — mesma mecânica do teste atual, o histórico já é carregado do banco pelo motor.
- **Sem WhatsApp no meio**: `processAgentMessage` ganha um modo `channel: 'web'` que pula `sendPartsViaWhatsApp` (hoje só existe `testMode`, que também pula limites — o modo web deve RESPEITAR limites de ativação).

### 1.3 Banco de dados **[NOVO]** (1 migration)

```sql
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS
  public_slug text UNIQUE,            -- /a/[slug]
  public_enabled boolean DEFAULT false,
  landing_config jsonb DEFAULT '{}';  -- { theme, headline, avatar_url, quick_replies[],
                                      --   capture_mode: 'inline'|'gate'|'none', pixel_id }
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS
  channel text DEFAULT 'whatsapp';    -- whatsapp | web | test
```

### 1.4 Componentes

| Componente | Tipo | Descrição |
|------------|------|-----------|
| `src/app/a/[slug]/page.tsx` | **[NOVO]** | Server component: carrega agente + landing_config + tema, SSR do shell, injeta pixel |
| `src/components/agent-landing/chat-landing.tsx` | **[NOVO]** | Client: tela cheia de chat, header com avatar/nome, dispara saudação automática no load |
| `src/components/agent-landing/message-bubble.tsx` | **[NOVO]** | Balão (visitante/agente), suporte a links clicáveis e botão de CTA |
| `src/components/agent-landing/typing-indicator.tsx` | **[NOVO]** | Extraído do `agent-test-chat.tsx` (3 pontinhos + delay proporcional) |
| `src/components/agent-landing/quick-replies.tsx` | **[NOVO]** | Chips de resposta rápida configuráveis (estilo Landbot) — reduz digitação no mobile |
| `src/components/agent-landing/lead-capture.tsx` | **[NOVO]** | Captura inline (nome/telefone/email) como mensagens do chat, com validação |
| `src/app/api/agents/public/[slug]/chat/route.ts` | **[NOVO]** | Endpoint público com rate limit (ex: 20 msg/min por conversa) |
| `src/lib/agents/chat.ts` | **[REFACTOR]** | `options.channel: 'whatsapp'\|'web'\|'test'` substituindo o booleano `testMode`; web pula WA mas conta ativação |
| `src/proxy.ts` | **[REFACTOR]** | Adicionar `/a/` e `/api/agents/public/` a `PUBLIC_PREFIXES` |
| `agents-client.tsx` + wizard | **[REFACTOR]** | Step novo "Landing" no wizard: ativar página, slug, tema, saudação, quick replies, modo de captura + botão copiar link |
| `agent-test-chat.tsx` | **[REFACTOR]** | Passa a compor os mesmos `MessageBubble`/`TypingIndicator` (uma UI só) |

### 1.5 Fluxo de conversação passo a passo

1. Visitante abre `/a/meu-agente?utm_source=meta&utm_ad_id=123` → SSR renderiza tema + avatar + headline.
2. Auto-mensagem: `greeting_message` do agente aparece com typing animation (sem chamada à IA — é fixa) + quick replies configuradas.
3. Visitante responde (texto ou chip) → `POST /api/agents/public/[slug]/chat`.
4. Motor responde em partes; front exibe balão a balão com delay proporcional (já implementado no teste).
5. **Captura** (configurável): `gate` = pede nome/whatsapp antes da 1ª resposta da IA; `inline` = a IA conversa e o front injeta o formulário quando `action.data.capture=true` ou após N mensagens; `none` = nunca.
6. No submit da captura → cria `lead` + `lead_source` com os UTMs da URL (reusar exatamente o padrão do quiz submit — corrigido, ver bug #1).
7. Ações terminais: `sell` → balão especial com botão do `payment_link` + pixel `InitiateCheckout`; `route` → matricular lead no `target_funnel_id` (implementar de verdade — hoje é campo morto, ver Parte 2); `handoff` → mostrar botão "Falar no WhatsApp" com deep-link `wa.me` da instância.
8. Conversa persiste com `channel='web'` — aparece na tela de Conversas existente com filtro por canal **[REFACTOR]** `conversations-client.tsx`.

### 1.6 Mobile

- Layout mobile-first: chat 100dvh, input fixo no rodapé com `env(safe-area-inset-bottom)`, teclado não cobre o input (scroll no container de mensagens, não na página).
- Quick replies em carrossel horizontal com scroll-snap.
- Desktop: card central máx. 480px com fundo do tema (mesma proporção do Landbot).

---

## PARTE 2 — Fluxo do Agente IA v2 (criação → treino → teste → deploy → feedback)

### 2.1 Como é hoje e os gaps

Fluxo atual: wizard 5 passos (Identidade → Produto+docs → Personalidade → Objetivo → Revisão+teste) → ativar. Gaps confirmados na auditoria:

| # | Gap | Impacto |
|---|-----|---------|
| G1 | **Sem RAG/chunking**: todos os docs (até 100k chars cada) concatenados no prompt a cada mensagem | Custo alto, estouro de contexto, latência |
| G2 | **Sem prompt caching** na chamada Anthropic | Paga o prompt inteiro em toda mensagem |
| G3 | PDF que falha no parse vira doc vazio **silenciosamente** | Usuário acha que treinou e não treinou |
| G4 | Endpoint de chat **não valida tenant** nem plano Scale | Segurança/billing |
| G5 | `target_funnel_id` coletado mas **nunca usado** no runtime (`route` não matricula em funil) | Objetivo "rotear" não funciona para lead standalone |
| G6 | Ação via regex de texto (`\|\|\|ACTION\|\|\|`) | Frágil; JSON malformado é ignorado |
| G7 | Sem templates, sem clonagem, sem versionamento de prompt | Setup lento, sem histórico |
| G8 | Sem feedback loop (avaliação de conversas, correções) | Agente nunca melhora |
| G9 | Business hours em hora do servidor (UTC), não do tenant | Horário comercial errado |
| G10 | `max_messages`, `business_hours`, `max_activations` sem UI | Só via banco |

### 2.2 Fluxo melhorado proposto

```
┌───────────┐   ┌───────────┐   ┌──────────┐   ┌─────────┐   ┌────────┐   ┌──────────────┐
│ TEMPLATE  │──►│  WIZARD   │──►│  TREINO  │──►│  TESTE  │──►│ DEPLOY │──►│ FEEDBACK LOOP│
│ (galeria) │   │(pré-preen-│   │docs+FAQ  │   │checklist│   │WA/Web  │   │ revisão +    │
│           │   │  chido)   │   │+validação│   │guiado   │   │        │   │ correções    │
└───────────┘   └───────────┘   └──────────┘   └─────────┘   └────────┘   └──────┬───────┘
      ▲                                                                          │
      └──────────────────── aprendizados viram ajustes de prompt ◄───────────────┘
```

**Etapa A — Templates [NOVO]**
- Tabela `agent_templates` (ou JSON estático em `src/lib/agents/templates.ts` para começar): 6-8 templates prontos por nicho (infoproduto, mentoria, serviço recorrente, e-commerce, clínica, imobiliária), cada um com objetivo, tom, saudação, regras de qualificação e tratamento de objeções pré-escritos.
- Tela inicial do wizard vira galeria de cards "Começar do zero / Usar template".

**Etapa B — Wizard [REFACTOR]**
- Mantém os 5 passos, pré-preenchidos pelo template.
- Adicionar em "Identidade" um accordion "Avançado": `max_messages_per_conversation`, `business_hours_*` (com timezone do tenant — **[BUGFIX]** G9), `max_activations_per_month` (G10).

**Etapa C — Treino [REFACTOR + NOVO]**
- **[BUGFIX G3]** upload de PDF: se `extracted_text` < 200 chars, avisar "não consegui ler este PDF" e rejeitar.
- **[NOVO]** aba "Perguntas e Respostas": pares Q&A estruturados (`agent_documents.doc_type='faq'`) — formam a seção mais confiável do prompt e são o formato que o dono do negócio realmente sabe preencher.
- **[NOVO quando docs > ~30k tokens] RAG leve**: chunking (~800 tokens) + embeddings (`pgvector` no Supabase, já disponível) + top-5 chunks por mensagem. Abaixo do limiar, mantém concatenação simples (mais barato e simples).
- **[REFACTOR G2]** `callAnthropic`: adicionar `cache_control: {type:'ephemeral'}` no bloco do system prompt — corta ~90% do custo do prompt em conversas.

**Etapa D — Teste guiado [NOVO]**
- Substituir o chat de teste solto por um "test drive" com checklist automático: o sistema sugere 5 mensagens de teste (pedir informação, perguntar preço, objeção de preço, pedir link, pedir humano) e marca ✓/✗ se o agente respondeu com preço certo, enviou o link certo, acionou handoff. Simples de implementar: roda as 5 mensagens em `testMode` e valida com regex/inclusão (preço formatado presente? link presente? action correta?).

**Etapa E — Deploy [REFACTOR]**
- Checklist de ativação: instância WA conectada? saudação definida? preço cadastrado? landing ativada?
- **[BUGFIX G5]** implementar `route`: ao receber action `route`, matricular o lead no `target_funnel_id` (criar `leads.funnel_id`/enfileirar primeiro bloco — mesmo código do quiz submit).
- **[BUGFIX G4]** endpoint autenticado valida `tenant_id` do agente contra o tenant da sessão + plano Scale.

**Etapa F — Feedback loop contínuo [NOVO]**
1. **Revisão de conversas**: na tela de Conversas, botão "marcar resposta ruim" por mensagem (`agent_messages.feedback: 'good'|'bad'` + nota).
2. **Correções viram treino**: ao marcar ruim, modal "o que ele deveria ter dito?" → grava par Q&A em `agent_documents (doc_type='correction')` → entra no prompt na seção "Correções aprendidas (siga sempre)".
3. **Métricas por agente**: taxa de conversão por objetivo (já existe `computeRate`), + novas: % conversas com feedback ruim, tempo médio até ação terminal, custo estimado (tokens).
4. **Versionamento leve**: `ai_agents.prompt_version int` incrementado a cada edição + snapshot em `agent_prompt_versions` — permite comparar taxa de conversão antes/depois de uma mudança.
5. **[G6, opcional fase 2]** migrar action de regex para **tool use** nativo da API Anthropic (mais confiável).

### 2.3 Checklist de componentes (Parte 2)

- [ ] **[NOVO]** `src/lib/agents/templates.ts` — templates por nicho
- [ ] **[NOVO]** UI galeria de templates no início do wizard
- [ ] **[NOVO]** Aba Q&A no passo Produto (CRUD de pares)
- [ ] **[NOVO]** Test drive com checklist (5 cenários automáticos)
- [ ] **[NOVO]** Feedback por mensagem + modal de correção + seção "Correções" no prompt
- [ ] **[NOVO]** `agent_prompt_versions` + snapshot na edição
- [ ] **[NOVO]** (condicional) RAG com pgvector quando docs grandes
- [ ] **[REFACTOR]** `callAnthropic` com prompt caching
- [ ] **[REFACTOR]** wizard: accordion avançado (limites, horário com timezone)
- [ ] **[BUGFIX]** validação de tenant + plano no endpoint de chat
- [ ] **[BUGFIX]** PDF vazio avisa o usuário
- [ ] **[BUGFIX]** action `route` matricula no `target_funnel_id`
- [ ] **[BUGFIX]** business hours com timezone do tenant

---

## PARTE 3 — Bug Audit: Formulário Interativo (Quiz v2)

Auditoria completa do código em 2026-07-03. 31 bugs. Todos são **[BUGFIX]** salvo indicação.

### 🔴 CRÍTICOS (corrigir imediatamente)

| # | Bug | Onde | Solução |
|---|-----|------|---------|
| 1 | **`tenantId` vem do cliente no submit público** — qualquer visitante pode criar leads/eventos e matricular leads em funis de OUTRO tenant (dispara WhatsApp!) | `api/quiz/[pageId]/submit/route.ts:10-16` | Derivar `tenant_id` da própria `pages` pelo `pageId`; ignorar o body |
| 2 | `conversions_count` recebe um query-builder como valor — conversões nunca contam | `submit/route.ts:107` | RPC `increment_page_conversions(pageId)` |
| 3 | **RichTextField corrompe conteúdo ao trocar de bloco** — innerHTML só inicializa no mount; selecionar outro bloco Texto mostra/grava o HTML do bloco anterior | `rich-text-field.tsx:25-30` | `key={block.id}` no uso dentro do editor (1 linha) + sync guard |
| 4 | Efeitos colaterais dentro do updater de `setAnswers` — pode duplicar score, submissão (leads duplicados!) e avanço de página | `quiz-renderer-v2.tsx:985-1021` | Calcular fora do updater; submit idempotente |

### 🟠 ALTOS

| # | Bug | Onde | Solução |
|---|-----|------|---------|
| 5 | Bloco obrigatório escondido por `appear_delay` trava o quiz sem nenhum feedback (o erro também fica escondido) | renderer `TimedBlock` + validação :389-401 | Validar só blocos já revelados |
| 6 | Duas `single_choice` na mesma página: auto-advance pula a segunda sem responder | renderer :521-525, :992 | Só auto-avançar com exatamente 1 bloco de escolha na página |
| 7 | Score duplica ao usar "Voltar" (soma a página de novo) + Voltar quebra com `goto_page_id` | renderer :404-441, :1111 | Recalcular score de `answers`; pilha de navegação |
| 8 | `final_capture` sem validação nenhuma — lead criado com email lixo/vazio, pixel dispara mesmo assim | renderer :684-702 | Validar email (regex) e telefone (dígitos) antes de avançar |
| 9 | **Toolbar do rich text clipada pelo painel com overflow** (o bug que você viu na tela) — na primeira linha ela é cortada pelo scroll container | `rich-text-field.tsx:66` + editor :2038 | Renderizar via portal `position:fixed`, ou abaixo do campo quando sem espaço acima |
| 10 | `exec_sql` RPC com DDL rodando em TODA carga do editor — vetor de SQL arbitrário + lock por request | `quiz-v2.ts:417-420` | Remover; coluna já existe via migration |
| 11 | Slug de publicação sem checagem de colisão e erro de update ignorado (retorna sucesso falso) | `quiz-v2.ts:505-515` | Retry em colisão + checar `error` |
| 12 | Autosave last-write-wins fora de ordem (save lento sobrescreve save novo; duas abas se destroem) | editor :2096-2108 | Fila de save + version check otimista |

### 🟡 MÉDIOS

| # | Bug | Solução resumida |
|---|-----|------------------|
| 13 | Upload compact (opções/depoimentos) não mostra erro — falha silenciosa >5MB | Exibir erro/tooltip no modo compact |
| 14 | Race no upload em listas: closure antigo apaga edições feitas durante o upload | Patch funcional por id no `updateBlock` |
| 15 | SVG na allowlist de upload = stored XSS no bucket público | Remover `image/svg+xml` |
| 16 | `html_embed`: `<script>` não executa (bloco não cumpre a função) E é XSS armazenado no domínio compartilhado | Criar script via DOM em `useEffect` + iframe sandbox |
| 17 | Roteamento por faixa de pontuação ignora `goto_page_id` se a página-alvo não tem bloco result; `goto` órfão nunca é limpo ao excluir página | Navegar mesmo sem result; limpar referências no `deletePage` |
| 18 | `LoadingBlock`: closure stale + re-dispara auto-advance ao Voltar (loop) | `onDone` em ref + flag executado |
| 19 | `button_action:'submit'` oferecido no editor mas não implementado no renderer | Implementar ou remover a opção |
| 20 | `scale_min > scale_max` renderiza zero botões e trava quiz obrigatório | Clamp no editor e renderer |
| 21 | Resposta identificada pelo `label` da opção — labels duplicados quebram score/goto | Usar `opt.id` como valor |
| 22 | Submit: `.single()` no lookup de lead com telefone duplicado → cria lead duplicado; phone nunca atualizado no match por email | `maybeSingle()` + atualizar phone |
| 23 | `/pg/[slug]` nunca revalidada após save/publish | `revalidatePath('/pg/'+slug)` |

### 🟢 BAIXOS

| # | Bug | Solução resumida |
|---|-----|------------------|
| 24 | Autosave dispara no mount sem edição (persiste migração v1→v2 irreversível) | Guard de primeira render |
| 25 | Excluir página sem confirmação nem undo | `confirm()` mínimo |
| 26 | Countdown com data inválida renderiza "NaN" | Validar `isNaN` |
| 27 | Barra de progresso nunca chega a 100% e ignora ramificações | `(pageIdx+1)/total` + considerar rota |
| 28 | Extensão do upload derivada do filename sem sanitizar | Derivar de `file.type` |
| 29 | Redirect automático do resultado (800ms) compete com o botão CTA | Só redirecionar se não houver CTA |
| 30 | Inputs do renderer com `bg-white`/cores hardcoded ignoram tema dark | Usar cores do `resolveTheme` |
| 31 | Editor com 4 colunas de largura fixa — inutilizável < 900px | Breakpoint colapsando palette/painel em drawer |

---

## ROADMAP / PRIORIDADES

### Sprint 1 — Segurança + bugs críticos (1-2 dias) 🔴
1. Bugs #1, #2, #10 (segurança/dados do quiz) — **antes de qualquer divulgação**
2. Bugs #3, #4, #9 (corrupção de conteúdo + duplicação + toolbar)
3. Gap G4 do agente (validação de tenant/plano no endpoint de chat)

### Sprint 2 — Bugs altos do quiz + custo do agente (2-3 dias) 🟠
4. Bugs #5-#8, #11, #12
5. Prompt caching (G2) — corta custo do Sonnet drasticamente
6. PDF vazio avisa (G3) + action `route` funcional (G5)

### Sprint 3 — Landing conversacional MVP (3-5 dias) 🚀
7. Migration (slug, landing_config, channel)
8. Endpoint público + rota `/a/[slug]` + componentes de chat
9. Step "Landing" no wizard + captura inline + pixel
10. **MVP entregável**: agente respondendo numa página pública com captura de lead e UTM

### Sprint 4 — Agente v2 (3-5 dias)
11. Templates por nicho + galeria
12. Aba Q&A de treino + test drive com checklist
13. Feedback por mensagem + correções no prompt
14. Bugs médios do quiz (#13-#23)

### Sprint 5 — Refinamento
15. RAG com pgvector (se docs grandes forem realidade dos clientes)
16. Versionamento de prompt + métricas comparativas
17. Tool use nativo p/ actions (G6)
18. Bugs baixos do quiz (#24-#31) + editor responsivo

### Dependências entre as partes
- A landing (Parte 1) **depende** do bug #1 corrigido (padrão de derivar tenant no server) e se beneficia do G5 (`route` funcional) e do prompt caching (custo por visitante anônimo).
- O feedback loop (Parte 2F) alimenta tanto o WhatsApp quanto a landing — mesma tabela de conversas, canal diferente.
