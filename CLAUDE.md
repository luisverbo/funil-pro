# CLAUDE.md — FunilPro SaaS
> Leia este arquivo no início de CADA sessão antes de escrever qualquer código.
> Ao final de cada sessão, atualize a seção "Status atual" e commite no GitHub.

---

## 📌 Instrução permanente
Ao final de cada sessão de trabalho:
1. Atualize a seção "Status atual" com o que foi feito
2. Atualize a seção "Próximos passos" com o que falta
3. Commite este arquivo no GitHub com mensagem: `docs: atualiza CLAUDE.md`

---

## 🎯 O que é este projeto

**FunilPro** — SaaS de funis de vendas visual com rastreamento completo de ROI.

- **Dono:** Luís Carlos da Silva (LC Marketing Digital)
- **Uso:** próprio + venda para outros empreendedores brasileiros
- **Modelo:** multi-tenant (cada cliente tem seu próprio espaço isolado)
- **Público-alvo:** infoprodutores, gestores de tráfego, donos de negócio digital

### O que o sistema faz
Builder visual de funis estilo fluxograma (drag-and-drop com React Flow). O usuário arrasta blocos, conecta com linhas e define condições em cada saída. Ex: "se o lead não abriu a mensagem → aguardar 2 dias → enviar follow-up". Rastreia o lead desde o clique no anúncio até a compra final, com métricas completas de ROI por anúncio.

---

## 🏗️ Arquitetura do sistema

### Stack técnica
```
Frontend:     Next.js 14 + TypeScript + Tailwind + Shadcn/ui
Banco:        Supabase (PostgreSQL + Auth + Realtime + Storage)
Filas:        Redis + BullMQ (execução dos funis em background)
WhatsApp:     Evolution API (Baileys) — multi-instância por tenant
E-mail:       Resend (transacional)
Builder:      React Flow (canvas drag-and-drop)
Infra:        VPS Hostinger 4GB RAM / 1 vCPU / 50GB NVMe
Reverse proxy: Caddy (SSL automático + domínios custom)
Containers:   Docker + Docker Compose
Deploy:       GitHub Actions → VPS via SSH
```

### Serviços externos
```
Meta Marketing API:   puxa ad_spend por campaign/ad_id (cron diário)
Hotmart webhook:      recebe eventos de compra/reembolso
Kiwify webhook:       recebe eventos de compra/reembolso
Eduzz webhook:        recebe eventos de compra/reembolso
Yampi webhook:        recebe eventos de pedido/abandono
Pixel Meta:           disparado nas páginas e eventos do funil
```

---

## 📦 Módulos do sistema

### FASE 1 — construção agora

| Módulo | Descrição | Status |
|--------|-----------|--------|
| Auth + multi-tenant | Login, registro, isolamento por tenant | ✅ concluído |
| Builder de funis | Canvas React Flow, blocos, conexões, condições | ✅ concluído |
| Motor de execução | BullMQ processa blocos em fila, dispara ações | ✅ concluído |
| WhatsApp | Evolution API, instâncias por tenant, envio/recebimento | ✅ concluído |
| E-mail | Resend, sequências, broadcasts | 🔴 não iniciado |
| Rastreamento UTM | Captura parâmetros na entrada, grava lead_source | ✅ concluído |
| Integração Meta API | Puxa ad_spend, calcula CPL e ROAS | 🔴 não iniciado |
| Webhooks pagamento | Hotmart, Kiwify, Eduzz, Yampi | ✅ concluído |
| Painel de métricas | CPL, ROAS, drop-off por etapa, timeline do lead | ✅ concluído |
| Templates de funil | Exportar/importar JSON, marketplace | 🔴 não iniciado |
| Planos + billing | Starter/Pro/Scale + add-ons, Asaas ou Stripe | 🔴 não iniciado |

### FASE 2 — após core pronto

| Módulo | Descrição |
|--------|----------|
| Editor de páginas | VSL com botão temporizado, carta de vendas, upsell, rastreamento de clique e tempo assistido |
| Formulário interativo | Estilo Typeform, respostas alimentam condições do funil |
| Agente de IA por funil | ✅ Etapa 15 concluída — módulo Agentes IA treináveis (só Scale) |

