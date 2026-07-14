import { useEffect, useRef, useState } from 'react'
import * as B from '../lib/backend'
import { Empty } from '../ui'

// AI tab — a full-page analytics assistant for leadership, powered by Claude
// server-side. It answers from de-identified aggregates only (counts, trends,
// group labels); client names never reach the model, which is what keeps this
// HIPAA-safe by architecture rather than by policy.

const SUGGESTIONS = [
  'How is attendance trending this week?',
  'Which groups are declining and by how much?',
  'Compare Morning vs Afternoon this month',
  'How busy was member check-in today vs last week?',
]

// ----- tiny markdown renderer (tables, bold, headers, lists) -----
// The assistant is instructed to answer in GitHub-flavored markdown; this
// renders the subset it uses without pulling in a dependency.

function renderInline(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <b key={keyBase + '-' + i}>{p.slice(2, -2)}</b>
      : p
  )
}

function isTableDivider(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
}

export function Markdown({ text }) {
  const lines = String(text || '').split('\n')
  const out = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    // Table: header row + divider row
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      out.push(
        <div key={key++} className="ai-tablewrap cholla-scroll">
          <table className="ai-table">
            <thead><tr>{header.map((h, j) => <th key={j}>{renderInline(h, key + '-h' + j)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c, key + '-' + ri + '-' + ci)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    // Headers
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(<div key={key++} className="ai-h">{renderInline(h[2], key + '-h')}</div>)
      i++
      continue
    }
    // Lists (bulleted or numbered)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      out.push(
        <ul key={key++} className="ai-list">
          {items.map((it, j) => <li key={j}>{renderInline(it, key + '-li' + j)}</li>)}
        </ul>
      )
      continue
    }
    // Paragraphs
    if (line.trim()) {
      out.push(<p key={key++} className="ai-p">{renderInline(line, key + '-p')}</p>)
    }
    i++
  }
  return <>{out}</>
}

export default function Assistant({ store }) {
  const { state: st } = store
  const [thread, setThread] = useState([]) // {role, content}
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current && endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread, busy])

  const ask = async (q) => {
    const question = (q || input).trim()
    if (!question || busy) return
    setErr(''); setInput(''); setBusy(true)
    const history = thread.map((t) => ({ role: t.role, content: t.content }))
    setThread((cur) => [...cur, { role: 'user', content: question }])
    try {
      const out = await B.askAi(question, history)
      setThread((cur) => [...cur, { role: 'assistant', content: (out && out.answer) || 'No answer returned — try again.' }])
    } catch (e) {
      setErr(e.message || 'The AI request failed — try again')
      setThread((cur) => cur.slice(0, -1))
      setInput(question)
    }
    setBusy(false)
  }

  return (
    <div className="scroll fade cholla-scroll" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="section-title">AI assistant</div>
      <div className="section-sub">
        {st.authName || 'Leadership'} · asks Claude about your attendance data ·
        aggregates only — client names never reach the AI
      </div>

      <div style={{ flex: 1, marginTop: 16 }}>
        {thread.length === 0 && !busy ? (
          <>
            <div className="card">
              <Empty title="Ask anything about the numbers">
                Attendance, trends, group comparisons, member check-in traffic —
                answers come back with tables built from your live data.
              </Empty>
            </div>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip ai-chip" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </>
        ) : (
          thread.map((m, i) => (
            <div key={i} className={'ai-msg ' + (m.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant')}>
              {m.role === 'user' ? <p className="ai-p">{m.content}</p> : <Markdown text={m.content} />}
            </div>
          ))
        )}
        {busy && (
          <div className="ai-msg ai-msg-assistant">
            <p className="ai-p ai-thinking">Reading the numbers…</p>
          </div>
        )}
        {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}
        <div ref={endRef} />
      </div>

      <div className="ai-composer">
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="Ask about attendance, trends, groups…"
          disabled={busy}
        />
        <button className="btn" style={{ width: 'auto' }} disabled={busy || input.trim().length < 3} onClick={() => ask()}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {thread.length > 0 && (
        <button className="signin-link" style={{ marginTop: 10, alignSelf: 'center' }} onClick={() => { setThread([]); setErr('') }}>
          Clear conversation
        </button>
      )}
    </div>
  )
}
