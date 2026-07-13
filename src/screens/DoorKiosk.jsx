import { useEffect, useRef, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Seg } from '../ui'

// Front-door kiosk — the tablet at the facility entrance. Clients check in
// (and out) with just their name; no group, no session. A facilitator unlocks
// it each morning with the same day code as the group kiosks. Pin a device to
// this surface with ?door=1.
//
// The log is date-keyed server-side, so it resets itself at midnight — nobody
// carries over to the next day.

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫']

function nowClock() {
  const d = new Date()
  return S.fmtClock(d.getHours() * 60 + d.getMinutes())
}

export default function DoorKiosk({ live }) {
  const [step, setStep] = useState('lock') // lock | entry | confirm
  const [code, setCode] = useState('')
  const [codeErr, setCodeErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(() => (live ? [] : S.defaultDoor()))
  const [mode, setMode] = useState('in')
  const [entry, setEntry] = useState('')
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(null)
  const timer = useRef(null)

  const refresh = async () => {
    if (!live) return
    const fresh = await B.fetchDoorRows(S.todayISO())
    if (fresh) setRows(fresh)
  }

  // Keep the "in facility now" count honest while the tablet sits open.
  useEffect(() => {
    if (step === 'lock') return
    const iv = setInterval(refresh, 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, live])

  useEffect(() => () => clearTimeout(timer.current), [])

  const pressPad = (l) => {
    setCodeErr('')
    setCode((c) => (l === 'Clear' ? '' : l === '⌫' ? c.slice(0, -1) : c.length < 4 ? c + l : c))
  }

  const unlock = async () => {
    if (code.length !== 4 || busy) return
    setBusy(true); setCodeErr('')
    const ok = await B.verifyKioskCode(code)
    if (!ok) {
      setBusy(false); setCode('')
      setCodeErr(live ? 'That code didn’t match — check with the front office' : 'Enter facilitator code 0000 to open')
      return
    }
    B.setKioskCode(code)
    await refresh()
    setBusy(false); setStep('entry'); setEntry(''); setErr(''); setMode('in')
  }

  const doCheck = async () => {
    const q = entry.trim()
    if (q.length < 2 || busy) return
    const t = nowClock()
    const existing = rows.find((r) => r.name.toLowerCase() === q.toLowerCase())
    let row
    if (mode === 'in') {
      row = existing
        ? { ...existing, in: t, out: null, status: 'In Facility' }
        : { id: 'd' + String(Date.now()).slice(-6), name: S.titleCase(q), in: t, out: null, status: 'In Facility' }
    } else {
      if (!existing) { setErr('We couldn’t find that name on today’s list — check the spelling, or check in first'); return }
      row = { ...existing, out: t, status: 'Departed' }
    }
    setBusy(true); setErr('')
    if (live) {
      try {
        const merged = await B.saveDoorRow(S.todayISO(), row)
        if (merged) setRows(merged)
      } catch (e) {
        setBusy(false); setErr('That didn’t save — please try again, or flag the front office')
        return
      }
    } else {
      setRows((cur) => (existing ? cur.map((r) => (r.id === row.id ? row : r)) : [...cur, row]))
    }
    setBusy(false)
    setConfirm({ mode, time: t })
    setStep('confirm'); setEntry('')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStep((s) => (s === 'confirm' ? 'entry' : s)), 4800)
  }

  const relock = () => {
    B.setKioskCode(null)
    setStep('lock'); setCode(''); setCodeErr(''); setEntry(''); setErr(''); setConfirm(null)
  }

  if (step === 'confirm') {
    const isIn = confirm?.mode === 'in'
    return (
      <div className="scroll fade cholla-scroll" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
        <div className="pop" style={{ width: 92, height: 92, borderRadius: 999, margin: '0 auto', background: isIn ? '#EAF6F0' : '#EEF4FB', border: '3px solid ' + (isIn ? '#2E9E73' : '#4C84C4'), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 18px 36px -16px ' + (isIn ? 'rgba(46,158,115,.55)' : 'rgba(76,132,196,.55)') }}>
          <span style={{ font: '700 44px Inter', color: isIn ? '#1F7A56' : '#2C5C94' }}>✓</span>
        </div>
        <div style={{ font: '700 24px Inter', marginTop: 20, color: isIn ? '#1F7A56' : '#2C5C94' }}>
          {isIn ? 'Welcome — you’re checked in' : 'You’re checked out — take care'}
        </div>
        <div className="card" style={{ marginTop: 18, background: isIn ? '#EAF6F0' : '#EEF4FB', border: 'none' }}>
          <div className="muted" style={{ font: '600 12px Inter' }}>{isIn ? 'Arrival time' : 'Departure time'}</div>
          <div style={{ font: '700 26px Inter', marginTop: 4, color: isIn ? '#1F7A56' : '#2C5C94' }}>{confirm?.time}</div>
        </div>
        <div className="muted" style={{ font: '500 11.5px Inter', marginTop: 18, lineHeight: 1.5 }}>
          For your privacy, names are never shown here · this screen resets automatically
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => { clearTimeout(timer.current); setStep('entry') }}>Next visitor</button>
      </div>
    )
  }

  if (step === 'entry') {
    const present = rows.filter((r) => !r.out).length
    const word = mode === 'in' ? 'in' : 'out'
    const enabled = entry.trim().length >= 2 && !busy
    return (
      <div className="scroll fade cholla-scroll">
        <div className="section-title">Welcome to Cholla</div>
        <div className="section-sub">Front-door check-in · {present} in the facility now</div>

        <div style={{ marginTop: 16 }}>
          <Seg options={['Check in', 'Check out']} value={mode === 'in' ? 'Check in' : 'Check out'}
            onChange={(o) => { setMode(o === 'Check in' ? 'in' : 'out'); setEntry(''); setErr('') }} />
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <span className="lab">Enter your name to check {word}</span>
          <input className="input" value={entry}
            onChange={(e) => { setEntry(e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40)); setErr('') }}
            placeholder="First and last name" autoFocus />
          {err && <div style={{ color: '#B14233', font: '600 12.5px Inter', marginTop: 10 }}>{err}</div>}
          <button className="btn" style={{ marginTop: 16, background: enabled ? '#BE6A45' : '#D8C3B8', boxShadow: enabled ? '0 12px 24px -10px rgba(190,106,69,.65)' : 'none' }}
            disabled={!enabled} onClick={doCheck}>
            {busy ? 'Saving…' : mode === 'in' ? 'Check in' : 'Check out'}
          </button>
        </div>

        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={relock}>Lock kiosk</button>
      </div>
    )
  }

  // step === 'lock'
  const begin = code.length === 4 && !busy
  return (
    <div className="scroll fade cholla-scroll">
      <div className="kiosk-title">Front-door setup</div>
      <div className="kiosk-block">
        <span className="lab">Facilitator code</span>
        <div className="codedots">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="codedot"
              style={{ borderColor: code.length === i ? '#4C84C4' : '#DCE3EE', background: code.length === i ? '#F2F7FD' : '#fff' }}>
              {code[i] ? '•' : ''}
            </div>
          ))}
        </div>
        {codeErr && <div style={{ color: '#B14233', font: '600 12.5px Inter', marginTop: 10, textAlign: 'center' }}>{codeErr}</div>}
        <div className="pad" style={{ marginTop: 14 }}>
          {PAD.map((l) => (
            <button key={l} onClick={() => pressPad(l)}
              style={{ background: l === 'Clear' || l === '⌫' ? '#F4F7FB' : '#fff', fontSize: l === 'Clear' ? 15 : 22 }}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <button className="btn" style={{ marginTop: 16, background: begin ? '#BE6A45' : '#D8C3B8', boxShadow: begin ? '0 12px 24px -10px rgba(190,106,69,.65)' : 'none' }}
        disabled={!begin} onClick={unlock}>
        {busy ? 'Verifying…' : 'Open front-door check-in'}
      </button>
      {!live && <div className="muted" style={{ textAlign: 'center', font: '500 12px Inter', marginTop: 12 }}>Preview facilitator code: 0 0 0 0</div>}
    </div>
  )
}
