// ============================================================================
// Conteúdos Instagram — regras, publicador e costuras
// ----------------------------------------------------------------------------
// Pedido do dono: painel de aprovação + publicação automática de Reels e
// carrosséis produzidos fora do FunilPro. Aqui se tranca:
//   1. regras puras: transições, legenda, 125 caracteres, slots, fuso
//   2. o publicador Graph API com fetch FALSO (reel, carrossel, alt_text
//      recusado, container em ERROR, 3 tentativas)
//   3. costuras: migration (RLS, bucket, RPCs), rota do cron com
//      evaluateCronAuth, proxy, workflow sem `uses:`, despachante, sidebar,
//      token nunca no cliente, documento do contrato
// Nenhuma chamada de rede real.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  acoesPermitidas, podeFazer, normalizarHashtags, montarLegenda, recorteVisivel, CORTE_VISIVEL,
  partesEmBrasilia, diaEmBrasilia, paraInputLocal, deInputLocalParaIso, inicioDaSemana, gradeDaSemana,
  statusAposFalha, resumirErro, validarParaPublicar, HORA_DO_SLOT, type Conteudo,
} from '@/lib/conteudos-ig/regras'
import {
  publicarReel, publicarCarrossel, ehParametroRecusado, idDaContaConectada, type FetchLike,
} from '@/lib/instagram/publicar'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

function item(p: Partial<Conteudo> = {}): Conteudo {
  return {
    id: 'c1', tenant_id: 't1', conta_instagram_id: null, tipo: 'reel', status: 'pendente',
    data_agendada: '2026-09-24T09:00:00.000Z', midia_urls: ['https://x/v.mp4'], capa_url: null,
    descricao: 'oi', alt_text: null, hashtags: [], palavra_chave: null, tema: null, origem_url: null,
    origem_trecho: null, nota: null, ig_container_id: null, ig_media_id: null, ig_permalink: null,
    erro: null, tentativas: 0, created_at: '2026-09-23T00:00:00.000Z', aprovado_em: null, publicado_em: null, ...p,
  }
}

