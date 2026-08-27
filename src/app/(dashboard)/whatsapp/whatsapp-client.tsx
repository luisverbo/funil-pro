'use client'

// ============================================================================
// Inbox WhatsApp oficial — multiatendimento sobre a Cloud API
// ----------------------------------------------------------------------------
// Três colunas: conversas | chat | dossiê do lead. O dossiê é o diferencial:
// o atendente vê o que o ecossistema já sabe (quiz, agente IA, compras) sem
// sair da conversa. No celular, lista OU chat (o dossiê vira gaveta).
//
//   • janela de 24h com cronômetro — fora dela o composer TROCA para
//     templates (a regra da Meta vira UX, não erro)
//   • 🤖/🙋: IA de plantão responde; enviar manual assume na hora
//   • 💰 Vendido com valor → fecha o lead no kanban (caminho do Mercos)
//   • "/" no composer abre as respostas rápidas
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  enviarWaMensagem, enviarWaTemplate, getWaConversa, listarWaConversas,
  listarWaRespostasRapidas, listarWaTemplates, marcarWaVendido, salvarWaConta,
  salvarWaRespostaRapida, excluirWaRespostaRapida, setWaModoIa, setWaStatus, setWaTags,
  listarWaEquipe, salvarWaDepartamento, excluirWaDepartamento, salvarWaAtendente,
  removerWaAtendente, atribuirWaConversa, transferirWaDepartamento,
  listarFunisPublicados, enviarParaAutomacao, setWaContaDepartamento,
  uploadWaMidia, enviarWaMidiaMsg, listarWaProdutos, salvarWaProduto, excluirWaProduto,
  type WaProduto,
  type DossieLead, type WaConta, type WaConversaResumo, type WaMensagem,
  type WaDepartamento, type WaAtendente,
} from '@/app/actions/wa-inbox'
import { lerValorDigitado } from '@/lib/quiz/valor-venda'
import { dentroDaJanela } from '@/lib/whatsapp-cloud/webhook-parser'

const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Cor estável do avatar a partir do nome/telefone. */
function corAvatar(chave: string): string {
  let h = 0
  for (const ch of chave) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))`
}

function iniciais(nome: string | null, telefone: string): string {
  const n = (nome ?? '').trim()
  if (!n) return telefone.slice(-2)
  const partes = n.split(/\s+/)
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase()
}

function horaCurta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  if (d.getTime() >= hoje.getTime()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/** "4h 12min" até a janela fechar — ou null se já fechou. */
function restanteJanela(janelaAte: string | null): string | null {
  if (!janelaAte) return null
  const ms = new Date(janelaAte).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const min = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${min}min` : `${min}min`
}

const SITUACAO_AGENTE: Record<string, string> = {
  active: 'Em conversa', qualified: '🔥 Qualificado', disqualified: 'Fora do perfil',
  sold: '💰 Comprou', routed_to_funnel: 'Encaminhado', scheduled: '📅 Reunião marcada',
  handed_to_human: 'Pediu humano', abandoned: 'Abandonou',
}

interface Props {
  contas: WaConta[]
  erroContas: string | null
  agentes: { id: string; nome: string }[]
}

// ─── Modo demonstração ───────────────────────────────────────────────────────
// O dono quer VER a ferramenta antes de configurar a Meta. Tudo daqui vive só
// na tela: nenhuma action é chamada, nada toca o banco — é um test drive.

const agora = () => Date.now()
const min = (n: number) => new Date(agora() - n * 60_000).toISOString()

function demoConversas(): WaConversaResumo[] {
  return [
    { id: 'demo-1', nome: 'Lucas Lima', telefone: '5521980120036', ultimaMsg: 'Fechado! Pode emitir o boleto 🙌', ultimaMsgAt: min(4), naoLidas: 2, status: 'aberta', modo: 'humano', tags: ['vendido', 'orçamento'], vendidoCents: 189000, janelaAte: new Date(agora() + 5 * 3600_000).toISOString(), contaNome: 'Comercial', departamentoId: 'demo-dep-vendas', atendenteId: 'demo-at-1' },
    { id: 'demo-2', nome: 'Dra. Fernanda Souza', telefone: '5511998765432', ultimaMsg: 'Qual o valor do plano trimestral?', ultimaMsgAt: min(12), naoLidas: 1, status: 'aberta', modo: 'ia', tags: ['clínica'], vendidoCents: null, janelaAte: new Date(agora() + 21 * 3600_000).toISOString(), contaNome: 'Comercial', departamentoId: 'demo-dep-vendas', atendenteId: 'demo-at-1' },
    { id: 'demo-3', nome: 'Marcão Distribuidora', telefone: '5587999112233', ultimaMsg: '🤖 Perfeito! Agendei quinta às 10h com o Luís ✅', ultimaMsgAt: min(45), naoLidas: 0, status: 'aberta', modo: 'ia', tags: ['reunião'], vendidoCents: null, janelaAte: new Date(agora() + 15 * 3600_000).toISOString(), contaNome: 'Comercial', departamentoId: 'demo-dep-vendas', atendenteId: 'demo-at-1' },
    { id: 'demo-4', nome: 'Ana Beatriz', telefone: '5531984551200', ultimaMsg: 'vou pensar e te falo, obrigada', ultimaMsgAt: min(60 * 26), naoLidas: 0, status: 'aberta', modo: 'humano', tags: ['follow-up'], vendidoCents: null, janelaAte: min(60 * 2), contaNome: 'Comercial', departamentoId: 'demo-dep-vendas', atendenteId: 'demo-at-1' },
    { id: 'demo-5', nome: null, telefone: '5541987223344', ultimaMsg: '[🎙 áudio]', ultimaMsgAt: min(60 * 49), naoLidas: 0, status: 'resolvida', modo: 'humano', tags: [], vendidoCents: null, janelaAte: min(60 * 25), contaNome: 'Comercial', departamentoId: 'demo-dep-vendas', atendenteId: 'demo-at-1' },
  ]
}