---

## 💳 Modelo de negócio

### Planos

| Plano | Preço | Instâncias WA | E-mails/mês | Diferenciais |
|-------|-------|----------------|-------------|-------------- |
| Starter | R$ 97/mês | 1 | 1.000 | Funis ilimitados, WA + email, métricas básicas |
| Pro | R$ 197/mês | 1 | 10.000 | + ROI Meta, + 1 add-on incluso (formulário OU páginas), templates |
| Scale | R$ 397/mês | 3 | 50.000 | + tudo incluso, + agente IA opcional por funil |

### Add-ons avulsos (disponíveis em qualquer plano)
- Instância WA adicional: **R$ 60/mês** por instância
- Formulário interativo: **R$ 79/mês**
- Editor de páginas: **R$ 79/mês**

### Regras de negócio importantes
- Agente IA: exclusivo Scale, opcional por funil, desativado por padrão
- Agente só pode ser ativado com funil já publicado
- Templates: disponível a partir do Pro (exportar/importar/marketplace)
- Instâncias WA: cada funil pode usar uma instância diferente
- Add-ons podem ser comprados em qualquer plano sem upgrade

---

## 🗄️ Schema do banco de dados (Supabase)

### Tabelas principais

```sql
-- TENANTS (clientes do SaaS)
tenants
  id uuid PK
  name text
  slug text UNIQUE              -- subdomínio: slug.funil.pro
  custom_domain text            -- domínio próprio do cliente
  plan text                     -- starter | pro | scale
  plan_expires_at timestamptz
  meta_access_token text        -- token API Meta
  meta_ad_account_id text
  resend_api_key text           -- chave Resend do tenant
  email_quota_used int DEFAULT 0
  email_quota_limit int DEFAULT 1000
  created_at timestamptz DEFAULT now()

-- ADDONS contratados por tenant
tenant_addons
  id uuid PK
  tenant_id uuid FK tenants
  addon_type text               -- whatsapp_instance | form | pages
  status text                   -- active | cancelled
  price_cents int
  created_at timestamptz

-- INSTÂNCIAS WHATSAPP
whatsapp_instances
  id uuid PK
  tenant_id uuid FK tenants
  instance_name text            -- nome na Evolution API
  phone_number text
  status text                   -- connected | disconnected | connecting
  is_addon boolean DEFAULT false
  created_at timestamptz

-- FUNIS
funnels
  id uuid PK
  tenant_id uuid FK tenants
  name text
  description text
  status text                   -- draft | published | paused
  whatsapp_instance_id uuid FK whatsapp_instances
  agent_enabled boolean DEFAULT false   -- agente IA opcional (só Scale)
  agent_prompt text             -- prompt base do agente
  utm_source text               -- fonte padrão para links gerados
  created_at timestamptz
  published_at timestamptz

-- BLOCOS DO FUNIL (nodes do React Flow)
funnel_blocks
  id uuid PK
  funnel_id uuid FK funnels
  block_type text               -- message | condition | delay | tag | sale | form* | page*
  label text
  config jsonb                  -- configurações específicas do tipo
  position_x float
  position_y float
  created_at timestamptz

-- CONEXÕES ENTRE BLOCOS (edges do React Flow)
funnel_edges
  id uuid PK
  funnel_id uuid FK funnels
  source_block_id uuid FK funnel_blocks
  target_block_id uuid FK funnel_blocks
  condition text                -- opened | not_opened | clicked | not_clicked | replied | purchased | yes | no | default
  condition_value text          -- valor da condição quando necessário
  created_at timestamptz

-- TEMPLATES DE FUNIL
funnel_templates
  id uuid PK
  tenant_id uuid FK tenants     -- null = template oficial da plataforma
  name text
  description text
  category text                 -- emagrecimento | lançamento | mentoria | produto_físico...
  funnel_json jsonb             -- export completo do funil (blocos + edges + config)
  is_public boolean DEFAULT false
  price_cents int DEFAULT 0     -- 0 = gratuito
  downloads_count int DEFAULT 0
  created_at timestamptz

-- LEADS
leads
  id uuid PK
  tenant_id uuid FK tenants
  funnel_id uuid FK funnels
  name text
  phone text
  email text
  status text                   -- active | converted | unsubscribed | lost
  current_block_id uuid FK funnel_blocks
  agent_active boolean DEFAULT false
  agent_last_at timestamptz
  funnel_paused_at timestamptz  -- quando agente assumiu
  funnel_resume_block_id uuid   -- bloco onde retomar após agente
  tags text[]
  metadata jsonb                -- dados extras coletados no funil
  created_at timestamptz

-- ORIGEM DO LEAD (imutável — nunca muda após criação)
lead_sources
  id uuid PK
  lead_id uuid FK leads
  utm_source text               -- meta | google | organic
  utm_campaign text
  utm_campaign_id text          -- ID real da campanha Meta
  utm_adset_id text
  utm_ad_id text                -- ID real do anúncio Meta
  utm_content text
  referrer_url text
  landing_url text
  created_at timestamptz

-- EVENTOS DO LEAD (timeline completa)
lead_events
  id uuid PK
  tenant_id uuid FK tenants
  lead_id uuid FK leads
  funnel_id uuid FK funnels
  block_id uuid FK funnel_blocks
  event_type text               -- clicked_ad | entered_funnel | message_sent | message_opened |
                                --   message_clicked | replied | purchased | agent_activated |
                                --   agent_deactivated | page_viewed | page_button_clicked |
                                --   unsubscribed | funnel_completed | quiz_completed
  event_data jsonb              -- dados extras do evento
  platform text                 -- hotmart | kiwify | eduzz | yampi | internal
  revenue_cents int             -- receita gerada neste evento (se compra)
  product_name text
  created_at timestamptz

-- MÉTRICAS DE ANÚNCIO (sincronizadas da API Meta)
ad_metrics
  id uuid PK
  tenant_id uuid FK tenants
  ad_id text                    -- ID do anúncio no Meta
  campaign_id text
  adset_id text
  ad_name text
  campaign_name text
  spend_cents int               -- gasto em centavos
  impressions int
  clicks int
  leads_count int               -- calculado pelo sistema
  revenue_cents int             -- calculado pelo sistema
  cpl_cents int                 -- custo por lead
  roas float                    -- retorno sobre gasto
  date date                     -- dia da métrica
  synced_at timestamptz

-- PÁGINAS (Fase 2)
pages
  id uuid PK
  tenant_id uuid FK tenants
  funnel_id uuid FK funnels
  title text
  slug text
  page_type text                -- capture | vsl | delivery | thankyou | sales | interactive
  craft_json jsonb              -- conteúdo do builder Craft.js
  meta_title text
  meta_description text
  og_image_url text
  views_count int DEFAULT 0
  clicks_count int DEFAULT 0
  conversions_count int DEFAULT 0
  published boolean DEFAULT false
  created_at timestamptz

-- PERGUNTAS DO QUIZ INTERATIVO
interactive_questions
  id uuid PK
  page_id uuid FK pages
  tenant_id uuid FK tenants
  order_index int
  question_type text            -- single_choice | multi_choice | text_short | text_long |
                                --   scale | email | phone | final_capture | result
  question_text text
  subtitle text
  options jsonb                 -- [{id, label, emoji, next_question_id}]
  required boolean DEFAULT true
  next_question_id uuid         -- para tipos lineares (não-choice)
  config jsonb                  -- {is_result, result_profile, result_text, cta_text, cta_url,
                                --  funnel_id, bg_color, scale_min, scale_max}
  pos_x float
  pos_y float
  created_at timestamptz

-- RESPOSTAS DO QUIZ
interactive_responses
  id uuid PK
  page_id uuid FK pages
  lead_id uuid FK leads
  tenant_id uuid FK tenants
  answers jsonb                 -- {question_id: answer_value}
  result_profile text
  completed boolean DEFAULT false
  completed_at timestamptz
  created_at timestamptz
```

