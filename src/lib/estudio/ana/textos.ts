// ============================================================================
// Estúdio IA — textos da Ana por idioma (seção 5) — PADRÃO do código
// ----------------------------------------------------------------------------
// estudio_textos (tela "Atendente") sobrescreve qualquer chave por idioma.
// Variáveis: {nome} {tema} {link} {tabela} {qtd} {faltam} {valor} {poses}
//            {prazo} {lista_temas}
// Áudios A1–A6: se não houver arquivo no idioma, vai o texto da chave a1..a6
// (vazio = não manda nada no lugar do áudio).
// ============================================================================

export const IDIOMAS = ['pt-BR', 'pt-PT', 'es', 'en'] as const
export type IdiomaAna = (typeof IDIOMAS)[number]

/** pt-BR/pt-PT ficam; es-* → es; en-* e o resto → en. */
export function idiomaDaAna(idioma: string | null | undefined): IdiomaAna {
  const i = (idioma ?? '').toLowerCase()
  if (i === 'pt-pt') return 'pt-PT'
  if (i.startsWith('pt')) return 'pt-BR'
  if (i.startsWith('es')) return 'es'
  return 'en'
}

export const CHAVES_AUDIO = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] as const

type Tabela = Record<string, Record<IdiomaAna, string>>

export const TEXTOS: Tabela = {
  boas_vindas: {
    'pt-BR': 'Oi, tudo bem? 😊 Aqui é a Ana, do Estúdio. Vou te explicar como funciona nosso ensaio com IA!',
    'pt-PT': 'Olá, tudo bem? 😊 Sou a Ana, do Estúdio. Vou explicar-te como funciona a nossa sessão fotográfica com IA!',
    es: '¡Hola! ¿Qué tal? 😊 Soy Ana, del Estudio. ¡Te explico cómo funciona nuestra sesión de fotos con IA!',
    en: "Hi there! 😊 I'm Ana from the Studio. Let me tell you how our AI photo shoot works!",
  },
  pede_nome: {
    'pt-BR': 'Me fala seu nome para eu salvar seu contato? 💖',
    'pt-PT': 'Diz-me o teu nome para eu guardar o teu contacto? 💖',
    es: '¿Me dices tu nombre para guardar tu contacto? 💖',
    en: "What's your name, so I can save your contact? 💖",
  },
  menu: {
    'pt-BR': 'Prazer, {nome}! É só me contar qual tema você gostaria:\n\n🎂 1 - ANIVERSÁRIO\n💼 2 - CORPORATIVO\n👗 3 - CASUAL\n🌹 4 - SENSUAL',
    'pt-PT': 'Muito prazer, {nome}! Diz-me qual o tema que gostavas:\n\n🎂 1 - ANIVERSÁRIO\n💼 2 - CORPORATIVO\n👗 3 - CASUAL\n🌹 4 - SENSUAL',
    es: '¡Encantada, {nombre}! Cuéntame qué temática te gustaría:\n\n🎂 1 - CUMPLEAÑOS\n💼 2 - CORPORATIVO\n👗 3 - CASUAL\n🌹 4 - SENSUAL',
    en: 'Nice to meet you, {nome}! Just tell me which theme you would like:\n\n🎂 1 - BIRTHDAY\n💼 2 - CORPORATE\n👗 3 - CASUAL\n🌹 4 - SENSUAL',
  },
  menu_de_novo: {
    'pt-BR': 'Me manda só o número do tema, tá? 1, 2, 3 ou 4 😊',
    'pt-PT': 'Manda-me só o número do tema, está bem? 1, 2, 3 ou 4 😊',
    es: 'Envíame solo el número de la temática: 1, 2, 3 o 4 😊',
    en: 'Just send me the theme number: 1, 2, 3 or 4 😊',
  },
  outro_tema: {
    'pt-BR': 'Por enquanto trabalhamos com esses 4, em breve teremos mais! 💖 Qual deles você prefere?',
    'pt-PT': 'Por agora trabalhamos com estes 4, em breve teremos mais! 💖 Qual preferes?',
    es: 'Por ahora trabajamos con estas 4, ¡pronto tendremos más! 💖 ¿Cuál prefieres?',
    en: "For now we work with these 4, more coming soon! 💖 Which one do you prefer?",
  },
  sensual_idade: {
    'pt-BR': 'O ensaio sensual é só para maiores de 18 anos e é sem nudez, tá? Me confirma sua idade?',
    'pt-PT': 'A sessão sensual é só para maiores de 18 anos e sem nudez. Confirmas a tua idade?',
    es: 'La sesión sensual es solo para mayores de 18 años y sin desnudos. ¿Me confirmas tu edad?',
    en: 'The sensual shoot is only for adults 18+ and has no nudity. Can you confirm your age?',
  },
  sensual_menor: {
    'pt-BR': 'Que pena, o sensual é só para maiores de 18 💖 Mas os outros temas ficam lindos! Quer escolher outro? 1 Aniversário, 2 Corporativo ou 3 Casual.',
    'pt-PT': 'Que pena, o sensual é só para maiores de 18 💖 Mas os outros temas ficam lindos! Escolhes outro? 1 Aniversário, 2 Corporativo ou 3 Casual.',
    es: 'Lo siento, la sensual es solo para mayores de 18 💖 ¡Pero las otras quedan preciosas! ¿Eliges otra? 1 Cumpleaños, 2 Corporativo o 3 Casual.',
    en: "Sorry, the sensual shoot is for adults only 💖 The other themes look amazing! Pick another? 1 Birthday, 2 Corporate or 3 Casual.",
  },
  catalogo_link: {
    'pt-BR': 'Aqui está o catálogo do tema {tema} 👇\n{link}\n\nCada foto tem um número: é só me mandar os números das que você mais gostou, sem print 😉',
    'pt-PT': 'Aqui está o catálogo do tema {tema} 👇\n{link}\n\nCada foto tem um número: manda-me só os números das que mais gostaste, sem captura de ecrã 😉',
    es: 'Aquí está el catálogo de {tema} 👇\n{link}\n\nCada foto tiene un número: envíame solo los números de las que más te gusten, sin captura 😉',
    en: "Here's the {tema} catalog 👇\n{link}\n\nEach photo has a number: just send me the numbers you like most, no screenshots 😉",
  },
  tabela_precos: {
    'pt-BR': '✨ Ensaio Premium Natural ✨\n{tabela}\n\n⏱ Prazo de entrega: {prazo} minutos\n🔁 1 ajuste grátis\n\nQual pacote você quer? Me manda o número da opção 😊',
    'pt-PT': '✨ Sessão Premium Natural ✨\n{tabela}\n\n⏱ Prazo de entrega: {prazo} minutos\n🔁 1 ajuste grátis\n\nQue pacote queres? Manda-me o número da opção 😊',
    es: '✨ Sesión Premium Natural ✨\n{tabela}\n\n⏱ Entrega en: {prazo} minutos\n🔁 1 ajuste gratis\n\n¿Qué paquete quieres? Envíame el número de la opción 😊',
    en: '✨ Premium Natural Shoot ✨\n{tabela}\n\n⏱ Delivery: {prazo} minutes\n🔁 1 free adjustment\n\nWhich package would you like? Send me the option number 😊',
  },
  pacote_de_novo: {
    'pt-BR': 'Me manda só o número da opção do pacote (1 a 5), tá? 😊',
    'pt-PT': 'Manda-me só o número da opção do pacote (1 a 5) 😊',
    es: 'Envíame solo el número de la opción del paquete (1 a 5) 😊',
    en: 'Just send me the package option number (1 to 5) 😊',
  },
  pede_fotos_poses: {
    'pt-BR': 'Perfeito! Pacote de {qtd} fotos 💖\n\nAgora me manda:\n📸 1 foto do seu ROSTO (de frente, nítida, sem filtro)\n📸 1 foto de CORPO INTEIRO (pode ser qualquer roupa)\n🔢 Os números de {qtd} poses do catálogo\n\nPode ser foto da sua galeria!',
    'pt-PT': 'Perfeito! Pacote de {qtd} fotos 💖\n\nAgora envia-me:\n📸 1 foto do ROSTO (de frente, nítida, sem filtro)\n📸 1 foto de CORPO INTEIRO (pode ser com qualquer roupa)\n🔢 Os números de {qtd} poses do catálogo\n\nPode ser da tua galeria!',
    es: '¡Perfecto! Paquete de {qtd} fotos 💖\n\nAhora envíame:\n📸 1 foto de tu CARA (de frente, nítida, sin filtro)\n📸 1 foto de CUERPO ENTERO (con cualquier ropa)\n🔢 Los números de {qtd} poses del catálogo\n\n¡Puede ser de tu galería!',
    en: 'Perfect! {qtd}-photo package 💖\n\nNow send me:\n📸 1 photo of your FACE (front-facing, sharp, no filter)\n📸 1 FULL-BODY photo (any outfit)\n🔢 The numbers of {qtd} poses from the catalog\n\nGallery photos are fine!',
  },
  foto_rosto_ok: {
    'pt-BR': 'Que foto linda! 😍 Essa vai ser a do rosto. Agora me manda a de corpo inteiro?',
    'pt-PT': 'Que foto linda! 😍 Esta fica como a do rosto. Agora envias a de corpo inteiro?',
    es: '¡Qué foto tan bonita! 😍 Esta será la de la cara. ¿Ahora me mandas la de cuerpo entero?',
    en: "What a lovely photo! 😍 This one is for the face. Now the full-body one?",
  },
  foto_corpo_ok: {
    'pt-BR': 'Perfeita! 💖 Já tenho as duas fotos.',
    'pt-PT': 'Perfeita! 💖 Já tenho as duas fotos.',
    es: '¡Perfecta! 💖 Ya tengo las dos fotos.',
    en: 'Perfect! 💖 I have both photos now.',
  },
  foto_ruim: {
    'pt-BR': 'Amiga, essa foto não ficou boa para o rosto 🥺 Preciso de uma de frente, bem nítida, com boa luz e sem filtro. Me manda outra?',
    'pt-PT': 'Esta foto não ficou boa para o rosto 🥺 Preciso de uma de frente, nítida, com boa luz e sem filtro. Envias outra?',
    es: 'Esta foto no sirve para la cara 🥺 Necesito una de frente, nítida, con buena luz y sin filtro. ¿Me mandas otra?',
    en: "This photo won't work for the face 🥺 I need a front-facing, sharp one with good light and no filter. Can you send another?",
  },
  foto_recusada: {
    'pt-BR': 'Desculpa, amiga, só consigo fazer o ensaio com fotos da própria pessoa que está pedindo, e maior de idade 💖 Me manda uma foto sua?',
    'pt-PT': 'Desculpa, só consigo fazer a sessão com fotos da própria pessoa que pede, e maior de idade 💖 Envias uma foto tua?',
    es: 'Lo siento, solo puedo hacer la sesión con fotos de la propia persona que lo pide, y mayor de edad 💖 ¿Me mandas una foto tuya?',
    en: "Sorry, I can only do the shoot with photos of the person ordering it, and they must be an adult 💖 Can you send one of yourself?",
  },
  video_nao: {
    'pt-BR': 'Recebi um vídeo, mas preciso de FOTO, tá? 📸 Pode tirar um print dele ou mandar uma foto normal.',
    'pt-PT': 'Recebi um vídeo, mas preciso de FOTO 📸 Podes enviar uma foto normal?',
    es: 'Recibí un video, pero necesito FOTO 📸 ¿Me envías una foto normal?',
    en: 'I got a video, but I need a PHOTO 📸 Can you send a regular photo?',
  },
  poses_invalidas: {
    'pt-BR': 'Hmm, não achei {poses} no catálogo de {tema} 🤔 Confere os números no link e me manda de novo?',
    'pt-PT': 'Hmm, não encontrei {poses} no catálogo de {tema} 🤔 Confirmas os números no link e envias de novo?',
    es: 'Hmm, no encontré {poses} en el catálogo de {tema} 🤔 ¿Revisas los números en el enlace y me los mandas otra vez?',
    en: "Hmm, I couldn't find {poses} in the {tema} catalog 🤔 Can you check the numbers on the link and send again?",
  },
  poses_faltam: {
    'pt-BR': 'Anotei as poses {poses} ✅ Faltam {faltam} para completar o pacote. Quais mais?',
    'pt-PT': 'Anotei as poses {poses} ✅ Faltam {faltam} para completar o pacote. Quais mais?',
    es: 'Anoté las poses {poses} ✅ Faltan {faltam} para completar el paquete. ¿Cuáles más?',
    en: 'Got poses {poses} ✅ {faltam} more to complete the package. Which ones?',
  },
  poses_demais: {
    'pt-BR': 'Você escolheu mais poses do que o pacote de {qtd} 😊 Me manda só {qtd} números, ou me diga se quer um pacote maior!',
    'pt-PT': 'Escolheste mais poses do que o pacote de {qtd} 😊 Envia-me só {qtd} números, ou diz-me se queres um pacote maior!',
    es: 'Elegiste más poses que el paquete de {qtd} 😊 Envíame solo {qtd} números, ¡o dime si quieres un paquete mayor!',
    en: 'You picked more poses than the {qtd}-photo package 😊 Send me just {qtd} numbers, or tell me if you want a bigger package!',
  },
  falta_foto: {
    'pt-BR': 'Anotei as poses ✅ Agora só falta {faltam} 📸',
    'pt-PT': 'Anotei as poses ✅ Agora só falta {faltam} 📸',
    es: 'Anoté las poses ✅ Ahora solo falta {faltam} 📸',
    en: 'Poses noted ✅ Now I just need {faltam} 📸',
  },
  pede_idade_prefs: {
    'pt-BR': 'Quase lá! 💖 Me conta:\n• Sua idade\n• Como é seu cabelo (cor, comprimento)\n• Suas preferências: tipo de roupa, cor, maquiagem (sim/não), decote (sim/não), acessórios',
    'pt-PT': 'Quase lá! 💖 Conta-me:\n• A tua idade\n• Como é o teu cabelo (cor, comprimento)\n• As tuas preferências: tipo de roupa, cor, maquilhagem (sim/não), decote (sim/não), acessórios',
    es: '¡Casi listo! 💖 Cuéntame:\n• Tu edad\n• Cómo es tu cabello (color, largo)\n• Tus preferencias: tipo de ropa, color, maquillaje (sí/no), escote (sí/no), accesorios',
    en: "Almost there! 💖 Tell me:\n• Your age\n• Your hair (color, length)\n• Your preferences: outfit style, color, makeup (yes/no), neckline (yes/no), accessories",
  },
  idade_falta: {
    'pt-BR': 'Só me fala sua idade, por favor? 😊',
    'pt-PT': 'Só me dizes a tua idade, por favor? 😊',
    es: '¿Me dices solo tu edad, por favor? 😊',
    en: 'Could you just tell me your age, please? 😊',
  },
  resumo_pedido: {
    'pt-BR': 'Prontinho, {nome}! 🎉 Seu pedido:\n📸 {qtd} fotos · tema {tema}\n🔢 Poses: {poses}\n💰 Valor: {valor}\n\nJá já te mando a forma de pagamento. Assim que pagar, entra na fila de produção! 🚀',
    'pt-PT': 'Prontinho, {nome}! 🎉 O teu pedido:\n📸 {qtd} fotos · tema {tema}\n🔢 Poses: {poses}\n💰 Valor: {valor}\n\nEnvio-te já a forma de pagamento. Assim que pagares, entra na fila de produção! 🚀',
    es: '¡Listo, {nome}! 🎉 Tu pedido:\n📸 {qtd} fotos · temática {tema}\n🔢 Poses: {poses}\n💰 Valor: {valor}\n\nEnseguida te envío la forma de pago. ¡En cuanto pagues, entra en la cola de producción! 🚀',
    en: "All set, {nome}! 🎉 Your order:\n📸 {qtd} photos · {tema} theme\n🔢 Poses: {poses}\n💰 Price: {valor}\n\nI'll send you the payment details shortly. As soon as you pay, it goes into production! 🚀",
  },
  aguardando_pagamento: {
    'pt-BR': 'Seu pedido já está separado 💖 Assim que eu te mandar o pagamento, é só pagar que entra na fila!',
    'pt-PT': 'O teu pedido já está reservado 💖 Assim que te enviar o pagamento, é só pagar!',
    es: 'Tu pedido ya está reservado 💖 ¡Cuando te envíe el pago, solo tienes que pagar!',
    en: "Your order is reserved 💖 As soon as I send you the payment details, just pay and it's in!",
  },
  nao_entendi: {
    'pt-BR': 'Desculpa, não entendi muito bem 🥺 Pode me explicar de outro jeito?',
    'pt-PT': 'Desculpa, não percebi muito bem 🥺 Podes explicar de outra forma?',
    es: 'Perdona, no entendí bien 🥺 ¿Me lo explicas de otra forma?',
    en: "Sorry, I didn't quite get that 🥺 Could you say it another way?",
  },
  humano: {
    'pt-BR': 'Vou chamar uma pessoa da equipe para falar com você, tá? Já já ela te responde 💖',
    'pt-PT': 'Vou chamar uma pessoa da equipa para falar contigo. Responde-te já 💖',
    es: 'Voy a llamar a una persona del equipo para que hable contigo. Te responde enseguida 💖',
    en: "I'll get someone from the team to talk to you. They'll reply shortly 💖",
  },
  sou_assistente: {
    'pt-BR': 'Sou a assistente virtual do Estúdio 🤖💖 E uma pessoa da nossa equipe revisa todas as fotos antes de você receber!',
    'pt-PT': 'Sou a assistente virtual do Estúdio 🤖💖 E uma pessoa da equipa revê todas as fotos antes de as receberes!',
    es: 'Soy la asistente virtual del Estudio 🤖💖 ¡Y una persona del equipo revisa todas las fotos antes de que las recibas!',
    en: "I'm the Studio's virtual assistant 🤖💖 And a real person on our team reviews every photo before you get it!",
  },
  cobranca_1: {
    'pt-BR': 'Amiga, tá por aí? Ficou com alguma dúvida? 😊',
    'pt-PT': 'Estás por aí? Ficaste com alguma dúvida? 😊',
    es: '¿Sigues por ahí? ¿Te quedó alguna duda? 😊',
    en: 'Are you still there? Any questions? 😊',
  },
  cobranca_2: {
    'pt-BR': 'Se quiser, eu faço uma PRÉVIA grátis de 1 foto para você ver como fica 💖 Pode ser?',
    'pt-PT': 'Se quiseres, faço uma PRÉVIA grátis de 1 foto para veres como fica 💖 Pode ser?',
    es: 'Si quieres, te hago una VISTA PREVIA gratis de 1 foto para que veas cómo queda 💖 ¿Te parece?',
    en: "If you'd like, I can make a FREE PREVIEW of 1 photo so you can see how it looks 💖 Shall I?",
  },
  cobranca_3: {
    'pt-BR': 'Vou deixar sua vaga reservada até amanhã, tá? É só me chamar 😊',
    'pt-PT': 'Deixo a tua vaga reservada até amanhã. É só chamares 😊',
    es: 'Te guardo tu lugar hasta mañana. ¡Solo escríbeme! 😊',
    en: "I'll keep your spot until tomorrow. Just message me 😊",
  },
  previa_pede_fotos: {
    'pt-BR': 'Oba! 💖 Me manda 1 foto do seu rosto (de frente, nítida) e 1 de corpo inteiro, e me diz o número de 1 pose do catálogo. Faço rapidinho só para você ver que é sério!',
    'pt-PT': 'Boa! 💖 Envia-me 1 foto do rosto (de frente, nítida) e 1 de corpo inteiro, e diz-me o número de 1 pose do catálogo. Faço rapidinho!',
    es: '¡Genial! 💖 Envíame 1 foto de tu cara (de frente, nítida) y 1 de cuerpo entero, y dime el número de 1 pose del catálogo. ¡La hago enseguida!',
    en: 'Great! 💖 Send me 1 face photo (front-facing, sharp) and 1 full-body photo, and tell me 1 pose number from the catalog. I\'ll do it quickly!',
  },
  previa_na_fila: {
    'pt-BR': 'Prontinho! Sua prévia entrou na fila 🚀 Ela vem com marca d\'água; no pacote sai sem marca e com mais capricho 💖',
    'pt-PT': 'Pronto! A tua prévia entrou na fila 🚀 Vem com marca de água; no pacote sai sem marca e com mais cuidado 💖',
    es: '¡Listo! Tu vista previa entró en la cola 🚀 Viene con marca de agua; en el paquete sale sin marca y con más detalle 💖',
    en: "Done! Your preview is in the queue 🚀 It has a watermark; the full package comes without it and even more polished 💖",
  },
  idioma_trocado: {
    'pt-BR': 'Claro! Vou falar em português 😊',
    'pt-PT': 'Claro! Vou falar em português 😊',
    es: '¡Claro! Te hablo en español 😊',
    en: "Sure! I'll speak English 😊",
  },
  // Áudios A1–A6: texto no lugar do áudio quando não há arquivo no idioma.
  a1: { 'pt-BR': '', 'pt-PT': '', es: '', en: '' },
  a2: {
    'pt-BR': 'O ensaio é 100% on-line! Você não precisa sair de casa: nada de Uber, maquiadora, cabeleireiro nem roupa nova. Recebe um ensaio lindo, com cara de estúdio ✨',
    'pt-PT': 'A sessão é 100% online! Não precisas de sair de casa: nada de táxi, maquilhadora, cabeleireiro nem roupa nova. Recebes uma sessão linda, com ar de estúdio ✨',
    es: '¡La sesión es 100% online! No necesitas salir de casa: ni taxi, ni maquilladora, ni peluquería, ni ropa nueva. Recibes una sesión preciosa, con aspecto de estudio ✨',
    en: "The shoot is 100% online! No need to leave home: no ride, makeup artist, hairdresser or new clothes. You get a beautiful studio-quality shoot ✨",
  },
  a3: {
    'pt-BR': 'Eu só preciso de 2 fotos suas: uma do rosto e uma de corpo inteiro. A do rosto é a mais importante: nítida, de frente, com boa luz e sem filtro 📸',
    'pt-PT': 'Só preciso de 2 fotos tuas: uma do rosto e uma de corpo inteiro. A do rosto é a mais importante: nítida, de frente, com boa luz e sem filtro 📸',
    es: 'Solo necesito 2 fotos tuyas: una de la cara y una de cuerpo entero. La de la cara es la más importante: nítida, de frente, con buena luz y sin filtro 📸',
    en: "I only need 2 photos of you: one of your face and one full-body. The face one matters most: sharp, front-facing, good light, no filter 📸",
  },
  a4: { 'pt-BR': '', 'pt-PT': '', es: '', en: '' },
  a5: { 'pt-BR': '', 'pt-PT': '', es: '', en: '' },
  a6: {
    'pt-BR': 'Seu ensaio ficou lindo! Dá uma olhada e me conta o que achou! 💖',
    'pt-PT': 'A tua sessão ficou linda! Vê e diz-me o que achaste! 💖',
    es: '¡Tu sesión quedó preciosa! ¡Mírala y cuéntame qué te parece! 💖',
    en: 'Your shoot turned out beautiful! Take a look and tell me what you think! 💖',
  },
}

