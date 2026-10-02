# Prompt — Painel de Conteúdos Instagram (instalação por cliente)

> **Como usar:** crie um repositório vazio para o cliente, abra o Claude Code
> nele e cole este arquivo inteiro como primeira mensagem (ou salve como
> `CLAUDE.md` na raiz e peça "leia o CLAUDE.md e construa o sistema").
> Preencha antes a seção **0. Dados deste cliente**.

---

## 0. Dados deste cliente (preencher antes de colar)

| Item | Valor |
|---|---|
| Nome do cliente / marca | `__________` |
| @ do Instagram | `__________` |
| E-mail(s) de quem vai entrar no painel | `__________` |
| Projeto Supabase (URL) | `https://__________.supabase.co` |
| URL de produção (Vercel) | `https://__________.vercel.app` |
| Horário do reel (Brasília) | `06:00` |
| Horário do carrossel (Brasília) | `15:00` |

---

## 1. O que você vai construir

Um painel web **de um cliente só** (não é multiempresa: cada cliente ganha a
sua própria cópia, com banco próprio) para **aprovar e publicar
automaticamente** Reels e carrosséis no Instagram do cliente.

Quem **cria** os conteúdos não é o painel: é uma **skill externa** (rodando no
computador do operador) que sobe os arquivos, pede a próxima data livre e
insere o item na fila como `pendente`. O painel:

1. mostra a fila e o calendário;
2. deixa o cliente **aprovar, editar, descartar, voltar para pendente,
   tentar de novo e publicar agora**;
3. publica sozinho no horário, pela Instagram API, com retentativas;
4. mantém o token do Instagram vivo (renova a cada 24h).

Tudo em **português do Brasil**, horários sempre em **America/Sao_Paulo**.

### Fora do escopo (não construir)
Funis, leads, DMs, automações de comentário, anúncios, multiempresa,
cadastro público, pagamento. Se surgir vontade de adicionar, pergunte antes.

---

## 2. Stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **Supabase**: Postgres, Auth (e-mail e senha), Storage, **pg_cron + pg_net**
- Deploy na **Vercel**
- Sem Redis, sem filas externas, sem bibliotecas de UI pesadas. Gráfico ou
  calendário são feitos à mão com CSS grid.

### Variáveis de ambiente (só estas)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```
**Nada de segredo em `NEXT_PUBLIC_*`.** O token do Instagram **não** vai em
variável de ambiente: ele é colado na tela **Conexões** e fica no banco
(tabela fechada, ver §3.3). Assim trocar o token nunca exige redeploy.

---

## 3. Banco de dados (migrations em `supabase/migrations/`)

### 3.1 `conteudos_instagram`

```sql
CREATE TABLE conteudos_instagram (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_instagram_id  text,                       -- preenchido pelo publicador via /me
  tipo                text NOT NULL CHECK (tipo IN ('reel','carrossel')),
  status              text NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','agendado','publicando','publicado','erro','descartado')),
  data_agendada       timestamptz NOT NULL,

  midia_urls          text[] NOT NULL CHECK (array_length(midia_urls,1) >= 1),
  capa_url            text,
  descricao           text NOT NULL DEFAULT '',
  alt_text            text,
  hashtags            text[] NOT NULL DEFAULT '{}',
  palavra_chave       text,

  tema                text,
  origem_url          text,
  origem_trecho       text,
  nota                int CHECK (nota IS NULL OR nota BETWEEN 0 AND 10),

  ig_container_id     text,
  ig_media_id         text,
  ig_permalink        text,
  erro                text,
  tentativas          int NOT NULL DEFAULT 0,
  publicando_desde    timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  aprovado_em         timestamptz,
  publicado_em        timestamptz,

  CONSTRAINT midia_por_tipo CHECK (
    (tipo = 'reel'      AND array_length(midia_urls,1) = 1) OR
    (tipo = 'carrossel' AND array_length(midia_urls,1) BETWEEN 2 AND 10)
  )
);
CREATE INDEX ON conteudos_instagram (status, data_agendada);
CREATE INDEX ON conteudos_instagram (tipo, data_agendada);
```