---

## 🔄 Fluxo de execução do funil

```
1. Lead clica no anúncio Meta
   → UTMs capturados na URL
   → lead criado no banco
   → lead_source gravado (imutável)
   → primeiro bloco enfileirado no BullMQ

2. BullMQ processa bloco
   → tipo 'message': envia WA ou email via Evolution API / Resend
   → tipo 'condition': avalia evento do lead, escolhe próximo bloco
   → tipo 'delay': agenda próximo bloco para X horas/dias
   → tipo 'tag': adiciona tag ao lead
   → tipo 'sale': envia link de pagamento

3. Lead responde mensagem WA
   → webhook Evolution API dispara
   → classificador verifica se é palavra-chave do funil
   → se sim: processa como condição normal
   → se não (pergunta livre) e agente ativo: ativa agente IA
   → agente responde, detecta intenção de compra, devolve controle

4. Lead compra em plataforma externa
   → webhook Hotmart/Kiwify/Eduzz/Yampi chega
   → sistema identifica lead por email/telefone
   → grava evento 'purchased' com valor e produto
   → atribui receita ao ad_id de origem
   → funil avança para próxima etapa automaticamente

5. Cron job diário (API Meta)
   → puxa ad_spend por ad_id
   → atualiza tabela ad_metrics
   → recalcula CPL e ROAS

6. Lead completa quiz interativo
   → respostas salvas em interactive_responses
   → lead criado/atualizado com dados capturados
   → evento 'quiz_completed' gravado em lead_events
   → funil ativado baseado no result_profile configurado
```

