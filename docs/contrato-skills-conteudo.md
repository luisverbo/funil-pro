# Contrato — skills de conteúdo → FunilPro (`/conteudos`)

Este documento diz **exatamente** como uma skill externa (rodando no PC do dono)
entrega um Reel ou um carrossel para o painel de aprovação do FunilPro. A skill
faz três coisas, nesta ordem:

1. sobe os arquivos no bucket `conteudos-instagram`
2. pede a próxima data livre à RPC `proxima_data_livre`
3. insere uma linha em `conteudos_instagram` com `status: 'pendente'`

O FunilPro faz o resto: exibe, deixa aprovar pelo celular e publica no horário.
A skill **não** precisa do token do Instagram e **não** deve ter esse token.

## Credenciais que a skill usa

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | `https://hcadyqktfowfkxsbogmj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | a service role do projeto (Studio → Settings → API). Nunca commitar. |
| `FUNILPRO_TENANT_ID` | `7fb20044-ef4e-407a-8d20-f83e8b7b1029` (espaço "Lc Marketing Digital") |

A service role passa por cima do RLS. Por isso o `tenant_id` **tem que** ir em
toda inserção — é ele que faz o conteúdo aparecer no painel certo.

## 1. Arquivos no bucket `conteudos-instagram`

Bucket público (a Meta baixa o arquivo pela URL na hora de publicar).

Caminho: `<tenant_id>/<AAAA>/<MM>/<slug>-<hhmmss>/<arquivo>`

| Tipo | Arquivos | Formato |
|---|---|---|
| Reel | `video.mp4` (obrigatório), `capa.jpg` (opcional) | MP4 H.264 + AAC, vertical 9:16 (1080×1920), 3 s a 90 s, até 1 GB |
| Carrossel | `01.jpg`, `02.jpg`, … `10.jpg` (2 a 10) | JPEG, 1080×1350 (4:5) ou 1080×1080, até 8 MB cada |

Use `upsert: false` para nunca sobrescrever um post já aprovado, e pegue a URL
com `getPublicUrl`. Guarde as URLs **na ordem** em que os slides devem aparecer.

## 2. Data: RPC `proxima_data_livre(p_tenant_id uuid, p_tipo text)`

Devolve `timestamptz` do próximo slot livre, em Brasília:

- `reel` → próximo dia sem reel, às **06:00**
- `carrossel` → próximo dia sem carrossel, às **15:00**

Se o horário de hoje já passou, começa amanhã. Itens `descartado` não ocupam
vaga. O painel usa a mesma função, então skill e tela nunca discordam.

Se a skill for inserir **vários** itens do mesmo tipo de uma vez, insira um por
um chamando a RPC antes de cada inserção (a segunda chamada já vê a primeira
inserção e devolve o dia seguinte).

## 3. Inserção em `conteudos_instagram`

### Campos obrigatórios

| Campo | Tipo | Regra |
|---|---|---|
| `tenant_id` | uuid | `FUNILPRO_TENANT_ID` |
| `tipo` | `'reel'` \| `'carrossel'` | |
| `status` | `'pendente'` | sempre. O dono aprova no painel. |
| `data_agendada` | timestamptz | o retorno da RPC |
| `midia_urls` | text[] | reel: exatamente 1 URL (o vídeo). carrossel: 2 a 10 URLs, na ordem |
| `descricao` | text | texto do post (sem hashtags), até 2200 caracteres com as hashtags. Os **primeiros 125** aparecem antes do "mais" |

### Campos recomendados

| Campo | Tipo | Observação |
|---|---|---|
| `capa_url` | text | capa do reel |
| `hashtags` | text[] | sem `#`, até 30. O FunilPro monta a legenda: `descricao + "\n\n" + "#a #b …"` |
| `alt_text` | text | acessibilidade; enviado nas imagens do carrossel, guardado no reel |
| `palavra_chave` | text | foco de SEO |
| `tema`, `origem_url`, `origem_trecho`, `nota` (0–10) | | metadados da curadoria, visíveis no card |

### Não preencher

`conta_instagram_id`, `ig_container_id`, `ig_media_id`, `ig_permalink`, `erro`,
`tentativas`, `aprovado_em`, `publicado_em` — o FunilPro cuida. O id da conta é
descoberto com o token da plataforma na hora de publicar.

### Regras que o banco aplica (a inserção falha se violar)

- reel com `midia_urls` diferente de 1 item, ou carrossel fora de 2–10
- `tipo` ou `status` fora dos valores acima
- `nota` fora de 0–10

## Exemplo completo (JavaScript, `@supabase/supabase-js`)