**RLS:** ligado. Só usuário **logado** (`authenticated`) lê e altera;
`anon` não vê nada. A skill usa a service role (passa por cima do RLS).

```sql
ALTER TABLE conteudos_instagram ENABLE ROW LEVEL SECURITY;
CREATE POLICY logado_le     ON conteudos_instagram FOR SELECT TO authenticated USING (true);
CREATE POLICY logado_altera ON conteudos_instagram FOR UPDATE TO authenticated USING (true);
REVOKE ALL ON conteudos_instagram FROM anon;
```
Mesmo com RLS, **todas as ações do painel rodam no servidor** com a service
role, depois de conferir a sessão. O navegador nunca escreve direto na tabela.

### 3.2 Bucket `conteudos-instagram`
Público para **leitura** (a Meta baixa o arquivo pela URL na hora de
publicar). Upload só com service role ou usuário logado.

### 3.3 `configuracoes` (segredos) — FECHADA
```sql
CREATE TABLE configuracoes (
  chave      text PRIMARY KEY,
  valor      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON configuracoes FROM anon, authenticated;   -- só service role
```
Chaves usadas: `ig_access_token`, `ig_token_renovado_em`, `ig_token_expira_em`,
`ig_username`, `ig_user_id`, `cron_secret`.

> ⚠️ **Lição aprendida:** no sistema original esta tabela nasceu sem RLS e,
> com os GRANTs padrão do Supabase, qualquer pessoa com a chave pública lia o
> token do Instagram. Escreva um teste que falhe se a migration não tiver o
> `REVOKE`.

### 3.4 Funções (RPC)

**`conteudo_hora_do_slot(tipo)`** → `time`: reel `06:00`, carrossel `15:00`
(use os horários da seção 0).

**`proxima_data_livre(p_tipo text)`** → `timestamptz`:
próximo dia, a partir de hoje (se o horário de hoje ainda não passou), **sem
item do mesmo tipo** que não esteja `descartado`, no instante exato do slot em
America/Sao_Paulo. Teto de 730 dias; tipo inválido lança erro. **Um por dia de
cada tipo.**

**`puxar_fila(p_tipo text, p_a_partir_de timestamptz)`** → `int`:
quando o cliente descarta um item e escolhe "puxar a fila", os
`pendente`/`agendado` do mesmo tipo com data **depois** da vaga sobem 1 dia.
Nunca mexe em publicado.

