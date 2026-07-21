export interface PageTemplate {
  id: string
  name: string
  page_type: string
  description: string
  craft_json: object
}

const makeRoot = (bgColor: string, nodes: string[], extraProps: object = {}) => ({
  type: { resolvedName: 'PageRootNode' },
  isCanvas: true,
  props: { backgroundColor: bgColor, ...extraProps },
  displayName: 'Página',
  custom: {},
  hidden: false,
  nodes,
  linkedNodes: {},
})

const makeNode = (resolvedName: string, props: object, parent: string) => ({
  type: { resolvedName },
  isCanvas: false,
  props,
  displayName: resolvedName,
  custom: {},
  parent,
  hidden: false,
  nodes: [],
  linkedNodes: {},
})

// ─── CAPTURA ────────────────────────────────────────────────────────────────

export const captureTemplate = {
  ROOT: makeRoot('#f8fafc', ['hero1', 'form1']),
  hero1: { ...makeNode('HeroSimple', { headline: 'Transforme sua vida em 30 dias', subheadline: 'Descubra o método que já ajudou mais de 10.000 pessoas a alcançar seus objetivos', ctaText: 'Quero Começar Agora →', ctaColor: '#6366F1', ctaLink: '#form', align: 'center', bgColor: '#ffffff', paddingY: 80 }, 'ROOT') },
  form1: { ...makeNode('CaptureForm', { title: 'Garanta sua vaga gratuita', namePlaceholder: 'Seu nome completo', emailPlaceholder: 'Seu melhor e-mail', phonePlaceholder: 'Seu WhatsApp', showPhone: true, btnText: 'Quero Participar Agora →', btnColor: '#6366F1', bgColor: '#f8fafc', paddingY: 60 }, 'ROOT') },
}

// ─── VSL ────────────────────────────────────────────────────────────────────

export const vslTemplate = {
  ROOT: makeRoot('#0f172a', ['hero1', 'video1', 'cta1']),
  hero1: { ...makeNode('HeroSimple', { headline: 'Assista ao vídeo completo antes de fechar esta página', subheadline: 'Esta apresentação gratuita revela o segredo que ninguém está te contando', ctaText: '', ctaColor: '#6366F1', ctaLink: '', align: 'center', bgColor: '#0f172a', paddingY: 40 }, 'ROOT') },
  video1: { ...makeNode('VideoPlayer', { videoUrl: '', caption: '', bgColor: '#0f172a', paddingY: 20, aspectRatio: '16/9' }, 'ROOT') },
  cta1: { ...makeNode('CtaButton', { text: '✅ Sim! Quero Aproveitar Esta Oportunidade →', subtext: 'Garantia incondicional de 7 dias', btnColor: '#16A34A', textColor: '#ffffff', link: '#', size: 'xl', align: 'center', bgColor: '#0f172a', paddingY: 40 }, 'ROOT') },
}

// ─── ENTREGA ─────────────────────────────────────────────────────────────────

export const deliveryTemplate = {
  ROOT: makeRoot('#f0fdf4', ['hero1', 'delivery1']),
  hero1: { ...makeNode('HeroSimple', { headline: '🎉 Parabéns! Seu acesso está pronto', subheadline: 'Clique no botão abaixo para acessar o produto que você adquiriu', ctaText: '', ctaColor: '#16A34A', ctaLink: '', align: 'center', bgColor: '#f0fdf4', paddingY: 60 }, 'ROOT') },
  delivery1: { ...makeNode('DeliveryCard', { headline: 'Seu acesso está liberado! 🎉', description: 'Parabéns pela sua decisão! Clique abaixo para acessar todo o conteúdo que você adquiriu.', accessLink: '#', accessLinkText: 'Acessar meu conteúdo agora →', supportEmail: 'suporte@seudominio.com.br', items: ['Acesso à área de membros por 12 meses', 'Suporte por e-mail em até 24h úteis', 'Bônus exclusivos liberados agora'], bgColor: '#f0fdf4', cardColor: '#ffffff', accentColor: '#16A34A', paddingY: 40 }, 'ROOT') },
}

