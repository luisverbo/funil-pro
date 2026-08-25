'use client'

// ============================================================================
// Portal do cliente — configuração a partir da página de AGENTES
// ----------------------------------------------------------------------------
// O mesmo portal (link /ql/<token> + senha) que entrega leads de quiz agora
// entrega os leads do agente. Este modal é o caminho do dono quando o cliente
// tem só agente (sem quiz): escolhe quais agentes entram, o público de cada
// um (padrão = 🔥 só quem atingiu o objetivo), se a transcrição aparece e a
// data de corte.
//
// As chamadas vão pelo /api/painel-quiz (HTTP, não server action) — as
// actions desta área já quebraram mascaradas em produção uma vez; não se
// repete o erro.
// ============================================================================

import { useEffect, useState } from 'react'
import {
  ativarPortal, atualizarPortalConfig, desativarPortal,
  getPortalDoAgente, listarAgentesDoTenant,
} from '@/lib/quiz/painel-client'

interface AgenteConfig {
  agentId: string
  titulo: string
  publico: string
  mostrarConversa: boolean
  desde: string | null
}

const PUBLICOS: { valor: string; rotulo: string; dica: string }[] = [
  { valor: 'quentes', rotulo: '🔥 Só leads quentes (atingiram o objetivo)', dica: 'Agendou reunião, comprou ou foi qualificado — conforme o objetivo do agente.' },
  { valor: 'agendados', rotulo: '📅 Só quem marcou reunião', dica: 'Apenas conversas com reunião confirmada na agenda.' },
  { valor: 'com_contato', rotulo: '📱 Quem deixou contato', dica: 'Todo lead com telefone ou e-mail, quente ou não.' },
  { valor: 'todos', rotulo: 'Todas as conversas', dica: 'Inclui curiosos e desqualificados.' },
]

