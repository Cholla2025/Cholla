import { useEffect, useState } from 'react'
import * as B from '../lib/backend'
import { Field, ActionButton, Empty } from '../ui'
import { OrgSettings } from './Leader'

// The Settings tab. Sections appear by role:
//   everyone   — My profile (display name, session info, sign out)
//   leader +   — Team (facilitators & groups — same powers as Day-of settings)
//                and Sign-in accounts (facilitator accounts)
//   admin      — full account management incl. leader/admin roles, plus the
//                platform panel (kiosk code & app-setting reference)

export const ROLE_LABELS = { facilitator: 'Facilitator', leader: 'Leader', admin: 'Admin' }
const ROLE_COLORS = { facilitator: ['#E7F0E9', '#1F7A56'], leader: ['#E8EEF9', '#21314F'], admin: ['#F7E9E1', '#BE6A45'] }

export function RolePill({ role }) {
  const [bg, fg] = ROLE_COLORS[role] || ['#EEF1F6', '#5A6B85']
  return <span className="pill" style={{ background: bg, color: fg, font: '600 11.5px Inter' }}>{ROLE_LABELS[role] || role}</span>
}

export default function Settings({ store }) {
  const { state: st } = store
  const isLeader = st.authRole === 'leader' || st.authRole === 'admin'
  const isAdmin = st.authRole === 'admin'

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Settings</div>
      <div className="section-sub">{st.authName || 'Signed in'} · {st.todayLabel}</div>

      <Profile store={store} />
      {isLeader && (
        <div className="admin-section">
          <div className="admin-h">Team — facilitators &amp; groups</div>
          <div className="section-sub" style={{ marginTop: -4, marginBottom: 4 }}>
            Add or remove facilitators and change which group each one runs.
            These are the same controls as Leadership → Day-of settings.
          </div>
          <OrgSettings store={store} />
        </div>
      )}
      {isLeader && <Accounts store={store} isAdmin={isAdmin} />}
      {isAdmin && <Platform />}
    </div>
  )
}

function Profile({ store }) {
  const { state: st, actions: a } = store
  const [name, setName] = useState(st.authName || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    const nm = name.trim()
    if (nm.length < 2 || busy) return
    setBusy(true); setMsg('')
    const ok = await a.saveProfile(nm)
    setMsg(ok ? 'Saved' : 'Could not save — try again')
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-h">My profile</div>
      <div className="card admin-form">
        <Field label="Display name">
          <input className="input" value={name} maxLength={80}
            onChange={(e) => { setName(e.target.value); setMsg('') }}
            placeholder="Name shown on dashboards" />
        </Field>
        <Field label="Email"><input className="input" value={st.authUser?.email || ''} disabled /></Field>
        <Field label="Role"><div style={{ paddingTop: 9 }}><RolePill role={st.authRole} /></div></Field>
        <button className="btn" style={{ width: 'auto', alignSelf: 'end' }}
          disabled={busy || name.trim().length < 2 || name.trim() === st.authName} onClick={save}>
          {busy ? 'Saving…' : 'Save name'}
        </button>
      </div>
      <div className="card" style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="roster-name">Session</div>
          <div className="roster-meta">
            <span>{st.authUser?.provider === 'aad' ? 'Microsoft sign-in' : st.authUser?.provider === 'email' ? 'Email-code sign-in (12-hour session)' : 'Preview session'}</span>
            {msg && <span style={{ color: msg === 'Saved' ? '#1F7A56' : '#B14233' }}>{msg}</span>}
          </div>
        </div>
        <ActionButton label="Sign out" color="#21314F" border="#DCE3EE" onClick={a.signOutUser} />
      </div>
    </div>
  )
}

