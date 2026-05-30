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
| Rastreamento UTM | Captura parâmetros na entrada, grava lead_source | 🔴 não iniciado |
| Integração Meta API | Puxa ad_spend, calcula CPL e ROAS | 🔴 não iniciado |
| Webhooks pagamento | Hotmart, Kiwify, Eduzz, Yampi | 🔴 não iniciado |
| Painel de métricas | CPL, ROAS, drop-off por etapa, timeline do lead | 🔴 não iniciado |
| Templates de funil | Exportar/importar JSON, marketplace | 🔴 não iniciado |
| Planos + billing | Starter/Pro/Scale + add-ons, Asaas ou Stripe | 🔴 não iniciado |

### FASE 2 — após core pronto

| Módulo | Descrição |
|--------|-----------|
| Editor de páginas | VSL com botão temporizado, carta de vendas, upsell, rastreamento de clique e tempo assistido |
| Formulário interativo | Estilo Typeform, respostas alimentam condições do funil |
| Agente de IA por funil | Opcional, só plano Scale, desativado por padrão |

---

## 💳 Modelo de negócio

### Planos

| Plano | Preço | Instâncias WA | E-mails/mês | Diferenciais |
|-------|-------|----------------|-------------|--------------|
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
  condition text                -- opened | not_opened | clicked | not_clicked | replied | purchased | default
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
                                --   unsubscribed | funnel_completed
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

-- PÁGINAS (Fase 2 — estrutura preparada)
pages
  id uuid PK
  tenant_id uuid FK tenants
  funnel_id uuid FK funnels
  title text
  slug text
  content jsonb                 -- blocos da página
  video_url text
  button_text text
  button_show_at_seconds int    -- botão aparece após X segundos
  button_url text
  pixel_meta_id text
  published boolean DEFAULT false
  created_at timestamptz

-- EVENTOS DE PÁGINA (Fase 2 — estrutura preparada)
page_events
  id uuid PK
  tenant_id uuid FK tenants
  page_id uuid FK pages
  lead_id uuid FK leads
  event_type text               -- viewed | video_started | video_progress | button_clicked | converted
  video_seconds_watched int
  created_at timestamptz

-- AGENTES DE IA por funil (Fase 2 — estrutura preparada)
funnel_agents
  id uuid PK
  funnel_id uuid FK funnels
  tenant_id uuid FK tenants
  enabled boolean DEFAULT false
  model text DEFAULT 'claude-haiku'
  system_prompt text
  product_name text
  product_description text
  payment_link text
  max_activations_per_month int DEFAULT 200
  activations_used int DEFAULT 0
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
```

---

## 📡 Webhooks recebidos

| Plataforma | URL | Evento principal |
|------------|-----|-----------------|
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
Etapa 14: Formulário interativo (Typeform)
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
│   │   │   └── settings/        ← plano, add-ons, domínio
│   │   └── api/
│   │       ├── webhooks/        ← endpoints de webhook
│   │       ├── funnels/         ← CRUD de funis
│   │       ├── leads/           ← CRUD de leads
│   │       └── metrics/         ← endpoints de métricas
│   │
│   ├── components/
│   │   ├── builder/             ← React Flow + nodes customizados
│   │   ├── metrics/             ← gráficos e dashboards
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

**Última atualização:** 2026-05-30 — Etapas 1, 2, 3, 4 e 5 concluídas
**O que foi feito:**
- Etapa 1: Next.js 16.2.6 scaffolded, dependências instaladas, estrutura de pastas, lib stubs, schema SQL (15 tabelas + RLS)
- Etapa 2: Auth completo — login, registro, onboarding multi-tenant, middleware de proteção de rotas, deploy na Vercel funcionando
- Etapa 3: Builder visual React Flow completo:
  - `/funnels` — lista de funis com status badge e empty state
  - `CreateFunnelDialog` — modal nativo Tailwind para criar funil
  - `/funnels/[id]/builder` — canvas React Flow com palette lateral
  - 5 node types: message (💬), condition (🔀), delay (⏱️), tag (🏷️), sale (💰)
  - Custom edge com label de condição clicável
  - Server actions: createFunnel, saveFunnel (delete edges→blocks→reinsert), publishFunnel
  - SSR seguro: dynamic import com ssr:false para React Flow
  - Build passando sem erros TypeScript
- Etapa 4: Motor de execução BullMQ completo:
  - `src/lib/queue/handlers/` — 5 handlers: message, condition, delay, tag, sale
  - `src/lib/queue/worker.ts` — Worker BullMQ com concurrency 10, enfileira próximo bloco automaticamente
  - `src/server.ts` — processo standalone para rodar o worker em produção
  - `src/app/api/funnels/[id]/activate/route.ts` — endpoint POST para entrada de lead no funil
  - Handler condition: avalia eventos do lead (opened/clicked/replied/purchased) e roteia yes/no
  - Handler delay: calcula delayMs (minutos/horas/dias) e passa para BullMQ
  - Handler tag: add/remove tags com fallback direto se RPC falhar
  - docker-compose.yml: serviço worker já configurado com `npx tsx src/server.ts`
- Etapa 5: Integração WhatsApp Evolution API completa:
  - `src/lib/evolution/index.ts` — funções: sendTextMessage, sendMediaMessage, createInstance, getInstanceQRCode, getInstanceStatus, deleteInstance, setInstanceWebhook
  - `src/app/actions/whatsapp.ts` — server actions: createWhatsappInstance, deleteWhatsappInstance
  - `src/app/api/whatsapp/[instanceId]/qrcode/route.ts` — endpoint GET para QR code
  - `src/app/api/whatsapp/[instanceId]/status/route.ts` — endpoint GET para status (sincroniza DB)
  - `src/app/api/webhooks/evolution/[instanceId]/route.ts` — webhook: processa CONNECTION_UPDATE, MESSAGES_UPSERT, grava evento 'replied', re-enfileira condition block
  - `src/components/whatsapp/instance-card.tsx` — card com QR code, polling de status, badge animado
  - `src/components/whatsapp/create-instance-button.tsx` — botão client-side com useTransition
  - `src/app/(dashboard)/integrations/page.tsx` — página completa com lista de instâncias

**Próximos passos:**
- Etapa 6: Integração e-mail (Resend + sequências)
- Etapa 7: Rastreamento UTM + lead_source
- Etapa 8: Webhooks de pagamento (Hotmart, Kiwify, Eduzz, Yampi)


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