---

## 📡 Webhooks recebidos

| Plataforma | URL | Evento principal |
|------------|-----|------------------|
| Evolution API | `/api/webhooks/evolution/:instanceId` | mensagem recebida |
| Hotmart | `/api/webhooks/hotmart/:tenantId` | compra aprovada |
| Kiwify | `/api/webhooks/kiwify/:tenantId` | compra aprovada |
| Eduzz | `/api/webhooks/eduzz/:tenantId` | compra aprovada |
| Yampi | `/api/webhooks/yampi/:tenantId` | pedido aprovado |

---

## 🔐 Multi-tenancy

- Cada tenant tem `tenant_id` em todas as tabelas
- Row Level Security (RLS) no Supabase ativado em todas as tabelas
- Política: usuário só acessa dados do próprio tenant
- Subdomínio: `{slug}.funil.pro` gerenciado pelo Caddy
- Domínio custom: cliente aponta CNAME para o VPS, Caddy emite SSL automático

---

## 🚀 Ordem de implementação recomendada

```
Etapa 1:  Schema do banco + migrations Supabase
Etapa 2:  Auth + multi-tenant (login, registro, isolamento RLS)
Etapa 3:  Builder visual (React Flow + blocos + salvar no banco)
Etapa 4:  Motor de execução (BullMQ + processamento de blocos)
Etapa 5:  Integração WhatsApp (Evolution API + envio + webhook recebimento)
Etapa 6:  Integração e-mail (Resend + sequências)
Etapa 7:  Rastreamento UTM + lead_source
Etapa 8:  Webhooks de pagamento (Hotmart, Kiwify, Eduzz, Yampi)
Etapa 9:  Integração API Meta (ad_spend + métricas)
Etapa 10: Painel de métricas (CPL, ROAS, drop-off, timeline)
Etapa 11: Templates + marketplace
Etapa 12: Planos + billing (Asaas)
--- FASE 2 ---
Etapa 13: Editor de páginas (VSL + botão temporizado)
Etapa 14: Formulário interativo (Quiz estilo Typeform) ✅
Etapa 15: Agente de IA por funil
```

---

## 📁 Estrutura de pastas do projeto