const demoMensagens: Record<string, WaMensagem[]> = {
  'demo-1': [
    { id: 'd1', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Boa tarde! Vi o anúncio de vocês, ainda tem a condição especial?', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(38) },
    { id: 'd2', direcao: 'saida', autor: 'ia', autorNome: null, tipo: 'texto', corpo: 'Boa tarde, Lucas! Tem sim 😊 Antes de te passar os valores, me conta rapidinho: hoje vocês já investem em tráfego pago?', templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: min(37) },
    { id: 'd3', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Já sim, uns R$ 300 por dia na Meta', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(35) },
    { id: 'd4', direcao: 'saida', autor: 'ia', autorNome: null, tipo: 'texto', corpo: 'Excelente, com esse volume dá pra estruturar algo sério. Vou te passar pro Luís fechar os detalhes 👍', templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: min(34) },
    { id: 'd5', direcao: 'saida', autor: 'atendente', autorNome: 'Luís', tipo: 'texto', corpo: 'Lucas, aqui é o Luís! O plano completo com gestão + qualificação fica R$ 1.890/mês. Fechando hoje, o setup sai de graça.', templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: min(20) },
    { id: 'd6', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Fechado! Pode emitir o boleto 🙌', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(4) },
  ],
  'demo-2': [
    { id: 'd7', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Olá! Atendem clínicas odontológicas?', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(15) },
    { id: 'd8', direcao: 'saida', autor: 'ia', autorNome: null, tipo: 'texto', corpo: 'Olá, Dra. Fernanda! Atendemos sim — clínicas são metade dos nossos clientes 😊 Vocês já fazem tráfego pago hoje?', templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: min(14) },
    { id: 'd9', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Qual o valor do plano trimestral?', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(12) },
  ],
  'demo-3': [
    { id: 'd10', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Quero uma reunião pra entender o serviço', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(50) },
    { id: 'd11', direcao: 'saida', autor: 'ia', autorNome: null, tipo: 'texto', corpo: 'Claro! Tenho quinta às 10h ou sexta às 14h. Qual prefere?', templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: min(49) },
    { id: 'd12', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'Quinta 10h', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(46) },
    { id: 'd13', direcao: 'saida', autor: 'ia', autorNome: null, tipo: 'texto', corpo: 'Perfeito! Agendei quinta às 10h com o Luís ✅ Vou te mandar o lembrete 1h antes.', templateName: null, mediaUrl: null, statusEntrega: 'delivered', createdAt: min(45) },
  ],
  'demo-4': [
    { id: 'd14', direcao: 'saida', autor: 'atendente', autorNome: 'Luís', tipo: 'texto', corpo: 'Ana, conseguiu ver a proposta que te mandei?', templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: min(60 * 27) },
    { id: 'd15', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'texto', corpo: 'vou pensar e te falo, obrigada', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(60 * 26) },
  ],
  'demo-5': [
    { id: 'd16', direcao: 'entrada', autor: 'lead', autorNome: null, tipo: 'audio', corpo: '[🎙 áudio]', templateName: null, mediaUrl: null, statusEntrega: null, createdAt: min(60 * 49) },
  ],
}

const demoDossies: Record<string, DossieLead> = {
  'demo-1': {
    leadId: 'demo', nome: 'Lucas Lima', email: 'lucas@corretora.com.br', origem: null,
    conversasAgente: [{ agente: 'Clayton', situacao: 'qualified', quando: min(60 * 24 * 2) }],
    quizzes: [{ titulo: 'Diagnóstico de Tráfego', quando: min(60 * 24 * 3), concluiu: true }],
  },
  'demo-2': {
    leadId: null, nome: 'Dra. Fernanda Souza', email: null, origem: null,
    conversasAgente: [], quizzes: [{ titulo: 'Quiz Clínicas', quando: min(60 * 24), concluiu: false }],
  },
  'demo-3': {
    leadId: 'demo', nome: 'Marcão Distribuidora', email: 'compras@marcao.com.br', origem: null,
    conversasAgente: [{ agente: 'Clayton', situacao: 'scheduled', quando: min(45) }], quizzes: [],
  },
  'demo-4': { leadId: null, nome: 'Ana Beatriz', email: null, origem: null, conversasAgente: [], quizzes: [] },
  'demo-5': { leadId: null, nome: null, email: null, origem: null, conversasAgente: [], quizzes: [] },
}

const DEMO_TEMPLATES = [
  { name: 'retomar_conversa', language: 'pt_BR', corpo: 'Olá {{1}}! Passando para saber se ainda posso te ajudar com a proposta. Podemos falar?' },
  { name: 'lembrete_reuniao', language: 'pt_BR', corpo: 'Oi {{1}}! Lembrete da nossa reunião {{2}}. Até já!' },
]

export default function WhatsappClient({ contas, erroContas, agentes }: Props) {
  const [conversas, setConversas] = useState<WaConversaResumo[]>([])
  const [filtroStatus, setFiltroStatus] = useState<'aberta' | 'esperando' | 'resolvida'>('aberta')
  const [busca, setBusca] = useState('')
  const [ativa, setAtiva] = useState<WaConversaResumo | null>(null)
  const [mensagens, setMensagens] = useState<WaMensagem[]>([])
  const [dossie, setDossie] = useState<DossieLead | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [carregouUmaVez, setCarregouUmaVez] = useState(false)
  // Celular: 'lista' ou 'chat'. Dossiê vira gaveta em qualquer tamanho < xl.
  const [telaMobile, setTelaMobile] = useState<'lista' | 'chat'>('lista')
  const [dossieAberto, setDossieAberto] = useState(false)
  // Templates (fora da janela) e respostas rápidas ("/")
  const [templates, setTemplates] = useState<{ name: string; language: string; corpo: string }[] | null>(null)
  const [respostas, setRespostas] = useState<{ id: string; atalho: string; texto: string }[]>([])
  const [gerindoRespostas, setGerindoRespostas] = useState(false)
  const [novoAtalho, setNovoAtalho] = useState(''); const [novoTexto, setNovoTexto] = useState('')
  // Vendido
  const [vendendoValor, setVendendoValor] = useState<string | null>(null)
  // Conexão de conta
  const [conectando, setConectando] = useState(contas.length === 0 && !erroContas)
  const [fNome, setFNome] = useState(''); const [fWaba, setFWaba] = useState('')
  const [fPhone, setFPhone] = useState(''); const [fToken, setFToken] = useState('')
  const [fAgente, setFAgente] = useState('')
  const [salvandoConta, setSalvandoConta] = useState(false)
  // 🧪 Demonstração: o inbox inteiro com dados de exemplo, SÓ na tela —
  // nenhuma action é chamada, nada toca o banco.
  const [demo, setDemo] = useState(false)
  // Equipe: departamentos + atendentes; "quem sou eu" fica no navegador
  // (mesmo desenho sem-login do portal — o gestor vê tudo, o atendente só a
  // fila dele + as conversas sem dono do departamento dele).
  const [departamentos, setDepartamentos] = useState<WaDepartamento[]>([])
  const [atendentes, setAtendentes] = useState<WaAtendente[]>([])
  const [euSou, setEuSou] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem('fp_wa_eu') ?? '' } catch { return '' }
  })
  const [filtroDepto, setFiltroDepto] = useState<string>('')
  const [equipeAberta, setEquipeAberta] = useState(false)
  const [novoDepto, setNovoDepto] = useState(''); const [novoDeptoModo, setNovoDeptoModo] = useState('menos_ocupado')
  const [novoAtNome, setNovoAtNome] = useState(''); const [novoAtDepto, setNovoAtDepto] = useState('')
  const [novoAtPapel, setNovoAtPapel] = useState('atendente')
  const [erroEquipe, setErroEquipe] = useState<string | null>(null)
  const [automacaoAberta, setAutomacaoAberta] = useState(false)
  // Mídia + catálogo de produtos
  const [enviandoMidia, setEnviandoMidia] = useState(false)
  const [produtosAberto, setProdutosAberto] = useState(false)
  const [produtos, setProdutos] = useState<WaProduto[]>([])
  const [cadastrandoProduto, setCadastrandoProduto] = useState(false)
  const [pNome, setPNome] = useState(''); const [pPreco, setPPreco] = useState('')
  const [pDesc, setPDesc] = useState(''); const [pDepto, setPDepto] = useState('')
  const [pMidias, setPMidias] = useState<{ url: string; tipo: string }[]>([])
  const [pSubindo, setPSubindo] = useState(false)
  const [erroProduto, setErroProduto] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileProdutoRef = useRef<HTMLInputElement>(null)
  const [funis, setFunis] = useState<{ id: string; nome: string }[]>([])
  const [avisoTopo, setAvisoTopo] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const ativaRef = useRef<string | null>(null)
  useEffect(() => { ativaRef.current = ativa?.id ?? null }, [ativa?.id])

  const recarregarLista = useCallback(async () => {
    if (demo) return
    // "Esperando" é um recorte das abertas: sem atendente e sem IA cuidando.
    const r = await listarWaConversas({ status: filtroStatus === 'resolvida' ? 'resolvida' : 'aberta' })
    setConversas(r.conversas)
    setCarregouUmaVez(true)
    if (r.error) setErro(r.error)
  }, [filtroStatus, demo])

  const abrirConversa = useCallback(async (c: WaConversaResumo) => {
    setAtiva(c); setTelaMobile('chat'); setErro(null); setTemplates(null)
    setConversas(cs => cs.map(x => x.id === c.id ? { ...x, naoLidas: 0 } : x))
    if (c.id.startsWith('demo-')) {
      setMensagens(demoMensagens[c.id] ?? []); setDossie(demoDossies[c.id] ?? null)
      return
    }
    const r = await getWaConversa(c.id)
    if (ativaRef.current !== c.id) return
    setMensagens(r.mensagens); setDossie(r.dossie)
    if (r.error) setErro(r.error)
  }, [])

  // Polling: primeira carga imediata (via timeout 0 — a regra do projeto
  // proíbe setState síncrono em efeito) e depois a cada 5s.
  useEffect(() => {
    const primeiro = setTimeout(() => { void recarregarLista() }, 0)
    const t = setInterval(() => { void recarregarLista() }, 5000)
    return () => { clearTimeout(primeiro); clearInterval(t) }
  }, [recarregarLista])
  useEffect(() => {
    if (!ativa?.id || ativa.id.startsWith('demo-')) return
    const id = ativa.id
    const t = setInterval(() => {
      void (async () => {
        const r = await getWaConversa(id)
        if (ativaRef.current !== id) return
        setMensagens(prev => (r.mensagens.length !== prev.length ? r.mensagens : prev))
      })()
    }, 4000)
    return () => clearInterval(t)
  }, [ativa?.id])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [mensagens.length, ativa?.id])
  useEffect(() => { void listarWaRespostasRapidas().then(r => setRespostas(r.respostas)) }, [gerindoRespostas])
  useEffect(() => {
    if (demo) return
    void listarWaEquipe().then(r => { setDepartamentos(r.departamentos); setAtendentes(r.atendentes) })
  }, [equipeAberta, demo])
  useEffect(() => { try { localStorage.setItem('fp_wa_eu', euSou) } catch { /* opcional */ } }, [euSou])

  const eu = atendentes.find(a => a.id === euSou) ?? null
  const souGestor = !eu || eu.papel === 'gestor'
  const recarregarEquipe = () =>
    listarWaEquipe().then(r => { setDepartamentos(r.departamentos); setAtendentes(r.atendentes); if (r.error) setErroEquipe(r.error) })

  const janelaAberta = ativa ? dentroDaJanela(ativa.janelaAte, new Date()) : false
  const restante = ativa ? restanteJanela(ativa.janelaAte) : null

  const enviar = async () => {
    if (!ativa || !texto.trim() || enviando) return
    const corpo = texto.trim()
    if (demo) {
      setTexto('')
      setMensagens(m => [...m, {
        id: `demo-local-${Date.now()}`, direcao: 'saida', autor: 'atendente', autorNome: 'Você',
        tipo: 'texto', corpo, templateName: null, mediaUrl: null, statusEntrega: 'read', createdAt: new Date().toISOString(),
      }])
      setAtiva(a => a ? { ...a, modo: 'humano' } : a)
      return
    }
    setEnviando(true); setErro(null); setTexto('')
    // Otimista
    setMensagens(m => [...m, {
      id: `local-${Date.now()}`, direcao: 'saida', autor: 'atendente', autorNome: null,
      tipo: 'texto', corpo, templateName: null, mediaUrl: null, statusEntrega: 'sent', createdAt: new Date().toISOString(),
    }])
    const r = await enviarWaMensagem(ativa.id, corpo)
    setEnviando(false)
    if ('error' in r) {
      setErro(r.error); setTexto(corpo)
      setMensagens(m => m.filter(x => !x.id.startsWith('local-')))
      if (r.foraDaJanela) void carregarTemplates()
      return
    }
    setAtiva(a => a ? { ...a, modo: 'humano' } : a)
    setConversas(cs => cs.map(x => x.id === ativa.id ? { ...x, modo: 'humano', ultimaMsg: corpo } : x))
  }

  /** 📎 do composer: sobe o arquivo e envia na conversa (legenda = texto digitado). */
  const anexarEEnviar = async (file: File) => {
    if (!ativa) return
    setEnviandoMidia(true); setErro(null)
    try {
      if (demo) {
        const url = URL.createObjectURL(file)
        const tipo = file.type.startsWith('image/') ? 'imagem'
          : file.type.startsWith('video/') ? 'video'
          : file.type.startsWith('audio/') ? 'audio' : 'documento'
        setMensagens(m => [...m, {
          id: `demo-local-${Date.now()}`, direcao: 'saida', autor: 'atendente', autorNome: 'Você',
          tipo, corpo: texto.trim() || file.name, templateName: null, mediaUrl: url,
          statusEntrega: 'sent', createdAt: new Date().toISOString(),
        }])
        setTexto('')
        return
      }
      const fd = new FormData(); fd.set('file', file)
      const up = await uploadWaMidia(fd)
      if ('error' in up) { setErro(up.error); return }
      const r = await enviarWaMidiaMsg(ativa.id, up.tipo, up.url, texto.trim() || undefined, up.filename)
      if ('error' in r) { setErro(r.error); if (r.foraDaJanela) void carregarTemplates(); return }
      setTexto('')
      void abrirConversa(ativa)
    } finally {
      setEnviandoMidia(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** 📦: envia uma mídia do catálogo com a legenda do produto — UM clique. */
  const enviarMidiaProduto = async (prod: WaProduto, midia: { url: string; tipo: string }) => {
    if (!ativa) return
    const caption = `${prod.nome}${prod.precoCents ? ` — ${brl(prod.precoCents)}` : ''}${prod.descricao ? `\n${prod.descricao}` : ''}`
    setProdutosAberto(false)
    if (demo) {
      setMensagens(m => [...m, {
        id: `demo-local-${Date.now()}`, direcao: 'saida', autor: 'atendente', autorNome: 'Você',
        tipo: midia.tipo, corpo: caption, templateName: null, mediaUrl: midia.url,
        statusEntrega: 'sent', createdAt: new Date().toISOString(),
      }])
      return
    }
    setEnviandoMidia(true); setErro(null)
    const r = await enviarWaMidiaMsg(ativa.id, midia.tipo === 'video' ? 'video' : 'image', midia.url, caption)
    setEnviandoMidia(false)
    if ('error' in r) { setErro(r.error); if (r.foraDaJanela) void carregarTemplates(); return }
    void abrirConversa(ativa)
  }

  const carregarProdutos = async () => {
    if (demo) {
      setProdutos([
        { id: 'demo-p1', nome: 'Plano Completo', precoCents: 189000, descricao: 'Gestão + qualificação de leads', departamentoId: null, midias: [{ url: 'https://placehold.co/600x400/10b981/white?text=Plano+Completo', tipo: 'imagem' }] },
        { id: 'demo-p2', nome: 'Consultoria Avulsa', precoCents: 49700, descricao: null, departamentoId: 'demo-dep-vendas', midias: [{ url: 'https://placehold.co/600x400/6366f1/white?text=Consultoria', tipo: 'imagem' }] },
      ])
      return
    }
    const r = await listarWaProdutos()
    setProdutos(r.produtos)
    if (r.error) setErroProduto(r.error)
  }

  const subirMidiaProduto = async (file: File) => {
    setPSubindo(true); setErroProduto(null)
    try {
      if (demo) {
        setPMidias(ms => [...ms, { url: URL.createObjectURL(file), tipo: file.type.startsWith('video/') ? 'video' : 'imagem' }])
        return
      }
      const fd = new FormData(); fd.set('file', file)
      const up = await uploadWaMidia(fd)
      if ('error' in up) { setErroProduto(up.error); return }
      if (up.tipo !== 'image' && up.tipo !== 'video') { setErroProduto('Produto aceita foto ou vídeo'); return }
      setPMidias(ms => [...ms, { url: up.url, tipo: up.tipo === 'video' ? 'video' : 'imagem' }])
    } finally {
      setPSubindo(false)
      if (fileProdutoRef.current) fileProdutoRef.current.value = ''
    }
  }

  const salvarProduto = async () => {
    const lido = lerValorDigitado(pPreco)
    if (!lido.ok) { setErroProduto(lido.erro); return }
    if (demo) {
      setProdutos(ps => [...ps, {
        id: `demo-p-${Date.now()}`, nome: pNome, precoCents: lido.cents, descricao: pDesc || null,
        departamentoId: pDepto || null, midias: pMidias,
      }])
      setCadastrandoProduto(false); setPNome(''); setPPreco(''); setPDesc(''); setPDepto(''); setPMidias([])
      return
    }
    const r = await salvarWaProduto({
      nome: pNome, precoCents: lido.cents, descricao: pDesc || null,
      departamentoId: pDepto || null, midias: pMidias,
    })
    if ('error' in r) { setErroProduto(r.error); return }
    setCadastrandoProduto(false); setPNome(''); setPPreco(''); setPDesc(''); setPDepto(''); setPMidias([])
    void carregarProdutos()
  }

  const carregarTemplates = async () => {
    if (!ativa) return
    if (demo) { setTemplates(DEMO_TEMPLATES); return }
    const r = await listarWaTemplates(ativa.id)
    setTemplates(r.templates)
    if (r.error) setErro(r.error)
  }

  const mandarTemplate = async (nome: string, idioma: string) => {
    if (!ativa) return
    if (demo) {
      setTemplates(null)
      setMensagens(m => [...m, {
        id: `demo-local-${Date.now()}`, direcao: 'saida', autor: 'atendente', autorNome: 'Você',
        tipo: 'template', corpo: `[template: ${nome}]`, templateName: nome, mediaUrl: null, statusEntrega: 'sent', createdAt: new Date().toISOString(),
      }])
      setAtiva(a => a ? { ...a, janelaAte: new Date(Date.now() + 24 * 3600_000).toISOString() } : a)
      return
    }
    setEnviando(true); setErro(null)
    const r = await enviarWaTemplate(ativa.id, nome, idioma)
    setEnviando(false)
    if ('error' in r) { setErro(r.error); return }
    setTemplates(null)
    void abrirConversa(ativa)
  }

  const alternarIa = async () => {
    if (!ativa) return
    const novo = ativa.modo !== 'ia'
    setAtiva(a => a ? { ...a, modo: novo ? 'ia' : 'humano' } : a)
    if (demo) return
    const r = await setWaModoIa(ativa.id, novo)
    if ('error' in r) setErro(r.error)
  }

  const resolver = async () => {
    if (!ativa) return
    const novo = ativa.status === 'aberta' ? 'resolvida' as const : 'aberta' as const
    // Trava de classificação: fechar sem tag deixa o relatório furado.
    if (novo === 'resolvida' && ativa.tags.length === 0) {
      setErro('Coloque ao menos uma tag no lead antes de resolver — é ela que classifica o desfecho.')
      return
    }
    if (demo) {
      setAtiva(a => a ? { ...a, status: novo } : a)
      setConversas(cs => cs.map(x => x.id === ativa.id ? { ...x, status: novo } : x))
      return
    }
    await setWaStatus(ativa.id, novo)
    setAtiva(a => a ? { ...a, status: novo } : a)
    void recarregarLista()
  }

  const salvarVendido = async () => {
    if (!ativa || vendendoValor === null) return
    const lido = lerValorDigitado(vendendoValor)
    if (!lido.ok) { setErro(lido.erro); return }
    if (demo) {
      setVendendoValor(null)
      setAtiva(a => a ? { ...a, vendidoCents: lido.cents, tags: lido.cents ? [...new Set([...a.tags, 'vendido'])] : a.tags.filter(t => t !== 'vendido') } : a)
      return
    }
    const r = await marcarWaVendido(ativa.id, lido.cents)
    if ('error' in r) { setErro(r.error); return }
    setVendendoValor(null)
    setAtiva(a => a ? { ...a, vendidoCents: lido.cents, tags: lido.cents ? [...new Set([...a.tags, 'vendido'])] : a.tags.filter(t => t !== 'vendido') } : a)
    void recarregarLista()
  }

  const addTag = async (tag: string) => {
    if (!ativa) return
    const t = tag.trim()
    if (!t) return
    const novas = [...new Set([...ativa.tags, t])]
    setAtiva(a => a ? { ...a, tags: novas } : a)
    if (demo) return
    await setWaTags(ativa.id, novas)
  }
  const rmTag = async (tag: string) => {
    if (!ativa) return
    const novas = ativa.tags.filter(t => t !== tag)
    setAtiva(a => a ? { ...a, tags: novas } : a)
    if (demo) return
    await setWaTags(ativa.id, novas)
  }

  const conectarConta = async () => {
    setSalvandoConta(true); setErro(null)
    const r = await salvarWaConta({
      nome: fNome, wabaId: fWaba, phoneNumberId: fPhone, token: fToken,
      agentePlantaoId: fAgente || null,
    })
    setSalvandoConta(false)
    if ('error' in r) { setErro(r.error); return }
    window.location.reload()
  }

  const sugestoes = useMemo(() => {
    if (!texto.startsWith('/')) return []
    const q = texto.slice(1).toLowerCase()
    return respostas.filter(r => r.atalho.toLowerCase().startsWith(q)).slice(0, 6)
  }, [texto, respostas])

  // ── Tela de conexão (sem conta) ───────────────────────────────────────────
  if (conectando) {
    return (
      <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-emerald-50/40 to-slate-50 p-6">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-2xl text-white shadow-lg">💬</div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">WhatsApp oficial</h1>
              <p className="text-sm text-slate-500">Conecte a API Cloud da Meta e atenda daqui.</p>
            </div>
          </div>
          {erroContas && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{erroContas}</p>}
          <div className="mt-6 space-y-3">
            <input value={fNome} onChange={e => setFNome(e.target.value)} placeholder="Nome interno (ex.: Comercial)"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
            <input value={fWaba} onChange={e => setFWaba(e.target.value)} placeholder="WABA ID (WhatsApp Business Account ID)"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
            <input value={fPhone} onChange={e => setFPhone(e.target.value)} placeholder="Phone Number ID"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
            <input value={fToken} onChange={e => setFToken(e.target.value)} placeholder="Token de acesso do sistema (permanente)"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
            <select value={fAgente} onChange={e => setFAgente(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-emerald-500 focus:outline-none">
              <option value="">🤖 Agente IA de plantão (opcional)</option>
              {agentes.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
            <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
              No app da Meta (developers.facebook.com): produto WhatsApp → API Setup.
              Configure o webhook para <span className="font-mono">/api/webhooks/meta-wa</span> com
              o campo <b>Verify token</b> = seu APP_SECRET, e assine o campo <b>messages</b>.
              ⚠️ Migrar um número do app WhatsApp Business para a API apaga o histórico do aparelho.
            </div>
            {erro && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{erro}</p>}
            <button onClick={() => void conectarConta()} disabled={salvandoConta}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50">
              {salvandoConta ? 'Conectando…' : '🚀 Conectar número'}
            </button>
            <button
              onClick={() => {
                // Test drive: povoar a tela com os exemplos e abrir o inbox.
                setDemo(true); setConectando(false)
                setConversas(demoConversas()); setCarregouUmaVez(true)
                setDepartamentos([
                  { id: 'demo-dep-vendas', nome: 'Vendas', emoji: '💰', distribuicao: 'menos_ocupado' },
                  { id: 'demo-dep-suporte', nome: 'Suporte', emoji: '🛟', distribuicao: 'rodizio' },
                ])
                setAtendentes([
                  { id: 'demo-at-1', nome: 'Luís (você)', papel: 'gestor', departamentoId: 'demo-dep-vendas', ativo: true },
                  { id: 'demo-at-2', nome: 'Camila', papel: 'atendente', departamentoId: 'demo-dep-vendas', ativo: true },
                  { id: 'demo-at-3', nome: 'Rafael', papel: 'atendente', departamentoId: 'demo-dep-suporte', ativo: true },
                ])
                setRespostas([
                  { id: 'demo-r1', atalho: 'preço', texto: 'Nosso plano completo fica R$ 1.890/mês, com setup grátis fechando este mês 😊' },
                  { id: 'demo-r2', atalho: 'pix', texto: 'Segue nossa chave PIX: contato@suaempresa.com.br — me avisa quando cair que eu já libero!' },
                ])
              }}
              className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
              👀 Ver demonstração (sem conectar nada)
            </button>
            {contas.length > 0 && (
              <button onClick={() => setConectando(false)} className="w-full text-xs text-slate-400 hover:text-slate-600">← voltar ao inbox</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Inbox ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-[calc(100dvh)] flex-col overflow-hidden bg-slate-100 md:h-full">
      {demo && (
        <div className="flex shrink-0 items-center justify-center gap-3 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-1.5 text-xs font-medium text-white">
          🧪 Demonstração — nada aqui é real e nada é salvo. Explore à vontade!
          <button onClick={() => { setDemo(false); setAtiva(null); setConversas([]); setConectando(true) }}
            className="rounded-full bg-white/20 px-3 py-0.5 font-semibold hover:bg-white/30">
            Sair e conectar meu número
          </button>
        </div>
      )}
      {avisoTopo && (
        <div className="flex shrink-0 items-center justify-between bg-indigo-50 px-4 py-1.5 text-xs text-indigo-800">
          {avisoTopo}
          <button onClick={() => setAvisoTopo(null)} className="text-indigo-400">✕</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Coluna 1: conversas ── */}
      <aside className={`${telaMobile === 'lista' ? 'flex' : 'hidden'} w-full flex-col border-r border-slate-200 bg-white md:flex md:w-80 md:shrink-0`}>
        <div className="border-b border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-base text-white">💬</span>
              WhatsApp
            </h1>
            <div className="flex items-center gap-1">
              <button onClick={() => setEquipeAberta(true)} title="Equipe e departamentos"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">👥</button>
              <button onClick={() => setGerindoRespostas(true)} title="Respostas rápidas"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">⚡</button>
              <button onClick={() => setConectando(true)} title="Contas conectadas"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">⚙️</button>
            </div>
          </div>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar conversa…"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none" />
          <div className="mt-2 flex rounded-xl bg-slate-100 p-0.5 text-xs font-medium">
            {([['aberta', 'Abertas'], ['esperando', '⏳ Esperando'], ['resolvida', 'Resolvidas']] as const).map(([v, r]) => {
              const esperando = v === 'esperando'
                ? conversas.filter(c => c.status === 'aberta' && !c.atendenteId && c.modo !== 'ia').length
                : 0
              return (
                <button key={v} onClick={() => setFiltroStatus(v)}
                  className={`flex-1 rounded-lg py-1.5 transition ${filtroStatus === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {r}{v === 'esperando' && esperando > 0 ? ` (${esperando})` : ''}
                </button>
              )
            })}
          </div>
          {atendentes.length > 0 && (
            <select value={euSou} onChange={e => setEuSou(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 focus:outline-none">
              <option value="">👑 Gestor · vendo tudo</option>
              {atendentes.map(a => (
                <option key={a.id} value={a.id}>
                  {a.papel === 'gestor' ? '👑' : '🙋'} {a.nome} — {a.papel === 'gestor' ? 'vê tudo' : 'só minha fila'}
                </option>
              ))}
            </select>
          )}
          {departamentos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <button onClick={() => setFiltroDepto('')}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${filtroDepto === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                Todos
              </button>
              {departamentos.map(d => (
                <button key={d.id} onClick={() => setFiltroDepto(d.id)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${filtroDepto === d.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {d.emoji} {d.nome}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversas
            .filter(c => !busca.trim()
              || (c.nome ?? '').toLowerCase().includes(busca.toLowerCase())
              || c.telefone.includes(busca))
            .filter(c => !filtroDepto || c.departamentoId === filtroDepto)
            // Esperando = aberta, sem dono e sem IA cuidando — ninguém atendeu.
            .filter(c => filtroStatus !== 'esperando' || (c.status === 'aberta' && !c.atendenteId && c.modo !== 'ia'))
            .filter(c => filtroStatus !== 'aberta' || c.status === 'aberta')
            // Atendente vê a PRÓPRIA fila + as sem dono do departamento dele;
            // gestor vê tudo.
            .filter(c => souGestor
              || c.atendenteId === euSou
              || (!c.atendenteId && (!eu?.departamentoId || c.departamentoId === eu.departamentoId)))
            .map(c => (
            <button key={c.id} onClick={() => void abrirConversa(c)}
              className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-3 text-left transition hover:bg-slate-50 ${ativa?.id === c.id ? 'bg-emerald-50/60' : ''}`}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow"
                style={{ background: corAvatar(c.nome ?? c.telefone) }}>
                {iniciais(c.nome, c.telefone)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{c.nome ?? c.telefone}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{horaCurta(c.ultimaMsgAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  {c.modo === 'ia' && <span title="IA atendendo" className="shrink-0 text-xs">🤖</span>}
                  {c.atendenteId && (() => {
                    const at = atendentes.find(a => a.id === c.atendenteId)
                    return at ? (
                      <span title={`Atendente: ${at.nome}`}
                        className="shrink-0 rounded bg-indigo-100 px-1 text-[9px] font-bold text-indigo-600">
                        {at.nome.split(' ')[0]}
                      </span>
                    ) : null
                  })()}
                  {(c.vendidoCents ?? 0) > 0 && <span className="shrink-0 rounded bg-emerald-100 px-1 text-[9px] font-bold text-emerald-700">💰</span>}
                  <span className="truncate text-xs text-slate-500">{c.ultimaMsg ?? '…'}</span>
                  {c.naoLidas > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">
                      {c.naoLidas}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {carregouUmaVez && conversas.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-3xl">📭</p>
              <p className="mt-2 text-sm font-medium text-slate-600">
                {filtroStatus === 'esperando' ? 'Ninguém esperando atendimento 🎉' : `Nenhuma conversa ${filtroStatus === 'aberta' ? 'aberta' : 'resolvida'}`}
              </p>
              <p className="mt-1 text-xs text-slate-400">Quando alguém mandar mensagem para o seu número oficial, a conversa aparece aqui.</p>
            </div>
          )}
        </div>
      </aside>

      {/* ── Coluna 2: chat ── */}
      <main className={`${telaMobile === 'chat' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>
        {!ativa ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-emerald-50/30 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-4xl text-white shadow-xl">💬</span>
            <p className="text-sm font-medium text-slate-600">Escolha uma conversa ao lado</p>
            <p className="max-w-xs text-xs text-slate-400">O dossiê do lead (quiz, agente IA, compras) aparece junto — você atende sabendo com quem fala.</p>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
              <button onClick={() => setTelaMobile('lista')} className="text-slate-400 hover:text-slate-600 md:hidden">←</button>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: corAvatar(ativa.nome ?? ativa.telefone) }}>
                {iniciais(ativa.nome, ativa.telefone)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{ativa.nome ?? ativa.telefone}</p>
                <p className="truncate text-[11px] text-slate-400">
                  {ativa.telefone} · {ativa.contaNome}
                  {restante ? <span className="text-emerald-600"> · janela {restante}</span>
                    : <span className="text-amber-600"> · janela fechada (só template)</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {souGestor && atendentes.length > 0 && (
                  <select value={ativa.atendenteId ?? ''}
                    onChange={e => {
                      const novo = e.target.value || null
                      setAtiva(a => a ? { ...a, atendenteId: novo } : a)
                      setConversas(cs => cs.map(x => x.id === ativa.id ? { ...x, atendenteId: novo } : x))
                      if (!demo) void atribuirWaConversa(ativa.id, novo).then(r => { if ('error' in r) setErro(r.error) })
                    }}
                    title="Atribuir a um atendente (gestor)"
                    className="max-w-[8rem] rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 focus:outline-none">
                    <option value="">— fila —</option>
                    {atendentes
                      .filter(a => !ativa.departamentoId || !a.departamentoId || a.departamentoId === ativa.departamentoId)
                      .map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                  </select>
                )}
                {souGestor && departamentos.length > 0 && (
                  <select value={ativa.departamentoId ?? ''}
                    onChange={e => {
                      const novo = e.target.value || null
                      setAtiva(a => a ? { ...a, departamentoId: novo, atendenteId: null } : a)
                      setConversas(cs => cs.map(x => x.id === ativa.id ? { ...x, departamentoId: novo, atendenteId: null } : x))
                      if (!demo) void transferirWaDepartamento(ativa.id, novo).then(r => { if ('error' in r) setErro(r.error) })
                    }}
                    title="Transferir para outro departamento (volta para a fila de lá)"
                    className="max-w-[7rem] rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 focus:outline-none">
                    <option value="">— depto —</option>
                    {departamentos.map(d => <option key={d.id} value={d.id}>{d.emoji} {d.nome}</option>)}
                  </select>
                )}
                <button
                  onClick={() => {
                    setAutomacaoAberta(true)
                    if (!demo) void listarFunisPublicados().then(r => setFunis(r.funis))
                    else setFunis([{ id: 'demo-f1', nome: 'Remarketing 7 dias' }, { id: 'demo-f2', nome: 'Nutrição pós-venda' }])
                  }}
                  title="Jogar este lead numa automação (remarketing, nutrição…)"
                  className="rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">
                  ⚡
                </button>
                <button onClick={() => void alternarIa()}
                  title={ativa.modo === 'ia' ? 'IA atendendo — clique para assumir' : 'Entregar para a IA de plantão'}
                  className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                    ativa.modo === 'ia' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {ativa.modo === 'ia' ? '🤖 IA' : '🙋 Você'}
                </button>
                {(ativa.vendidoCents ?? 0) > 0 ? (
                  <button onClick={() => setVendendoValor(String((ativa.vendidoCents! / 100).toFixed(2)).replace('.', ','))}
                    className="rounded-xl bg-emerald-100 px-2.5 py-1.5 text-xs font-bold text-emerald-700">
                    💰 {brl(ativa.vendidoCents!)}
                  </button>
                ) : (
                  <button onClick={() => setVendendoValor('')}
                    className="rounded-xl border border-dashed border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50">
                    💰 Vendido
                  </button>
                )}
                <button onClick={() => void resolver()}
                  title={ativa.status === 'aberta' && ativa.tags.length === 0
                    ? 'Coloque ao menos uma tag antes de resolver — é ela que classifica o desfecho'
                    : undefined}
                  className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold ${
                    ativa.status === 'aberta' && ativa.tags.length === 0
                      ? 'cursor-not-allowed bg-slate-50 text-slate-300'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {ativa.status === 'aberta' ? '✓ Resolver' : '↩ Reabrir'}
                </button>
                <button onClick={() => setDossieAberto(v => !v)} title="Dossiê do lead"
                  className="rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs xl:hidden">👤</button>
              </div>
            </div>

            {/* venda inline */}
            {vendendoValor !== null && (
              <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2">
                <span className="text-xs font-semibold text-emerald-800">Valor da venda:</span>
                <input autoFocus value={vendendoValor} onChange={e => setVendendoValor(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void salvarVendido(); if (e.key === 'Escape') setVendendoValor(null) }}
                  placeholder="1.500,00" inputMode="decimal"
                  className="w-28 rounded-lg border border-emerald-300 px-2 py-1 text-sm focus:outline-none" />
                <button onClick={() => void salvarVendido()} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Salvar</button>
                {(ativa.vendidoCents ?? 0) > 0 && (
                  <button onClick={() => { setVendendoValor(''); void marcarWaVendido(ativa.id, null).then(() => { setAtiva(a => a ? { ...a, vendidoCents: null } : a); setVendendoValor(null) }) }}
                    className="text-xs text-red-500">desfazer</button>
                )}
                <button onClick={() => setVendendoValor(null)} className="ml-auto text-xs text-slate-400">✕</button>
                <span className="hidden text-[10px] text-emerald-700 sm:block">move o lead para Fechado no kanban do portal</span>
              </div>
            )}

            {/* tags */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-white px-4 py-1.5">
              {ativa.tags.map(t => (
                <span key={t} className={`group flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  t === 'vendido' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-50 text-indigo-600'
                }`}>
                  {t}
                  <button onClick={() => void rmTag(t)} className="opacity-0 transition group-hover:opacity-100">✕</button>
                </span>
              ))}
              <input placeholder="+ tag"
                onKeyDown={e => {
                  if (e.key === 'Enter') { void addTag((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = '' }
                }}
                className="w-16 bg-transparent text-[10px] text-slate-400 focus:outline-none" />
            </div>

            {/* mensagens */}
            <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3"
              style={{ background: 'linear-gradient(180deg, #f1f5f9 0%, #ecfdf5 100%)' }}>
              {mensagens.map(m => {
                const minha = m.direcao === 'saida'
                return (
                  <div key={m.id} className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      minha
                        ? m.autor === 'ia'
                          ? 'rounded-br-sm bg-gradient-to-br from-violet-500 to-purple-600 text-white'
                          : 'rounded-br-sm bg-gradient-to-br from-emerald-500 to-teal-600 text-white'
                        : 'rounded-bl-sm border border-slate-200 bg-white text-slate-800'
                    }`}>
                      {minha && m.autor === 'ia' && <p className="mb-0.5 text-[10px] font-bold opacity-80">🤖 agente IA</p>}
                      {m.mediaUrl && m.tipo === 'imagem' && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.mediaUrl} alt="" className="mb-1 max-h-64 w-full rounded-xl object-cover" />
                      )}
                      {m.mediaUrl && m.tipo === 'video' && (
                        <video src={m.mediaUrl} controls className="mb-1 max-h-64 w-full rounded-xl" />
                      )}
                      {m.mediaUrl && m.tipo === 'audio' && (
                        <audio src={m.mediaUrl} controls className="mb-1 w-56 max-w-full" />
                      )}
                      {m.mediaUrl && m.tipo === 'documento' && (
                        <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer"
                          className={`mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${minha ? 'bg-white/15' : 'bg-slate-100'}`}>
                          📎 Abrir documento
                        </a>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.corpo}</p>
                      <p className={`mt-0.5 text-right text-[10px] ${minha ? 'text-white/70' : 'text-slate-400'}`}>
                        {horaCurta(m.createdAt)}
                        {minha && (
                          <span className={m.statusEntrega === 'read' ? 'ml-1 text-sky-200' : 'ml-1'}>
                            {m.statusEntrega === 'failed' ? ' ⚠' : ' ✓✓'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )
              })}
              {mensagens.length === 0 && <p className="py-10 text-center text-xs text-slate-400">Sem mensagens ainda</p>}
            </div>

            {erro && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{erro}</p>}

            {/* composer OU templates (fora da janela) */}
            {janelaAberta ? (
              <div className="relative border-t border-slate-200 bg-white p-3">
                {sugestoes.length > 0 && (
                  <div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                    {sugestoes.map(s => (
                      <button key={s.id} onClick={() => setTexto(s.texto)}
                        className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-50">
                        <span className="font-mono font-bold text-emerald-600">/{s.atalho}</span>
                        <span className="truncate text-slate-500">{s.texto}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input ref={fileRef} type="file" className="hidden"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void anexarEEnviar(f) }} />
                  <button onClick={() => fileRef.current?.click()} disabled={enviandoMidia}
                    title="Enviar foto, vídeo, áudio ou documento (o texto digitado vira a legenda)"
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg text-slate-500 transition hover:bg-slate-200 disabled:opacity-40">
                    {enviandoMidia ? '…' : '📎'}
                  </button>
                  <button onClick={() => { setProdutosAberto(true); void carregarProdutos() }}
                    title="Catálogo de produtos — envie as fotos com um clique"
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg text-slate-500 transition hover:bg-slate-200">
                    📦
                  </button>
                  <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={1}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar() } }}
                    placeholder={ativa.modo === 'ia' ? 'Responder assume a conversa da IA…' : 'Mensagem  ·  "/" para respostas rápidas'}
                    className="max-h-32 min-h-[42px] flex-1 resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-emerald-500 focus:bg-white focus:outline-none" />
                  <button onClick={() => void enviar()} disabled={enviando || !texto.trim()}
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg transition hover:opacity-90 disabled:opacity-40">
                    ➤
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">
                  ⏰ Janela de 24h fechada — a Meta só permite reabrir com um template aprovado.
                </p>
                {templates === null ? (
                  <button onClick={() => void carregarTemplates()}
                    className="mt-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700">
                    Ver templates aprovados
                  </button>
                ) : templates.length === 0 ? (
                  <p className="mt-2 text-xs text-amber-700">Nenhum template aprovado nesta WABA — crie um no Gerenciador do WhatsApp e aguarde a aprovação.</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {templates.map(t => (
                      <button key={`${t.name}-${t.language}`} onClick={() => void mandarTemplate(t.name, t.language)} disabled={enviando}
                        className="flex w-full items-baseline gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs hover:bg-amber-100 disabled:opacity-50">
                        <span className="shrink-0 font-mono font-bold text-amber-700">{t.name}</span>
                        <span className="truncate text-slate-500">{t.corpo}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Coluna 3: dossiê ── */}
      {ativa && (
        <aside className={`${dossieAberto ? 'flex' : 'hidden'} w-full shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white xl:flex xl:w-72
          ${dossieAberto ? 'absolute inset-y-0 right-0 z-40 max-w-xs shadow-2xl xl:static xl:max-w-none xl:shadow-none' : ''}`}>
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <h2 className="text-sm font-bold text-slate-900">👤 Dossiê do lead</h2>
            <button onClick={() => setDossieAberto(false)} className="text-slate-400 xl:hidden">✕</button>
          </div>
          <div className="space-y-4 p-4">
            <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-emerald-50/50 p-3 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white shadow"
                style={{ background: corAvatar(ativa.nome ?? ativa.telefone) }}>
                {iniciais(ativa.nome, ativa.telefone)}
              </span>
              <p className="mt-2 text-sm font-bold text-slate-900">{dossie?.nome ?? ativa.nome ?? 'Sem nome'}</p>
              <p className="text-xs text-slate-500">{ativa.telefone}</p>
              {dossie?.email && <p className="text-xs text-slate-500">{dossie.email}</p>}
              {(ativa.vendidoCents ?? 0) > 0 && (
                <p className="mt-1 text-sm font-bold text-emerald-600">💰 {brl(ativa.vendidoCents!)}</p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">🧠 Quizzes respondidos</p>
              {(dossie?.quizzes ?? []).length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">Nenhum quiz deste telefone.</p>
              ) : (dossie?.quizzes ?? []).map((q, i) => (
                <div key={i} className="mt-1.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-800">{q.titulo}</p>
                  <p className="text-[10px] text-slate-500">
                    {q.concluiu ? '✅ concluiu' : 'não concluiu'}{q.quando ? ` · ${new Date(q.quando).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">🤖 Conversas com agente IA</p>
              {(dossie?.conversasAgente ?? []).length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">Nenhuma conversa com os agentes.</p>
              ) : (dossie?.conversasAgente ?? []).map((c, i) => (
                <div key={i} className="mt-1.5 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-800">{c.agente}</p>
                  <p className="text-[10px] text-slate-500">
                    {SITUACAO_AGENTE[c.situacao] ?? c.situacao}{c.quando ? ` · ${new Date(c.quando).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      )}

      </div>


      {/* ── Automação: jogar o lead num funil ── */}
      {automacaoAberta && ativa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => setAutomacaoAberta(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="relative bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5">
              <button onClick={() => setAutomacaoAberta(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white">✕</button>
              <h3 className="text-lg font-bold text-white">⚡ Jogar em automação</h3>
              <p className="mt-1 text-xs text-white/70">
                <b>{ativa.nome ?? ativa.telefone}</b> entra no funil escolhido
                (remarketing, nutrição…) pelo motor de automações.
              </p>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto p-5">
              {funis.map(f => (
                <button key={f.id}
                  onClick={() => {
                    setAutomacaoAberta(false)
                    if (demo) { setAvisoTopo(`⚡ (demo) ${ativa.nome ?? ativa.telefone} entraria no funil "${f.nome}"`); return }
                    void enviarParaAutomacao(ativa.id, f.id).then(r => {
                      setAvisoTopo('error' in r ? r.error : `⚡ Lead enviado para "${f.nome}"`)
                    })
                  }}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50">
                  {f.nome}
                </button>
              ))}
              {funis.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nenhum funil criado ainda.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Equipe: departamentos, atendentes e distribuição ── */}
      {equipeAberta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => setEquipeAberta(false)}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* header */}
            <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-900 px-6 py-5">
              <button onClick={() => setEquipeAberta(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white">✕</button>
              <h3 className="text-lg font-bold text-white">Equipe e departamentos</h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-white/60">
                A conversa nova cai no departamento padrão da conta e é distribuída
                sozinha — com afinidade: o lead volta para quem já o atendeu.
              </p>
            </div>

            <div className="max-h-[calc(92vh-96px)] space-y-6 overflow-y-auto p-6">
              {/* departamentos */}
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-sm">🏢</span>
                  <h4 className="text-sm font-bold text-slate-900">Departamentos</h4>
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  {departamentos.map((d, i2) => (
                    <div key={d.id} className={`flex items-center gap-3 px-4 py-3 ${i2 > 0 ? 'border-t border-slate-100' : ''}`}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-base">{d.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{d.nome}</span>
                      <select value={d.distribuicao}
                        onChange={e => void salvarWaDepartamento({ id: d.id, nome: d.nome, emoji: d.emoji, distribuicao: e.target.value }).then(() => void recarregarEquipe())}
                        className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                        <option value="menos_ocupado">🧠 Menos ocupado</option>
                        <option value="rodizio">🔁 Rodízio</option>
                        <option value="manual">✋ Manual</option>
                      </select>
                      <button onClick={() => void excluirWaDepartamento(d.id).then(() => void recarregarEquipe())}
                        title="Excluir departamento"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500">✕</button>
                    </div>
                  ))}
                  {departamentos.length === 0 && (
                    <p className="px-4 py-5 text-center text-xs text-slate-400">Nenhum departamento ainda — crie o primeiro abaixo.</p>
                  )}
                  {/* linha de criação */}
                  <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    <input value={novoDepto} onChange={e => { setNovoDepto(e.target.value); setErroEquipe(null) }}
                      onKeyDown={e => { if (e.key === 'Enter' && novoDepto.trim().length >= 2) void salvarWaDepartamento({ nome: novoDepto, distribuicao: novoDeptoModo }).then(r => { if ('error' in r) setErroEquipe(r.error); else { setNovoDepto(''); void recarregarEquipe() } }) }}
                      placeholder="Novo departamento (Vendas, Suporte…)"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                    <select value={novoDeptoModo} onChange={e => setNovoDeptoModo(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-600 focus:outline-none">
                      <option value="menos_ocupado">🧠 Menos ocupado</option>
                      <option value="rodizio">🔁 Rodízio</option>
                      <option value="manual">✋ Manual</option>
                    </select>
                    <button disabled={novoDepto.trim().length < 2}
                      onClick={() => void salvarWaDepartamento({ nome: novoDepto, distribuicao: novoDeptoModo })
                        .then(r => { if ('error' in r) setErroEquipe(r.error); else { setNovoDepto(''); void recarregarEquipe() } })}
                      className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-30">
                      Adicionar
                    </button>
                  </div>
                </div>
              </section>

              {/* atendentes */}
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-sm">🙋</span>
                  <h4 className="text-sm font-bold text-slate-900">Atendentes</h4>
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  {atendentes.map((a, i2) => (
                    <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${i2 > 0 ? 'border-t border-slate-100' : ''}`}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: corAvatar(a.nome) }}>
                        {a.nome.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-800">{a.nome}</span>
                        <span className="text-[11px] text-slate-400">{a.papel === 'gestor' ? '👑 Gestor — vê e distribui tudo' : 'Atendente — só a própria fila'}</span>
                      </span>
                      <select value={a.departamentoId ?? ''}
                        onChange={e => void salvarWaAtendente({ id: a.id, nome: a.nome, papel: a.papel, departamentoId: e.target.value || null }).then(() => void recarregarEquipe())}
                        className="max-w-[8.5rem] rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                        <option value="">Sem departamento</option>
                        {departamentos.map(d => <option key={d.id} value={d.id}>{d.emoji} {d.nome}</option>)}
                      </select>
                      <select value={a.papel}
                        onChange={e => void salvarWaAtendente({ id: a.id, nome: a.nome, papel: e.target.value, departamentoId: a.departamentoId }).then(() => void recarregarEquipe())}
                        className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                        <option value="atendente">Atendente</option>
                        <option value="gestor">👑 Gestor</option>
                      </select>
                      <button onClick={() => void removerWaAtendente(a.id).then(() => void recarregarEquipe())}
                        title="Remover (o histórico dele permanece)"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500">✕</button>
                    </div>
                  ))}
                  {atendentes.length === 0 && (
                    <p className="px-4 py-5 text-center text-xs text-slate-400">Nenhum atendente ainda — adicione o primeiro abaixo.</p>
                  )}
                  <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    <input value={novoAtNome} onChange={e => { setNovoAtNome(e.target.value); setErroEquipe(null) }}
                      onKeyDown={e => { if (e.key === 'Enter' && novoAtNome.trim().length >= 2) void salvarWaAtendente({ nome: novoAtNome, papel: novoAtPapel, departamentoId: novoAtDepto || null }).then(r => { if ('error' in r) setErroEquipe(r.error); else { setNovoAtNome(''); void recarregarEquipe() } }) }}
                      placeholder="Nome do atendente"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                    <select value={novoAtDepto} onChange={e => setNovoAtDepto(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-600 focus:outline-none">
                      <option value="">Sem departamento</option>
                      {departamentos.map(d => <option key={d.id} value={d.id}>{d.emoji} {d.nome}</option>)}
                    </select>
                    <select value={novoAtPapel} onChange={e => setNovoAtPapel(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-600 focus:outline-none">
                      <option value="atendente">Atendente</option>
                      <option value="gestor">👑 Gestor</option>
                    </select>
                    <button disabled={novoAtNome.trim().length < 2}
                      onClick={() => void salvarWaAtendente({ nome: novoAtNome, papel: novoAtPapel, departamentoId: novoAtDepto || null })
                        .then(r => { if ('error' in r) setErroEquipe(r.error); else { setNovoAtNome(''); void recarregarEquipe() } })}
                      className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-30">
                      Adicionar
                    </button>
                  </div>
                </div>
              </section>

              {/* departamento padrão por conta */}
              {contas.length > 0 && departamentos.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-sm">📥</span>
                    <h4 className="text-sm font-bold text-slate-900">Onde caem as conversas novas</h4>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    {contas.map((c, i2) => (
                      <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${i2 > 0 ? 'border-t border-slate-100' : ''}`}>
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-base">💬</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{c.nome}</span>
                        <select defaultValue=""
                          onChange={e => void setWaContaDepartamento(c.id, e.target.value || null).then(r => { if ('error' in r) setErroEquipe(r.error) })}
                          className="rounded-lg border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40">
                          <option value="">Sem departamento</option>
                          {departamentos.map(d => <option key={d.id} value={d.id}>{d.emoji} {d.nome}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {erroEquipe && (
                <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">{erroEquipe}</p>
              )}
            </div>
          </div>
        </div>
      )}


      {/* ── Catálogo de produtos: o cliente pede a foto, o atendente clica ── */}
      {produtosAberto && ativa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => setProdutosAberto(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="relative bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-5">
              <button onClick={() => setProdutosAberto(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white">✕</button>
              <h3 className="text-lg font-bold text-white">📦 Catálogo de produtos</h3>
              <p className="mt-1 text-xs text-white/70">
                Clique numa foto e ela vai para <b>{ativa.nome ?? ativa.telefone}</b> com nome e preço na legenda.
              </p>
            </div>

            <div className="max-h-[calc(92vh-96px)] overflow-y-auto p-6">
              {!cadastrandoProduto ? (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                      {souGestor ? 'Você vê todos os produtos.' : 'Você vê os produtos liberados para o seu departamento.'}
                    </p>
                    <button onClick={() => { setCadastrandoProduto(true); setErroProduto(null) }}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700">
                      ＋ Cadastrar produto
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {produtos
                      .filter(pr => souGestor || !pr.departamentoId || pr.departamentoId === eu?.departamentoId)
                      .map(pr => (
                      <div key={pr.id} className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="flex items-start justify-between gap-2 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{pr.nome}</p>
                            <p className="text-xs text-slate-500">
                              {pr.precoCents ? <span className="font-semibold text-emerald-600">{brl(pr.precoCents)}</span> : 'sem preço'}
                              {pr.departamentoId
                                ? ` · ${departamentos.find(d => d.id === pr.departamentoId)?.nome ?? 'restrito'}`
                                : ' · toda a equipe'}
                            </p>
                          </div>
                          {souGestor && (
                            <button onClick={() => {
                                if (demo) { setProdutos(ps => ps.filter(x => x.id !== pr.id)); return }
                                void excluirWaProduto(pr.id).then(() => void carregarProdutos())
                              }}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500">✕</button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1 px-3 pb-3">
                          {pr.midias.map((mid, i2) => (
                            <button key={i2} onClick={() => void enviarMidiaProduto(pr, mid)}
                              title="Enviar esta mídia agora"
                              className="group relative aspect-square overflow-hidden rounded-xl border border-slate-100 transition hover:ring-2 hover:ring-emerald-500">
                              {mid.tipo === 'video'
                                ? <video src={mid.url} className="h-full w-full object-cover" />
                                // eslint-disable-next-line @next/next/no-img-element
                                : <img src={mid.url} alt="" className="h-full w-full object-cover" />}
                              <span className="absolute inset-0 flex items-center justify-center bg-emerald-600/0 text-white opacity-0 transition group-hover:bg-emerald-600/60 group-hover:opacity-100">➤ enviar</span>
                            </button>
                          ))}
                          {pr.midias.length === 0 && (
                            <p className="col-span-3 py-3 text-center text-[11px] text-slate-400">Sem mídias ainda</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {produtos.length === 0 && (
                    <p className="py-8 text-center text-sm text-slate-400">Nenhum produto cadastrado — clique em ＋ Cadastrar produto.</p>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={pNome} onChange={e => setPNome(e.target.value)} placeholder="Nome do produto"
                      className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                    <input value={pPreco} onChange={e => setPPreco(e.target.value)} placeholder="Preço (ex.: 1.890,00)" inputMode="decimal"
                      className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                  </div>
                  <textarea value={pDesc} onChange={e => setPDesc(e.target.value)} rows={2}
                    placeholder="Descrição curta (vai na legenda junto com o preço)"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                  <select value={pDepto} onChange={e => setPDepto(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-600 focus:outline-none">
                    <option value="">👥 Liberado para toda a equipe</option>
                    {departamentos.map(d => <option key={d.id} value={d.id}>🔒 Só {d.emoji} {d.nome}</option>)}
                  </select>

                  <div className="grid grid-cols-4 gap-2">
                    {pMidias.map((mid, i2) => (
                      <div key={i2} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200">
                        {mid.tipo === 'video'
                          ? <video src={mid.url} className="h-full w-full object-cover" />
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={mid.url} alt="" className="h-full w-full object-cover" />}
                        <button onClick={() => setPMidias(ms => ms.filter((_, k) => k !== i2))}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-[10px] text-white opacity-0 transition group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                    <input ref={fileProdutoRef} type="file" className="hidden"
                      accept="image/jpeg,image/png,image/webp,video/mp4"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void subirMidiaProduto(f) }} />
                    <button onClick={() => fileProdutoRef.current?.click()} disabled={pSubindo}
                      className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-2xl text-slate-300 transition hover:border-emerald-400 hover:text-emerald-500 disabled:opacity-40">
                      {pSubindo ? '…' : '＋'}
                    </button>
                  </div>

                  {erroProduto && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{erroProduto}</p>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => void salvarProduto()} disabled={pNome.trim().length < 2}
                      className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40">
                      Salvar produto
                    </button>
                    <button onClick={() => setCadastrandoProduto(false)}
                      className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {!cadastrandoProduto && erroProduto && (
                <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{erroProduto}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Respostas rápidas (modal) ── */}
      {gerindoRespostas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => setGerindoRespostas(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="relative bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5">
              <button onClick={() => setGerindoRespostas(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white">✕</button>
              <h3 className="text-lg font-bold text-white">⚡ Respostas rápidas</h3>
              <p className="mt-1 text-xs text-white/70">Digite &quot;/&quot; no chat para usar.</p>
            </div>
            <div className="p-5">
            <div className="flex gap-2">
              <input value={novoAtalho} onChange={e => setNovoAtalho(e.target.value)} placeholder="atalho"
                className="w-24 rounded-xl border border-slate-300 px-2 py-2 text-xs focus:outline-none" />
              <input value={novoTexto} onChange={e => setNovoTexto(e.target.value)} placeholder="Texto da resposta"
                onKeyDown={e => { if (e.key === 'Enter') void salvarWaRespostaRapida(novoAtalho, novoTexto).then(() => { setNovoAtalho(''); setNovoTexto(''); void listarWaRespostasRapidas().then(r => setRespostas(r.respostas)) }) }}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none" />
              <button onClick={() => void salvarWaRespostaRapida(novoAtalho, novoTexto).then(() => { setNovoAtalho(''); setNovoTexto(''); void listarWaRespostasRapidas().then(r => setRespostas(r.respostas)) })}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700">Adicionar</button>
            </div>
            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
              {respostas.map(r => (
                <div key={r.id} className="flex items-baseline gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-mono font-bold text-emerald-600">/{r.atalho}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{r.texto}</span>
                  <button onClick={() => void excluirWaRespostaRapida(r.id).then(() => setRespostas(rs => rs.filter(x => x.id !== r.id)))}
                    className="text-slate-300 hover:text-red-500">✕</button>
                </div>
              ))}
              {respostas.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nenhuma resposta ainda.</p>}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
