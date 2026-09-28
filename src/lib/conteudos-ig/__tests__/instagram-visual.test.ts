// ============================================================================
// Aba Instagram — conta conectada com a cara do perfil e cards redesenhados
// ----------------------------------------------------------------------------
// Pedido do dono: "achei esse layout horrível, cards feios; lá em cima
// 'conectado como @… · ID 1784…' dá pra botar algo mais bonito".
// Aqui se tranca o essencial do redesenho sem perder nenhuma função.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (r: string) => readFileSync(join(process.cwd(), r), 'utf8')
const tela = ler('src/app/(dashboard)/instagram/instagram-client.tsx')
const lib = ler('src/lib/instagram/index.ts')

const tests: Record<string, () => void> = {
  'conexão traz nome, foto, seguidores e posts — e cai no mínimo se a Meta recusar campo': () => {
    assert.ok(lib.includes("pedir('user_id,username,name,profile_picture_url,followers_count,media_count')"))
    assert.ok(lib.includes("if (!r.ok) r = await pedir('user_id,username')"))
    assert.ok(lib.includes('profilePic: j.profile_picture_url'))
  },
  'bloco da conta: foto com anel do Instagram, nome, @ e números; o ID não aparece mais no texto': () => {
    assert.ok(tela.includes('<AvatarIg src={connection.profilePic}'))
    assert.ok(tela.includes("{connection.name || `@${connection.username}`}"))
    assert.ok(tela.includes("r: 'seguidores'") && tela.includes("r: 'posts'") && tela.includes("r: 'disparos'"))
    assert.ok(!tela.includes('· ID {connection.accountId}'), 'o ID cru saiu da frase; fica só no título do link')
  },
  'foto/miniatura expirada do CDN vira inicial ou degradê, nunca imagem quebrada': () => {
    assert.equal((tela.match(/el\.complete && el\.naturalWidth === 0/g) ?? []).length, 2)
  },
  'cards: capa, liga/desliga, etapas em ordem, prévia como balão do Direct': () => {
    assert.ok(tela.includes('<CapaAutomacao thumb={a.media_thumb}'))
    assert.ok(tela.includes("onClick={() => toggle(a)} title={active ? 'Pausar' : 'Ativar'}"))
    assert.ok(tela.includes("{ i: '🔒', t: 'Pede follow' }"))
    assert.ok(tela.includes('rounded-bl-md bg-gray-100'))
  },
  'nenhuma função sumiu: inbox, nova, editor, contatos, excluir, aviso de desconexão': () => {
    for (const t of ['href="/instagram/inbox"', 'onClick={openModal}', 'href={`/instagram/${a.id}/editor`}', 'onClick={() => openContacts(a)}', 'onClick={() => remove(a.id)}', 'explicarErroDeToken(connection?.error)']) {
      assert.ok(tela.includes(t), `sumiu: ${t}`)
    }
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