**`reservar_conteudos_para_publicar(p_limite int default 5)`** → `SETOF`:
1. primeiro devolve para a fila quem está `publicando` há mais de 15 minutos
   (`tentativas+1`; na 3ª vira `erro`; mensagem "a publicação anterior não
   terminou — tentando de novo");
2. depois marca como `publicando` (com `publicando_desde = now()`) os
   `agendado` com `data_agendada <= now()`, em ordem de data, usando
   **`FOR UPDATE SKIP LOCKED`** — duas rodadas simultâneas nunca pegam o
   mesmo item.

### 3.5 Agendador no próprio banco (pg_cron)

```sql
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
INSERT INTO configuracoes (chave, valor)
VALUES ('cron_secret', encode(extensions.gen_random_bytes(32),'hex'))
ON CONFLICT DO NOTHING;
```
Função `disparar_publicacao()` (SECURITY DEFINER): se houver item `agendado`
vencido **ou** se for a rodada dos minutos 0–4 de cada hora (para renovar o
token), faz `net.http_get` para `<URL de produção>/api/cron/publicar` com o
header `x-cron-secret: <cron_secret>` e timeout de 290 s.
Job: `cron.schedule('publicar-conteudos', '*/5 * * * *', 'SELECT disparar_publicacao()')`.

> ⚠️ **Lição aprendida:** no original o agendador era o cron do GitHub
> Actions, que **atrasa e descarta** execuções quando a fila deles está
> cheia — um reel das 06:00 simplesmente não saiu. Agendador principal é o
> **pg_cron**. Não use GitHub Actions nem Vercel Cron como principal.

---

## 4. Login

- Supabase Auth com **e-mail e senha**. **Cadastro público desligado**
  (Auth → Providers → Email → desmarcar "Enable sign ups").
- Os usuários são criados por você no Studio (Authentication → Add user),
  com os e-mails da seção 0.
- Tela `/login` limpa: logo/nome do cliente, e-mail, senha, "Esqueci a senha"
  (link de redefinição do Supabase), mensagens de erro em português.
- Middleware: tudo exige sessão, **exceto** `/login`, `/auth/*` e
  `/api/cron/publicar` (que se autentica pelo segredo, §6).
- Botão "Sair" no menu.

---

## 5. Tela "Conexões" — conectar o Instagram (`/conexoes`)

Igual ao sistema original: **o token é colado na tela**, sem OAuth e sem
redeploy.

### 5.1 O que a tela mostra
- **Conectado:** foto, @, nome, seguidores, nº de posts, "token renovado em
  dd/mm hh:mm" e "vale até dd/mm" (quando souber); botões **Testar conexão**,
  **Trocar token** e **Desconectar**.
- **Não conectado / token recusado:** aviso em vermelho com o motivo traduzido
  (ex.: "O token venceu em 17/09. Gere um novo e cole aqui."), campo para
  colar o token e botão **Conectar**.

### 5.2 Ao clicar em Conectar (servidor)
1. Valida chamando `GET https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url,followers_count,media_count`
   com `Authorization: Bearer <token>`. Se falhar com os campos extras, tenta
   só `user_id,username` (algumas contas não liberam todos).
2. Se válido: tenta trocar por um de **60 dias**
   (`GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…`);
   se a Meta recusar porque o token tem menos de 24h, guarda o original e
   renova depois.
3. Grava em `configuracoes`: `ig_access_token`, `ig_user_id`, `ig_username`,
   `ig_token_renovado_em`, `ig_token_expira_em` (se a Meta devolver
   `expires_in`).
4. **O token nunca volta para o navegador.** A tela só recebe @, nome, foto e
   datas.

### 5.3 Passo a passo para o cliente (mostrar na própria tela, recolhível)
1. Ter conta Instagram **Profissional** (Empresa ou Criador).
2. Em developers.facebook.com → **Meus apps → Criar app** → caso de uso
   **"Gerenciar mensagens e conteúdo no Instagram"** (API do Instagram com
   login do Instagram).
3. Em **API do Instagram → Configuração da API com login do Instagram**:
   adicionar a conta do Instagram e clicar em **Gerar token**.
4. Permissões necessárias: `instagram_business_basic` e
   `instagram_business_content_publish`.
5. Copiar o token e colar aqui em **Conexões**.
6. Enquanto o app estiver em modo de desenvolvimento, a conta precisa estar
   adicionada como **testadora** do app (Funções do app → Testadores do
   Instagram) e aceitar o convite no Instagram.

### 5.4 Renovação automática
A cada rodada do cron (§6), se `ig_token_renovado_em` tiver 24h ou mais,
chama `refresh_access_token` e grava o token novo e o carimbo. Se falhar, **não
apaga o token antigo** (ele vale até vencer) e mostra o erro em Conexões.

> ⚠️ **Lição aprendida:** no original o token de 60 dias nunca era renovado,
> venceu e **tudo** parou junto. A renovação é obrigatória desde o dia 1.

---

## 6. Publicação

### 6.1 Rota `GET|POST /api/cron/publicar` (`maxDuration = 300`)
1. Confere o header `x-cron-secret` contra `configuracoes.cron_secret` com
   **`timingSafeEqual`** (tamanhos diferentes = recusa). Sem header válido → 401.
2. Renova o token se precisar (§5.4).
3. Sem token → 503 com mensagem clara.
4. `reservar_conteudos_para_publicar(5)` e publica **em sequência** (não em
   paralelo: a Meta limita publicações por hora e vídeos processando juntos
   só dobram a espera). Um `/me` por rodada para descobrir o `ig_user_id`.
5. Responde um resumo: processados, publicados, falhas, renovação.

### 6.2 Publicar um item (Content Publishing API, host `graph.instagram.com/v21.0`)

**Reel**
1. `POST /{ig-user-id}/media` com `media_type=REELS`, `video_url`, `caption`,
   `share_to_feed=true`, `cover_url` (se houver) → `container_id`
2. `GET /{container_id}?fields=status_code,status` a cada 5 s até
   `FINISHED` (teto 240 s). `ERROR`/`EXPIRED` → falha com o detalhe.
3. `POST /{ig-user-id}/media_publish` com `creation_id` → `media_id`
4. `GET /{media_id}?fields=permalink` (se falhar, segue sem permalink)

**Carrossel (2 a 10 imagens)**
1. Para cada imagem, na ordem: `POST /{ig-user-id}/media` com `image_url`,
   `is_carousel_item=true` e `alt_text` → ids dos filhos.
   **Se a Meta recusar `alt_text`, refaça sem ele** (o texto fica no banco).
2. `POST /{ig-user-id}/media` com `media_type=CAROUSEL`,
   `children=<ids separados por vírgula>`, `caption`
3. Espera `FINISHED`, publica e pega o permalink, como no reel.

Envie o corpo como `application/x-www-form-urlencoded` e o token no header
`Authorization: Bearer`, **nunca** na URL.

**Legenda:** `descricao` + `"\n\n"` + hashtags `#a #b …` (sem repetir, sem
`#` duplicado, máximo 30), cortada em 2200 caracteres.

**Antes de chamar a Meta, valide:** toda mídia é `https://`; reel com
exatamente 1 URL; carrossel com 2 a 10.

### 6.3 Resultado
- **Sucesso:** `status='publicado'`, `ig_media_id`, `ig_container_id`,
  `ig_permalink`, `publicado_em`, `conta_instagram_id`, `erro=null`,
  `publicando_desde=null`.
- **Falha:** `tentativas+1`; volta para `agendado` até a 3ª, depois `erro`.
  Grava a mensagem curta **com `access_token=***` mascarado**, até 500
  caracteres.

---

## 7. Regras de status (máquina de estados — função pura, testada)

| Status | Ações permitidas no painel |
|---|---|
| `pendente` | aprovar, descartar, editar, publicar agora |
| `agendado` | descartar, editar, publicar agora, voltar para pendente |
| `erro` | tentar de novo, descartar, editar, publicar agora |
| `publicando` | nenhuma |
| `publicado` | nenhuma (só "Ver no Instagram") |
| `descartado` | voltar para pendente |

- **Aprovar:** `agendado` + `aprovado_em`. "Aprovar todos os pendentes" num
  clique.
- **Descartar:** pergunta "puxar os próximos um dia?" → chama `puxar_fila`.
- **Tentar de novo:** zera `tentativas` e `erro`, volta para `agendado`.
- **Publicar agora:** reserva só aquele item (condição `status IN
  (pendente, agendado, erro)` no UPDATE, para não colidir com o cron) e
  publica na hora; mostra o link ao terminar.
- **Editar:** descrição (contador de caracteres e marca dos **125** que
  aparecem antes do "mais"), hashtags, alt text, palavra-chave e data/hora
  (em horário de Brasília).
- Toda ação confere no servidor se a transição é permitida (use a mesma
  função pura da tela).

---

## 8. Telas

Layout com menu lateral (Calendário, Fila, Conexões, Sair) que vira menu
inferior/hambúrguer no celular. **O cliente vai aprovar pelo celular:** tudo
precisa funcionar em 390 px de largura, sem rolagem horizontal da página.

### 8.1 `/` — Calendário
- Abas de visão: **Mês**, **Semana**, **Lista**.
- Cabeçalho: contadores por status (Pendentes, Agendados, Publicados, Com
  erro) clicáveis como filtro; navegação ‹ mês/semana › e "Hoje".
- **Mês:** grade 7 colunas; cada dia mostra miniaturas pequenas dos itens
  (reel com ícone ▶, carrossel com ícone de páginas e "1/N"), cor por status,
  e um traço discreto nas **vagas livres** do dia (reel/carrossel).
- **Semana:** 7 colunas × 2 linhas (06:00 reel, 15:00 carrossel), cards
  maiores com miniatura, horário e status.
- **Lista:** cronológica, agrupada por dia.
- Clicar num item abre o **painel de detalhe** (lateral no desktop, tela
  cheia no celular).

### 8.2 `/fila` — Fila de aprovação
- Só `pendente`, em ordem de data, com **"Aprovar todos"** no topo.
- Cada card: prévia (vídeo tocável ou carrossel deslizável), data/hora,
  descrição com o corte de 125, hashtags, nota, tema, origem; botões
  **Aprovar** (destaque), **Editar**, **Descartar**.

### 8.3 Detalhe do conteúdo
- Prévia grande estilo Instagram (moldura de celular): vídeo com capa, ou
  carrossel com setas e bolinhas.
- Legenda exatamente como vai sair (montada pela mesma função do publicador).
- Status, tentativas e **erro em linguagem humana** (ex.: token vencido →
  "Vá em Conexões e cole um token novo").
- Botões conforme a tabela da §7. Quando publicado: link "Ver no Instagram".

### 8.4 `/conexoes` — ver §5

### Detalhes de UI que importam
- Miniatura que falhar ao carregar mostra um placeholder (não ícone quebrado).
- Modais e painéis com `createPortal` para o `body` (evita ficarem presos
  dentro de containers com `transform`).
- Toasts curtos para sucesso/erro de cada ação.
- Datas sempre em `dd/mm/aaaa hh:mm` de Brasília.

---

## 9. Contrato da skill (entrada dos conteúdos)

Gere também o arquivo **`docs/contrato-skill.md`** para a skill de criação
de conteúdo, com este conteúdo adaptado (sem `tenant_id` — o sistema é de um
cliente só):

**Credenciais da skill:** `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` deste
projeto. A skill **não** tem e **não** deve ter o token do Instagram.

**Passo 1 — subir arquivos** no bucket `conteudos-instagram`, caminho
`<AAAA>/<MM>/<slug>-<hhmmss>/<arquivo>`, com `upsert: false`, e pegar a URL
pública com `getPublicUrl`.

| Tipo | Arquivos | Formato |
|---|---|---|
| Reel | `video.mp4` (+ `capa.jpg` opcional) | MP4 H.264 + AAC, 9:16 (1080×1920), 3–90 s, até 1 GB |
| Carrossel | `01.jpg` … `10.jpg` (2 a 10) | JPEG 1080×1350 (4:5) ou 1080×1080, até 8 MB cada |

**Passo 2 — data:** `rpc('proxima_data_livre', { p_tipo })`. Para vários
itens do mesmo tipo, chame antes de **cada** inserção.

**Passo 3 — inserir** em `conteudos_instagram`:
- obrigatórios: `tipo`, `status: 'pendente'`, `data_agendada` (da RPC),
  `midia_urls` (reel 1; carrossel 2–10 na ordem), `descricao` (sem hashtags)
- recomendados: `capa_url`, `hashtags` (sem `#`, até 30), `alt_text`,
  `palavra_chave`, `tema`, `origem_url`, `origem_trecho`, `nota` (0–10)
- **não preencher:** `conta_instagram_id`, `ig_*`, `erro`, `tentativas`,
  `aprovado_em`, `publicado_em`, `publicando_desde`

Inclua no contrato um exemplo completo em JavaScript (`@supabase/supabase-js`)
com `enviarReel(...)` e `enviarCarrossel(...)`, e a tabela "o que acontece
depois" (pendente → agendado → publicando → publicado / agendado de novo /
erro / descartado).

