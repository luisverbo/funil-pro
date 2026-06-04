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

export const captureTemplate = {
  ROOT: makeRoot('#f8fafc', ['hero1', 'form1']),
  hero1: {
    type: { resolvedName: 'HeroSimple' },
    isCanvas: false,
    props: {
      headline: 'Transforme sua vida em 30 dias',
      subheadline: 'Descubra o método que já ajudou mais de 10.000 pessoas a alcançar seus objetivos',
      ctaText: 'Quero Começar Agora →',
      ctaColor: '#6366F1',
      ctaLink: '#form',
      align: 'center',
      bgColor: '#ffffff',
      paddingY: 80,
    },
    displayName: 'Hero Simples',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
  form1: {
    type: { resolvedName: 'CaptureForm' },
    isCanvas: false,
    props: {
      title: 'Garanta sua vaga gratuita',
      namePlaceholder: 'Seu nome completo',
      emailPlaceholder: 'Seu melhor e-mail',
      phonePlaceholder: 'Seu WhatsApp',
      showPhone: true,
      btnText: 'Quero Participar Agora →',
      btnColor: '#6366F1',
      bgColor: '#f8fafc',
      paddingY: 60,
    },
    displayName: 'Formulário de Captura',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
}

export const vslTemplate = {
  ROOT: makeRoot('#0f172a', ['hero1', 'video1', 'cta1']),
  hero1: {
    type: { resolvedName: 'HeroSimple' },
    isCanvas: false,
    props: {
      headline: 'Assista ao vídeo completo antes de fechar esta página',
      subheadline: 'Esta apresentação gratuita revela o segredo que ninguém está te contando',
      ctaText: '',
      ctaColor: '#6366F1',
      ctaLink: '',
      align: 'center',
      bgColor: '#0f172a',
      paddingY: 40,
    },
    displayName: 'Hero Simples',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
  video1: {
    type: { resolvedName: 'VideoPlayer' },
    isCanvas: false,
    props: {
      videoUrl: '',
      caption: '',
      bgColor: '#0f172a',
      paddingY: 20,
      aspectRatio: '16/9',
    },
    displayName: 'Player de Vídeo',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
  cta1: {
    type: { resolvedName: 'CtaButton' },
    isCanvas: false,
    props: {
      text: '✅ Sim! Quero Aproveitar Esta Oportunidade →',
      subtext: 'Garantia incondicional de 7 dias',
      btnColor: '#16A34A',
      textColor: '#ffffff',
      link: '#',
      size: 'xl',
      align: 'center',
      bgColor: '#0f172a',
      paddingY: 40,
    },
    displayName: 'Botão CTA',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
}

export const deliveryTemplate = {
  ROOT: makeRoot('#f0fdf4', ['hero1', 'delivery1']),
  hero1: {
    type: { resolvedName: 'HeroSimple' },
    isCanvas: false,
    props: {
      headline: '🎉 Parabéns! Seu acesso está pronto',
      subheadline: 'Clique no botão abaixo para acessar o produto que você adquiriu',
      ctaText: '',
      ctaColor: '#16A34A',
      ctaLink: '',
      align: 'center',
      bgColor: '#f0fdf4',
      paddingY: 60,
    },
    displayName: 'Hero Simples',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
  delivery1: {
    type: { resolvedName: 'DeliveryCard' },
    isCanvas: false,
    props: {
      headline: 'Seu acesso está liberado! 🎉',
      description: 'Parabéns pela sua decisão! Clique abaixo para acessar todo o conteúdo que você adquiriu.',
      accessLink: '#',
      accessLinkText: 'Acessar meu conteúdo agora →',
      supportEmail: 'suporte@seudominio.com.br',
      items: ['Acesso à área de membros por 12 meses', 'Suporte por e-mail em até 24h úteis', 'Bônus exclusivos liberados agora'],
      bgColor: '#f0fdf4',
      cardColor: '#ffffff',
      accentColor: '#16A34A',
      paddingY: 40,
    },
    displayName: 'Card de Entrega',
    custom: {},
    parent: 'ROOT',
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  { id: 'capture', name: 'Captura Minimalista', page_type: 'capture', description: 'Hero + formulário de captura simples', craft_json: captureTemplate },
  { id: 'vsl', name: 'VSL Clássica', page_type: 'vsl', description: 'Hero + vídeo de vendas + botão de ação', craft_json: vslTemplate },
  { id: 'delivery', name: 'Entrega Simples', page_type: 'delivery', description: 'Hero + card de entrega do produto', craft_json: deliveryTemplate },
]
