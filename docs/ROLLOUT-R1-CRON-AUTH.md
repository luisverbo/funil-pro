# R1 — Proteger `/api/queue/process`

> **Nada aqui foi executado.** Este documento é o roteiro operacional.
> A ordem das etapas não é negociável: inverter derruba filas em produção.

## O problema

`/api/queue/process` aceita `GET` e `POST` **sem autenticação alguma**. Está na
allowlist `PUBLIC_PREFIXES` do `proxy.ts`, ou seja, nem o middleware o protege.

Qualquer pessoa na internet pode disparar o processamento da fila.

O endpoint tem **dois chamadores**, e os dois precisam continuar funcionando:

| Chamador | Frequência | Onde fica |
|---|---|---|
| Crontab da VPS Hostinger | ~1 min | fora do repositório |
| GitHub Actions | ~5 min | `.github/workflows/deploy.yml` |

E carrega, no mesmo processamento:

- filas dos funis (`queue_jobs`)
- sequências de DM do Instagram
- lembretes de reunião
- follow-ups de leads parados

Derrubar esse endpoint derruba os quatro de uma vez.

## Como funciona a proteção

Duas variáveis de ambiente:

| Variável | Efeito |
|---|---|
| `CRON_SECRET` | o segredo esperado |
| `CRON_AUTH_ENFORCE` | `true` exige o segredo; **qualquer outro valor ou ausente = modo de compatibilidade** |

Autenticação **só** por header:

```
Authorization: Bearer <CRON_SECRET>
```

Nunca por query string — `?key=` e `?token=` aparecem em log de servidor,
histórico de proxy, header `Referer` e painel de analytics.

### Matriz de comportamento

| `CRON_AUTH_ENFORCE` | Credencial | Resultado | Log |
|---|---|---|---|
| off | válida | processa | `authenticated` |
| off | ausente | **processa** | `legacy_missing` (warn) |
| off | inválida | **processa** | `legacy_invalid` (warn) |
| on | válida | processa | `authenticated` |
| on | ausente | **401** | `legacy_missing` (warn) |
| on | inválida | **401** | `legacy_invalid` (warn) |
| on | `CRON_SECRET` não configurado | **401** | erro de configuração |

O 401 é **idêntico** nos dois casos (`{"error":"unauthorized"}`) — não revela se
a credencial faltou ou estava errada.

### O que vai para o log

Só metadados: `timestamp`, método, User-Agent, origem, modo, se o enforcement
está ligado e o status HTTP.

**Nunca**: o segredo, seu hash, um prefixo dele, seu comprimento ou o valor
recebido no header. Há teste automatizado verificando cada um desses itens.

### Comparação

`crypto.timingSafeEqual` sobre SHA-256 dos dois valores. O hash existe porque
`timingSafeEqual` exige buffers do mesmo tamanho — comparar direto lançaria
exceção com tamanhos diferentes, vazando o comprimento do segredo.

---

## Rollout

### Etapa 1 — criar e cadastrar o segredo (nada muda em produção)

Gere um segredo forte:

```bash
openssl rand -base64 48 | tr -d '\n'
```

Cadastre **o mesmo valor** em dois lugares:

**Vercel** → Project Settings → Environment Variables

| Nome | Valor | Ambientes |
|---|---|---|
| `CRON_SECRET` | o valor gerado | Production, Preview, Development |
| `CRON_AUTH_ENFORCE` | `false` | Production |

**GitHub** → Settings → Secrets and variables → Actions → New repository secret

| Nome | Valor |
|---|---|
| `CRON_SECRET` | **o mesmo valor** |

> Guarde o segredo no seu gerenciador de senhas. Depois de salvo, nem a Vercel
> nem o GitHub mostram o valor de novo.

Nesta etapa **nada muda**: o código em produção ainda é o antigo.

### Etapa 2 — publicar o modo de compatibilidade

Merge deste PR e deploy. Com `CRON_AUTH_ENFORCE=false`:

- o GitHub Actions passa a enviar o header (já está neste PR)
- o crontab da VPS **ainda não envia** — e continua funcionando

Nenhuma chamada é recusada. Nada quebra.

### Etapa 3 — atualizar o crontab da VPS

Acesse a VPS e edite:

```bash
crontab -e
```

Localize a linha atual, algo como:

```cron
* * * * * curl -s -X POST https://funil-pro.vercel.app/api/queue/process
```

Substitua por — **mesma URL, mesma frequência, mesmo método**, só o header a mais:

```cron
CRON_SECRET=COLE_AQUI_O_SEGREDO
* * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://funil-pro.vercel.app/api/queue/process
```

> O `crontab` não expande `$VAR` dentro da linha de comando da forma esperada em
> todas as implementações. Se o header não chegar, use um script:
>
> ```bash
> # /root/queue-process.sh  (chmod 600 — contém o segredo)
> #!/bin/sh
> curl -s -X POST -H "Authorization: Bearer SEGREDO_AQUI" \
>   https://funil-pro.vercel.app/api/queue/process
> ```
> ```cron
> * * * * * /root/queue-process.sh
> ```

### Etapa 4 — confirmar que os dois chamadores autenticam

Antes de exigir, **observe**. Nos logs da Vercel, filtre por `[cron-auth]`.

Você precisa ver, dos **dois** chamadores:

```json
[cron-auth] {"at":"...","method":"POST","ua":"curl/...","mode":"authenticated","enforced":false,"status":200}
```

**Só avance quando não houver mais nenhum `legacy_missing` ou `legacy_invalid`.**
Deixe rodando pelo menos 30 minutos — o GitHub Actions só chama a cada 5.

Se ainda aparecer `legacy_*`, há um chamador que você não atualizou. Descubra
qual pelo User-Agent antes de seguir.

### Etapa 5 — ligar o enforcement

Na Vercel, mude `CRON_AUTH_ENFORCE` para `true` e faça redeploy
(variável de ambiente só vale a partir do próximo deploy).

Confirme, nesta ordem:

1. as chamadas autenticadas continuam com `status: 200`
2. uma chamada sem credencial recebe 401:
   ```bash
   curl -i -X POST https://funil-pro.vercel.app/api/queue/process
   # HTTP/2 401   {"error":"unauthorized"}
   ```
3. um job de funil ainda avança
4. uma sequência de DM do Instagram ainda avança
5. um lembrete de reunião ainda dispara
6. um follow-up ainda dispara

---

## Rollback

Se qualquer coisa parar de funcionar:

1. Na Vercel, `CRON_AUTH_ENFORCE` = `false`
2. Redeploy

Pronto — a compatibilidade volta na hora e todos os chamadores voltam a passar.

**Não remova `CRON_SECRET`** e **não tire os headers** dos dois chamadores: eles
são inofensivos no modo de compatibilidade, e mantê-los deixa o caminho pronto
para tentar de novo sem refazer as etapas 1 a 3.

---

## Fora do escopo deste PR

`/api/agents/meetings/remind` também está em `PUBLIC_PREFIXES` sem autenticação.
Mesma classe de problema, mesma solução — mas é outra mudança, em outro PR.
