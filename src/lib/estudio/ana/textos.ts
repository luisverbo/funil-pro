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
    'pt-BR': '✨ Ensaio Premium Natural ✨\n\nPrazo de entrega: {prazo} minutos ⏱️  ·  1 ajuste grátis\n\nEscolha seu pacote 👇\n{tabela}\n\n*Responda só com o NÚMERO do pacote* (ex.: 3) 😉',
    'pt-PT': '✨ Sessão Premium Natural ✨\n\nPrazo de entrega: {prazo} minutos ⏱️  ·  1 ajuste grátis\n\nEscolhe o teu pacote 👇\n{tabela}\n\n*Responde só com o NÚMERO do pacote* (ex.: 3) 😉',
    es: '✨ Sesión Premium Natural ✨\n\nEntrega en: {prazo} minutos ⏱️  ·  1 ajuste gratis\n\nElige tu paquete 👇\n{tabela}\n\n*Responde solo con el NÚMERO del paquete* (ej.: 3) 😉',
    en: '✨ Premium Natural Shoot ✨\n\nDelivery: {prazo} minutes ⏱️  ·  1 free adjustment\n\nChoose your package 👇\n{tabela}\n\n*Reply with just the package NUMBER* (e.g. 3) 😉',
  },
  pacote_de_novo: {
    'pt-BR': 'Quando decidir, me manda só o número do pacote 😉',
    'pt-PT': 'Quando decidires, manda-me só o número do pacote 😉',
    es: 'Cuando lo decidas, envíame solo el número del paquete 😉',
    en: 'When you decide, just send me the package number 😉',
  },
  pacote_confirmar: {
    'pt-BR': 'Só pra confirmar: é o pacote de {qtd} fotos por {valor}? (responda sim ou não)',
    'pt-PT': 'Só para confirmar: é o pacote de {qtd} fotos por {valor}? (responde sim ou não)',
    es: 'Solo para confirmar: ¿es el paquete de {qtd} fotos por {valor}? (responde sí o no)',
    en: 'Just to confirm: is it the {qtd}-photo package for {valor}? (reply yes or no)',
  },
  pede_fotos_poses: {
    'pt-BR': 'Perfeito! Pacote de {qtd} fotos ✅ Agora me manda os {qtd} NÚMEROS das poses que você escolheu no catálogo (ex.: 03, 12, 27) e as 2 fotos: uma do rosto de frente, nítida e sem filtro, e uma de corpo inteiro.',
    'pt-PT': 'Perfeito! Pacote de {qtd} fotos ✅ Agora envia-me os {qtd} NÚMEROS das poses que escolheste no catálogo (ex.: 03, 12, 27) e as 2 fotos: uma do rosto de frente, nítida e sem filtro, e uma de corpo inteiro.',
    es: '¡Perfecto! Paquete de {qtd} fotos ✅ Ahora envíame los {qtd} NÚMEROS de las poses que elegiste en el catálogo (ej.: 03, 12, 27) y las 2 fotos: una de la cara de frente, nítida y sin filtro, y una de cuerpo entero.',
    en: 'Perfect! {qtd}-photo package ✅ Now send me the {qtd} NUMBERS of the poses you picked in the catalog (e.g. 03, 12, 27) and 2 photos: one of your face, front-facing, sharp and with no filter, and one full-body.',
  },
  foto_rosto_ok: {
    'pt-BR': 'Recebi a do rosto ✅ Falta só a de corpo inteiro 😊',
    'pt-PT': 'Recebi a do rosto ✅ Falta só a de corpo inteiro 😊',
    es: 'Recibí la de la cara ✅ Solo falta la de cuerpo entero 😊',
    en: 'Got the face photo ✅ Just the full-body one left 😊',
  },
  foto_so_corpo: {
    'pt-BR': 'Recebi a de corpo inteiro ✅ Falta só uma do rosto de frente, nítida e sem filtro 😊',
    'pt-PT': 'Recebi a de corpo inteiro ✅ Falta só uma do rosto de frente, nítida e sem filtro 😊',
    es: 'Recibí la de cuerpo entero ✅ Solo falta una de la cara de frente, nítida y sin filtro 😊',
    en: 'Got the full-body photo ✅ Just a front-facing, sharp face photo with no filter left 😊',
  },
  foto_corpo_ok: {
    'pt-BR': 'Perfeita! 💖 Recebi as 2 fotos ✅',
    'pt-PT': 'Perfeita! 💖 Recebi as 2 fotos ✅',
    es: '¡Perfecta! 💖 Recibí las 2 fotos ✅',
    en: 'Perfect! 💖 Got both photos ✅',
  },
  foto_unica_ok: {
    'pt-BR': 'Que foto maravilhosa! 😍 Dá para ver seu rosto e o corpo inteiro, então já serve ✅ Se quiser, me manda também um close do rosto para ficar ainda mais fiel (opcional).',
    'pt-PT': 'Que foto maravilhosa! 😍 Vê-se o rosto e o corpo inteiro, por isso já serve ✅ Se quiseres, envia também um close do rosto para ficar ainda mais fiel (opcional).',
    es: '¡Qué foto tan linda! 😍 Se ve tu cara y el cuerpo entero, así que ya sirve ✅ Si quieres, envíame también un primer plano de la cara para que quede aún más fiel (opcional).',
    en: 'Gorgeous photo! 😍 I can see your face and full body, so it works ✅ If you like, also send a face close-up so it looks even more like you (optional).',
  },
  foto_ruim: {
    'pt-BR': 'Amiga, essa foto não ficou boa ({motivo}) 🥺 Preciso de uma nítida, com boa luz, sem filtro e só com você. Me manda outra?',
    'pt-PT': 'Esta foto não ficou boa ({motivo}) 🥺 Preciso de uma nítida, com boa luz, sem filtro e só contigo. Envias outra?',
    es: 'Esta foto no sirve ({motivo}) 🥺 Necesito una nítida, con buena luz, sin filtro y solo contigo. ¿Me mandas otra?',
    en: "This photo won't work ({motivo}) 🥺 I need a sharp one with good light, no filter and just you. Can you send another?",
  },
  foto_recusada: {
    'pt-BR': 'Desculpa, amiga, só consigo fazer o ensaio com fotos da própria pessoa que está pedindo, e maior de idade 💖 Me manda uma foto sua?',
    'pt-PT': 'Desculpa, só consigo fazer a sessão com fotos da própria pessoa que pede, e maior de idade 💖 Envias uma foto tua?',
    es: 'Lo siento, solo puedo hacer la sesión con fotos de la propia persona que lo pide, y mayor de edad 💖 ¿Me mandas una foto tuya?',
    en: "Sorry, I can only do the shoot with photos of the person ordering it, and they must be an adult 💖 Can you send one of yourself?",
  },
  pede_close_rosto: {
    'pt-BR': 'Só um detalhe: me manda uma foto do rosto de perto, de frente e sem filtro? O rosto é o mais importante pra ficar igualzinho a você 💖',
    'pt-PT': 'Só um detalhe: envias uma foto do rosto de perto, de frente e sem filtro? O rosto é o mais importante para ficar igual a ti 💖',
    es: 'Un detalle: ¿me mandas una foto de la cara de cerca, de frente y sin filtro? La cara es lo más importante para que quede igual a ti 💖',
    en: 'One detail: could you send a close-up of your face, front-facing with no filter? The face matters most so it looks just like you 💖',
  },
  video_nao: {
    'pt-BR': 'Você me mandou um vídeo 😊 Para o ensaio eu preciso de FOTO: uma do rosto de frente, nítida e sem filtro, e uma de corpo inteiro. Pode ser da sua galeria!',
    'pt-PT': 'Enviaste-me um vídeo 😊 Para a sessão preciso de FOTO: uma do rosto de frente, nítida e sem filtro, e uma de corpo inteiro. Pode ser da tua galeria!',
    es: 'Me enviaste un video 😊 Para la sesión necesito FOTO: una de la cara de frente, nítida y sin filtro, y una de cuerpo entero. ¡Puede ser de tu galería!',
    en: 'You sent me a video 😊 For the shoot I need PHOTOS: one of your face, front-facing, sharp with no filter, and one full-body. Gallery photos are fine!',
  },
  figurinha_nao: {
    'pt-BR': 'Isso é uma figurinha 😄 Para o ensaio eu preciso de FOTO: uma do rosto de frente, nítida e sem filtro, e uma de corpo inteiro.',
    'pt-PT': 'Isso é um autocolante 😄 Para a sessão preciso de FOTO: uma do rosto de frente, nítida e sem filtro, e uma de corpo inteiro.',
    es: 'Eso es un sticker 😄 Para la sesión necesito FOTO: una de la cara de frente, nítida y sin filtro, y una de cuerpo entero.',
    en: "That's a sticker 😄 For the shoot I need PHOTOS: one of your face, front-facing, sharp with no filter, and one full-body.",
  },
  documento_nao: {
    'pt-BR': 'Recebi um arquivo, mas preciso de FOTO 📸 Pode mandar direto da galeria?',
    'pt-PT': 'Recebi um ficheiro, mas preciso de FOTO 📸 Podes enviar direto da galeria?',
    es: 'Recibí un archivo, pero necesito FOTO 📸 ¿Puedes enviarla directo de la galería?',
    en: 'I got a file, but I need a PHOTO 📸 Can you send it straight from your gallery?',
  },
  audio_nao_ouvi: {
    'pt-BR': 'Não consegui ouvir seu áudio aqui 🙈 pode me mandar por escrito?',
    'pt-PT': 'Não consegui ouvir o teu áudio aqui 🙈 podes escrever?',
    es: 'No pude escuchar tu audio aquí 🙈 ¿me lo escribes?',
    en: "I couldn't listen to your audio here 🙈 could you type it?",
  },
  poses_invalidas: {
    'pt-BR': 'Hmm, não achei {poses} no catálogo de {tema} 🤔 Confere os números no link e me manda de novo?',
    'pt-PT': 'Hmm, não encontrei {poses} no catálogo de {tema} 🤔 Confirmas os números no link e envias de novo?',
    es: 'Hmm, no encontré {poses} en el catálogo de {tema} 🤔 ¿Revisas los números en el enlace y me los mandas otra vez?',
    en: "Hmm, I couldn't find {poses} in the {tema} catalog 🤔 Can you check the numbers on the link and send again?",
  },
  poses_faltam: {
    'pt-BR': 'Anotei as poses {poses} ✅ Faltam {faltam} poses 😊 Me manda os números que faltam.',
    'pt-PT': 'Anotei as poses {poses} ✅ Faltam {faltam} poses 😊 Envia-me os números que faltam.',
    es: 'Anoté las poses {poses} ✅ Faltan {faltam} poses 😊 Envíame los números que faltan.',
    en: 'Got poses {poses} ✅ {faltam} more poses to go 😊 Send me the remaining numbers.',
  },
  pede_poses: {
    'pt-BR': 'Agora me manda os {qtd} NÚMEROS das poses que você escolheu no catálogo (ex.: 03, 12, 27) 😊\n{link}',
    'pt-PT': 'Agora envia-me os {qtd} NÚMEROS das poses que escolheste no catálogo (ex.: 03, 12, 27) 😊\n{link}',
    es: 'Ahora envíame los {qtd} NÚMEROS de las poses que elegiste en el catálogo (ej.: 03, 12, 27) 😊\n{link}',
    en: 'Now send me the {qtd} NUMBERS of the poses you picked in the catalog (e.g. 03, 12, 27) 😊\n{link}',
  },
  poses_demais: {
    'pt-BR': 'Você mandou mais poses do que o pacote de {qtd} 😊 Escolhe só {qtd} números, ou me diga se quer um pacote maior!',
    'pt-PT': 'Enviaste mais poses do que o pacote de {qtd} 😊 Escolhe só {qtd} números, ou diz-me se queres um pacote maior!',
    es: 'Enviaste más poses que el paquete de {qtd} 😊 Elige solo {qtd} números, ¡o dime si quieres un paquete mayor!',
    en: 'You sent more poses than the {qtd}-photo package 😊 Pick just {qtd} numbers, or tell me if you want a bigger package!',
  },
  falta_foto: {
    'pt-BR': 'Anotei as poses ✅ Agora só falta {faltam} 📸',
    'pt-PT': 'Anotei as poses ✅ Agora só falta {faltam} 📸',
    es: 'Anoté las poses ✅ Ahora solo falta {faltam} 📸',
    en: 'Poses noted ✅ Now I just need {faltam} 📸',
  },
  pref_maquiagem: {
    'pt-BR': 'Que foto maravilhosa! 😍 Quer que eu coloque maquiagem nas suas fotos? (sim ou não)',
    'pt-PT': 'Que foto maravilhosa! 😍 Queres que eu coloque maquilhagem nas tuas fotos? (sim ou não)',
    es: '¡Qué foto tan linda! 😍 ¿Quieres que ponga maquillaje en tus fotos? (sí o no)',
    en: 'Gorgeous photo! 😍 Would you like makeup in your photos? (yes or no)',
  },
  pref_decote: {
    'pt-BR': 'E decote, prefere com ou sem? 😊',
    'pt-PT': 'E decote, preferes com ou sem? 😊',
    es: 'Y el escote, ¿lo prefieres con o sin? 😊',
    en: 'And neckline, do you prefer low-cut or not? 😊',
  },
  pref_cores: {
    'pt-BR': 'Tem alguma cor ou acessório que você gostaria? Se não tiver, é só dizer "pode escolher" 😉',
    'pt-PT': 'Há alguma cor ou acessório que gostarias? Se não, é só dizer "podes escolher" 😉',
    es: '¿Hay algún color o accesorio que te gustaría? Si no, solo di "puedes elegir" 😉',
    en: 'Any color or accessory you would like? If not, just say "you choose" 😉',
  },
  pref_idade: {
    'pt-BR': 'Última coisinha: qual sua idade? (é pra deixar o ensaio fiel a você)',
    'pt-PT': 'Última coisinha: qual é a tua idade? (é para a sessão ficar fiel a ti)',
    es: 'Última cosita: ¿cuántos años tienes? (es para que la sesión sea fiel a ti)',
    en: 'Last little thing: how old are you? (so the shoot stays true to you)',
  },
  pede_idade_prefs: {
    'pt-BR': 'Que foto maravilhosa! 😍 Quer que eu coloque maquiagem nas suas fotos? (sim ou não)',
    'pt-PT': 'Que foto maravilhosa! 😍 Queres que eu coloque maquilhagem nas tuas fotos? (sim ou não)',
    es: '¡Qué foto tan linda! 😍 ¿Quieres que ponga maquillaje en tus fotos? (sí o no)',
    en: 'Gorgeous photo! 😍 Would you like makeup in your photos? (yes or no)',
  },
  idade_falta: {
    'pt-BR': 'Só me fala sua idade em número, por favor? (ex.: 35) 😊',
    'pt-PT': 'Só me dizes a tua idade em número, por favor? (ex.: 35) 😊',
    es: '¿Me dices tu edad en número, por favor? (ej.: 35) 😊',
    en: 'Could you tell me your age as a number, please? (e.g. 35) 😊',
  },
  lembrete_nome: {
    'pt-BR': 'Me fala seu nome? 😊', 'pt-PT': 'Dizes-me o teu nome? 😊', es: '¿Me dices tu nombre? 😊', en: "What's your name? 😊",
  },
  lembrete_tema: {
    'pt-BR': 'Quando quiser, me manda o NÚMERO do tema (1 a 4) 😉', 'pt-PT': 'Quando quiseres, envia o NÚMERO do tema (1 a 4) 😉',
    es: 'Cuando quieras, envíame el NÚMERO de la temática (1 a 4) 😉', en: 'Whenever you are ready, send me the theme NUMBER (1 to 4) 😉',
  },
  lembrete_fotos: {
    'pt-BR': 'Quando puder, me manda {faltam} 😉', 'pt-PT': 'Quando puderes, envia-me {faltam} 😉',
    es: 'Cuando puedas, envíame {faltam} 😉', en: 'When you can, send me {faltam} 😉',
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
  pix_dados: {
    'pt-BR': '💸 Pagamento por Pix\nValor: *{valor}*\nRecebedor: {recebedor}\n\nChave Pix (toque para copiar) 👇',
    'pt-PT': '💸 Pagamento por Pix\nValor: *{valor}*\nRecebedor: {recebedor}\n\nChave Pix 👇',
    es: '💸 Pago por Pix\nValor: *{valor}*\nDestinatario: {recebedor}\n\nClave Pix 👇',
    en: '💸 Payment via Pix\nAmount: *{valor}*\nRecipient: {recebedor}\n\nPix key 👇',
  },
  pede_comprovante: {
    'pt-BR': 'Assim que pagar, me manda o *comprovante* aqui (print ou PDF) que eu já coloco na fila de produção 💖',
    'pt-PT': 'Assim que pagares, envia-me o *comprovativo* aqui (imagem ou PDF) e coloco já na fila de produção 💖',
    es: 'En cuanto pagues, envíame el *comprobante* aquí (captura o PDF) y lo pongo en la cola de producción 💖',
    en: 'Once you pay, send me the *receipt* here (screenshot or PDF) and I will put it in the production queue 💖',
  },
  conferindo: {
    'pt-BR': 'Recebi seu comprovante, {nome}! 🙏 Estou conferindo e já te confirmo, tá?',
    'pt-PT': 'Recebi o teu comprovativo, {nome}! 🙏 Estou a confirmar e já te digo, está bem?',
    es: '¡Recibí tu comprobante, {nome}! 🙏 Lo estoy revisando y enseguida te confirmo.',
    en: 'Got your receipt, {nome}! 🙏 Checking it now, I will confirm in a moment.',
  },
  pago_ok: {
    'pt-BR': 'Pagamento confirmado! ✅ Seu ensaio já entrou na fila de produção. Em até {prazo} minutos te mando as fotos 📸✨',
    'pt-PT': 'Pagamento confirmado! ✅ A tua sessão já entrou na fila de produção. Em até {prazo} minutos envio-te as fotos 📸✨',
    es: '¡Pago confirmado! ✅ Tu sesión ya entró en la cola de producción. En hasta {prazo} minutos te envío las fotos 📸✨',
    en: 'Payment confirmed! ✅ Your shoot is now in the production queue. I will send your photos within {prazo} minutes 📸✨',
  },
  comprovante_recusado: {
    'pt-BR': 'Amiga, não consegui confirmar esse pagamento 🥺 Confere se o valor é {valor} e se foi para a chave certa, e me manda o comprovante de novo?',
    'pt-PT': 'Não consegui confirmar este pagamento 🥺 Confirma se o valor é {valor} e se foi para a chave certa, e envia-me o comprovativo outra vez?',
    es: 'No pude confirmar este pago 🥺 ¿Revisas si el valor es {valor} y si fue a la clave correcta, y me envías el comprobante otra vez?',
    en: "I couldn't confirm this payment 🥺 Could you check the amount is {valor} and it went to the right key, then send the receipt again?",
  },
  confirmar_equipe: {
    'pt-BR': 'Boa pergunta! Vou confirmar com a equipe e já te respondo, tá? 💖',
    'pt-PT': 'Boa pergunta! Vou confirmar com a equipa e já te respondo, está bem? 💖',
    es: '¡Buena pregunta! Lo confirmo con el equipo y enseguida te respondo 💖',
    en: 'Great question! Let me check with the team and get right back to you 💖',
  },
  pedido_pago_duvida: {
    'pt-BR': 'Seu ensaio já está na fila de produção, {nome} 💖 Assim que ficar pronto eu te mando aqui!',
    'pt-PT': 'A tua sessão já está na fila de produção, {nome} 💖 Assim que ficar pronta envio-ta aqui!',
    es: 'Tu sesión ya está en la cola de producción, {nome} 💖 ¡En cuanto esté lista te la envío aquí!',
    en: "Your shoot is already in the production queue, {nome} 💖 I'll send it here as soon as it's ready!",
  },
  entrega_ajuste: {
    'pt-BR': '💖 Você tem *1 ajuste grátis* em até 24 h: é só me mandar o *número da foto* e o que quer mudar (ex.: "foto 03, cabelo mais claro").',
    'pt-PT': '💖 Tens *1 ajuste grátis* em até 24 h: envia-me o *número da foto* e o que queres mudar (ex.: "foto 03, cabelo mais claro").',
    es: '💖 Tienes *1 ajuste gratis* en hasta 24 h: envíame el *número de la foto* y qué quieres cambiar (ej.: "foto 03, pelo más claro").',
    en: '💖 You get *1 free adjustment* within 24 h: just send me the *photo number* and what to change (e.g. "photo 03, lighter hair").',
  },
  upsell_oferta: {
    'pt-BR': '🎁 Gostou? Leva *+{qtd} fotos* com *{desconto}% off*: de {valor_cheio} por *{valor}*. É só responder "quero mais" 😍',
    'pt-PT': '🎁 Gostaste? Leva *+{qtd} fotos* com *{desconto}% de desconto*: de {valor_cheio} por *{valor}*. Responde "quero mais" 😍',
    es: '🎁 ¿Te gustó? Llévate *+{qtd} fotos* con *{desconto}% de descuento*: de {valor_cheio} a *{valor}*. Responde "quiero más" 😍',
    en: '🎁 Loved it? Get *+{qtd} photos* at *{desconto}% off*: from {valor_cheio} to *{valor}*. Just reply "more" 😍',
  },
  upsell_poses: {
    'pt-BR': 'Oba! 🎉 Vou usar as mesmas fotos que você já me mandou. Me manda os números de *{qtd} poses* do catálogo:\n{link}',
    'pt-PT': 'Boa! 🎉 Vou usar as mesmas fotos que já me enviaste. Envia-me os números de *{qtd} poses* do catálogo:\n{link}',
    es: '¡Genial! 🎉 Usaré las mismas fotos que ya me enviaste. Envíame los números de *{qtd} poses* del catálogo:\n{link}',
    en: "Yay! 🎉 I'll use the same photos you already sent. Send me the numbers of *{qtd} poses* from the catalog:\n{link}",
  },
  previa_entregue: {
    'pt-BR': 'Essa é a sua *prévia grátis* ✨ (com marca d\'água). Gostou? Fechando o pacote eu faço todas com mais capricho e sem marca 💖\n\n{tabela}',
    'pt-PT': 'Esta é a tua *prévia grátis* ✨ (com marca d\'água). Gostaste? Fechando o pacote faço todas com mais cuidado e sem marca 💖\n\n{tabela}',
    es: 'Esta es tu *vista previa gratis* ✨ (con marca de agua). ¿Te gustó? Si cierras el paquete las hago todas con más cuidado y sin marca 💖\n\n{tabela}',
    en: "This is your *free preview* ✨ (watermarked). Like it? Grab a package and I'll make them all with extra care and no watermark 💖\n\n{tabela}",
  },
  ajuste_pede_numero: {
    'pt-BR': 'Claro! Me diz o *número da foto* que você quer ajustar e o que mudar 💖',
    'pt-PT': 'Claro! Diz-me o *número da foto* que queres ajustar e o que mudar 💖',
    es: '¡Claro! Dime el *número de la foto* que quieres ajustar y qué cambiar 💖',
    en: 'Of course! Tell me the *photo number* you want adjusted and what to change 💖',
  },
  ajuste_pede_o_que: {
    'pt-BR': 'Anotado a foto {poses} ✍️ O que você quer mudar nela?',
    'pt-PT': 'Anotei a foto {poses} ✍️ O que queres mudar nela?',
    es: 'Anoté la foto {poses} ✍️ ¿Qué quieres cambiar?',
    en: 'Got photo {poses} ✍️ What would you like to change?',
  },
  ajuste_registrado: {
    'pt-BR': 'Perfeito! Seu ajuste da foto {poses} já foi para a produção 🔁 Te mando assim que ficar pronto!',
    'pt-PT': 'Perfeito! O teu ajuste da foto {poses} já foi para a produção 🔁 Envio-te assim que ficar pronto!',
    es: '¡Perfecto! Tu ajuste de la foto {poses} ya está en producción 🔁 ¡Te lo envío en cuanto esté listo!',
    en: "Perfect! Your adjustment for photo {poses} is in production 🔁 I'll send it as soon as it's ready!",
  },
  ajuste_expirado: {
    'pt-BR': 'Ah, o ajuste grátis vale por 24 h depois da entrega (ou já foi usado) 🥺 Vou chamar a equipe para ver o que dá para fazer, tá?',
    'pt-PT': 'O ajuste grátis vale 24 h depois da entrega (ou já foi usado) 🥺 Vou chamar a equipa para ver o que dá para fazer, está bem?',
    es: 'El ajuste gratis vale 24 h después de la entrega (o ya se usó) 🥺 Llamo al equipo para ver qué podemos hacer.',
    en: "The free adjustment is valid for 24 h after delivery (or it's already been used) 🥺 I'll ask the team what we can do.",
  },
  atraso: {
    'pt-BR': '{nome}, seu ensaio está levando um pouquinho mais que o normal porque estamos caprichando em cada foto 💖 Já já te mando, prometo!',
    'pt-PT': '{nome}, a tua sessão está a demorar um pouco mais do que o normal porque estamos a caprichar em cada foto 💖 Envio-te já já!',
    es: '{nome}, tu sesión está tardando un poquito más de lo normal porque estamos cuidando cada foto 💖 ¡Te la envío muy pronto!',
    en: "{nome}, your shoot is taking a little longer than usual because we're perfecting every photo 💖 It's coming very soon!",
  },
  hotmart_link: {
    'pt-BR': 'Perfeito! 💖 Você pode pagar aqui com segurança (cartão, na sua moeda): {pagar}\nAssim que o pagamento confirmar, seguimos por aqui 😉',
    'pt-PT': 'Perfeito! 💖 Podes pagar aqui em segurança (cartão, na tua moeda): {pagar}\nAssim que o pagamento for confirmado, continuamos por aqui 😉',
    es: '¡Perfecto! 💖 Podés pagar acá de forma segura (tarjeta, en tu moneda): {pagar}\nApenas se confirme el pago, seguimos por acá 😉',
    en: 'Perfect! 💖 You can pay here securely (card, in your currency): {pagar}\nAs soon as the payment is confirmed, we continue right here 😉',
  },
  hotmart_print: {
    'pt-BR': 'Não precisa mandar comprovante 😊 A confirmação chega aqui automaticamente em alguns minutos!',
    'pt-PT': 'Não precisas de enviar comprovativo 😊 A confirmação chega aqui automaticamente em alguns minutos!',
    es: 'No hace falta enviar comprobante 😊 ¡La confirmación llega acá automáticamente en unos minutos!',
    en: "No need to send a receipt 😊 The confirmation arrives here automatically within a few minutes!",
  },
  hotmart_lembrete: {
    'pt-BR': 'Quando quiser, é só pagar por aqui: {pagar} 😉',
    'pt-PT': 'Quando quiseres, é só pagar por aqui: {pagar} 😉',
    es: 'Cuando quieras, podés pagar acá: {pagar} 😉',
    en: 'Whenever you are ready, you can pay here: {pagar} 😉',
  },
  pacote_inexistente: {
    'pt-BR': 'Pacote de {pedido} fotos a gente não tem 😊 Os mais próximos são: {opcoes}. Qual você prefere? Me manda só o número da opção.',
    'pt-PT': 'Pacote de {pedido} fotos não temos 😊 Os mais próximos são: {opcoes}. Qual preferes? Envia-me só o número da opção.',
    es: 'No tenemos paquete de {pedido} fotos 😊 Los más cercanos son: {opcoes}. ¿Cuál prefieres? Envíame solo el número de la opción.',
    en: "We don't have a {pedido}-photo package 😊 The closest ones are: {opcoes}. Which one do you prefer? Just send me the option number.",
  },
  poses_demais_maior: {
    'pt-BR': 'Você escolheu {n} poses e o seu pacote é de {qtd} 😊 Duas opções:\n1️⃣ Fico com as {qtd} primeiras: {primeiras}\n2️⃣ Passo para o pacote de {prox_qtd} fotos por {valor} e faço todas\nMe responde 1 ou 2.',
    'pt-PT': 'Escolheste {n} poses e o teu pacote é de {qtd} 😊 Duas opções:\n1️⃣ Fico com as {qtd} primeiras: {primeiras}\n2️⃣ Passo para o pacote de {prox_qtd} fotos por {valor} e faço todas\nResponde 1 ou 2.',
    es: 'Elegiste {n} poses y tu paquete es de {qtd} 😊 Dos opciones:\n1️⃣ Me quedo con las {qtd} primeras: {primeiras}\n2️⃣ Paso al paquete de {prox_qtd} fotos por {valor} y hago todas\nRespóndeme 1 o 2.',
    en: 'You picked {n} poses and your package has {qtd} 😊 Two options:\n1️⃣ I keep the first {qtd}: {primeiras}\n2️⃣ I switch you to the {prox_qtd}-photo package for {valor} and do them all\nReply 1 or 2.',
  },
  poses_demais_corte: {
    'pt-BR': 'Você escolheu {n} poses e o pacote maior é de {qtd} 😊 Fico com as {qtd} primeiras: {primeiras}. Se quiser trocar alguma, é só me mandar os números.',
    'pt-PT': 'Escolheste {n} poses e o pacote maior é de {qtd} 😊 Fico com as {qtd} primeiras: {primeiras}. Se quiseres trocar alguma, envia-me os números.',
    es: 'Elegiste {n} poses y el paquete más grande es de {qtd} 😊 Me quedo con las {qtd} primeras: {primeiras}. Si quieres cambiar alguna, envíame los números.',
    en: 'You picked {n} poses and the biggest package has {qtd} 😊 I kept the first {qtd}: {primeiras}. If you want to swap any, just send me the numbers.',
  },
  pacote_trocado: {
    'pt-BR': 'Feito! ✅ Agora o seu pacote é de {qtd} fotos, por {valor}.',
    'pt-PT': 'Feito! ✅ Agora o teu pacote é de {qtd} fotos, por {valor}.',
    es: '¡Listo! ✅ Ahora tu paquete es de {qtd} fotos, por {valor}.',
    en: 'Done! ✅ Your package is now {qtd} photos, for {valor}.',
  },
  pagar_ja: {
    'pt-BR': 'Pra já garantir o seu ensaio, aqui está o pagamento 👇 Enquanto isso você me manda as fotos e as poses, tá?',
    'pt-PT': 'Para garantires já o teu ensaio, aqui está o pagamento 👇 Entretanto envias-me as fotos e as poses, está bem?',
    es: 'Para asegurar tu sesión, aquí tienes el pago 👇 Mientras tanto me envías las fotos y las poses, ¿sí?',
    en: "To lock in your photoshoot, here's the payment 👇 Meanwhile, send me the photos and the poses, ok?",
  },
  pago_ok_coleta: {
    'pt-BR': 'Pagamento confirmado! ✅ Assim que eu tiver tudo, seu ensaio entra na fila de produção 📸',
    'pt-PT': 'Pagamento confirmado! ✅ Assim que tiver tudo, o teu ensaio entra na fila de produção 📸',
    es: '¡Pago confirmado! ✅ En cuanto tenga todo, tu sesión entra en la fila de producción 📸',
    en: 'Payment confirmed! ✅ As soon as I have everything, your photoshoot goes into production 📸',
  },
  tudo_certo_producao: {
    'pt-BR': 'Tudo certo, {nome}! ✅ Pagamento, fotos e poses recebidos. Seu ensaio já entrou na fila de produção e em até {prazo} minutos te mando as fotos 📸✨',
    'pt-PT': 'Tudo certo, {nome}! ✅ Pagamento, fotos e poses recebidos. O teu ensaio já entrou na fila de produção e em até {prazo} minutos envio-te as fotos 📸✨',
    es: '¡Todo listo, {nome}! ✅ Pago, fotos y poses recibidos. Tu sesión ya entró en producción y en hasta {prazo} minutos te envío las fotos 📸✨',
    en: "All set, {nome}! ✅ Payment, photos and poses received. Your photoshoot is in production and I'll send the photos within {prazo} minutes 📸✨",
  },
  resposta_segura: {
    'pt-BR': 'Os valores e condições são exatamente os da tabela 😊 Posso te ajudar a escolher o melhor pacote pra você?',
    'pt-PT': 'Os valores e condições são exatamente os da tabela 😊 Posso ajudar-te a escolher o melhor pacote?',
    es: 'Los valores y condiciones son exactamente los de la tabla 😊 ¿Te ayudo a elegir el mejor paquete para ti?',
    en: 'Prices and terms are exactly the ones in the table 😊 Can I help you pick the best package for you?',
  },
  catalogo_de_novo: {
    'pt-BR': 'Pra facilitar, aqui está o catálogo de novo 👇\n{link}',
    'pt-PT': 'Para facilitar, aqui está o catálogo outra vez 👇\n{link}',
    es: 'Para que sea más fácil, aquí está el catálogo otra vez 👇\n{link}',
    en: "To make it easier, here's the catalog again 👇\n{link}",
  },
  rmk_tema: {
    'pt-BR': 'Oi, {nome}! Tudo bem? 😊 Já escolheu o tema do seu ensaio? É só me mandar o número.',
    'pt-PT': 'Olá, {nome}! Tudo bem? 😊 Já escolheste o tema da tua sessão? É só enviares o número.',
    es: '¡Hola, {nome}! ¿Todo bien? 😊 ¿Ya elegiste el tema de tu sesión? Solo envíame el número.',
    en: 'Hi {nome}! All good? 😊 Have you picked the theme for your photoshoot? Just send me the number.',
  },
  rmk_pacote: {
    'pt-BR': 'Oi, {nome}! E aí, já deu uma olhada no catálogo? 😍 Qual pacote combina mais com você?\n{link}',
    'pt-PT': 'Olá, {nome}! Já deste uma vista de olhos no catálogo? 😍 Qual pacote combina mais contigo?\n{link}',
    es: '¡Hola, {nome}! ¿Ya viste el catálogo? 😍 ¿Qué paquete va más contigo?\n{link}',
    en: 'Hi {nome}! Did you get a chance to look at the catalog? 😍 Which package suits you best?\n{link}',
  },
  rmk_coleta: {
    'pt-BR': 'Oi, {nome}! Tá conseguindo escolher as poses? 😊 O catálogo está aqui: {link}\nQualquer dúvida, me chama!',
    'pt-PT': 'Olá, {nome}! Estás a conseguir escolher as poses? 😊 O catálogo está aqui: {link}\nQualquer dúvida, diz!',
    es: '¡Hola, {nome}! ¿Pudiste elegir las poses? 😊 El catálogo está aquí: {link}\n¡Cualquier duda, escríbeme!',
    en: 'Hi {nome}! Managing to pick the poses? 😊 The catalog is here: {link}\nAny questions, just ask!',
  },
  rmk_pagamento: {
    'pt-BR': 'Oi, {nome}! Tudo certo? 😊 Conseguiu fazer o pagamento de {valor}? Assim que pagar, me manda o comprovante que já coloco na produção 💖 Ficou alguma dúvida?',
    'pt-PT': 'Olá, {nome}! Tudo bem? 😊 Conseguiste fazer o pagamento de {valor}? Assim que pagares, envia-me o comprovativo e coloco logo em produção 💖 Ficou alguma dúvida?',
    es: '¡Hola, {nome}! ¿Todo bien? 😊 ¿Pudiste hacer el pago de {valor}? En cuanto pagues, envíame el comprobante y lo pongo en producción 💖 ¿Te quedó alguna duda?',
    en: 'Hi {nome}! All good? 😊 Were you able to make the {valor} payment? Once you pay, send me the receipt and I will start production 💖 Any questions?',
  },
  rmk_duvida: {
    'pt-BR': 'Ficou com alguma dúvida, {nome}? Posso te ajudar a escolher 😊',
    'pt-PT': 'Ficaste com alguma dúvida, {nome}? Posso ajudar-te a escolher 😊',
    es: '¿Te quedó alguna duda, {nome}? Te ayudo a elegir 😊',
    en: 'Any questions, {nome}? I can help you choose 😊',
  },
  rmk_previa_final: {
    'pt-BR': 'Última coisinha, {nome} 💖 Pra você ver como fica, eu faço 1 foto de PRÉVIA grátis com o seu rosto. Quer? É só responder SIM.',
    'pt-PT': 'Só mais uma coisa, {nome} 💖 Para veres como fica, faço 1 foto de PRÉVIA grátis com o teu rosto. Queres? Responde SIM.',
    es: 'Una última cosita, {nome} 💖 Para que veas cómo queda, hago 1 foto de PREVIA gratis con tu rostro. ¿Quieres? Responde SÍ.',
    en: "One last thing, {nome} 💖 So you can see how it looks, I'll make 1 free PREVIEW photo with your face. Want it? Just reply YES.",
  },
  previa_pede_pose: {
    'pt-BR': 'Oba! 💖 Já tenho as suas fotos. Me diz o número de 1 pose do catálogo pra prévia:\n{link}',
    'pt-PT': 'Boa! 💖 Já tenho as tuas fotos. Diz-me o número de 1 pose do catálogo para a prévia:\n{link}',
    es: '¡Genial! 💖 Ya tengo tus fotos. Dime el número de 1 pose del catálogo para la previa:\n{link}',
    en: 'Yay! 💖 I already have your photos. Tell me the number of 1 pose from the catalog for the preview:\n{link}',
  },
  poses_antes_pacote: {
    'pt-BR': 'Anotei a(s) pose(s) {poses} ✅ Agora me diz qual pacote você quer 👇',
    'pt-PT': 'Anotei a(s) pose(s) {poses} ✅ Agora diz-me qual pacote queres 👇',
    es: 'Anoté la(s) pose(s) {poses} ✅ Ahora dime qué paquete quieres 👇',
    en: 'Got pose(s) {poses} ✅ Now tell me which package you want 👇',
  },
  foto_cedo_ambas: {
    'pt-BR': 'Recebi suas fotos ✅ Já guardei aqui!',
    'pt-PT': 'Recebi as tuas fotos ✅ Já guardei aqui!',
    es: '¡Recibí tus fotos ✅ Ya las guardé!',
    en: 'Got your photos ✅ Saved them!',
  },
  foto_cedo_rosto: {
    'pt-BR': 'Recebi a foto do rosto ✅ Depois vou precisar também de 1 de corpo inteiro.',
    'pt-PT': 'Recebi a foto do rosto ✅ Depois vou precisar também de 1 de corpo inteiro.',
    es: 'Recibí la foto de tu cara ✅ Después también voy a necesitar 1 de cuerpo entero.',
    en: "Got the face photo ✅ Later I'll also need 1 full-body photo.",
  },
  foto_cedo_corpo: {
    'pt-BR': 'Recebi sua foto ✅ Depois vou precisar também de 1 foto do ROSTO, de frente e bem nítida (tipo selfie).',
    'pt-PT': 'Recebi a tua foto ✅ Depois vou precisar também de 1 foto do ROSTO, de frente e bem nítida (tipo selfie).',
    es: 'Recibí tu foto ✅ Después también voy a necesitar 1 foto de tu CARA, de frente y bien nítida (tipo selfie).',
    en: "Got your photo ✅ Later I'll also need 1 FACE photo, from the front and sharp (like a selfie).",
  },
  falta_foto_cliente: {
    'pt-BR': 'Pra eu fazer as suas fotos, falta {faltam} 📸 Pode me mandar aqui?',
    'pt-PT': 'Para fazer as tuas fotos, falta {faltam} 📸 Podes enviar-me aqui?',
    es: 'Para hacer tus fotos, me falta {faltam} 📸 ¿Me la envías por aquí?',
    en: 'To make your photos, I still need {faltam} 📸 Could you send it here?',
  },
  hotmart_link_coleta: {
    'pt-BR': '💳 Pagamento (cartão, na sua moeda) para garantir o seu ensaio: {pagar}\nVocê pode pagar agora ou depois de escolher as poses — eu sigo te ajudando aqui 😉',
    'pt-PT': '💳 Pagamento (cartão, na tua moeda) para garantir a tua sessão: {pagar}\nPodes pagar agora ou depois de escolher as poses — continuo a ajudar-te aqui 😉',
    es: '💳 Pago (tarjeta, en tu moneda) para asegurar tu sesión: {pagar}\nPodés pagar ahora o después de elegir las poses — yo te sigo ayudando acá 😉',
    en: '💳 Payment (card, in your currency) to lock in your photoshoot: {pagar}\nYou can pay now or after picking the poses — I will keep helping you here 😉',
  },
  explico_passo: {
    'pt-BR': 'Calma, te explico 😊',
    'pt-PT': 'Calma, eu explico 😊',
    es: 'Tranqui, te explico 😊',
    en: 'No worries, let me explain 😊',
  },
  explica_pagamento_hotmart: {
    'pt-BR': 'O link de pagamento é para garantir o ensaio: você paga com cartão, e assim que eu tiver as poses e as fotos, sua sessão entra em produção 📸',
    'pt-PT': 'O link de pagamento é para garantir a sessão: pagas com cartão e, assim que tiver as poses e as fotos, a tua sessão entra em produção 📸',
    es: 'El link de pago es para asegurar tu sesión: pagás con tarjeta y, apenas tenga las poses y las fotos, tu sesión entra en producción 📸',
    en: 'The payment link is to lock in your photoshoot: you pay by card and, once I have the poses and photos, it goes into production 📸',
  },
  explica_pagamento_pix: {
    'pt-BR': 'O Pix é para garantir o ensaio: assim que você pagar e eu tiver as poses e as fotos, sua sessão entra em produção 📸 Depois do Pix, me manda o comprovante aqui.',
    'pt-PT': 'O Pix é para garantir a sessão: assim que pagares e eu tiver as poses e as fotos, a tua sessão entra em produção 📸 Depois envia-me o comprovativo aqui.',
    es: 'El Pix es para asegurar tu sesión: apenas pagues y tenga las poses y las fotos, entra en producción 📸 Después enviame el comprobante acá.',
    en: 'The Pix payment locks in your photoshoot: once you pay and I have the poses and photos, it goes into production 📸 Then send me the receipt here.',
  },
  pausa_ok: {
    'pt-BR': 'Claro, sem pressa! 💖 Fico aqui te esperando, é só me chamar.',
    'pt-PT': 'Claro, sem pressa! 💖 Fico aqui à tua espera, é só dizeres.',
    es: '¡Claro, sin apuro! 💖 Acá te espero, solo escribime.',
    en: "Of course, no rush! 💖 I'll be right here, just message me.",
  },
  rmk_suave: {
    'pt-BR': 'Oi, {nome}! Passando só pra saber se conseguiram conversar 😊 Qualquer dúvida, estou por aqui. Sem pressa nenhuma 💖',
    'pt-PT': 'Olá, {nome}! Só a passar para saber se conseguiram conversar 😊 Qualquer dúvida, estou por aqui. Sem pressa nenhuma 💖',
    es: '¡Hola, {nome}! Solo paso a saber si pudieron conversar 😊 Cualquier duda, acá estoy. Sin ningún apuro 💖',
    en: "Hi {nome}! Just checking whether you got a chance to talk it over 😊 Any questions, I'm here. No rush at all 💖",
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