// ─── OBRIGADO ────────────────────────────────────────────────────────────────

export const thankYouTemplate = {
  ROOT: makeRoot('#f0fdf4', ['ty1', 'cta1']),
  ty1: { ...makeNode('ThankYouHero', { headline: 'Obrigado, {primeiro_nome}! 🎉', subheadline: 'Sua inscrição foi confirmada com sucesso. Verifique seu e-mail para mais detalhes.', nextStep: 'Verifique seu WhatsApp para os próximos passos', showCta: true, ctaText: 'Entrar no Grupo →', ctaLink: '', showCountdown: false, countdownSeconds: 5, bgColor: '#f0fdf4', accentColor: '#16A34A', paddingY: 80 }, 'ROOT') },
  cta1: { ...makeNode('CtaButton', { text: 'Acessar o Grupo VIP →', subtext: '', btnColor: '#16A34A', textColor: '#ffffff', link: '#', size: 'lg', align: 'center', bgColor: '#f0fdf4', paddingY: 20 }, 'ROOT') },
}

// ─── CARTA DE VENDAS COMPLETA (TOP) ──────────────────────────────────────────

export const salesTemplate = {
  ROOT: makeRoot('#ffffff', [
    'banner1',
    'hero1',
    'scarcity1',
    'video1',
    'benefits1',
    'author1',
    'testimonial1',
    'beforeafter1',
    'bonus1',
    'guarantee1',
    'countdown1',
    'price1',
    'cta1',
    'faq1',
    'cta2',
  ]),

  banner1: {
    ...makeNode('ScarcityBar', {
      text: '⚠️ ATENÇÃO: Esta oferta expira em breve — apenas para os primeiros 50 inscritos',
      filledPercent: 78,
      barColor: '#DC2626',
      bgColor: '#1e1b4b',
      textColor: '#ffffff',
      paddingY: 12,
    }, 'ROOT'),
  },

  hero1: {
    ...makeNode('HeroSimple', {
      headline: 'Como Sair do Zero e Faturar R$ 10.000/mês Vendendo Infoprodutos — Mesmo Sem Audiência, Sem Experiência e Sem Dinheiro Para Investir em Tráfego',
      subheadline: 'O método passo a passo que mais de 3.200 alunos já usaram para criar, lançar e escalar seu produto digital nos últimos 12 meses',
      ctaText: 'QUERO GARANTIR MINHA VAGA COM DESCONTO →',
      ctaColor: '#DC2626',
      ctaLink: '#preco',
      align: 'center',
      bgColor: '#0f172a',
      paddingY: 80,
    }, 'ROOT'),
  },

  scarcity1: {
    ...makeNode('ScarcityBar', {
      text: '🔥 782 pessoas estão vendo esta página agora • 34 vagas restantes neste lote',
      filledPercent: 92,
      barColor: '#EA580C',
      bgColor: '#fff7ed',
      textColor: '#9a3412',
      paddingY: 14,
    }, 'ROOT'),
  },

  video1: {
    ...makeNode('VideoPlayer', {
      videoUrl: '',
      caption: '👆 Assista ao vídeo completo antes de rolar a página',
      bgColor: '#0f172a',
      paddingY: 40,
      aspectRatio: '16/9',
    }, 'ROOT'),
  },

  benefits1: {
    ...makeNode('BenefitsList', {
      title: 'O Que Você Vai Dominar Dentro do Programa:',
      items: [
        '✅ Como validar sua ideia de produto em 48h antes de criar uma linha sequer de conteúdo',
        '✅ O funil de vendas de 3 etapas que converte frios em compradores em menos de 7 dias',
        '✅ A estratégia de tráfego orgânico que gerou R$ 180k em vendas sem gastar R$ 1 em anúncios',
        '✅ Como criar uma página de vendas que vende enquanto você dorme (usamos essa mesma estrutura aqui)',
        '✅ O script de lançamento relâmpago que fatura R$ 50k em 5 dias com uma lista de apenas 300 pessoas',
        '✅ Como montar uma esteira de produtos e criar receita recorrente todos os meses',
      ],
      iconColor: '#16A34A',
      bgColor: '#f8fafc',
      paddingY: 72,
    }, 'ROOT'),
  },

  author1: {
    ...makeNode('AuthorBio', {
      photoUrl: '',
      name: 'João Mendes',
      jobTitle: 'Especialista em Infoprodutos e Marketing Digital',
      bio: 'Nos últimos 3 anos saí de R$ 0 para mais de R$ 2,4 milhões faturados vendendo infoprodutos. Já formei mais de 3.200 alunos que hoje faturam online — de professores a médicos, de donas de casa a engenheiros. Desenvolvi o método que você vai aprender dentro do programa depois de testar o que funciona (e muito do que não funciona) na prática.',
      instagramUrl: '',
      youtubeUrl: '',
      whatsappNumber: '',
      bgColor: '#ffffff',
      paddingY: 64,
    }, 'ROOT'),
  },

  testimonial1: {
    ...makeNode('Testimonial', {
      quote: 'Em 45 dias de programa eu fiz R$ 23.400 com meu primeiro produto digital. Nunca imaginei que seria possível tão rápido. O método é realmente diferente de tudo que já vi — prático, direto e sem enrolação.',
      name: 'Carla Souza',
      role: 'Ex-professora, agora infoprodutora em tempo integral',
      stars: 5,
      bgColor: '#f0fdf4',
      paddingY: 60,
    }, 'ROOT'),
  },

  beforeafter1: {
    ...makeNode('BeforeAfter', {
      title: 'A Diferença de Ter o Método Certo',
      beforeTitle: 'Sem o Programa',
      afterTitle: 'Com o Programa',
      beforeItems: [
        'Tentando criar produto sem saber se vai vender',
        'Gastando dinheiro em tráfego sem retorno',
        'Página de vendas que não converte',
        'Trabalhando 12h/dia sem escala',
        'Sem saber por onde começar',
      ],
      afterItems: [
        'Produto validado antes de criar',
        'Tráfego orgânico gerando vendas todos os dias',
        'Página que converte 24/7 no automático',
        'Funil rodando enquanto você descansa',
        'Passo a passo claro do zero ao R$ 10k/mês',
      ],
      bgColor: '#f8fafc',
      paddingY: 72,
    }, 'ROOT'),
  },

  bonus1: {
    ...makeNode('BonusSection', {
      title: '🎁 Bônus Exclusivos Para Quem Entrar Hoje',
      items: [
        {
          emoji: '🗂️',
          name: 'Kit de Templates de Página de Vendas',
          originalValue: 'R$ 297',
          description: '12 modelos prontos das páginas que mais convertem no Brasil — edite em minutos',
        },
        {
          emoji: '📱',
          name: 'Grupo VIP de Mentorias ao Vivo',
          originalValue: 'R$ 497',
          description: '4 encontros ao vivo por mês para tirar dúvidas e ter feedbacks do seu negócio',
        },
        {
          emoji: '🎯',
          name: 'Script de Copy para WhatsApp',
          originalValue: 'R$ 197',
          description: 'As mensagens prontas que fecham vendas pelo WhatsApp em menos de 24h',
        },
        {
          emoji: '📊',
          name: 'Planilha de Gestão Financeira do Infoprodutor',
          originalValue: 'R$ 97',
          description: 'Controle faturamento, custos, impostos e projeções de crescimento',
        },
      ],
      bgColor: '#fffbeb',
      paddingY: 72,
    }, 'ROOT'),
  },

  guarantee1: {
    ...makeNode('Guarantee', {
      days: 30,
      title: 'Garantia Incondicional de 30 Dias',
      text: 'Se em até 30 dias após a sua inscrição você não estiver 100% satisfeito com o conteúdo, basta enviar um e-mail e devolvemos cada centavo do seu investimento. Sem burocracia, sem questionamentos. Você não tem nada a perder — e um negócio digital inteiro a ganhar.',
      sealColor: '#16a34a',
      bgColor: '#f0fdf4',
      textColor: '#111827',
      paddingY: 64,
    }, 'ROOT'),
  },

  countdown1: {
    ...makeNode('CountdownTimer', {
      mode: 'duration',
      durationMinutes: 20,
      title: '⏳ Esta oferta expira em:',
      subtitle: 'Após o prazo o preço volta para R$ 997',
      onZeroAction: 'message',
      onZeroMessage: 'Esta oferta expirou. Entre em contato para verificar disponibilidade.',
      bgColor: '#1e1b4b',
      textColor: '#ffffff',
      boxBg: '#312e81',
      paddingY: 48,
    }, 'ROOT'),
  },

  price1: {
    ...makeNode('PriceSection', {
      badge: '🔥 Oferta de Lançamento — apenas neste lote',
      fromPrice: 'R$ 997',
      mainPrice: 'R$ 297',
      installments: '12x de R$ 28,65 (ou R$ 247 à vista)',
      ctaText: '✅ GARANTIR MINHA VAGA AGORA →',
      ctaLink: '#',
      ctaColor: '#DC2626',
      bgColor: '#fff7ed',
      paddingY: 64,
    }, 'ROOT'),
  },

  cta1: {
    ...makeNode('CtaButton', {
      text: '🔒 QUERO GARANTIR MINHA VAGA COM DESCONTO →',
      subtext: '🔐 Pagamento 100% seguro  •  ✅ Garantia de 30 dias  •  📦 Acesso imediato',
      btnColor: '#DC2626',
      textColor: '#ffffff',
      link: '#',
      size: 'xl',
      align: 'center',
      bgColor: '#ffffff',
      paddingY: 48,
    }, 'ROOT'),
  },

  faq1: {
    ...makeNode('FaqAccordion', {
      title: 'Perguntas Frequentes',
      items: [
        {
          question: 'Preciso ter experiência com marketing digital?',
          answer: 'Não. O programa foi criado para quem está começando do zero. O método vai do básico ao avançado com linguagem simples e prática.',
        },
        {
          question: 'Quanto tempo vou levar para ver resultados?',
          answer: 'Depende do seu ritmo de implementação. Alunos dedicados têm feito suas primeiras vendas entre 2 e 6 semanas após o início.',
        },
        {
          question: 'Precisa ter um produto criado para entrar?',
          answer: 'Não! Um dos módulos iniciais ensina exatamente como escolher e validar seu nicho antes de criar qualquer coisa.',
        },
        {
          question: 'Terei acesso a suporte durante o programa?',
          answer: 'Sim. Você terá acesso ao grupo VIP de alunos e às mentorias ao vivo mensais incluídas como bônus.',
        },
        {
          question: 'Qual o prazo da garantia?',
          answer: '30 dias corridos. Se não ficar satisfeito por qualquer motivo, devolvemos 100% do valor sem perguntas.',
        },
        {
          question: 'Por quanto tempo terei acesso ao conteúdo?',
          answer: 'Acesso vitalício. Paga uma vez e acessa para sempre, incluindo todas as atualizações futuras do programa.',
        },
      ],
      onlyOneOpen: true,
      bgColor: '#f8fafc',
      textColor: '#111827',
      paddingY: 72,
    }, 'ROOT'),
  },

  cta2: {
    ...makeNode('CtaButton', {
      text: '🚀 SIM! QUERO TRANSFORMAR MINHA VIDA AGORA →',
      subtext: 'Não perca mais tempo — cada dia que passa é dinheiro que você deixa de faturar',
      btnColor: '#DC2626',
      textColor: '#ffffff',
      link: '#',
      size: 'xl',
      align: 'center',
      bgColor: '#0f172a',
      paddingY: 64,
    }, 'ROOT'),
  },
}