// Also rendered inside the global Admin Portal with full powers.
export function Accounts({ store, isAdmin }) {
  const { state: st } = store
  const roleChoices = isAdmin ? ['facilitator', 'leader', 'admin'] : ['facilitator']
  const [list, setList] = useState(null) // null = loading
  const [adminEmails, setAdminEmails] = useState([])
  const [form, setForm] = useState({ email: '', name: '', role: 'facilitator' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    try {
      const out = await B.fetchStaffAccounts()
      setList(out.staff || [])
      setAdminEmails(out.adminEmails || [])
    } catch (e) {
      setList([]); setErr(e.message || 'Could not load accounts')
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(); await load() } catch (e) { setErr(e.message || 'Action failed') }
    setBusy(false)
  }

  const add = () => run(async () => {
    await B.upsertStaffAccount({ email: form.email.trim(), name: form.name.trim(), role: form.role, active: true })
    setForm({ email: '', name: '', role: 'facilitator' })
  })
  const setRole = (rec, role) => run(() => B.upsertStaffAccount({ ...rec, role }))
  const setActive = (rec, active) => run(() => B.upsertStaffAccount({ ...rec, active }))
  const remove = (rec) => run(() => B.removeStaffAccount(rec.email))

  const formValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && form.name.trim().length >= 2
  const canManage = (rec) => isAdmin || rec.role === 'facilitator'
  const self = (rec) => rec.email === st.authUser?.email

  return (
    <div className="admin-section">
      <div className="admin-h">Sign-in accounts</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        People added here can sign in with an emailed one-time code, or with the
        Microsoft button when their work email matches. Their role decides what
        they can see{isAdmin ? '' : ' — leaders can manage facilitator accounts; ask an admin for leader or admin access'}.
      </div>
      {err && <div className="signin-err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="card admin-form">
        <Field label="Work email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@chollabh.org" /></Field>
        <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
        <Field label="Role">
          <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roleChoices.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy || !formValid} onClick={add}>Add account</button>
      </div>

      <div className="card" style={{ marginTop: 12, padding: list && list.length ? '4px 16px' : 16 }}>
        {list === null ? <Empty>Loading accounts…</Empty> : list.length ? list.map((rec) => (
          <div className="roster-row" key={rec.email}>
            <div>
              <div className="roster-name" style={{ opacity: rec.active === false ? 0.5 : 1 }}>{rec.name}</div>
              <div className="roster-meta">
                <span>{rec.email}</span>
                {rec.active === false && <span style={{ color: '#B14233' }}>deactivated</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {canManage(rec) && !self(rec) ? (
                <>
                  <select className="select" style={{ width: 'auto', padding: '8px 10px' }} disabled={busy || !isAdmin} value={rec.role} onChange={(e) => setRole(rec, e.target.value)}>
                    {(isAdmin ? ['facilitator', 'leader', 'admin'] : [rec.role]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <ActionButton label={rec.active === false ? 'Reactivate' : 'Deactivate'} color="#21314F" border="#DCE3EE" onClick={() => !busy && setActive(rec, rec.active === false)} />
                  <ActionButton label="Remove" color="#B14233" border="#E6BCB5" onClick={() => !busy && remove(rec)} />
                </>
              ) : (
                <RolePill role={rec.role} />
              )}
            </div>
          </div>
        )) : <Empty>No sign-in accounts yet — add the first one above</Empty>}
      </div>

      {isAdmin && adminEmails.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="roster-name">Bootstrap admins (ADMIN_EMAILS app setting)</div>
          <div className="roster-meta" style={{ marginTop: 4 }}>
            {adminEmails.map((e) => <span key={e}>{e}</span>)}
          </div>
          <div className="section-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            These addresses always have admin access — even before any account
            exists. Change them in the Static Web App's environment variables.
          </div>
        </div>
      )}
    </div>
  )
}

function Platform() {
  return (
    <div className="admin-section">
      <div className="admin-h">Platform (admin)</div>
      <div className="card">
        <div className="roster-name">Kiosk day code</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          The 4-digit code facilitators enter on the tablets is the
          <b> KIOSK_CODE</b> environment variable on the Static Web App — it is
          never stored in the app or this browser. To rotate it (recommended
          weekly): Azure portal → your Static Web App → <b>Environment
          variables</b> → change <b>KIOSK_CODE</b> → Apply. Unlocked kiosks
          stop working on their next request until the new code is entered.
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">Sign-in &amp; email settings</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Email codes are sent through Azure Communication Services
          (<b>ACS_CONNECTION_STRING</b> / <b>ACS_SENDER</b>); sessions are
          signed with <b>SESSION_SECRET</b>; bootstrap admins come from
          <b> ADMIN_EMAILS</b>. The full runbook lives in <b>GO-LIVE.md</b> in
          the repository.
        </div>
      </div>
    </div>
  )
}
