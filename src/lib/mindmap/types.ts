// ─── Mapa Mental — tipos e paleta ────────────────────────────────────────────

/** Nível visual do nó: 0 = raiz, 1 = ramo principal, 2+ = descendentes */
export type MindLevel = 0 | 1 | 2

/** Estilos de caixa do nó */
export type MindShape = 'solid' | 'outline' | 'pill' | 'sharp' | 'underline' | 'plain'

export interface MindShapeDef { key: MindShape; label: string }
export const MIND_SHAPES: MindShapeDef[] = [
  { key: 'solid',     label: 'Sólido' },
  { key: 'outline',   label: 'Contorno' },
  { key: 'pill',      label: 'Pílula' },
  { key: 'sharp',     label: 'Reto' },
  { key: 'underline', label: 'Sublinhado' },
  { key: 'plain',     label: 'Sem caixa' },
]

export interface MindNode {
  id: string
  parentId: string | null
  label: string
  note?: string
  icon?: string            // emoji opcional
  color?: string           // chave da paleta (herda do ramo quando vazio)
  x: number
  y: number
  collapsed?: boolean    // recolhe TODOS os filhos deste nó
  hidden?: boolean       // oculta APENAS este item (e o que estiver abaixo dele)
  order: number
  // aparência e conteúdo
  shape?: MindShape
  imageUrl?: string
  linkUrl?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: 'sm' | 'md' | 'lg'
  textColor?: string
}

export interface MindMapSummary {
  id: string
  title: string
  description: string | null
  thumbnail_url: string | null
  created_at: string
  updated_at: string
  node_count?: number
}

export interface MindMap extends MindMapSummary {
  nodes: MindNode[]
}

/** Paleta dos ramos — saturada mas harmônica (estilo MindMeister) */
export interface BranchColor {
  key: string
  label: string
  solid: string    // cor forte (raiz/ramo principal, conexões)
  soft: string     // fundo suave (descendentes)
  border: string
  text: string     // texto sobre o fundo suave
}

export const BRANCH_COLORS: BranchColor[] = [
  { key: 'indigo', label: 'Índigo', solid: '#6366f1', soft: '#eef2ff', border: '#c7d2fe', text: '#3730a3' },
  { key: 'violet', label: 'Roxo',   solid: '#8b5cf6', soft: '#f5f3ff', border: '#ddd6fe', text: '#5b21b6' },
  { key: 'pink',   label: 'Rosa',   solid: '#ec4899', soft: '#fdf2f8', border: '#fbcfe8', text: '#9d174d' },
  { key: 'orange', label: 'Laranja',solid: '#f97316', soft: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
  { key: 'amber',  label: 'Âmbar',  solid: '#f59e0b', soft: '#fffbeb', border: '#fde68a', text: '#92400e' },
  { key: 'green',  label: 'Verde',  solid: '#10b981', soft: '#ecfdf5', border: '#a7f3d0', text: '#065f46' },
  { key: 'cyan',   label: 'Ciano',  solid: '#06b6d4', soft: '#ecfeff', border: '#a5f3fc', text: '#155e75' },
  { key: 'blue',   label: 'Azul',   solid: '#3b82f6', soft: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
]

export const colorByKey = (key?: string): BranchColor =>
  BRANCH_COLORS.find(c => c.key === key) ?? BRANCH_COLORS[0]

/** Cor efetiva de um nó: a sua própria ou a herdada do ramo mais acima */
export function resolveBranchColor(node: MindNode, byId: Map<string, MindNode>): BranchColor {
  let cur: MindNode | undefined = node
  const guard = new Set<string>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    if (cur.color) return colorByKey(cur.color)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return BRANCH_COLORS[0]
}

/** Nível visual (0 raiz, 1 filho da raiz, 2 daí pra baixo) */
export function levelOf(node: MindNode, byId: Map<string, MindNode>): MindLevel {
  if (!node.parentId) return 0
  const parent = byId.get(node.parentId)
  if (!parent || !parent.parentId) return 1
  return 2
}

/** Ids de todos os descendentes de um nó */
export function descendantsOf(id: string, nodes: MindNode[]): string[] {
  const out: string[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of nodes) {
      if (n.parentId === cur) { out.push(n.id); stack.push(n.id) }
    }
  }
  return out
}

/** Nós escondidos: por ancestral recolhido OU por ocultação individual */
export function hiddenIds(nodes: MindNode[]): Set<string> {
  const hidden = new Set<string>()
  for (const n of nodes) {
    if (n.collapsed) for (const d of descendantsOf(n.id, nodes)) hidden.add(d)
    if (n.hidden) {
      hidden.add(n.id)
      for (const d of descendantsOf(n.id, nodes)) hidden.add(d)
    }
  }
  return hidden
}

/**
 * Reorganiza a sub-árvore de `rootId` em formato de árvore: cada nível à direita
 * do anterior e os filhos distribuídos verticalmente, com o pai centralizado em
 * relação a eles. O próprio `rootId` permanece onde está.
 */
export function layoutSubtree(nodes: MindNode[], rootId: string, hGap = 260, vGap = 84): MindNode[] {
  const kidsOf = (id: string) => nodes.filter(n => n.parentId === id).sort((a, b) => a.order - b.order)

  // "altura" da sub-árvore, contada em linhas (folhas)
  const cache = new Map<string, number>()
  const height = (id: string): number => {
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    const kids = kidsOf(id)
    const h = kids.length === 0 ? 1 : kids.reduce((s, k) => s + height(k.id), 0)
    cache.set(id, h)
    return h
  }

  const pos = new Map<string, { x: number; y: number }>()
  const place = (id: string, x: number, top: number) => {
    const h = height(id)
    pos.set(id, { x, y: top + ((h - 1) * vGap) / 2 })   // pai centralizado nos filhos
    let cursor = top
    for (const k of kidsOf(id)) {
      place(k.id, x + hGap, cursor)
      cursor += height(k.id) * vGap
    }
  }

  const root = nodes.find(n => n.id === rootId)
  if (!root) return nodes
  place(rootId, root.x, root.y - ((height(rootId) - 1) * vGap) / 2)

  return nodes.map(n => {
    const p = pos.get(n.id)
    return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n
  })
}

export const newNodeId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'n' + Math.random().toString(36).slice(2)

export const emptyMap = (): MindNode[] => [
  { id: newNodeId(), parentId: null, label: 'Ideia central', x: 0, y: 0, order: 0 },
]