export default function AgentPortalModal({
  agentId, agentName, onClose,
}: { agentId: string; agentName: string; onClose: () => void }) {
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [portalId, setPortalId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [acessos, setAcessos] = useState(0)
  const [mostrarMetricas, setMostrarMetricas] = useState(true)
  const [mostrarFunil, setMostrarFunil] = useState(true)
  const [permitirStatus, setPermitirStatus] = useState(true)
  const [disponiveis, setDisponiveis] = useState<{ id: string; titulo: string }[]>([])
  const [selecionados, setSelecionados] = useState<AgenteConfig[]>([])
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const [portal, agentes] = await Promise.all([
          getPortalDoAgente(agentId),
          listarAgentesDoTenant(),
        ])
        if ('error' in portal) { setErro(portal.error); setCarregando(false); return }
        const lista = Array.isArray(agentes) ? agentes : []
        setDisponiveis(lista)
        if (portal.portalId) {
          setPortalId(portal.portalId)
          setToken(portal.token)
          setNome(portal.nome)
          setAcessos(portal.acessos)
          setMostrarMetricas(portal.mostrarMetricas)
          setMostrarFunil(portal.mostrarFunil)
          setPermitirStatus(portal.permitirStatus)
          setSelecionados(portal.agentes.map(a => ({
            agentId: a.agentId, titulo: a.titulo, publico: a.publico,
            mostrarConversa: a.mostrarConversa, desde: a.desde,
          })))
        } else {
          // Portal novo: começa com O agente de onde o modal abriu, no padrão
          // mais seguro (só leads quentes, sem transcrição).
          setSelecionados([{
            agentId, titulo: agentName, publico: 'quentes', mostrarConversa: false, desde: null,
          }])
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar')
      } finally {
        setCarregando(false)
      }
    })()
  }, [agentId, agentName])

  const alternar = (id: string, titulo: string) => {
    setSelecionados(sel => sel.some(a => a.agentId === id)
      ? sel.filter(a => a.agentId !== id)
      : [...sel, { agentId: id, titulo, publico: 'quentes', mostrarConversa: false, desde: null }])
  }
  const mudar = (id: string, patch: Partial<AgenteConfig>) => {
    setSelecionados(sel => sel.map(a => a.agentId === id ? { ...a, ...patch } : a))
  }

  const link = token && typeof window !== 'undefined' ? `${window.location.origin}/ql/${token}` : null

  const salvar = async (renovarSenha: boolean) => {
    setSalvando(true); setErro(null)
    try {
      if (selecionados.length === 0) { setErro('Escolha ao menos um agente'); return }
      const agentes = selecionados.map(a => ({
        agentId: a.agentId, publico: a.publico, mostrarConversa: a.mostrarConversa, desde: a.desde,
      }))
      if (!portalId || renovarSenha) {
        if (senha.trim().length < 4) { setErro('Defina uma senha (mínimo 4 caracteres)'); return }
        const r = await ativarPortal({
          nome, senha, agentes, mostrarMetricas, mostrarFunil, permitirStatus,
          ...(portalId ? { portalId } : {}),
        })
        if ('error' in r) { setErro(r.error); return }
        setPortalId(r.portalId); setToken(r.token); setSenha('')
      } else {
        const r = await atualizarPortalConfig({
          portalId, nome, agentes, mostrarMetricas, mostrarFunil, permitirStatus,
        })
        if ('error' in r) { setErro(r.error); return }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar')
    } finally {
      setSalvando(false)
    }
  }

  const desligar = async () => {
    if (!portalId) return
    setSalvando(true); setErro(null)
    try {
      const r = await desativarPortal(portalId)
      if ('error' in r) { setErro(r.error); return }
      setToken(null)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">🔗 Portal do cliente</h3>
            <p className="mt-0.5 text-sm text-gray-500">
              Link + senha para o seu cliente receber os leads do agente —
              com kanban, WhatsApp e métricas, sem precisar de conta.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {carregando ? (
          <p className="py-8 text-center text-sm text-gray-400">Carregando…</p>
        ) : (
          <>
            {link && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold text-emerald-800">Portal ativo · {acessos} acesso(s)</p>
                <div className="mt-1.5 flex gap-2">
                  <input readOnly value={link}
                    className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-gray-700" />
                  <button
                    onClick={() => { void navigator.clipboard.writeText(link).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }) }}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                    {copiado ? '✓ Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="text-xs font-semibold text-gray-700">Nome do cliente</label>
              <input value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Ex.: Clínica Sorriso"
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-700">Agentes neste portal</p>
              <div className="mt-2 space-y-2">
                {disponiveis.map(a => {
                  const sel = selecionados.find(x => x.agentId === a.id)
                  return (
                    <div key={a.id} className={`rounded-xl border p-3 ${sel ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200'}`}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                        <input type="checkbox" checked={Boolean(sel)} onChange={() => alternar(a.id, a.titulo)} />
                        🤖 {a.titulo}
                      </label>
                      {sel && (
                        <div className="mt-2 space-y-2 pl-6">
                          <select value={sel.publico} onChange={e => mudar(a.id, { publico: e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
                            {PUBLICOS.map(p => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                          </select>
                          <p className="text-[11px] text-gray-400">
                            {PUBLICOS.find(p => p.valor === sel.publico)?.dica}
                          </p>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
                            <input type="checkbox" checked={sel.mostrarConversa}
                              onChange={e => mudar(a.id, { mostrarConversa: e.target.checked })} />
                            Mostrar a conversa completa ao cliente
                            <span className="text-gray-400">(sensível — padrão é só o resumo)</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-600">
                            Mostrar a partir de
                            <input type="date" value={sel.desde ?? ''}
                              onChange={e => mudar(a.id, { desde: e.target.value || null })}
                              className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
                          </label>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 space-y-1.5 text-sm text-gray-700">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={mostrarMetricas} onChange={e => setMostrarMetricas(e.target.checked)} />
                Mostrar métricas (conversas, conversão, funil)
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={mostrarFunil} onChange={e => setMostrarFunil(e.target.checked)} />
                Mostrar o funil de conversão do agente
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={permitirStatus} onChange={e => setPermitirStatus(e.target.checked)} />
                Cliente pode marcar o desfecho (kanban)
              </label>
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold text-gray-700">
                {portalId ? 'Nova senha (só para renovar o link)' : 'Senha do portal'}
              </label>
              <input type="text" value={senha} onChange={e => setSenha(e.target.value)}
                placeholder={portalId ? 'Deixe em branco para manter senha e link' : 'A senha que você vai passar ao cliente'}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              {portalId && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Renovar a senha gera um LINK NOVO — o antigo deixa de funcionar.
                </p>
              )}
            </div>

            {erro && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{erro}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => void salvar(!portalId || senha.trim().length > 0)} disabled={salvando}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {salvando ? 'Salvando…' : portalId ? (senha.trim() ? '🔄 Renovar link e senha' : '💾 Salvar configurações') : '🚀 Criar portal'}
              </button>
              {portalId && token && (
                <button onClick={() => void desligar()} disabled={salvando}
                  className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  Desativar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