// ─── CAPTURA PREMIUM (gradiente + selo + prova social) ───────────────────────

export const capturePremiumTemplate = {
  ROOT: makeRoot('#0f172a', ['hero1', 'benefits1', 'testimonial1', 'form1', 'faq1'], { bgGradient: true, bgGradientTo: '#1e1b4b', fontFamily: 'Poppins' }),
  hero1: { ...makeNode('HeroSimple', { badge: '🎁 100% GRATUITO — VAGAS LIMITADAS', headline: 'A Estratégia Que Está Gerando Leads Todos os Dias no Automático', subheadline: 'Aula gratuita de 40 minutos revelando o passo a passo — sem enrolação e sem precisar aparecer', ctaText: 'QUERO ASSISTIR AGORA →', ctaColor: '#8B5CF6', ctaLink: '#form', align: 'center', bgColor: '#0f172a', bgGradient: true, bgGradientTo: '#312e81', textColor: '#ffffff', paddingY: 90 }, 'ROOT') },
  benefits1: { ...makeNode('BenefitsList', { title: 'O que você vai descobrir nesta aula:', items: ['✅ O funil de 3 mensagens que converte seguidor em cliente', '✅ Como automatizar o atendimento sem parecer robô', '✅ O erro nº 1 que faz você perder vendas no WhatsApp', '✅ Como escalar sem contratar equipe'], iconColor: '#8B5CF6', bgColor: '#ffffff', paddingY: 64 }, 'ROOT') },
  testimonial1: { ...makeNode('Testimonial', { quote: 'Apliquei o que aprendi na aula e em 2 semanas dobrei minha taxa de resposta. Conteúdo direto ao ponto.', name: 'Renata Lima', role: 'Gestora de tráfego', stars: 5, bgColor: '#f5f3ff', paddingY: 56 }, 'ROOT') },
  form1: { ...makeNode('CaptureForm', { title: '🎟 Garanta seu acesso gratuito', namePlaceholder: 'Seu nome', emailPlaceholder: 'Seu melhor e-mail', phonePlaceholder: 'Seu WhatsApp', showPhone: true, btnText: 'GARANTIR MINHA VAGA →', btnColor: '#8B5CF6', bgColor: '#ffffff', paddingY: 64 }, 'ROOT') },
  faq1: { ...makeNode('FaqAccordion', { title: 'Perguntas frequentes', items: [ { question: 'A aula é realmente gratuita?', answer: 'Sim, 100% gratuita. Você só precisa se inscrever com seu e-mail.' }, { question: 'Quando recebo o acesso?', answer: 'Imediatamente após a inscrição, no seu e-mail e WhatsApp.' }, { question: 'Serve pra quem está começando?', answer: 'Sim — o conteúdo foi pensado pra funcionar mesmo pra quem está no zero.' } ], onlyOneOpen: true, bgColor: '#f8fafc', textColor: '#111827', paddingY: 56 }, 'ROOT') },
}