```
funil-pro/
├── CLAUDE.md                    ← este arquivo
├── .env.local                   ← variáveis de ambiente (não commitar)
├── .env.example                 ← template de variáveis
├── docker-compose.yml           ← Redis + Evolution API
├── Caddyfile                    ← configuração reverse proxy
│
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── (auth)/              ← páginas de login/registro
│   │   ├── (dashboard)/         ← painel do cliente
│   │   │   ├── funnels/         ← listagem e builder de funis
│   │   │   ├── leads/           ← CRM de leads
│   │   │   ├── metrics/         ← painel de métricas
│   │   │   ├── integrations/    ← configurar WA, email, plataformas
│   │   │   ├── pages/           ← lista de páginas + quiz editor
│   │   │   │   └── [id]/quiz-editor/ ← editor React Flow do quiz
│   │   │   └── settings/        ← plano, add-ons, domínio
│   │   └── api/
│   │       ├── webhooks/        ← endpoints de webhook
│   │       ├── funnels/         ← CRUD de funis
│   │       ├── leads/           ← CRUD de leads
│   │       ├── metrics/         ← endpoints de métricas
│   │       └── quiz/[pageId]/submit/ ← submissão pública do quiz
│   │
│   ├── components/
│   │   ├── builder/             ← React Flow + nodes customizados
│   │   ├── metrics/             ← gráficos e dashboards
│   │   ├── quiz/                ← quiz-editor-client.tsx
│   │   └── ui/                  ← Shadcn/ui components
│   │
│   ├── lib/
│   │   ├── supabase/            ← client e server Supabase
│   │   ├── evolution/           ← cliente Evolution API
│   │   ├── resend/              ← cliente Resend
│   │   ├── meta/                ← cliente API Meta
│   │   ├── queue/               ← BullMQ workers e jobs
│   │   └── webhooks/            ← parsers de webhook por plataforma
│   │
│   └── types/                   ← TypeScript types globais
│
└── supabase/
    └── migrations/              ← arquivos SQL de migration
```

---

## ⚙️ Variáveis de ambiente necessárias

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Redis
REDIS_URL=redis://localhost:6379

# Evolution API
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=

# Resend
RESEND_API_KEY=

# Meta
META_APP_ID=
META_APP_SECRET=

