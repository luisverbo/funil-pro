// ============================================================================
// Estúdio IA — Fase 1: tabelas, buckets, importação do poses.json e catálogo
// ----------------------------------------------------------------------------
// Os NOMES da seção 4 são contrato com o script do PC (producao.py): este
// teste reprova qualquer renomeação silenciosa.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  lerPosesJson, normalizarNumero, urlPublicaDoCatalogo, caminhoExemplo, caminhosDaCliente,
  mensagemDeEscolha, linkWhatsApp, preencherPrompt, ORDEM_LANCAMENTO,
} from '@/lib/estudio/catalogo'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sql = ler('supabase/migrations/20261023000000_estudio_ia_fase1.sql')
const posesJson = JSON.parse(ler('src/lib/estudio/dados/poses.json'))

const colunas = (tabela: string) => {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela} \\(([\\s\\S]*?)\\n\\);`))
  assert.ok(m, `tabela ${tabela} ausente`)
  return m![1].split('\n').map(l => l.trim().match(/^([a-z_]+)\s/)?.[1]).filter((c): c is string => !!c && c !== 'unique')
}

const tests: Record<string, () => void> = {
  'seção 4: tabelas e colunas com os nomes EXATOS do contrato com o PC': () => {
    assert.deepEqual(colunas('estudio_temas'), ['id', 'tenant_id', 'slug', 'nome', 'sujeito', 'capa_url', 'ativo', 'ordem'])
    assert.deepEqual(colunas('estudio_poses'), ['id', 'tenant_id', 'tema_slug', 'numero', 'cena', 'prompt_catalogo', 'prompt_cliente', 'foto_exemplo_path', 'ativa'])
    assert.deepEqual(colunas('estudio_pedidos'), ['id', 'tenant_id', 'contato_id', 'cliente_nome', 'wa_id', 'idade', 'cabelo', 'tema_slug', 'poses', 'pacote_qtd', 'valor_cents', 'preferencias', 'foto_rosto_path', 'foto_corpo_path', 'fotos_extras_paths', 'asaas_payment_id', 'status', 'motor', 'previa_enviada', 'ajustes_usados', 'observacoes_ajuste', 'criado_em', 'pago_em', 'entregue_em', 'aprovado_por'])
    assert.deepEqual(colunas('estudio_entregas'), ['id', 'pedido_id', 'pose_numero', 'foto_path', 'status', 'nota_rosto', 'observacao', 'criado_em'])
    assert.deepEqual(colunas('estudio_eventos'), ['id', 'pedido_id', 'tipo', 'detalhe', 'criado_em'])
  },
  'seção 4: unicidades, defaults e status': () => {
    assert.ok(sql.includes('slug      text NOT NULL UNIQUE'))
    assert.ok(sql.includes('UNIQUE (tema_slug, numero)'))
    assert.ok(sql.includes("motor               text NOT NULL DEFAULT 'chatgpt_site'"))
    assert.ok(sql.includes('ajustes_usados      int NOT NULL DEFAULT 0'))
    for (const s of ['novo', 'aguardando_pagamento', 'pago', 'aguardando_fotos', 'aguardando_producao', 'gerando', 'pronto', 'aguardando_aprovacao', 'entregue', 'ajuste', 'finalizado', 'cancelado']) {
      assert.ok(sql.includes(`'${s}'`), `status ${s}`)
    }
    for (const s of ['aguardando_aprovacao', 'aprovada', 'refazer', 'enviada']) assert.ok(sql.includes(`'${s}'`))
  },
  'buckets: clientes e entregas PRIVADOS, catálogo público': () => {
    assert.ok(sql.includes("('estudio-clientes', 'estudio-clientes', false)"))
    assert.ok(sql.includes("('estudio-entregas', 'estudio-entregas', false)"))
    assert.ok(sql.includes("('estudio-catalogo', 'estudio-catalogo', true)"))
    assert.deepEqual(caminhosDaCliente('abc'), { rosto: 'abc/rosto.jpg', corpo: 'abc/corpo.jpg' })
    assert.equal(caminhoExemplo('aniversario', '01'), 'aniversario/01.jpg')
  },
  'segurança: RLS ligado e nada legível pela chave pública': () => {
    for (const t of ['estudio_temas', 'estudio_poses', 'estudio_pedidos', 'estudio_entregas', 'estudio_eventos']) {
      assert.ok(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`).test(sql), t)
    }
    assert.ok(sql.includes('REVOKE ALL ON estudio_temas, estudio_poses, estudio_pedidos, estudio_entregas, estudio_eventos FROM anon;'))
  },
  'poses.json do projeto: 4 temas × 20 poses, números 01..20, sem erro': () => {
    const r = lerPosesJson(posesJson)
    assert.deepEqual(r.erros, [])
    assert.deepEqual(r.temas.map(t => t.slug), [...ORDEM_LANCAMENTO])
    assert.ok(r.temas.every(t => t.ativo), 'os 4 do lançamento entram ativos')
    assert.deepEqual(r.temas.map(t => t.ordem), [1, 2, 3, 4])
    assert.equal(r.poses.length, 80)
    const aniv = r.poses.filter(p => p.tema_slug === 'aniversario').map(p => p.numero)
    assert.deepEqual(aniv, Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0')))
    assert.ok(r.poses.every(p => p.cena && p.prompt_catalogo && p.prompt_cliente.includes('{idade}')))
  },
  'importação: tema fora do lançamento entra desligado; número normalizado; repetida e inválida avisam': () => {
    const r = lerPosesJson({ temas: [
      { slug: 'pet', nome: 'Pet', sujeito: 'pet', poses: [{ numero: 1, cena: 'a' }, { numero: '01', cena: 'b' }, { numero: 'x' }] },
      { slug: 'Errado!', poses: [] },
    ] })
    assert.equal(r.temas.length, 1); assert.equal(r.temas[0].ativo, false); assert.equal(r.temas[0].sujeito, 'pet')
    assert.deepEqual(r.poses.map(p => p.numero), ['01'])
    assert.equal(r.erros.length, 3)
    assert.deepEqual(lerPosesJson({}).erros, ['arquivo sem a lista "temas"'])
    assert.equal(normalizarNumero('7'), '07'); assert.equal(normalizarNumero('123'), '123'); assert.equal(normalizarNumero('1a'), null)
  },
  'importação não sobrescreve foto nem ativação já feitas': () => {
    const a = ler('src/app/actions/estudio.ts')
    assert.ok(a.includes(".upsert(validas.slice(i, i + 200).map(p => ({ ...p, tenant_id: tenantId })), { onConflict: 'tema_slug,numero' })"))
    const r = lerPosesJson(posesJson)
    assert.ok(r.poses.every(p => !('foto_exemplo_path' in p) && !('ativa' in p)), 'upsert não leva esses campos')
    assert.ok(a.includes(".update({ nome: t.nome, sujeito: t.sujeito })"), 'tema existente só troca nome/sujeito')
  },
  'URL pública do catálogo aceita caminho, caminho com bucket e URL completa': () => {
    const base = 'https://x.supabase.co'
    assert.equal(urlPublicaDoCatalogo('aniversario/01.jpg', base), 'https://x.supabase.co/storage/v1/object/public/estudio-catalogo/aniversario/01.jpg')
    assert.equal(urlPublicaDoCatalogo('estudio-catalogo/aniversario/01.jpg', base + '/'), 'https://x.supabase.co/storage/v1/object/public/estudio-catalogo/aniversario/01.jpg')
    assert.equal(urlPublicaDoCatalogo('https://cdn/x.jpg', base), 'https://cdn/x.jpg')
    assert.equal(urlPublicaDoCatalogo(null, base), null)
  },
  'mensagem de escolha e link do WhatsApp': () => {
    assert.equal(mensagemDeEscolha(['45', '3', '12', '03']), 'Quero as poses 03, 12, 45')
    assert.equal(mensagemDeEscolha(['7'], 'Casual'), 'Quero a pose 07 (Casual)')
    assert.equal(mensagemDeEscolha([]), '')
    assert.equal(linkWhatsApp('+55 (83) 99999-0000', 'Quero as poses 03'), 'https://wa.me/5583999990000?text=Quero%20as%20poses%2003')
    assert.equal(linkWhatsApp('', 'x'), null)
  },
  'prompt da cliente: placeholders preenchidos, com padrão quando falta dado': () => {
    const p = 'idade {idade}, cabelo {cabelo}, gosto {preferencias}'
    assert.equal(preencherPrompt(p, { idade: 42, cabelo: 'castanho liso', preferencias: 'vestido vermelho' }), 'idade 42, cabelo castanho liso, gosto vestido vermelho')
    assert.equal(preencherPrompt(p, {}), 'idade a mesma da foto, cabelo igual ao da foto, gosto sem preferências especiais')
  },
  'página pública: rota liberada sem login e prompts nunca vão ao navegador': () => {
    assert.ok(ler('src/proxy.ts').includes("'/estudio/catalogo',"))
    const d = ler('src/app/estudio/catalogo/dados.ts')
    assert.ok(!/select\([^)]*prompt/.test(d), 'a vitrine não lê prompts')
    assert.ok(d.includes(".eq('ativo', true)") && d.includes(".eq('ativa', true)"))
    const tx = ler('src/lib/estudio/catalogo-idiomas.ts')
    assert.ok(tx.includes('As cenas são recriadas com o rosto e o corpo da cliente.'))
    assert.ok(tx.includes('Toque no número para escolher suas fotos.'))
  },
  'painel: menu, despachante de lista fechada e sem export type em use server': () => {
    assert.ok(ler('src/components/layout/sidebar.tsx').includes("{ href: '/estudio-ia',    label: 'Estúdio IA',"))
    const r = ler('src/app/api/estudio/route.ts')
    assert.ok(r.includes("return NextResponse.json({ error: 'operação desconhecida' }, { status: 404 })"))
    assert.ok(!/console\.\w+\([^)]*args/.test(r))
    assert.ok(!/^export type \{/m.test(ler('src/app/actions/estudio.ts')))
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
