import OfficePreview from '@/components/content-studio/office-preview'

// A autenticação vem do layout do dashboard (AppShell) e do proxy: esta rota
// NÃO está em PUBLIC_PREFIXES, então exige sessão. Não há link no menu lateral
// ainda — o acesso é digitando a URL, de propósito, enquanto é preview.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Content Studio',
}

export default function ContentStudioPage() {
  return <OfficePreview />
}