export const NOMES_TEMA: Record<string, Record<IdiomaAna, string>> = {
  aniversario: { 'pt-BR': 'Aniversário', 'pt-PT': 'Aniversário', es: 'Cumpleaños', en: 'Birthday' },
  corporativo: { 'pt-BR': 'Corporativo', 'pt-PT': 'Corporativo', es: 'Corporativo', en: 'Corporate' },
  casual: { 'pt-BR': 'Casual', 'pt-PT': 'Casual', es: 'Casual', en: 'Casual' },
  sensual: { 'pt-BR': 'Sensual', 'pt-PT': 'Sensual', es: 'Sensual', en: 'Sensual' },
}

export function nomeDoTema(slug: string | null | undefined, idioma: IdiomaAna): string {
  return (slug && NOMES_TEMA[slug]?.[idioma]) || slug || ''
}

/** Texto final: sobrescrita da tela (se houver) ou padrão; troca {variáveis}. */
export function texto(chave: string, idioma: IdiomaAna, vars: Record<string, string | number> = {}, sobrescritas?: Map<string, string>): string {
  const base = sobrescritas?.get(`${chave}|${idioma}`)?.trim() || TEXTOS[chave]?.[idioma] || TEXTOS[chave]?.['pt-BR'] || ''
  // {nombre} no espanhol = {nome}
  return base.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k === 'nombre' ? 'nome' : k]
    return v === undefined || v === null ? '' : String(v)
  }).replace(/,\s*!/g, '!').replace(/\s+!/g, '!')
}

/** Preço formatado na moeda. */
export function dinheiro(cents: number, moeda: string, idioma: IdiomaAna): string {
  const loc = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : idioma
  try { return new Intl.NumberFormat(loc, { style: 'currency', currency: moeda || 'BRL' }).format(cents / 100) }
  catch { return `${(cents / 100).toFixed(2)} ${moeda}` }
}
