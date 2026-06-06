export interface PageTemplate {
  id: string
  name: string
  page_type: string
  description: string
  craft_json: object
}

const makeRoot = (bgColor: string, nodes: string[]) => ({
  type: { resolvedName: 'PageRootNode' },
  isCanvas: true,
  props: { backgroundColor: bgColor },
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

export const captureTemplate = {
  ROOT: makeRoot('#f8fafc', ['hero1', 'form1']),
  hero1: { ...makeNode('HeroSimple', { headline: 'Transforme sua vida em 30 dias', subheadline: 'Descubra o método que já ajudou mais de 10.000 pessoas a alcançar seus objetivos', ctaText: 'Quero Começar Agora →', ctaColor: '#6366F1', ctaLink: '#form', align: 'center', bgColor: '#ffffff', paddingY: 80 }, 'ROOT') },
  form1: { ...makeNode('CaptureForm', { title: 'Garanta sua vaga gratuita', namePlaceholder: 'Seu nome completo', emailPlaceholder: 'Seu melhor e-mail', phonePlaceholder: 'Seu WhatsApp', showPhone: true, btnText: 'Quero Participar Agora →', btnColor: '#6366F1', bgColor: '#f8fafc', paddingY: 60 }, 'ROOT') },
}

export const vslTemplate = {
  ROOT: makeRoot('#0f172a', ['hero1', 'video1', 'cta1']),
  hero1: { ...makeNode('HeroSimple', { headline: 'Assista ao vídeo completo antes de fechar esta página', subheadline: 'Esta apresentação gratuita revela o segredo que ninguém está te contando', ctaText: '', ctaColor: '#6366F1', ctaLink: '', align: 'center', bgColor: '#0f172a', paddingY: 40 }, 'ROOT') },
  video1: { ...makeNode('VideoPlayer', { videoUrl: '', caption: '', bgColor: '#0f172a', paddingY: 20, aspectRatio: '16/9' }, 'ROOT') },
  cta1: { ...makeNode('CtaButton', { text: '✅ Sim! Quero Aproveitar Esta Oportunidade →', subtext: 'Garantia incondicional de 7 dias', btnColor: '#16A34A', textColor: '#ffffff', link: '#', size: 'xl', align: 'center', bgColor: '#0f172a', paddingY: 40 }, 'ROOT') },
}

export const deliveryTemplate = {
  ROOT: makeRoot('#f0fdf4', ['hero1', 'delivery1']),
  hero1: { ...makeNode('HeroSimple', { headline: '🎉 Parabéns! Seu acesso está pronto', subheadline: 'Clique no botão abaixo para acessar o produto que você adquiriu', ctaText: '', ctaColor: '#16A34A', ctaLink: '', align: 'center', bgColor: '#f0fdf4', paddingY: 60 }, 'ROOT') },
  delivery1: { ...makeNode('DeliveryCard', { headline: 'Seu acesso está liberado! 🎉', description: 'Parabéns pela sua decisão! Clique abaixo para acessar todo o conteúdo que você adquiriu.', accessLink: '#', accessLinkText: 'Acessar meu conteúdo agora →', supportEmail: 'suporte@seudominio.com.br', items: ['Acesso à área de membros por 12 meses', 'Suporte por e-mail em até 24h úteis', 'Bônus exclusivos liberados agora'], bgColor: '#f0fdf4', cardColor: '#ffffff', accentColor: '#16A34A', paddingY: 40 }, 'ROOT') },
}

export const thankYouTemplate = {
  ROOT: makeRoot('#f0fdf4', ['ty1', 'cta1']),
  ty1: { ...makeNode('ThankYouHero', { headline: 'Obrigado, {primeiro_nome}! 🎉', subheadline: 'Sua inscrição foi confirmada com sucesso. Verifique seu e-mail para mais detalhes.', nextStep: 'Verifique seu WhatsApp para os próximos passos', showCta: true, ctaText: 'Entrar no Grupo →', ctaLink: '', showCountdown: false, countdownSeconds: 5, bgColor: '#f0fdf4', accentColor: '#16A34A', paddingY: 80 }, 'ROOT') },
  cta1: { ...makeNode('CtaButton', { text: 'Acessar o Grupo VIP →', subtext: '', btnColor: '#16A34A', textColor: '#ffffff', link: '#', size: 'lg', align: 'center', bgColor: '#f0fdf4', paddingY: 20 }, 'ROOT') },
}

export const salesTemplate = {
  ROOT: makeRoot('#ffffff', ['hero1', 'video1', 'benefits1', 'testimonial1', 'bonus1', 'guarantee1', 'faq1', 'price1', 'cta1']),
  hero1: { ...makeNode('HeroSimple', { headline: 'O Método Que Vai Transformar Seu Resultado em 30 Dias', subheadline: 'Descubra o sistema comprovado que mais de 10.000 alunos já usaram para dobrar seus resultados', ctaText: 'Quero Começar Agora →', ctaColor: '#DC2626', ctaLink: '#preco', align: 'center', bgColor: '#ffffff', paddingY: 80 }, 'ROOT') },
  video1: { ...makeNode('VideoPlayer', { videoUrl: '', caption: 'Assista ao vídeo completo', bgColor: '#f8fafc', paddingY: 40, aspectRatio: '16/9' }, 'ROOT') },
  benefits1: { ...makeNode('BenefitsList', { title: 'O que você vai aprender:', items: ['Como dobrar seus resultados sem trabalhar mais horas', 'A estratégia secreta dos top 1% de performers', 'O sistema de produtividade que elimina a procrastinação', 'Como criar renda recorrente com o método correto'], iconColor: '#16A34A', bgColor: '#f8fafc', paddingY: 60 }, 'ROOT') },
  testimonial1: { ...makeNode('Testimonial', { quote: 'Esse método mudou completamente minha vida. Em apenas 30 dias vi resultados que não conseguia em anos tentando sozinho.', name: 'João Silva', role: 'Empreendedor Digital', stars: 5, bgColor: '#ffffff', paddingY: 60 }, 'ROOT') },
  bonus1: { ...makeNode('BonusSection', { title: 'Bônus Exclusivos (somente hoje)', items: [{ emoji: '🎯', name: 'Planilha de Planejamento Semanal', originalValue: 'R$ 97', description: 'Template completo para organizar sua semana' }, { emoji: '📱', name: 'Grupo VIP no WhatsApp', originalValue: 'R$ 197', description: 'Acesso ao grupo exclusivo de alunos' }, { emoji: '📚', name: 'Biblioteca de Recursos', originalValue: 'R$ 297', description: '+50 materiais complementares' }], bgColor: '#fffbeb', paddingY: 60 }, 'ROOT') },
  guarantee1: { ...makeNode('Guarantee', { days: 7, title: 'Garantia Incondicional de 7 Dias', text: 'Se por qualquer motivo você não estiver satisfeito, devolvemos 100% do seu investimento. Sem perguntas.', bgColor: '#f0fdf4', paddingY: 60 }, 'ROOT') },
  faq1: { ...makeNode('FaqAccordion', { title: 'Perguntas Frequentes', items: [{ question: 'Para quem é este produto?', answer: 'Para qualquer pessoa que quer melhorar seus resultados e está disposta a aplicar o método.' }, { question: 'Quanto tempo tenho acesso?', answer: 'Acesso vitalício. Uma vez adquirido, é seu para sempre.' }, { question: 'E se eu não gostar?', answer: 'Você tem 7 dias de garantia incondicional. Pediu, devolvemos.' }], bgColor: '#ffffff', paddingY: 60 }, 'ROOT') },
  price1: { ...makeNode('PriceSection', { badge: 'Oferta por tempo limitado', fromPrice: 'R$ 497', mainPrice: 'R$ 197', installments: '12x de R$ 19,70', ctaText: 'Garantir Minha Vaga Agora →', ctaLink: '#', ctaColor: '#DC2626', bgColor: '#fff7ed', paddingY: 60 }, 'ROOT') },
  cta1: { ...makeNode('CtaButton', { text: '✅ Quero Garantir Minha Vaga Agora →', subtext: '🔒 Pagamento 100% seguro  ✓ Garantia de 7 dias', btnColor: '#DC2626', textColor: '#ffffff', link: '#', size: 'xl', align: 'center', bgColor: '#ffffff', paddingY: 40 }, 'ROOT') },
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  { id: 'capture', name: 'Captura Minimalista', page_type: 'capture', description: 'Hero + formulário de captura simples', craft_json: captureTemplate },
  { id: 'vsl', name: 'VSL Clássica', page_type: 'vsl', description: 'Hero + vídeo de vendas + botão de ação', craft_json: vslTemplate },
  { id: 'delivery', name: 'Entrega Simples', page_type: 'delivery', description: 'Hero + card de entrega do produto', craft_json: deliveryTemplate },
  { id: 'thankyou', name: 'Obrigado Simples', page_type: 'thankyou', description: 'Confirmação com check animado + CTA', craft_json: thankYouTemplate },
  { id: 'sales', name: 'Carta de Vendas Completa', page_type: 'sales', description: 'VSL + benefícios + depoimento + FAQ + preço', craft_json: salesTemplate },
]