// ─── ISCA DIGITAL / E-BOOK ───────────────────────────────────────────────────

export const leadMagnetTemplate = {
  ROOT: makeRoot('#f8fafc', ['hero1', 'benefits1', 'form1', 'author1'], { fontFamily: 'Inter' }),
  hero1: { ...makeNode('HeroSimple', { badge: '📕 E-BOOK GRATUITO', headline: 'Baixe o Guia Completo e Comece Hoje', subheadline: 'O material que já ajudou centenas de pessoas a dar o primeiro passo — direto no seu e-mail', ctaText: 'BAIXAR AGORA →', ctaColor: '#0EA5E9', ctaLink: '#form', align: 'center', bgColor: '#ffffff', paddingY: 80, imageUrl: '' }, 'ROOT') },
  benefits1: { ...makeNode('BenefitsList', { title: 'Dentro do guia você encontra:', items: ['✅ Checklist pronto pra aplicar hoje', '✅ Os 5 erros que travam seus resultados', '✅ Modelos e exemplos reais', '✅ Plano de ação de 7 dias'], iconColor: '#0EA5E9', bgColor: '#f8fafc', paddingY: 56 }, 'ROOT') },
  form1: { ...makeNode('CaptureForm', { title: 'Receba o e-book no seu e-mail', namePlaceholder: 'Seu nome', emailPlaceholder: 'Seu melhor e-mail', showPhone: false, btnText: 'QUERO O E-BOOK →', btnColor: '#0EA5E9', bgColor: '#ffffff', paddingY: 56 }, 'ROOT') },
  author1: { ...makeNode('AuthorBio', { photoUrl: '', name: 'Seu Nome', jobTitle: 'Autor(a) do guia', bio: 'Escreva aqui uma bio curta que gere autoridade: sua experiência, seus resultados e por que vale a pena baixar o material.', bgColor: '#f8fafc', paddingY: 56 }, 'ROOT') },
}

