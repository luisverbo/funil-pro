// Leitura pública do catálogo (servidor, service role) — só temas e poses ATIVOS.
// Os prompts NUNCA saem daqui para o navegador: a página só recebe número,
// cena curta e foto.
import { createAdminClient } from '@/lib/supabase/admin'
import { urlPublicaDoCatalogo } from '@/lib/estudio/catalogo'

export interface TemaPublico { slug: string; nome: string; capa: string | null; qtd: number }
export interface PosePublica { numero: string; foto: string | null }

/** Rodapé obrigatório (seção 3.2 e 7): avisa que as imagens são geradas por IA. */
export const RODAPE = 'Imagens ilustrativas, geradas por IA. As cenas são recriadas com o rosto e o corpo da cliente.'

const SUPA = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

export async function temasPublicos(): Promise<TemaPublico[]> {
  const admin = createAdminClient()
  const { data: temas } = await admin.from('estudio_temas')
    .select('slug, nome, capa_url').eq('ativo', true).order('ordem')
  if (!temas?.length) return []
  const { data: poses } = await admin.from('estudio_poses')
    .select('tema_slug, numero, foto_exemplo_path').eq('ativa', true).in('tema_slug', temas.map(t => t.slug)).limit(5000)
  return temas.map(t => {
    const doTema = (poses ?? []).filter(p => p.tema_slug === t.slug).sort((a, b) => Number(a.numero) - Number(b.numero))
    const capa = urlPublicaDoCatalogo(t.capa_url, SUPA()) ?? urlPublicaDoCatalogo(doTema.find(p => p.foto_exemplo_path)?.foto_exemplo_path, SUPA())
    return { slug: t.slug, nome: t.nome, capa, qtd: doTema.length }
  })
}

export async function temaPublico(slug: string): Promise<{ nome: string; poses: PosePublica[] } | null> {
  const admin = createAdminClient()
  const { data: tema } = await admin.from('estudio_temas').select('slug, nome').eq('slug', slug).eq('ativo', true).maybeSingle()
  if (!tema) return null
  const { data: poses } = await admin.from('estudio_poses')
    .select('numero, foto_exemplo_path').eq('tema_slug', slug).eq('ativa', true).limit(1000)
  return {
    nome: tema.nome,
    poses: (poses ?? [])
      .sort((a, b) => Number(a.numero) - Number(b.numero))
      .map(p => ({ numero: p.numero, foto: urlPublicaDoCatalogo(p.foto_exemplo_path, SUPA()) })),
  }
}

/** Número do estúdio para o botão "Escolher estas no WhatsApp" (só o número, nada de token). */
export async function numeroDoEstudio(): Promise<string | null> {
  const { data } = await createAdminClient().from('estudio_config')
    .select('display_number').eq('ativo', true).not('display_number', 'is', null).limit(1).maybeSingle()
  return (data?.display_number as string | undefined) ?? null
}