---

## 10. Testes (obrigatórios, sem rede)

Crie um script `npm test` que roda **todas** as suítes e só dá verde quando
**passou = total** (imprima `X/Y testes passaram` por suíte e um TOTAL; qualquer
crash ou X<Y é falha e sai com código 1).

Cubra no mínimo:
- máquina de estados (§7), inclusive transições proibidas;
- `normalizarHashtags`, `montarLegenda` (limite 2200, 30 tags, sem repetidas),
  corte de 125;
- `statusAposFalha` (1ª e 2ª voltam para agendado, 3ª vira erro);
- mascaramento de `access_token` na mensagem de erro;
- validação antes de publicar (https, 1 vídeo, 2–10 imagens);
- publicação de reel e carrossel com **`fetch` falso** injetado: ordem das
  chamadas, espera do `FINISHED`, refazer sem `alt_text` quando recusado,
  token no header e nunca na URL;
- renovação do token: `deveRenovar` (nunca renovou, <24h, ≥24h, data
  inválida);
- grade do mês/semana e conversões de horário de Brasília (inclusive virada
  de dia em UTC);
- invariantes por leitura de código: migration de `configuracoes` tem o
  `REVOKE`; rota do cron usa `timingSafeEqual`; nenhum `NEXT_PUBLIC_` com
  segredo; nenhuma rota devolve o token.

