# 📋 Plano de Ação — FunilPro (02/07/2026)

Tudo que foi implementado já está no ar (deploy automático da Vercel após o push).
Estes são os passos **manuais** que só você pode executar, em ordem de prioridade.

---

## 1️⃣ URGENTE — Aplicar a migration no Supabase Studio

Sem isso o agente IA continua com limitações (dedupe, reset mensal) e o **upload de imagens do quiz não funciona**.

1. Acesse https://supabase.com/dashboard/project/hcadyqktfowfkxsbogmj
2. Menu lateral → **SQL Editor** → **New query**
3. Abra o arquivo `supabase/migrations/20260702000000_agent_fixes_quiz_v2.sql` do repositório, copie TODO o conteúdo e cole
4. Clique em **Run**

Se aparecer erro "policy already exists", ignore — significa que parte já foi aplicada.

⚠️ Se ainda não aplicou as migrations anteriores, aplique também (nesta ordem):
- `20260618000000_interactive_quiz.sql`
- `20260619000000_quiz_leads.sql`
- `20260619000001_quiz_webhook_logs.sql`
- `20260619000002_ai_agents.sql`

---

## 2️⃣ Testar o agente IA standalone (o bug foi corrigido!)

**O que estava errado:** o sistema só sabia enviar respostas WhatsApp através do funil do lead. Leads que chegavam direto pelo WhatsApp (standalone) não têm funil, então o agente processava a mensagem, gastava ativação, mas a resposta nunca era enviada. Agora ele usa a instância WhatsApp vinculada ao próprio agente.

**Teste:**
1. Aguarde o deploy da Vercel terminar (~2 min após o push)
2. De um celular DIFERENTE do conectado, mande uma mensagem para o número do WhatsApp da instância
3. O agente deve responder em alguns segundos (em várias mensagens curtas, estilo conversa)
4. Se não responder, olhe os logs: **Vercel → funil-pro → Logs** e procure por `[chat]` ou `standalone agent error`

**Também corrigido:** mensagens duplicadas (Evolution reenviava webhook), limite mensal que nunca resetava, lead preso no agente para sempre, erro da Anthropic sendo enviado como resposta ao cliente.

---

## 3️⃣ Conhecer o novo Quiz Builder (nível Inlead)

Abra qualquer quiz em **Páginas → editar quiz**. Novidades:

### 🎨 Aba "Design" (clique fora de qualquer bloco → painel direito)
- **5 temas prontos**: Clean, Dark, Gradient, Minimal, Bold — 1 clique aplica tudo
- **4 fontes**: Inter, Poppins, Montserrat, Playfair
- **Fundo**: cor sólida, 6 gradientes prontos ou imagem (com upload)
- **Estilo dos cards**: flat, sombra ou vidro (glassmorphism)
- **Cantos dos botões**: reto, suave ou redondo
- **Logo**: aparece no topo do quiz publicado

### 🚀 Categoria "Landing" na paleta de blocos
Agora dá para montar uma landing page completa dentro do quiz:
- **Hero**: headline + subheadline + imagem + botão CTA
- **Depoimentos**: cards com foto, estrelas e texto
- **Benefícios**: grid de features com ícone
- **FAQ**: acordeão de perguntas
- **Contagem**: cronômetro de urgência (evergreen por visitante ou data fixa)

### 📤 Upload de imagens
- Bloco imagem, hero, depoimentos, logo e fundo: botão "Enviar imagem" (máx 5MB)
- **Opções de resposta com foto**: no editor, cada opção tem botão "Foto" — as opções viram cards com imagem em grade (estilo Inlead)
- ⚠️ Precisa da migration do passo 1 (cria o bucket `quiz-assets`)

### 📊 Pixel de conversão por etapa
- Em blocos **Botão** e **Captura final** → seção Integrações → "Evento do Pixel Meta"
- Eventos: Lead, CompleteRegistration, InitiateCheckout, Purchase ou personalizado
- Captura final novo já vem com "Lead" por padrão
- Cada quiz pode ter seu próprio Pixel ID (Configurações do quiz → aba Geral) — se vazio, usa o global

**Teste sugerido:** crie um quiz de teste → aplique o tema Gradient → adicione um Hero + Depoimentos na primeira página → publique → abra no celular.

---

## 4️⃣ Verificar o Pixel no Meta Events Manager

O bug do pixel também foi corrigido (o campo estava com nome trocado no código — por isso não aparecia em página nenhuma).

1. Confirme que o Pixel ID está salvo em **Configurações → Meta Pixel**
2. Abra uma página publicada (`/pg/seu-slug`) 
3. Em https://business.facebook.com/events_manager → seu pixel → **Testar eventos** → cole a URL
4. Deve aparecer `PageView`; ao completar a captura do quiz, deve aparecer `Lead`

---

## 5️⃣ Checklist rápido de ambiente

| Item | Onde | Status |
|------|------|--------|
| `ANTHROPIC_API_KEY` | Vercel → Settings → Env Vars | ✅ você confirmou |
| Migration 20260702 | Supabase Studio | ⬜ passo 1 |
| Migrations antigas (4) | Supabase Studio | ⬜ verificar |
| Plano do tenant = `scale` | SQL: `UPDATE tenants SET plan='scale' WHERE slug='SEU_SLUG';` | ⬜ necessário p/ agentes |
| Webhook Evolution | já verificado — OK | ✅ |

---

## O que ficou para depois (backlog)

- Etapa 6: E-mail (Resend + sequências)
- Etapa 9: API Meta (puxar ad_spend automático)
- Etapa 11: Templates + marketplace
- Etapa 12B: Billing (Asaas)
- Quiz: A/B test, embed em site externo, lógica condicional com operadores AND/OR
