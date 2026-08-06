import OfficePreview from '@/components/content-studio/office-preview'

// A autenticação vem do layout do dashboard (AppShell) e do proxy: esta rota
// NÃO está em PUBLIC_PREFIXES, então exige sessão. Não há link no menu lateral
// ainda — o acesso é digitando a URL, de propósito, enquanto é preview.
export const dynamic = 'force-dynamic'

// As Server Actions desta página chamam a IA de forma SÍNCRONA. No default da
// Vercel (10-15s) uma única chamada de carrossel já não cabe — o pedido morreria
// no meio de uma chamada paga.
//
// 60s cobria o pipeline de TEXTO (orçamento menor, STUDIO_REQUEST_BUDGET_MS,
// que devolve `partial` em vez de ser interrompido), mas NÃO a geração de
// IMAGEM: gpt-image-1 em qualidade alta e formato vertical passa dos 45s de
// timeout que cabiam aqui, e toda capa Premium falhava com "tempo limite".
// 300s é o teto do Fluid Compute; o orçamento de imagem (STUDIO_IMAGE_
// TIMEOUT_MS) fica abaixo disso com folga para compor e salvar.
export const maxDuration = 300

export const metadata = {
  title: 'Content Studio',
}

export default function ContentStudioPage() {
  return <OfficePreview />
}
