import { useState } from 'react'
import logoUrl from '../../Blue Agave Logo.png'
import * as B from '../lib/backend'
import { Field } from '../ui'

// Public visitor pre-registration — /preregister. FOR NON-CLIENTS ONLY:
// guests, vendors, family and community partners registering an upcoming
// visit ahead of time. Submissions go to a separate pre-registration queue
// (never any client table); the front desk confirms the arrival on the day.
//
// This page is public and write-only: it can submit a registration but can
// never read anything back. The API rate-limits and validates every field.

const PURPOSES = [
  'Meeting',
  'Visiting a staff member',
  'Graduation ceremony',
  'Vendor / delivery',
  'Facility tour',
  'Community partner visit',
  'Other',
]

const EMPTY = { first: '', last: '', date: '', purpose: '', host: '', company: '', phone: '' }

export default function PreRegister() {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const setF = (k) => (e) => {
    let v = e.target.value
    if (k === 'first' || k === 'last') v = v.replace(/[^A-Za-z .'-]/g, '').slice(0, 40)
    if (k === 'phone') v = v.replace(/[^\d() .+-]/g, '').slice(0, 24)
    setForm((f) => ({ ...f, [k]: v }))
    setErr('')
  }

  const today = new Date()
  const minDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')

  const valid =
    form.first.trim().length >= 1 &&
    form.last.trim().length >= 1 &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.date) &&
    form.purpose

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setErr('')
    try {
      await B.submitPreregistration({
        first: form.first.trim(),
        last: form.last.trim(),
        date: form.date,
        purpose: form.purpose,
        host: form.host.trim() || undefined,
        company: form.company.trim() || undefined,
        phone: form.phone.trim() || undefined,
      })
      setDone(true)
    } catch (e) {
      setErr(e.message || 'Could not submit — please try again, or just check in at the front desk when you arrive')
    }
    setBusy(false)
  }

  if (done) {
    return (
      <div className="app app--desktop">
        <div className="signin-wrap">
          <div className="signin-card" style={{ textAlign: 'center' }}>
            <img src={logoUrl} alt="Cholla Behavioral Health" className="signin-logo" />
            <div className="signin-title">You're pre-registered</div>
            <div className="signin-sub">
              Thanks, {form.first.trim()} — we'll have you on the list. When you
              arrive, stop by the front desk to complete check-in (a quick
              confidentiality acknowledgment is required on site).
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 16 }}
              onClick={() => { setForm(EMPTY); setDone(false) }}>
              Register another visitor
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app app--desktop">
      <div className="signin-wrap">
        <div className="signin-card" style={{ maxWidth: 460 }}>
          <img src={logoUrl} alt="Cholla Behavioral Health" className="signin-logo" />
          <div className="signin-title">Visitor pre-registration</div>
          <div className="signin-sub">
            Visiting Cholla Behavioral Health? Register ahead and the front desk
            will have you on the list. For visitors, vendors and community
            partners only — clients check in on site as usual.
          </div>

          <div className="row">
            <Field label="First name *"><input className="input" value={form.first} onChange={setF('first')} placeholder="First" /></Field>
            <Field label="Last name *"><input className="input" value={form.last} onChange={setF('last')} placeholder="Last" /></Field>
          </div>
          <Field label="Visit date *">
            <input className="input" type="date" min={minDate} value={form.date} onChange={setF('date')} />
          </Field>
          <Field label="Purpose of visit *">
            <select className="select" value={form.purpose} onChange={setF('purpose')}>
              <option value="">Select a purpose…</option>
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Who are you visiting?">
            <input className="input" value={form.host} onChange={setF('host')} placeholder="Staff member (optional)" maxLength={80} />
          </Field>
          <Field label="Company / organization">
            <input className="input" value={form.company} onChange={setF('company')} placeholder="Optional" maxLength={80} />
          </Field>
          <Field label="Phone">
            <input className="input" inputMode="tel" value={form.phone} onChange={setF('phone')} placeholder="Optional — speeds up check-in" />
          </Field>

          {err && <div className="signin-err" style={{ marginTop: 10 }}>{err}</div>}
          <button className="btn" style={{ marginTop: 12, background: valid ? '#BE6A45' : '#D8C3B8' }}
            disabled={!valid || busy} onClick={submit}>
            {busy ? 'Submitting…' : 'Pre-register my visit'}
          </button>
          <div className="signin-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            On arrival you'll confirm at the front desk and accept the standard
            confidentiality acknowledgment.
          </div>
        </div>
      </div>
    </div>
  )
}