# App
NEXT_PUBLIC_APP_URL=https://app.funil.pro
APP_SECRET=
```

---

## 🐛 Status atual

**Última atualização:** 2026-07-02 — Correção completa do agente IA + Quiz Builder nível Inlead
**O que foi feito:**
- Correções agente IA (2026-07-02):
  - **Bug crítico corrigido**: agente standalone não respondia — `sendPartsViaWhatsApp` só resolvia instância via funil; agora resolve via `ai_agents.whatsapp_instance_id` primeiro (leads standalone têm `funnel_id null`)
  - `src/lib/agents/chat.ts` reescrito: `callAnthropic` com retry 429/529, erro explícito se key ausente, erros não viram "resposta" ao lead; reset mensal de `activations_used`; incremento atômico via RPC `increment_agent_activations`; conversa duplicada reaproveitada (unique index parcial); `resumeFunnel` sempre limpa `agent_active`; try/catch por parte no envio WA
  - Webhook Evolution: `maxDuration = 60`; idempotência via tabela `processed_wa_messages` (dedupe por `key.id`); auto-recuperação de lead preso em `agent_active` sem bloco resolvível; processamento síncrono com `await` (fire-and-forget era morto pelo Vercel — causa raiz do agente mudo)
  - Migration: `supabase/migrations/20260702000000_agent_fixes_quiz_v2.sql` — **aplicar manualmente no Supabase Studio**
- Quiz Builder nível Inlead (2026-07-02):
  - Temas: `QuizSettings.theme` (5 presets clean/dark/gradient/minimal/bold, fonte Google Fonts, fundo cor/gradiente/imagem, card flat/shadow/glass, cantos de botão, dark mode) — `src/lib/quiz/theme.ts` (resolveTheme compartilhado editor+renderer); aba 🎨 Design no painel do editor; logo renderizada no topo
  - Blocos landing: hero, testimonials, features, faq, countdown (evergreen via localStorage ou data fixa) — categoria "Landing" na palette; página só-landing com hero CTA esconde botão "Próximo"
  - Upload de imagens: bucket Supabase Storage `quiz-assets` (criado na migration), action `uploadQuizImage` em `src/app/actions/upload.ts`, componente `ImageUploadField` (modo normal + compact); usado em bloco imagem, opções de resposta (`BlockOption.image_url` → grid de cards 2 col), hero, depoimentos, logo, fundo do tema
  - Pixel por etapa: `BlockConfig.pixel_event` (Lead/CompleteRegistration/InitiateCheckout/Purchase/custom) em button/final_capture, disparado via `fbq` no `fireIntegrations`; `QuizSettings.pixel_id` por quiz com fallback ao pixel global do tenant em `/pg/[slug]/page.tsx`
- Correção Meta Pixel (2026-07-02): campo lido errado em `/f/[id]` (`pixel_meta_id` → `meta_pixel_id`); pixel adicionado a todas as páginas `/pg/[slug]`
- Etapa 1: Next.js 16.2.6 scaffolded, dependências instaladas, estrutura de pastas, lib stubs, schema SQL (15 tabelas + RLS)
- Etapa 2: Auth completo — login, registro, onboarding multi-tenant, middleware de proteção de rotas, deploy na Vercel funcionando
- Etapa 3: Builder visual React Flow completo
- Etapa 4: Motor de execução BullMQ completo
- Etapa 5: Integração WhatsApp Evolution API completa
- Etapa 7: Rastreamento UTM completo
- Etapa 8: Webhooks de pagamento completos + carrinho abandonado
- Etapa 10: Painel de métricas completo
- Etapa 12A: Painel Admin Master completo
- Correções motor (2026-05-31): Evolution API v2, middleware, delay, condition, upload, triggers por produto
- Etapa 13: Editor de Páginas com Craft.js completo
- Melhorias /leads (2026-06-18): filtro multi-tag (TagDropdown com checkboxes), bulk actions bar (WA + enroll + add tag + delete), WA modal com chips de variáveis clicáveis, server actions bulkDeleteLeads/bulkAddTag
- Etapa 14: Formulário interativo tipo quiz (2026-06-18):
  - Migration: tabelas `interactive_questions` + `interactive_responses`, constraint `pages.page_type` atualizada para incluir 'interactive'
  - **IMPORTANTE**: migration em `supabase/migrations/20260618000000_interactive_quiz.sql` — aplicar manualmente no Supabase Studio do projeto `hcadyqktfowfkxsbogmj` (MCP não tem acesso a este projeto)
  - `src/app/actions/quiz.ts` — server actions: `getQuizQuestions`, `saveQuizQuestions`, `publishQuizPage`, `getQuizAnalytics`
  - `src/app/(dashboard)/pages/[id]/quiz-editor/page.tsx` — server component carrega page + questions + funnels
  - `src/components/quiz/quiz-editor-client.tsx` — editor React Flow com:
    - Nodes por tipo de pergunta (9 tipos: single_choice, multi_choice, text_short, text_long, scale, email, phone, final_capture, result)
    - Handles de saída POR OPÇÃO (usando useLayoutEffect para medir posições reais no DOM)
    - Painel direito de edição: texto, subtítulo, tipo, opções (emoji+label), toggle required, config de resultado
    - Nó "Resultado" com: profile identifier, result_text, CTA text/URL, funil ativado
    - Palette esquerda com todos os tipos de pergunta
    - Barra superior: voltar, salvar, publicar
  - `src/app/pg/[slug]/page.tsx` — atualizado: quando `page_type='interactive'` carrega questions e renderiza QuizRenderer
  - `src/app/pg/[slug]/quiz-renderer.tsx` — renderer público animado completo
  - `src/app/api/quiz/[pageId]/submit/route.ts` — API pública de submissão com criação de lead + funil
  - `src/proxy.ts` — `/api/quiz/` adicionado às PUBLIC_PREFIXES
  - `src/app/(dashboard)/pages/pages-client.tsx` — tipo 'interactive' (🧠 Quiz) no modal de criação
- Etapa 15: Agentes IA treináveis (2026-06-19):
  - Migration: `supabase/migrations/20260619000002_ai_agents.sql` — tabelas `ai_agents`, `agent_documents`, `agent_conversations`, `agent_messages` + RLS via `current_tenant_id()`
  - **IMPORTANTE**: aplicar migration manualmente no Supabase Studio (projeto hcadyqktfowfkxsbogmj)
  - `src/app/actions/ai-agents.ts` — CRUD, listAgents/getAgent/createAgent/updateAgent/deleteAgent, activate/pause, listFunnels/listWhatsappInstances, getAgentStats, listConversations, getConversation
  - `src/app/api/agents/[agentId]/chat/route.ts` — motor de conversação via Claude Haiku (claude-haiku-4-5), system prompt dinâmico, tag de ação `|||ACTION:{...}|||`, business hours, max messages, handoff por palavra-chave, persistência de mensagens, incremento de activations
  - `src/app/api/agents/[agentId]/documents/route.ts` — upload (PDF via pdf-parse + texto), GET, DELETE
  - `src/app/(dashboard)/agents/page.tsx` + `agents-client.tsx` — listagem, overlay de upgrade se plano != scale, cards com métricas, modal de teste
  - `src/components/agents/agent-wizard.tsx` — wizard 5 steps (identidade, produto+docs, personalidade, objetivo, revisão+teste)
  - `src/components/agents/agent-test-chat.tsx` — chat de teste (testMode)
  - `src/app/(dashboard)/agents/[id]/conversations/page.tsx` + `conversations-client.tsx` — tabela de conversas + drawer com transcript
  - Sidebar: item "Agentes IA" (ícone Bot) entre Páginas e Métricas
  - `ANTHROPIC_API_KEY` necessária no env. Bloco de funil "Agente IA" no builder React Flow ainda não implementado (apenas estrutura/restrição de plano prontas)

**Próximos passos:**
- **PENDENTE URGENTE**: Aplicar migrations no Supabase Studio (projeto hcadyqktfowfkxsbogmj): `20260618000000_interactive_quiz.sql`, `20260619000000_quiz_leads.sql`, `20260619000001_quiz_webhook_logs.sql`, `20260619000002_ai_agents.sql`, `20260702000000_agent_fixes_quiz_v2.sql`
- Testar agente standalone com mensagem real após deploy + migration
- Etapa 6: Integração e-mail (Resend + sequências)
- Etapa 9: Integração API Meta (ad_spend + métricas)
- Etapa 11: Templates + marketplace
- Etapa 12B: Planos + billing (Asaas) — falta implementar
- Etapa 15 (resto): bloco "Agente IA" no builder React Flow

---

## 📝 Decisões técnicas importantes

| Decisão | Motivo |
|---------|--------|
| React Flow para o builder | Única lib madura para canvas drag-and-drop no ecossistema React |
| BullMQ + Redis para filas | Essencial para não travar quando múltiplos tenants disparam funis simultâneos |
| lead_source imutável | Garante atribuição correta mesmo que o lead compre semanas depois |
| Classificador antes do agente | Evita chamar IA para respostas simples (sim/não/números), reduz custo 80% |
| block_type extensível | Permite adicionar 'form' e 'page' na Fase 2 sem alterar o motor de execução |
| Webhook por tenant | URL única por tenant + plataforma, facilita debugging e isolamento |
| Agente só no Scale | Protege o sistema de bugs em produção, vira diferencial de upgrade |
| Resend para email | Zero configuração, integração nativa Next.js, custo praticamente zero na escala inicial |
| Evolution API v2 body format | `{ number, text }` — NÃO usar `{ textMessage: { text } }` que é formato v1 |
| Cron via VPS + Vercel crons | VPS tem `* * * * *` no crontab chamando `/api/queue/process`; Vercel também tem cron no vercel.json como backup |
| Middleware whitelist | `/api/queue/process` e `/api/quiz/` devem estar em PUBLIC_PREFIXES no proxy.ts para funcionar sem sessão |
| Quiz handles por opção | useLayoutEffect mede posição real do DOM para posicionar handles React Flow — mais robusto que cálculo estático |
| Quiz first question detection | Primeira pergunta = a que NÃO aparece como target em nenhuma opção/next_question_id |
