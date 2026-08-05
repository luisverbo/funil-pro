import OfficePreview from '@/components/content-studio/office-preview'

// A autenticação vem do layout do dashboard (AppShell) e do proxy: esta rota
// NÃO está em PUBLIC_PREFIXES, então exige sessão. Não há link no menu lateral
// ainda — o acesso é digitando a URL, de propósito, enquanto é preview.
export const dynamic = 'force-dynamic'

// As Server Actions desta página chamam a IA de forma SÍNCRONA. No default da
// Vercel (10-15s) uma única chamada de carrossel já não cabe — o pedido morreria
// no meio de uma chamada paga. 60s é o teto válido em qualquer plano; o runner
// da geração Studio trabalha com orçamento MENOR que isso (STUDIO_REQUEST_
// BUDGET_MS) e devolve `partial` em vez de ser interrompido.
export const maxDuration = 60

export const metadata = {
  title: 'Content Studio',
}

export default function ContentStudioPage() {
  return <OfficePreview />
}