```js
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const TENANT_ID = process.env.FUNILPRO_TENANT_ID
const BUCKET = 'conteudos-instagram'

function pastaDoPost(slug) {
  const d = new Date()
  const hhmmss = d.toISOString().slice(11, 19).replace(/:/g, '')
  return `${TENANT_ID}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${slug}-${hhmmss}`
}

async function subir(caminho, arquivoLocal, contentType) {
  const { error } = await supabase.storage.from(BUCKET)
    .upload(caminho, await readFile(arquivoLocal), { contentType, upsert: false })
  if (error) throw new Error(`upload ${caminho}: ${error.message}`)
  return supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl
}

async function proximaData(tipo) {
  const { data, error } = await supabase.rpc('proxima_data_livre', { p_tenant_id: TENANT_ID, p_tipo: tipo })
  if (error) throw new Error(`proxima_data_livre: ${error.message}`)
  return data // ISO timestamptz
}

// ── Reel ────────────────────────────────────────────────────────────────────
export async function enviarReel({ slug, videoMp4, capaJpg, descricao, hashtags, altText, palavraChave, tema, origemUrl, origemTrecho, nota }) {
  const pasta = pastaDoPost(slug)
  const videoUrl = await subir(`${pasta}/video.mp4`, videoMp4, 'video/mp4')
  const capaUrl = capaJpg ? await subir(`${pasta}/capa.jpg`, capaJpg, 'image/jpeg') : null

  const { data, error } = await supabase.from('conteudos_instagram').insert({
    tenant_id: TENANT_ID,
    tipo: 'reel',
    status: 'pendente',
    data_agendada: await proximaData('reel'),
    midia_urls: [videoUrl],
    capa_url: capaUrl,
    descricao,
    hashtags,            // ['marketingdigital', 'vendas'] — sem '#'
    alt_text: altText ?? null,
    palavra_chave: palavraChave ?? null,
    tema: tema ?? null,
    origem_url: origemUrl ?? null,
    origem_trecho: origemTrecho ?? null,
    nota: nota ?? null,
  }).select('id, data_agendada').single()
  if (error) throw new Error(`insert reel: ${error.message}`)
  return data
}

// ── Carrossel ───────────────────────────────────────────────────────────────
export async function enviarCarrossel({ slug, imagensJpg, descricao, hashtags, altText, palavraChave, tema, origemUrl, origemTrecho, nota }) {
  if (imagensJpg.length < 2 || imagensJpg.length > 10) throw new Error('carrossel: 2 a 10 imagens')
  const pasta = pastaDoPost(slug)
  const urls = []
  for (let i = 0; i < imagensJpg.length; i++) {
    urls.push(await subir(`${pasta}/${String(i + 1).padStart(2, '0')}.jpg`, imagensJpg[i], 'image/jpeg'))
  }

  const { data, error } = await supabase.from('conteudos_instagram').insert({
    tenant_id: TENANT_ID,
    tipo: 'carrossel',
    status: 'pendente',
    data_agendada: await proximaData('carrossel'),
    midia_urls: urls,    // na ordem dos slides
    descricao,
    hashtags,
    alt_text: altText ?? null,
    palavra_chave: palavraChave ?? null,
    tema: tema ?? null,
    origem_url: origemUrl ?? null,
    origem_trecho: origemTrecho ?? null,
    nota: nota ?? null,
  }).select('id, data_agendada').single()
  if (error) throw new Error(`insert carrossel: ${error.message}`)
  return data
}
```

## O que acontece depois

| Status | Quem muda | Quando |
|---|---|---|
| `pendente` | skill | ao inserir |
| `agendado` | dono, no painel | ao aprovar (ou "Aprovar todos") |
| `publicando` | cron | reserva atômica quando `data_agendada <= agora` |
| `publicado` | cron | Meta devolveu `ig_media_id` e `ig_permalink` |
| `agendado` (de novo) | cron | falhou; `tentativas` + 1, `erro` preenchido, até 3 |
| `erro` | cron | 3 falhas. O dono vê a mensagem e pode "Tentar de novo" |
| `descartado` | dono | sai da fila; opção de puxar os próximos um dia |

O cron roda a cada 10 minutos (GitHub Actions), então o post sai em até ~10
minutos depois do slot. Para conferir a integração sem esperar, o painel tem
"Publicar agora (teste)" em cada item.

## Checklist rápido para a skill

- [ ] `tenant_id` em toda inserção
- [ ] `status: 'pendente'`
- [ ] `data_agendada` veio da RPC (não inventar horário)
- [ ] URLs do bucket público, `https://`
- [ ] reel: 1 URL; carrossel: 2–10 URLs na ordem
- [ ] `hashtags` sem `#`
- [ ] nenhum token do Instagram na skill
