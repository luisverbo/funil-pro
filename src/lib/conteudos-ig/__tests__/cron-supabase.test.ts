// ============================================================================
// Agendador dos conteúdos — pg_cron no Supabase (principal) + GitHub (reserva)
// ----------------------------------------------------------------------------
// Relato do dono (24/09): "não postou o vídeo de hoje programado para as 6".
// CAUSA RAIZ: o cron agendado do GitHub Actions ("a cada 10 min") rodou só 4
// vezes em 9 horas — o GitHub atrasa e descarta execuções agendadas sem aviso.
// A última foi 03:44 (Brasília); nenhuma depois. O reel ficou 'agendado',
// sem erro, esperando uma rodada que não veio.
//
// Aqui se tranca:
//   1. o banco dispara a rota a cada 5 min (pg_cron + pg_net), com segredo
//      gerado no próprio banco — sem variável nova
//   2. a rota aceita esse segredo (comparação em tempo constante) OU o
//      Bearer CRON_SECRET de sempre
//   3. item preso em 'publicando' (função caiu no meio) volta à fila em 15 min
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const sql = ler('supabase/migrations/20260924000000_cron_conteudos_pg_cron.sql')
const rota = ler('src/app/api/cron/publicar-instagram/route.ts')

const tests: Record<string, () => void> = {
  'pg_cron agenda a cada 5 minutos e chama a rota com o header do segredo': () => {
    assert.ok(sql.includes('CREATE EXTENSION IF NOT EXISTS pg_cron'))
    assert.ok(sql.includes('CREATE EXTENSION IF NOT EXISTS pg_net'))
    assert.ok(sql.includes("cron.schedule('publicar-conteudos-instagram', '*/5 * * * *'"))
    assert.ok(sql.includes("url := 'https://funil-pro.vercel.app/api/cron/publicar-instagram'"))
    assert.ok(sql.includes("jsonb_build_object('x-funilpro-cron'"))
    assert.ok(sql.includes("cron.unschedule(jobid) FROM cron.job WHERE jobname = 'publicar-conteudos-instagram'"), 'idempotente')
  },
  'segredo nasce no banco, aleatório, sem variável de ambiente': () => {
    assert.ok(sql.includes("('conteudos_cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))"))
    assert.ok(sql.includes('ON CONFLICT (key) DO NOTHING'), 'reaplicar não troca o segredo')
  },
  'só chama quando há item vencido (ou 1x por hora para renovar o token)': () => {
    assert.ok(sql.includes("WHERE status = 'agendado' AND data_agendada <= now()"))
    assert.ok(sql.includes('extract(minute FROM now()) >= 5'))
  },
  'rota aceita o segredo do banco em tempo constante, OU o CRON_SECRET': () => {
    assert.ok(rota.includes("request.headers.get('x-funilpro-cron')"))
    assert.ok(rota.includes("eq('key', 'conteudos_cron_secret')"))
    assert.ok(rota.includes('timingSafeEqual('), 'comparação em tempo constante')
    assert.ok(rota.includes('esperado.length !== recebido.length'), 'timingSafeEqual lança com tamanhos diferentes')
    assert.ok(rota.includes('if (!doBanco)') && rota.includes('evaluateCronAuth(request)'), 'o caminho antigo continua valendo')
    assert.ok(rota.includes('if (!esperado'), 'segredo vazio no banco nunca libera')
  },
  'item preso em publicando volta à fila depois de 15 minutos, contando tentativa': () => {
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS publicando_desde timestamptz'))
    assert.ok(sql.includes("publicando_desde < now() - interval '15 minutes'"))
    assert.ok(sql.includes("CASE WHEN tentativas + 1 >= 3 THEN 'erro' ELSE 'agendado' END"))
    assert.ok(sql.includes("SET status = 'publicando', publicando_desde = now()"))
    const pub = ler('src/lib/conteudos-ig/publicador.ts')
    assert.equal((pub.match(/publicando_desde: null/g) ?? []).length, 2, 'sucesso e falha limpam o carimbo')
    assert.ok(ler('src/app/actions/conteudos-ig.ts').includes("status: 'publicando', erro: null, publicando_desde:"), 'publicar agora também carimba')
  },
  'GitHub Actions continua como reserva — a reserva atômica impede post duplicado': () => {
    assert.ok(ler('.github/workflows/publicar-instagram.yml').includes('/api/cron/publicar-instagram'))
    assert.ok(sql.includes('FOR UPDATE SKIP LOCKED'))
  },
}

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