**Nunca** chame a Meta de verdade nos testes.

---

## 11. Armadilhas que já nos pegaram (não repetir)

1. **Cron do GitHub Actions descarta execuções** → agendador é o pg_cron.
2. **Token de 60 dias sem renovação** derrubou tudo → renovar a cada 24h.
3. **Tabela de segredos legível pela chave pública** → RLS + `REVOKE`.
4. **Item preso em `publicando`** quando a função caía no meio → devolver à
   fila depois de 15 min.
5. **Mesmo item publicado duas vezes** por rodadas paralelas → `SKIP LOCKED`.
6. **`export type { … }` dentro de arquivo `'use server'`** quebra todas as
   server actions do grafo no Turbopack, com erro mascarado → nunca faça
   isso; de preferência, exponha as ações por uma rota HTTP com lista
   fechada de operações (`/api/painel` recebe `{op, args}`, nome fora da lista
   = 404) e um cliente `op()` com as mesmas assinaturas (`typeof import`).
7. **Leitura do Supabase corta em 1000 linhas** → pagine com `.range()`.
8. **`position: fixed` preso dentro de um container com `transform`** →
   modais via `createPortal(document.body)`.
9. **`alt_text` recusado em alguns tipos de mídia** → refazer sem o campo.
10. **Horário em UTC na tela** → tudo em America/Sao_Paulo, inclusive a
    regra "o slot de hoje já passou".

