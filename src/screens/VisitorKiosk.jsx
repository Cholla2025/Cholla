import { useEffect, useRef, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Seg, Field, noAutofill } from '../ui'
import { HIPAA_STATEMENT } from '../hipaa'
import PreregQueue from './PreregQueue'

// Community Check-In — the third kiosk area, for people who are neither
// clients nor staff (guests, vendors, family). Collects name/phone/company
// (required), email (optional), who they're visiting (auto-suggests from the
// staff/facilitator directory), and a reason for the visit. "Visiting a
// client" deliberately has NO client-name field, and nobody enters the site
// without checking the HIPAA confidentiality acknowledgment. Pre-registered
// visitors (from the public /preregister page) appear in a confirm queue once
// the kiosk is unlocked.
//
// Every input carries noAutofill() so the browser never suggests a previous
// visitor's name/phone/email on this shared tablet.

const REASONS = [
  'Meeting',
  'Visiting a client',
  'Visiting a staff member',
  'Graduation ceremony',
  'Vendor / delivery',
  'Facility tour',
  'Other',
]

export { HIPAA_STATEMENT }

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫']

function nowClock() {
  const d = new Date()
  return S.fmtClock(d.getHours() * 60 + d.getMinutes())
}

const EMPTY_FORM = { first: '', last: '', phone: '', email: '', company: '', visiting: '', reason: '', hipaa: false }