/** Fetch falso: grava as chamadas e responde por rota. */
function fetchFalso(roteiro: (url: string, body: URLSearchParams | null, n: number) => { status?: number; json: unknown }) {
  const chamadas: { url: string; body: URLSearchParams | null }[] = []
  const f: FetchLike = async (url, init) => {
    const body = typeof init?.body === 'string' ? new URLSearchParams(init.body) : null
    chamadas.push({ url, body })
    const r = roteiro(url, body, chamadas.length)
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { f, chamadas }
}

const tests: Record<string, () => void | Promise<void>> = {
  // ── Regras ────────────────────────────────────────────────────────────────
  'transições: pendente aprova; publicado/publicando não mexe; descartado só volta': () => {
    assert.ok(podeFazer('pendente', 'aprovar'))
    assert.ok(podeFazer('agendado', 'descartar'))
    assert.ok(podeFazer('erro', 'tentar_de_novo'))
    assert.deepEqual(acoesPermitidas('publicando'), [])
    assert.deepEqual(acoesPermitidas('publicado'), [])
    assert.deepEqual(acoesPermitidas('descartado'), ['voltar_para_pendente'])
    assert.ok(!podeFazer('agendado', 'aprovar'), 'aprovar duas vezes não existe')
  },
  'hashtags: tira #, espaços e repetidas; teto de 30': () => {
    assert.deepEqual(normalizarHashtags(['#Marketing', 'marketing', ' vendas ', '#', 'a b']), ['Marketing', 'vendas', 'ab'])
    assert.equal(normalizarHashtags(Array.from({ length: 40 }, (_, i) => `t${i}`)).length, 30)
  },
  'legenda = descrição + duas quebras + hashtags; sem hashtag não sobra quebra': () => {
    assert.equal(montarLegenda('Texto', ['a', 'b']), 'Texto\n\n#a #b')
    assert.equal(montarLegenda('Texto', []), 'Texto')
    assert.equal(montarLegenda('x'.repeat(3000), []).length, 2200, 'limite da API')
  },
  'recorte dos 125 caracteres — o que aparece antes do "mais"': () => {
    const curta = recorteVisivel('curta')
    assert.equal(curta.visivel, 'curta'); assert.equal(curta.resto, '')
    const longa = recorteVisivel('a'.repeat(200))
    assert.equal(longa.visivel.length, CORTE_VISIVEL); assert.equal(longa.resto.length, 75)
  },
  'fuso: 09:00Z é 06:00 em Brasília; input local volta ao mesmo ISO': () => {
    const p = partesEmBrasilia('2026-09-24T09:00:00.000Z')
    assert.equal(p.hora, 6); assert.equal(p.minuto, 0); assert.equal(p.dia, 24)
    assert.equal(diaEmBrasilia('2026-09-24T02:30:00.000Z'), '2026-09-23', '02:30Z ainda é dia 23 no Brasil')
    assert.equal(paraInputLocal('2026-09-24T18:00:00.000Z'), '2026-09-24T15:00')
    assert.equal(deInputLocalParaIso('2026-09-24T15:00'), '2026-09-24T18:00:00.000Z')
    assert.equal(deInputLocalParaIso('lixo'), null)
  },
  'slots: reel 06:00, carrossel 15:00 — mesma régua do SQL': () => {
    assert.equal(HORA_DO_SLOT.reel.hora, 6)
    assert.equal(HORA_DO_SLOT.carrossel.hora, 15)
    const sql = ler('supabase/migrations/20260923000000_conteudos_instagram.sql')
    assert.ok(sql.includes("WHEN 'reel' THEN time '06:00' ELSE time '15:00'"))
  },
  'grade da semana: 14 slots, descartado não ocupa vaga, começa na segunda': () => {
    assert.equal(inicioDaSemana('2026-09-24T12:00:00.000Z'), '2026-09-21', 'quinta 24 → segunda 21')
    const itens = [
      item({ id: 'a', tipo: 'reel', data_agendada: '2026-09-22T09:00:00.000Z', status: 'agendado' }),
      item({ id: 'b', tipo: 'reel', data_agendada: '2026-09-23T09:00:00.000Z', status: 'descartado' }),
    ]
    const g = gradeDaSemana(itens, '2026-09-21')
    assert.equal(g.length, 14)
    assert.equal(g.find(s => s.dia === '2026-09-22' && s.tipo === 'reel')?.conteudo?.id, 'a')
    assert.equal(g.find(s => s.dia === '2026-09-23' && s.tipo === 'reel')?.conteudo, null, 'descartado deixa a vaga livre')
  },
  'falha: volta para agendado até a 3ª tentativa, depois erro; erro nunca leva token': () => {
    assert.deepEqual(statusAposFalha(0), { status: 'agendado', tentativas: 1 })
    assert.deepEqual(statusAposFalha(1), { status: 'agendado', tentativas: 2 })
    assert.deepEqual(statusAposFalha(2), { status: 'erro', tentativas: 3 })
    assert.equal(resumirErro(new Error('falhou ?access_token=ABC123&x=1')), 'falhou ?access_token=***&x=1')
    assert.equal(resumirErro('x'.repeat(900)).length, 500)
  },
  'validação: só https, reel 1 vídeo, carrossel 2–10 imagens': () => {
    assert.equal(validarParaPublicar({ tipo: 'reel', midia_urls: ['https://a/v.mp4'], descricao: '' }), null)
    assert.ok(validarParaPublicar({ tipo: 'reel', midia_urls: ['http://a/v.mp4'], descricao: '' }))
    assert.ok(validarParaPublicar({ tipo: 'reel', midia_urls: ['https://a', 'https://b'], descricao: '' }))
    assert.ok(validarParaPublicar({ tipo: 'carrossel', midia_urls: ['https://a'], descricao: '' }))
    assert.equal(validarParaPublicar({ tipo: 'carrossel', midia_urls: ['https://a', 'https://b'], descricao: '' }), null)
  },

  // ── Publicador (fetch falso) ──────────────────────────────────────────────
  'reel: container REELS → espera FINISHED → media_publish → permalink': async () => {
    const { f, chamadas } = fetchFalso((url, body, n) => {
      if (url.endsWith('/123/media') && body?.get('media_type') === 'REELS') return { json: { id: 'cont1' } }
      if (url.startsWith('https://graph.instagram.com/v21.0/cont1?')) return { json: { status_code: n < 3 ? 'IN_PROGRESS' : 'FINISHED' } }
      if (url.endsWith('/123/media_publish')) return { json: { id: 'media9' } }
      if (url.startsWith('https://graph.instagram.com/v21.0/media9?')) return { json: { permalink: 'https://instagram.com/p/x' } }
      return { status: 500, json: { error: { message: `rota inesperada ${url}` } } }
    })
    const r = await publicarReel({ token: 'T', igUserId: '123', fetchImpl: f, intervaloMs: 1 }, { videoUrl: 'https://a/v.mp4', caption: 'oi', coverUrl: 'https://a/c.jpg' })
    assert.equal(r.mediaId, 'media9'); assert.equal(r.permalink, 'https://instagram.com/p/x'); assert.equal(r.containerId, 'cont1')
    const cria = chamadas[0].body!
    assert.equal(cria.get('share_to_feed'), 'true'); assert.equal(cria.get('video_url'), 'https://a/v.mp4'); assert.equal(cria.get('cover_url'), 'https://a/c.jpg')
    assert.ok(!chamadas[0].url.includes('access_token'), 'token vai no header, nunca na URL')
    assert.equal(chamadas.filter(c => c.url.endsWith('/media_publish')).length, 1, 'publica UMA vez')
  },
  'carrossel: um container por imagem com alt_text, depois CAROUSEL com children': async () => {
    const { f, chamadas } = fetchFalso((url, body) => {
      if (url.endsWith('/123/media') && body?.get('is_carousel_item') === 'true') return { json: { id: `f${body.get('image_url')!.slice(-1)}` } }
      if (url.endsWith('/123/media') && body?.get('media_type') === 'CAROUSEL') return { json: { id: 'car1' } }
      if (url.includes('/car1?')) return { json: { status_code: 'FINISHED' } }
      if (url.endsWith('/media_publish')) return { json: { id: 'm1' } }
      if (url.includes('/m1?')) return { json: { permalink: 'p' } }
      return { status: 500, json: { error: { message: 'x' } } }
    })
    await publicarCarrossel({ token: 'T', igUserId: '123', fetchImpl: f, intervaloMs: 1 }, { imagens: ['https://a/1', 'https://a/2', 'https://a/3'], caption: 'c', altText: 'desc' })
    const filhos = chamadas.filter(c => c.body?.get('is_carousel_item') === 'true')
    assert.equal(filhos.length, 3)
    assert.ok(filhos.every(c => c.body!.get('alt_text') === 'desc'), 'alt_text em cada imagem')
    const pai = chamadas.find(c => c.body?.get('media_type') === 'CAROUSEL')!
    assert.equal(pai.body!.get('children'), 'f1,f2,f3', 'ordem preservada')
    assert.equal(pai.body!.get('caption'), 'c')
  },
  'alt_text recusado pela API → refaz o container SEM alt_text (guarda só no banco)': async () => {
    const { f, chamadas } = fetchFalso((url, body) => {
      if (body?.get('is_carousel_item') === 'true' && body.get('alt_text')) return { status: 400, json: { error: { message: '(#100) Invalid parameter alt_text', code: 100 } } }
      if (body?.get('is_carousel_item') === 'true') return { json: { id: 'f' } }
      if (body?.get('media_type') === 'CAROUSEL') return { json: { id: 'car' } }
      if (url.includes('/car?')) return { json: { status_code: 'FINISHED' } }
      if (url.endsWith('/media_publish')) return { json: { id: 'm' } }
      return { json: { permalink: null } }
    })
    await publicarCarrossel({ token: 'T', igUserId: '1', fetchImpl: f, intervaloMs: 1 }, { imagens: ['https://a/1', 'https://a/2'], caption: 'c', altText: 'd' })
    const filhos = chamadas.filter(c => c.body?.get('is_carousel_item') === 'true')
    assert.equal(filhos.length, 4, '2 recusados + 2 refeitos')
    assert.ok(ehParametroRecusado(new Error('Invalid parameter alt_text'), 'alt_text'))
    assert.ok(!ehParametroRecusado(new Error('rate limit'), 'alt_text'))
  },
  'container em ERROR ou tempo esgotado derruba com mensagem clara e não publica': async () => {
    const { f, chamadas } = fetchFalso((url) => {
      if (url.endsWith('/1/media')) return { json: { id: 'c' } }
      if (url.includes('/c?')) return { json: { status_code: 'ERROR', status: 'video too long' } }
      return { json: {} }
    })
    await assert.rejects(
      () => publicarReel({ token: 'T', igUserId: '1', fetchImpl: f, intervaloMs: 1 }, { videoUrl: 'https://a/v', caption: '' }),
      /container ERROR: video too long/,
    )
    assert.equal(chamadas.filter(c => c.url.endsWith('/media_publish')).length, 0)
    const lento = fetchFalso((url) => url.endsWith('/1/media') ? { json: { id: 'c' } } : { json: { status_code: 'IN_PROGRESS' } })
    await assert.rejects(
      () => publicarReel({ token: 'T', igUserId: '1', fetchImpl: lento.f, intervaloMs: 1, tempoMaximoMs: 5 }, { videoUrl: 'https://a/v', caption: '' }),
      /tempo esgotado/,
    )
  },
  'id da conta vem de /me com o token — igual ao painel /instagram': async () => {
    const { f } = fetchFalso(() => ({ json: { user_id: '1784', username: 'lc' } }))
    assert.equal(await idDaContaConectada('T', f), '1784')
    const ruim = fetchFalso(() => ({ status: 401, json: { error: { message: 'Invalid OAuth' } } }))
    await assert.rejects(() => idDaContaConectada('T', ruim.f), /Invalid OAuth/)
  },

  // ── Costuras ──────────────────────────────────────────────────────────────
  'migration: tabela por tenant com RLS, bucket público, RPCs e reserva atômica': () => {
    const sql = ler('supabase/migrations/20260923000000_conteudos_instagram.sql')
    assert.ok(sql.includes('tenant_id           uuid NOT NULL REFERENCES tenants(id)'))
    assert.ok(sql.includes('ALTER TABLE conteudos_instagram ENABLE ROW LEVEL SECURITY'))
    assert.ok(sql.includes('USING (tenant_id = current_tenant_id())'))
    assert.ok(sql.includes("VALUES ('conteudos-instagram', 'conteudos-instagram', true)"), 'a Meta precisa baixar pela URL')
    assert.ok(sql.includes('CREATE OR REPLACE FUNCTION proxima_data_livre(p_tenant_id uuid, p_tipo text)'))
    assert.ok(sql.includes("AND c.status <> 'descartado'"), 'descartado não ocupa vaga')
    assert.ok(sql.includes('CREATE OR REPLACE FUNCTION puxar_fila('))
    assert.ok(sql.includes("SET data_agendada = data_agendada - interval '1 day'"))
    assert.ok(sql.includes('FOR UPDATE SKIP LOCKED'), 'dois crons nunca pegam o mesmo item')
    assert.ok(sql.includes("(tipo = 'carrossel' AND array_length(midia_urls, 1) BETWEEN 2 AND 10)"))
  },
  'cron: rota protegida por evaluateCronAuth, reserva antes de publicar, no proxy e no workflow': () => {
    const rota = ler('src/app/api/cron/publicar-instagram/route.ts')
    assert.ok(rota.includes('evaluateCronAuth(request)'))
    assert.ok(rota.includes('status: 401'))
    assert.ok(rota.includes('rodadaDePublicacao('))
    const pub = ler('src/lib/conteudos-ig/publicador.ts')
    assert.ok(pub.includes("rpc('reservar_conteudos_para_publicar'"), 'marca publicando ANTES de começar')
    assert.ok(pub.includes("status: 'publicado'") && pub.includes('publicado_em: agora'))
    assert.ok(ler('src/proxy.ts').includes("'/api/cron/publicar-instagram'"))
    const wf = ler('.github/workflows/publicar-instagram.yml')
    assert.ok(!/^\s+uses:/m.test(wf), 'sem action externa')
    assert.ok(wf.includes('Authorization: Bearer ${CRON_SECRET}'))
    assert.ok(wf.includes("cron: '3,13,23,33,43,53 * * * *'"), 'a cada 10 minutos')
  },
  'token nunca desce para o cliente; ações passam pelo despachante': () => {
    const cli = ler('src/app/(dashboard)/conteudos/conteudos-client.tsx')
    assert.ok(!/IG_ACCESS_TOKEN|process\.env/.test(cli))
    assert.ok(cli.includes("from '@/lib/conteudos-ig/client'"))
    assert.ok(!cli.includes("from '@/app/actions/conteudos-ig'"), 'nada de server action direta na tela')
    const rota = ler('src/app/api/conteudos/route.ts')
    for (const op of ['aprovarConteudo', 'aprovarTodosPendentes', 'descartarConteudo', 'editarConteudo', 'tentarDeNovo', 'publicarAgora']) {
      assert.ok(rota.includes(op), `operação ${op} fora da lista fechada`)
    }
    const acoes = ler('src/app/actions/conteudos-ig.ts')
    assert.ok(!/^export type \{/m.test(acoes), 'export type em use server derruba todas as actions (vide quiz-leads)')
    assert.ok(acoes.includes("podeFazer(item.status, 'aprovar')"), 'toda mutação confere o status antes')
    assert.ok(acoes.includes(".in('status', ['pendente', 'agendado', 'erro'])"), 'publicar agora reserva de forma atômica')
  },
  'painel: abas, calendário, 125 caracteres, aprovar todos, puxar a fila, tentar de novo, publicar agora': () => {
    const cli = ler('src/app/(dashboard)/conteudos/conteudos-client.tsx')
    for (const t of ['Pendentes', 'Agendados', 'Publicados', 'Erros', 'Aprovar todos os', 'Descartar e puxar a fila', 'Tentar de novo', 'Publicar agora (teste)', 'gradeDaSemana(', 'recorteVisivel(', 'datetime-local']) {
      assert.ok(cli.includes(t), `faltou: ${t}`)
    }
    assert.ok(cli.includes('muted playsInline'), 'vídeo mudo com play')
    assert.ok(cli.includes('snap-x snap-mandatory'), 'carrossel deslizável')
    assert.ok(ler('src/components/layout/sidebar.tsx').includes("href: '/conteudos'"))
  },
  'contrato para as skills existe e diz o essencial': () => {
    assert.ok(existsSync(join(RAIZ, 'docs/contrato-skills-conteudo.md')))
    const doc = ler('docs/contrato-skills-conteudo.md')
    for (const t of ['conteudos-instagram', 'proxima_data_livre', 'tenant_id', 'midia_urls', 'createClient', 'SUPABASE_SERVICE_ROLE_KEY', "status: 'pendente'"]) {
      assert.ok(doc.includes(t), `contrato sem: ${t}`)
    }
    assert.ok(!/IG_ACCESS_TOKEN/.test(doc), 'as skills não precisam (nem podem ter) o token do Instagram')
  },
}

// ─── Execução (suporta testes assíncronos) ─────────────────────────────────

;(async () => {
  let passed = 0
  const nomes = Object.keys(tests)
  for (const nome of nomes) {
    try { await tests[nome](); passed++; console.log(`  ok   ${nome}`) }
    catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
  }
  console.log(`\n${passed}/${nomes.length} testes passaram`)
  if (passed !== nomes.length) process.exit(1)
})()
