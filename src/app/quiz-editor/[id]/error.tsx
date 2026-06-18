'use client'

export default function QuizEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ padding: 32, fontFamily: 'monospace' }}>
      <h2 style={{ color: 'red', marginBottom: 16 }}>Erro no Quiz Editor</h2>
      <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13 }}>
        {error.message}
        {error.stack ? '\n\n' + error.stack : ''}
      </pre>
      {error.digest && <p style={{ marginTop: 8, color: '#666', fontSize: 12 }}>Digest: {error.digest}</p>}
      <button
        onClick={reset}
        style={{ marginTop: 16, padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
      >
        Tentar novamente
      </button>
      <a href="/pages" style={{ marginLeft: 12, color: '#6366f1', fontSize: 14 }}>← Voltar</a>
    </div>
  )
}