export default function VisitorKiosk({ live, onExit }) {
  const [step, setStep] = useState('lock') // lock | entry | confirm
  const [code, setCode] = useState('')
  const [codeErr, setCodeErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(() => (live ? [] : S.defaultVisitors()))
  const [options, setOptions] = useState({ companies: [], people: [] })
  const [mode, setMode] = useState('in')
  const [form, setForm] = useState(EMPTY_FORM)
  const [outName, setOutName] = useState({ first: '', last: '' })
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(null)
  const timer = useRef(null)

  const refresh = async () => {
    if (!live) return
    const fresh = await B.fetchVisitorRows(S.todayISO())
    if (fresh) setRows(fresh)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  const pressPad = (l) => {
    setCodeErr('')
    setCode((c) => (l === 'Clear' ? '' : l === '⌫' ? c.slice(0, -1) : c.length < 4 ? c + l : c))
  }

  const unlock = async () => {
    if (code.length !== 4 || busy) return
    setBusy(true); setCodeErr('')
    const out = await B.verifyKioskCode(code)
    if (!out || !out.ok) {
      setBusy(false); setCode('')
      setCodeErr(live ? 'That code didn’t match — check with the front office' : 'Enter facilitator code 0000 to open')
      return
    }
    B.setKioskCode(code)
    await refresh()
    setOptions(await B.fetchVisitorOptions())
    setBusy(false); setStep('entry'); setErr(''); setMode('in'); setForm(EMPTY_FORM)
  }

  const setF = (k) => (e) => {
    let v = e.target.value
    if (k === 'first' || k === 'last') v = v.replace(/[^A-Za-z .'-]/g, '').slice(0, 40)
    if (k === 'phone') v = v.replace(/[^\d() .+-]/g, '').slice(0, 24)
    setForm((f) => ({ ...f, [k]: v }))
    setErr('')
  }

  const phoneDigits = form.phone.replace(/\D/g, '')
  const formValid =
    form.first.trim().length >= 1 &&
    form.last.trim().length >= 1 &&
    phoneDigits.length >= 7 &&
    form.company.trim().length >= 1 &&
    form.reason &&
    form.hipaa

  const checkIn = async () => {
    if (!formValid || busy) return
    const t = nowClock()
    const row = {
      id: 'v' + String(Date.now()).slice(-6),
      first: S.titleCase(form.first.trim()),
      last: S.titleCase(form.last.trim()),
      phone: form.phone.trim(),
      email: form.email.trim(),
      company: form.company.trim(),
      visiting: form.visiting.trim(),
      reason: form.reason,
      hipaa: true,
      in: t, out: null, status: 'On Site',
    }
    setBusy(true); setErr('')
    if (live) {
      try {
        const merged = await B.saveVisitorRow(S.todayISO(), row)
        if (merged) setRows(merged)
      } catch (e) {
        setBusy(false); setErr(e.message || 'That didn’t save — please try again, or flag the front office')
        return
      }
    } else {
      setRows((cur) => [...cur, row])
    }
    setBusy(false)
    setConfirm({ mode: 'in', time: t })
    setStep('confirm'); setForm(EMPTY_FORM)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStep((s) => (s === 'confirm' ? 'entry' : s)), 4800)
  }

  const checkOut = async () => {
    const first = outName.first.trim().toLowerCase()
    const last = outName.last.trim().toLowerCase()
    if (!first || !last || busy) return
    const existing = rows.find((r) => r.first.toLowerCase() === first && r.last.toLowerCase() === last)
    if (!existing) {
      setErr('We couldn’t find that name on today’s visitor list — check the spelling, or check in first')
      return
    }
    const t = nowClock()
    const row = { ...existing, out: t, status: 'Departed' }
    setBusy(true); setErr('')
    if (live) {
      try {
        const merged = await B.saveVisitorRow(S.todayISO(), row)
        if (merged) setRows(merged)
      } catch (e) {
        setBusy(false); setErr(e.message || 'That didn’t save — please try again')
        return
      }
    } else {
      setRows((cur) => cur.map((r) => (r.id === row.id ? row : r)))
    }
    setBusy(false)
    setConfirm({ mode: 'out', time: t })
    setStep('confirm'); setOutName({ first: '', last: '' })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStep((s) => (s === 'confirm' ? 'entry' : s)), 4800)
  }

  if (step === 'confirm') {
    const isIn = confirm?.mode === 'in'
    return (
      <div className="scroll fade cholla-scroll" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
        <div className="pop" style={{ width: 92, height: 92, borderRadius: 999, margin: '0 auto', background: isIn ? '#EAF6F0' : '#EEF4FB', border: '3px solid ' + (isIn ? '#2E9E73' : '#4C84C4'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ font: '700 44px Inter', color: isIn ? '#1F7A56' : '#2C5C94' }}>✓</span>
        </div>
        <div style={{ font: '700 24px Inter', marginTop: 20, color: isIn ? '#1F7A56' : '#2C5C94' }}>
          {isIn ? 'Welcome — you’re signed in' : 'Signed out — thanks for visiting'}
        </div>
        <div className="card" style={{ marginTop: 18, background: isIn ? '#EAF6F0' : '#EEF4FB', border: 'none' }}>
          <div className="muted" style={{ font: '600 12px Inter' }}>{isIn ? 'Arrival time' : 'Departure time'}</div>
          <div style={{ font: '700 26px Inter', marginTop: 4, color: isIn ? '#1F7A56' : '#2C5C94' }}>{confirm?.time}</div>
        </div>
        {isIn && (
          <div className="muted" style={{ font: '500 11.5px Inter', marginTop: 14, lineHeight: 1.5 }}>
            Please wear a visitor badge and remain with your host · this screen resets automatically
          </div>
        )}
        <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => { clearTimeout(timer.current); setStep('entry') }}>Next visitor</button>
      </div>
    )
  }

  if (step === 'entry') {
    const onSite = rows.filter((r) => !r.out).length
    return (
      <div className="scroll fade cholla-scroll">
        <div className="section-title">Community check-in</div>
        <div className="section-sub">Welcome to Cholla · {onSite} visitor{onSite === 1 ? '' : 's'} on site now</div>

        <PreregQueue today={S.todayISO()} live={live} onConfirmed={refresh} />

        <div style={{ marginTop: 16 }}>
          <Seg options={['Check in', 'Check out']} value={mode === 'in' ? 'Check in' : 'Check out'}
            onChange={(o) => { setMode(o === 'Check in' ? 'in' : 'out'); setErr('') }} />
        </div>

        {mode === 'in' ? (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row">
              <Field label="First name *"><input className="input" {...noAutofill()} value={form.first} onChange={setF('first')} placeholder="First" /></Field>
              <Field label="Last name *"><input className="input" {...noAutofill()} value={form.last} onChange={setF('last')} placeholder="Last" /></Field>
            </div>
            <div className="row">
              <Field label="Phone *"><input className="input" {...noAutofill()} inputMode="tel" value={form.phone} onChange={setF('phone')} placeholder="(602) 555-0100" /></Field>
              <Field label="Email"><input className="input" {...noAutofill()} inputMode="email" autoCapitalize="none" value={form.email} onChange={setF('email')} placeholder="Optional" /></Field>
            </div>
            <Field label="Company / organization *">
              <input className="input" {...noAutofill()} list="visitor-companies" value={form.company} onChange={setF('company')} placeholder="Who do you work with?" />
              <datalist id="visitor-companies">{options.companies.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Person you're visiting">
              <input className="input" {...noAutofill()} list="visitor-people" value={form.visiting} onChange={setF('visiting')} placeholder="Start typing a staff name (optional)" />
              <datalist id="visitor-people">{options.people.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Reason for visit *">
              <select className="select" value={form.reason} onChange={setF('reason')}>
                <option value="">Select a reason…</option>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>

            <label className="hipaa-box">
              <input type="checkbox" checked={form.hipaa} onChange={(e) => { setForm((f) => ({ ...f, hipaa: e.target.checked })); setErr('') }} />
              <span>
                <b>Confidentiality acknowledgment (required)</b><br />
                {HIPAA_STATEMENT}<br />
                <i>By checking this box, I acknowledge and agree.</i>
              </span>
            </label>

            {err && <div style={{ color: '#B14233', font: '600 12.5px Inter', marginTop: 10 }}>{err}</div>}
            <button className="btn" style={{ marginTop: 14, background: formValid ? '#BE6A45' : '#D8C3B8', boxShadow: formValid ? '0 12px 24px -10px rgba(190,106,69,.65)' : 'none' }}
              disabled={!formValid || busy} onClick={checkIn}>
              {busy ? 'Saving…' : 'Check in'}
            </button>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 16 }}>
            <span className="lab">Enter your name to sign out</span>
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input" {...noAutofill()} value={outName.first}
                onChange={(e) => { setOutName((o) => ({ ...o, first: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40) })); setErr('') }}
                placeholder="First name" />
              <input className="input" {...noAutofill()} value={outName.last}
                onChange={(e) => { setOutName((o) => ({ ...o, last: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40) })); setErr('') }}
                placeholder="Last name" />
            </div>
            {err && <div style={{ color: '#B14233', font: '600 12.5px Inter', marginTop: 10 }}>{err}</div>}
            <button className="btn" style={{ marginTop: 14 }} disabled={busy || !outName.first.trim() || !outName.last.trim()} onClick={checkOut}>
              {busy ? 'Saving…' : 'Check out'}
            </button>
          </div>
        )}

        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={onExit}>Switch check-in area</button>
      </div>
    )
  }

  // step === 'lock'
  const begin = code.length === 4 && !busy
  return (
    <div className="scroll fade cholla-scroll">
      <div className="kiosk-title">Community check-in setup</div>
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
        {busy ? 'Verifying…' : 'Open community check-in'}
      </button>
      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onExit}>Switch check-in area</button>
      {!live && <div className="muted" style={{ textAlign: 'center', font: '500 12px Inter', marginTop: 12 }}>Preview facilitator code: 0 0 0 0</div>}
    </div>
  )
}
