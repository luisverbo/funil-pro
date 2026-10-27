// Robô do outro lado: encerra a conversa antes de gastar IA; gente de verdade passa.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pareceRobo } from '@/lib/estudio/ana/robo'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const tests: Record<string, () => void> = {
  'robô: aviso explícito, empresa + menu, repetição, duas respostas automáticas': () => {
    assert.equal(pareceRobo(['Esta é uma mensagem automática. Retornaremos em breve.']).robo, true)
    assert.equal(pareceRobo(['Hola! Este es un mensaje automático 🤖']).robo, true)
    assert.equal(pareceRobo(['Olá! Obrigado por entrar em contato com a Loja X 😊\n1 - Vendas\n2 - Suporte\n3 - Financeiro']).robo, true)
    assert.equal(pareceRobo(['¡Gracias por comunicarte con Flores Ana! Elige una opción: 1 Pedidos 2 Horarios']).robo, true)
    const auto = 'Nosso horário de atendimento é de seg a sex das 9h às 18h.'
    assert.equal(pareceRobo([auto, 'oi', auto]).robo, true, 'mesma resposta automática repetida')
    assert.equal(pareceRobo(['Obrigado pelo contato! Em breve um atendente vai falar com você.', 'Estamos fora do horário de atendimento.']).robo, true)
  },
  'gente de verdade NÃO é robô': () => {
    for (const t of [['Oi, quero mais informação'], ['Maria'], ['Quero o ensaio de aniversário', '3'], ['obrigado pelo contato, vou pensar'],
      ['Quero as poses 1, 2 e 3'], ['ok', 'ok', 'ok'], ['1', '2', '3']]) {
      assert.equal(pareceRobo(t).robo, false, JSON.stringify(t))
    }
    assert.equal(pareceRobo([]).robo, false)
  },
  'ligado: antes da Ana, encerrada não responde nem avisa, botão Encerrar na conversa': () => {
    const e = ler('src/lib/estudio/entrada.ts')
    assert.match(e, /existente\?\.encerrada_em\) \{ await fechar\(\); return \}[\s\S]*avisarAparelhos/)
    assert.match(e, /pareceRobo\([\s\S]*encerrarConversa\([\s\S]*processarConversa\(/)
    assert.match(ler('src/app/actions/estudio-chat.ts'), /quem === 'encerrar'/)
    assert.match(ler('src/app/(dashboard)/estudio-ia/aba-conversas.tsx'), /definirAtendimentoChat\(c\.id, 'encerrar'\)/)
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
