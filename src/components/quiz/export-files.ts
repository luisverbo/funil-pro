// ============================================================================
// Geração de arquivo no NAVEGADOR (CSV e PDF) — compartilhada entre o painel
// logado (quiz-leads-view) e o painel público com senha (/ql/[token]).
// Duplicar isto faria os dois arquivos divergirem na primeira mudança.
// ============================================================================

import type { ExportTable } from '@/lib/quiz/leads-core'

/** CSV com escape correto (vírgula, aspas e quebra de linha no valor). */
export function montarCsv(t: ExportTable): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return [t.colunas.map(c => esc(c.rotulo)), ...t.linhas.map(l => l.map(esc))]
    .map(l => l.join(','))
    .join('\n')
}

/** Dispara o download do CSV. BOM incluso: o Excel pt-BR precisa dele. */
export function baixarCsv(t: ExportTable, nomeBase: string): void {
  const blob = new Blob(['\uFEFF' + montarCsv(t)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${nomeBase}.csv`; a.click()
  URL.revokeObjectURL(url)
}

/**
 * PDF sem dependência nova: janela de impressão com a tabela pronta e o
 * diálogo do navegador em "Salvar como PDF". Todo o conteúdo é escapado —
 * resposta de lead nunca vira HTML.
 *
 * Devolve mensagem de erro quando o navegador bloqueia a janela; null = ok.
 */
export function abrirPdf(t: ExportTable): string | null {
  const esc = (v: string) => v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const cab = t.colunas.map(c => `<th>${esc(c.rotulo)}</th>`).join('')
  const corpo = t.linhas
    .map(l => `<tr>${l.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`)
    .join('')
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(t.titulo)} — respostas</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111827; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.sub { font-size: 11px; color: #6b7280; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
</style></head><body>
<h1>${esc(t.titulo)}</h1>
<p class="sub">${t.linhas.length} ${t.linhas.length === 1 ? 'resposta' : 'respostas'} · gerado em ${esc(new Date().toLocaleString('pt-BR'))}</p>
<table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
</body></html>`
  const janela = window.open('', '_blank')
  if (!janela) return 'O navegador bloqueou a janela. Libere pop-ups para gerar o PDF.'
  janela.document.write(html)
  janela.document.close()
  janela.focus()
  setTimeout(() => janela.print(), 400)
  return null
}
