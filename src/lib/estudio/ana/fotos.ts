// ============================================================================
// Estúdio IA — escolha do rosto e do corpo entre TODAS as fotos recebidas
// (puro). Nunca pela ordem de chegada, nunca o mesmo arquivo nos dois.
//   corpo = a que mostra MAIS corpo (corpo_inteiro | rosto_e_corpo)
//   rosto = a mais FECHADA no rosto (rosto | rosto_e_corpo), outra foto
//   só uma foto com rosto E corpo → corpo = ela; rosto = recorte (último
//   recurso, marca "rosto recortado — pedir close")
// ============================================================================
import type { ClasseFoto } from './ia'

export interface FotoRecebida {
  path: string; mime?: string | null; wamid?: string | null; em?: string
  tipo: ClasseFoto['tipo']; motivo?: string | null; recusada?: boolean
  fracao_corpo: number; rosto_caixa?: ClasseFoto['rosto_caixa']; cabelo?: string | null
  /** Casal: de quem é a foto (1 = quem conversa, 2 = parceiro/a); undefined = ainda não disse. */
  pessoa?: 1 | 2
  /** Casal: foto dos DOIS juntos — referência extra, não substitui as individuais. */
  extra?: boolean
}

export interface Escolha {
  rosto: { path: string; recorte: ClasseFoto['rosto_caixa'] | 'topo' | null } | null
  corpo: string | null
  rosto_recortado: boolean
  cabelo: string | null
}

const serveDeCorpo = (f: FotoRecebida) => f.tipo === 'corpo_inteiro' || f.tipo === 'rosto_e_corpo'
const serveDeRosto = (f: FotoRecebida) => f.tipo === 'rosto' || f.tipo === 'rosto_e_corpo'

export function escolherFotos(lista: FotoRecebida[], manual?: { rosto?: string | null; corpo?: string | null }): Escolha {
  const validas = lista.filter(f => f.tipo !== 'invalida' && !f.recusada)
  const achar = (p?: string | null) => (p ? lista.find(f => f.path === p) : undefined)
  // Escolha manual do Luís no painel vale sobre a automática.
  const corpoManual = achar(manual?.corpo); const rostoManual = achar(manual?.rosto)

  const corpo = corpoManual ?? [...validas].filter(serveDeCorpo).sort((a, b) => b.fracao_corpo - a.fracao_corpo)[0] ?? null
  const rosto = rostoManual ?? [...validas].filter(f => serveDeRosto(f) && f.path !== corpo?.path).sort((a, b) => a.fracao_corpo - b.fracao_corpo)[0] ?? null

  if (rosto && corpo && rosto.path !== corpo.path) return { rosto: { path: rosto.path, recorte: null }, corpo: corpo.path, rosto_recortado: false, cabelo: rosto.cabelo ?? corpo.cabelo ?? null }
  if (!corpo && rosto) return { rosto: { path: rosto.path, recorte: null }, corpo: null, rosto_recortado: false, cabelo: rosto.cabelo ?? null }
  // Só a foto de corpo: o rosto sai dela por recorte (pede um close depois).
  if (corpo) return { rosto: corpo.tipo === 'rosto_e_corpo' || corpo.rosto_caixa ? { path: corpo.path, recorte: corpo.rosto_caixa ?? 'topo' } : null, corpo: corpo.path, rosto_recortado: corpo.tipo === 'rosto_e_corpo' || !!corpo.rosto_caixa, cabelo: corpo.cabelo ?? null }
  return { rosto: null, corpo: null, rosto_recortado: false, cabelo: null }
}

/** Casal: rosto/corpo de CADA pessoa, só entre as fotos atribuídas a ela (mesma régua de uma pessoa). */
export function escolherFotosCasal(lista: FotoRecebida[], manual?: { rosto?: string | null; corpo?: string | null; rosto2?: string | null; corpo2?: string | null }): { p1: Escolha; p2: Escolha; extras: string[]; sem_dono: FotoRecebida[] } {
  const de = (n: 1 | 2) => lista.filter(f => f.pessoa === n && !f.extra)
  return {
    p1: escolherFotos(de(1), { rosto: manual?.rosto, corpo: manual?.corpo }),
    p2: escolherFotos(de(2), { rosto: manual?.rosto2, corpo: manual?.corpo2 }),
    extras: lista.filter(f => f.extra).map(f => f.path),
    sem_dono: lista.filter(f => !f.extra && f.pessoa === undefined && f.tipo !== 'invalida' && !f.recusada),
  }
}

export interface ResumoCasal { p1: { rosto: boolean; corpo: boolean }; p2: { rosto: boolean; corpo: boolean }; sem_dono: number; extras: number; rosto_recortado: boolean }

/** Estado do casal para a máquina: o que cada pessoa já tem e quantas fotos esperam dono. */
export function resumoDasFotosCasal(lista: FotoRecebida[]): ResumoCasal {
  const e = escolherFotosCasal(lista)
  return {
    p1: { rosto: !!e.p1.rosto, corpo: !!e.p1.corpo }, p2: { rosto: !!e.p2.rosto, corpo: !!e.p2.corpo },
    sem_dono: e.sem_dono.length, extras: e.extras.length, rosto_recortado: e.p1.rosto_recortado || e.p2.rosto_recortado,
  }
}

/** Estado para a máquina: tem rosto de verdade? tem corpo? (recorte conta como rosto) */
export function resumoDasFotos(lista: FotoRecebida[]): { tem_rosto: boolean; tem_corpo: boolean; rosto_recortado: boolean; unica: boolean } {
  const e = escolherFotos(lista)
  return { tem_rosto: !!e.rosto, tem_corpo: !!e.corpo, rosto_recortado: e.rosto_recortado, unica: e.rosto_recortado && !!e.corpo }
}

/** Caixa do recorte em pixels, com margem (rosto + cabelo + queixo). */
export function caixaDoRecorte(w: number, h: number, c: ClasseFoto['rosto_caixa'] | 'topo'): { left: number; top: number; width: number; height: number } {
  if (!c || c === 'topo') { const lado = Math.round(Math.min(w, h * 0.35)); return { left: Math.round((w - lado) / 2), top: 0, width: lado, height: lado } }
  const cx = (c.x + c.w / 2) * w, cy = (c.y + c.h / 2) * h
  const lado = Math.max(c.w * w, c.h * h) * 1.8
  const left = Math.max(0, Math.round(cx - lado / 2)), top = Math.max(0, Math.round(cy - lado / 2))
  return { left, top, width: Math.max(16, Math.min(w - left, Math.round(lado))), height: Math.max(16, Math.min(h - top, Math.round(lado))) }
}