---

## 12. Ordem de construção (um PR por etapa)

1. Projeto Next + Tailwind + Supabase client/server/admin + middleware + login.
2. Migrations (§3) aplicadas + testes de invariantes de segurança.
3. Regras puras (estados, legenda, datas, grades) + testes.
4. Cliente da Instagram API (publicar, status, `/me`, renovar) + testes com
   fetch falso.
5. Tela Conexões (colar token, validar, mostrar conta, renovar).
6. Rota do cron + pg_cron + "Publicar agora".
7. Calendário (mês/semana/lista), Fila e Detalhe — conferidos em 1440 px e
   390 px.
8. `docs/contrato-skill.md` e um teste de ponta a ponta manual: inserir um
   item pela service role, aprovar no celular, "Publicar agora".

Em cada etapa: rode `npm test` (verde só com passou = total), `tsc --noEmit`,
lint e `next build`. Relate com honestidade o que passou e o que não passou.

---

## 13. Critérios de pronto

- [ ] Login funciona; sem sessão, nada abre (exceto login e cron).
- [ ] Colar token em Conexões mostra @, foto e validade; token nunca aparece
      no navegador nem em log.
- [ ] Skill insere reel e carrossel seguindo o contrato e eles aparecem como
      pendentes, na próxima vaga livre.
- [ ] Aprovar pelo celular agenda; no horário, o pg_cron publica sozinho em
      até ~5 minutos; o card vira "Publicado" com link.
- [ ] Falha mostra o motivo em português e tenta até 3 vezes.
- [ ] Descartar com "puxar a fila" sobe os próximos um dia.
- [ ] Token renova sozinho a cada 24h (carimbo visível em Conexões).
- [ ] `npm test`, `tsc`, lint e build verdes.
- [ ] README curto com: como criar o projeto Supabase, aplicar as migrations,
      ajustar a URL de produção na função do pg_cron, criar usuários e
      conectar o Instagram.