// ─── WEBINÁRIO / EVENTO AO VIVO ──────────────────────────────────────────────

export const webinarTemplate = {
  ROOT: makeRoot('#022c22', ['hero1', 'countdown1', 'benefits1', 'form1'], { bgGradient: true, bgGradientTo: '#064e3b', fontFamily: 'Montserrat' }),
  hero1: { ...makeNode('HeroSimple', { badge: '🔴 EVENTO AO VIVO E GRATUITO', headline: 'Workshop: Do Zero à Primeira Venda em 7 Dias', subheadline: 'Uma noite, um plano completo. Participe ao vivo e saia com o passo a passo pronto pra aplicar', ctaText: 'QUERO PARTICIPAR →', ctaColor: '#10B981', ctaLink: '#form', align: 'center', bgColor: '#022c22', bgGradient: true, bgGradientTo: '#065f46', textColor: '#ffffff', paddingY: 90 }, 'ROOT') },
  countdown1: { ...makeNode('CountdownTimer', { mode: 'duration', durationMinutes: 60 * 24, title: '⏳ O evento começa em:', subtitle: 'Inscreva-se antes que as vagas acabem', onZeroAction: 'message', onZeroMessage: 'As inscrições deste lote encerraram.', bgColor: '#064e3b', textColor: '#ffffff', boxBg: '#065f46', paddingY: 48 }, 'ROOT') },
  benefits1: { ...makeNode('BenefitsList', { title: 'No evento você vai aprender:', items: ['✅ Como escolher o produto certo pra começar', '✅ O script de oferta que converte no primeiro contato', '✅ Como gerar os primeiros leads sem investir em anúncio', '✅ O plano de 7 dias completo, slide a slide'], iconColor: '#10B981', bgColor: '#ffffff', paddingY: 64 }, 'ROOT') },
  form1: { ...makeNode('CaptureForm', { title: '🎟 Inscrição gratuita', namePlaceholder: 'Seu nome', emailPlaceholder: 'Seu melhor e-mail', phonePlaceholder: 'WhatsApp (receba o link por lá)', showPhone: true, btnText: 'CONFIRMAR MINHA VAGA →', btnColor: '#10B981', bgColor: '#f0fdf4', paddingY: 64 }, 'ROOT') },
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: 'capture',
    name: 'Captura Minimalista',
    page_type: 'capture',
    description: 'Hero + formulário de captura simples',
    craft_json: captureTemplate,
  },
  {
    id: 'vsl',
    name: 'VSL Clássica',
    page_type: 'vsl',
    description: 'Hero + vídeo de vendas + botão de ação',
    craft_json: vslTemplate,
  },
  {
    id: 'delivery',
    name: 'Entrega Simples',
    page_type: 'delivery',
    description: 'Hero + card de entrega do produto',
    craft_json: deliveryTemplate,
  },
  {
    id: 'thankyou',
    name: 'Obrigado Simples',
    page_type: 'thankyou',
    description: 'Confirmação com check animado + CTA',
    craft_json: thankYouTemplate,
  },
  {
    id: 'sales',
    name: 'Carta de Vendas Completa',
    page_type: 'sales',
    description: 'Página de vendas profissional de alta conversão — 15 seções',
    craft_json: salesTemplate,
  },
  {
    id: 'capture-premium',
    name: 'Captura Premium (aula gratuita)',
    page_type: 'capture',
    description: 'Gradiente escuro + selo + prova social + FAQ — visual de lançamento',
    craft_json: capturePremiumTemplate,
  },
  {
    id: 'lead-magnet',
    name: 'Isca Digital (e-book)',
    page_type: 'capture',
    description: 'Página de download de material gratuito com bio de autoridade',
    craft_json: leadMagnetTemplate,
  },
  {
    id: 'webinar',
    name: 'Webinário / Evento ao Vivo',
    page_type: 'capture',
    description: 'Evento com contagem regressiva e inscrição via WhatsApp',
    craft_json: webinarTemplate,
  },
]
