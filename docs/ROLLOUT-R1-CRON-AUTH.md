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

Gere um segredo forte **exclusivo de produção**:

```bash
openssl rand -base64 48 | tr -d '\n'
```

**Vercel** → Project Settings → Environment Variables

| Nome | Valor | Ambientes |
|---|---|---|
| `CRON_SECRET` | o valor gerado | **Production apenas** |
| `CRON_AUTH_ENFORCE` | `false` | **Production apenas** |

**GitHub** → Settings → Secrets and variables → Actions → New repository secret

| Nome | Valor |
|---|---|
| `CRON_SECRET` | **o mesmo segredo de produção** |

O GitHub recebe o segredo de produção porque o workflow chama a URL de
produção. É o mesmo destino, logo é o mesmo segredo.

#### Um segredo por ambiente — não reutilize

**Não marque Preview nem Development ao cadastrar `CRON_SECRET` na Vercel.**

Preview e Development são ambientes de menor confiança: builds de branch,
deploys de teste, variáveis puxadas para a máquina de quem desenvolve
(`vercel env pull`). Copiar o segredo de produção para lá significa que
comprometer qualquer um deles compromete produção.

Se um dia Preview ou Development precisarem desta autenticação:

- gere um segredo **novo e diferente** para cada ambiente
- cadastre cada um **somente** no seu próprio ambiente
- **nunca** copie o segredo de produção para um ambiente de menor confiança

Enquanto `CRON_SECRET` não existir em Preview/Development, o endpoint nesses
ambientes fica em modo de compatibilidade (`CRON_AUTH_ENFORCE` também não está
definido lá) e continua respondendo normalmente.

> Guarde o segredo no seu gerenciador de senhas. Depois de salvo, nem a Vercel
> nem o GitHub mostram o valor de novo.

Nesta etapa **nada muda**: o código em produção ainda é o antigo.

### Etapa 2 — publicar o modo de compatibilidade

Merge deste PR e deploy. Com `CRON_AUTH_ENFORCE=false`:

- o GitHub Actions passa a enviar o header (já está neste PR)
- o crontab da VPS **ainda não envia** — e continua funcionando

Nenhuma chamada é recusada. Nada quebra.

### Etapa 3 — atualizar o crontab da VPS

> **O segredo nunca entra na linha de comando.**
>
> Argumentos de processo são públicos na máquina: qualquer usuário roda
> `ps aux` (ou lê `/proc/<pid>/cmdline`) e vê o valor enquanto o `curl`
> executa. Isso vale para o segredo escrito direto no `crontab`, passado em
> `-H "Authorization: ..."`, ou expandido de uma variável dentro de um script —
> `chmod 600` protege o **arquivo**, não os argumentos do processo que ele gera.
>
> Por isso o segredo fica num **arquivo de configuração do curl**, que o `curl`
> lê sozinho. Ele nunca aparece na linha de comando.

**1. Faça backup da linha atual do crontab** — antes de qualquer mudança:

```bash
crontab -l > ~/crontab.backup.$(date +%Y%m%d-%H%M%S)
```

**2. Confirme o caminho real do curl** (o `cron` roda com `PATH` mínimo, então
o caminho absoluto é obrigatório):

```bash
command -v curl
```

Use na etapa 4 exatamente o que este comando devolver — normalmente
`/usr/bin/curl`, mas pode diferir.

**3. Crie o arquivo de configuração:**

```bash
touch /root/.queue-process.curl.conf
chmod 600 /root/.queue-process.curl.conf
```

Edite (`nano /root/.queue-process.curl.conf`) e coloque:

```
url = "https://funil-pro.vercel.app/api/queue/process"
request = "POST"
silent
show-error
fail
header = "Authorization: Bearer COLE_AQUI_O_SEGREDO"
```

Mesma URL, mesmo método (`POST`) que hoje. O `chmod 600` é criado **antes** de
o segredo ser escrito, para que ele nunca exista com permissão aberta.

**4. Teste manualmente antes de mexer no crontab:**

```bash
/usr/bin/curl --config /root/.queue-process.curl.conf -o /dev/null -w '%{http_code}\n'
```

**Só siga se retornar `200`.** Se vier outra coisa, corrija o arquivo — não
altere o crontab enquanto não estiver 200.

**5. Só então atualize o crontab** (`crontab -e`), mantendo a **mesma
frequência** da linha atual:

```cron
* * * * * /usr/bin/curl --config /root/.queue-process.curl.conf
```

#### Regras sobre este arquivo

- **Nunca** exiba, imprima ou registre o conteúdo dele — nada de `cat`,
  `echo`, `set -x` ou redirecionar para log.
- **Nunca** envie o segredo em chat, Pull Request, commit, issue ou
  documentação. Nem parcialmente.
- Não versione o arquivo. Ele vive só na VPS.
- Para rotacionar o segredo: atualize a Vercel, depois este arquivo, depois o
  GitHub Secret. Enquanto os três não estiverem iguais, mantenha
  `CRON_AUTH_ENFORCE=false`.

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

Na Vercel, mude `CRON_AUTH_ENFORCE` para `true` **em Production** e faça
redeploy (variável de ambiente só vale a partir do próximo deploy).

Confirme, nesta ordem:

1. as chamadas autenticadas continuam com `status: 200` — na VPS:
   ```bash
   /usr/bin/curl --config /root/.queue-process.curl.conf -o /dev/null -w '%{http_code}\n'
   # 200
   ```
2. uma chamada sem credencial recebe 401 (este comando não usa segredo nenhum):
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

1. Na Vercel, `CRON_AUTH_ENFORCE` = `false` (em Production)
2. Redeploy

Pronto — a compatibilidade volta na hora e todos os chamadores voltam a passar.

**Não remova `CRON_SECRET` da Vercel nem do GitHub**, e **não desfaça** o
arquivo `/root/.queue-process.curl.conf` da VPS nem o header do workflow. Os
três são inofensivos no modo de compatibilidade, e mantê-los deixa o caminho
pronto para tentar de novo sem refazer as etapas 1 a 3.

Se precisar reverter também o crontab, use o backup feito na etapa 3:

```bash
crontab ~/crontab.backup.<data>
```

---

## Fora do escopo deste PR

`/api/agents/meetings/remind` também está em `PUBLIC_PREFIXES` sem autenticação.
Mesma classe de problema, mesma solução — mas é outra mudança, em outro PR.
