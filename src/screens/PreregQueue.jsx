import { useEffect, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Field, ActionButton, Empty } from '../ui'
import { HIPAA_STATEMENT } from '../hipaa'

// Today's community pre-registration queue (people who registered an upcoming
// visit on the public /preregister page) with confirm and no-show controls.
// Confirming collects the HIPAA acknowledgment and a phone number at the desk
// — the same gate every walk-in visitor passes — and converts the entry into
// a normal Community Check-In row. Rendered on the leadership Community
// screen and on the unlocked Community Check-In kiosk; renders nothing when
// the queue is empty.

function nowClock() {
  const d = new Date()
  return S.fmtClock(d.getHours() * 60 + d.getMinutes())
}

export default function PreregQueue({ today, live, onConfirmed }) {
  const [entries, setEntries] = useState(null)
  const [confirming, setConfirming] = useState(null) // entry being confirmed
  const [phone, setPhone] = useState('')
  const [hipaa, setHipaa] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    if (!live) { setEntries([]); return }
    const out = await B.fetchPreregistrations(today)
    setEntries(out || [])
  }
  useEffect(() => { load() }, [live, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const pending = (entries || []).filter((e) => e.status === 'pending')
  if (entries === null || !pending.length) return null

  const startConfirm = (entry) => {
    setConfirming(entry)
    setPhone(entry.phone || '')
    setHipaa(false)
    setErr('')
  }

  const confirm = async () => {
    if (!confirming || !hipaa || busy) return
    setBusy(true); setErr('')
    try {
      await B.confirmPreregistration(confirming.id, today, { hipaa: true, phone: phone.trim(), in: nowClock() })
      setConfirming(null)
      await load()
      if (onConfirmed) onConfirmed()
    } catch (e) {
      setErr(e.message || 'Could not check them in — try again')
    }
    setBusy(false)
  }

  const cancel = async (entry) => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await B.cancelPreregistration(entry.id, today)
      await load()
    } catch (e) {
      setErr(e.message || 'Could not update — try again')
    }
    setBusy(false)
  }

  const phoneOk = phone.replace(/\D/g, '').length >= 7

  return (
    <div className="admin-section">
      <div className="admin-h">Pre-registered visitors — today</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        Registered ahead on the public pre-registration page. Confirm each
        arrival at the desk — the confidentiality acknowledgment and a phone
        number are collected then, exactly like a walk-in.
      </div>
      {err && <div className="signin-err" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="card" style={{ padding: '4px 16px' }}>
        {pending.map((e) => (
          <div className="roster-row" key={e.id}>
            <div style={{ minWidth: 0 }}>
              <div className="roster-name">{e.first} {e.last}</div>
              <div className="roster-meta">
                {e.company && <span>{e.company}</span>}
                <span>{e.purpose}</span>
                {e.host && <span>Visiting {e.host}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ActionButton label="Check in" color="#1F7A56" border="#BBE3D0" onClick={() => startConfirm(e)} />
              <ActionButton label="No-show" color="#B14233" border="#E6BCB5" onClick={() => cancel(e)} />
            </div>
          </div>
        ))}
      </div>

      {confirming && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="roster-name">Confirm arrival — {confirming.first} {confirming.last}</div>
          <Field label="Phone (required)">
            <input className="input" inputMode="tel" value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d() .+-]/g, '').slice(0, 24))}
              placeholder="(602) 555-0100" />
          </Field>
          <label className="hipaa-box">
            <input type="checkbox" checked={hipaa} onChange={(e) => setHipaa(e.target.checked)} />
            <span>
              <b>Confidentiality acknowledgment (required)</b><br />
              {HIPAA_STATEMENT}<br />
              <i>The visitor acknowledges and agrees.</i>
            </span>
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(null)}>Back</button>
            <button className="btn" disabled={busy || !hipaa || !phoneOk} onClick={confirm}>
              {busy ? 'Saving…' : 'Check in'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
