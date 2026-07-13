import { pillColors, badgeColors } from './seed'

export function Pill({ status }) {
  const [bg, fg] = pillColors(status)
  return (
    <span className="pill" style={{ background: bg, color: fg }}>
      <span className="dot" style={{ background: fg }} />
      {status}
    </span>
  )
}

export function Badge({ status }) {
  const [bg, fg] = badgeColors(status)
  const pulse = status === 'In Progress'
  return (
    <span className="pill" style={{ background: bg, color: fg, font: '600 11.5px Inter', flex: 'none' }}>
      <span className="dot" style={{ background: fg, animation: pulse ? 'cholla-pulse 1.4s infinite' : 'none' }} />
      {status}
    </span>
  )
}

export function Kpi({ label, value, color, sub }) {
  return (
    <div className="kpi">
      <div className="v" style={{ color }}>{value}</div>
      <div className="l">{label}</div>
      <div className="s">{sub}</div>
    </div>
  )
}

export function Seg({ options, value, onChange, activeBg = '#21314F', activeFg = '#fff', inactiveFg = '#5A6B85' }) {
  return (
    <div className="seg">
      {options.map((o) => {
        const a = o === value
        return (
          <button key={o} onClick={() => onChange(o)}
            style={{ background: a ? activeBg : 'transparent', color: a ? activeFg : inactiveFg, boxShadow: a ? '0 2px 6px -2px rgba(33,49,79,.3)' : 'none' }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const a = o === value
        return (
          <button key={o} className="chip" onClick={() => onChange(o)}
            style={{
              background: a ? '#21314F' : 'transparent',
              color: a ? '#fff' : '#5A6B85',
              boxShadow: a ? '0 2px 6px -2px rgba(33,49,79,.3)' : 'none',
            }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function ActionButton({ label, color, border, onClick }) {
  return (
    <button className="action-btn" onClick={onClick} style={{ color, borderColor: border }}>
      {label}
    </button>
  )
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span className="lab">{label}</span>
      {children}
    </label>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      {title && <div className="big">{title}</div>}
      {children}
    </div>
  )
}

// Browsers aggressively autofill anything that looks like a name / phone /
// email field. On a shared kiosk that would surface PREVIOUS people's entries
// to whoever is typing — a privacy leak — so every kiosk input gets
// autocomplete off PLUS a randomized field name (the combination the major
// browsers and password managers actually respect; autocomplete="off" alone
// is widely ignored).
let nfCounter = 0
export function noAutofill() {
  return {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'words',
    spellCheck: false,
    name: 'nf-' + Math.random().toString(36).slice(2, 8) + '-' + nfCounter++,
    'data-lpignore': 'true',
    'data-form-type': 'other',
    'data-1p-ignore': 'true',
  }
}
