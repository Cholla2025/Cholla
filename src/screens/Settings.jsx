import { useEffect, useState } from 'react'
import * as B from '../lib/backend'
import { Field, ActionButton, Empty } from '../ui'
import { OrgSettings } from './Leader'
import { AlertsPanel } from './Analytics'
import { parseNames } from './Clients'
import DirectoryPicker from '../DirectoryPicker'

// The Settings tab. Sections appear by role:
//   everyone     — My profile (display name; sign-in is Microsoft, no password)
//   facilitator  — My kiosk code, Add clients (own groups only), My alerts
//   leader +     — Team (facilitators & groups), facilitator kiosk codes, and
//                  Sign-in accounts (with the Microsoft 365 picker)
//   admin        — full account management plus the platform panel

export const ROLE_LABELS = { facilitator: 'Facilitator', leader: 'Leader', admin: 'Admin' }
const ROLE_COLORS = { facilitator: ['#E7F0E9', '#1F7A56'], leader: ['#E8EEF9', '#21314F'], admin: ['#F7E9E1', '#BE6A45'] }

export function RolePill({ role }) {
  const [bg, fg] = ROLE_COLORS[role] || ['#EEF1F6', '#5A6B85']
  return <span className="pill" style={{ background: bg, color: fg, font: '600 11.5px Inter' }}>{ROLE_LABELS[role] || role}</span>
}

const CODE_GUIDANCE = 'Never share your code with clients; rotate it weekly.'

export default function Settings({ store }) {
  const { state: st } = store
  const isLeader = st.authRole === 'leader' || st.authRole === 'admin'
  const isAdmin = st.authRole === 'admin'
  const isFacilitator = st.authRole === 'facilitator'

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Settings</div>
      <div className="section-sub">{st.authName || 'Signed in'} · {st.todayLabel}</div>

      <Profile store={store} />
      {isFacilitator && <MyKioskCode store={store} />}
      {isFacilitator && <FacilitatorAddClients store={store} />}
      {isFacilitator && <AlertsPanel store={store} />}
      {isLeader && (
        <div className="admin-section">
          <div className="admin-h">Team — facilitators &amp; groups</div>
          <div className="section-sub" style={{ marginTop: -4, marginBottom: 4 }}>
            Add or remove facilitators and change which group each one runs.
            These are the same controls as Leadership → Day-of settings. The
            client list lives under Leadership → Clients.
          </div>
          <OrgSettings store={store} />
        </div>
      )}
      {isLeader && <KioskCodes store={store} />}
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
            <span>
              {st.authUser?.provider === 'aad' ? 'Microsoft sign-in' : st.authUser?.provider === 'email' ? 'Email-code session' : 'Preview session'}
              {' '}· there is no password to manage — sign-in is handled by your Microsoft account
            </span>
            {msg && <span style={{ color: msg === 'Saved' ? '#1F7A56' : '#B14233' }}>{msg}</span>}
          </div>
        </div>
        <ActionButton label="Sign out" color="#21314F" border="#DCE3EE" onClick={a.signOutUser} />
      </div>
    </div>
  )
}

// ----- per-facilitator kiosk codes -----

// One row's set/clear controls, shared by the leadership list and the
// facilitator's own section. The code is sent once and stored hashed
// server-side — it is never displayed back.
function CodeControls({ fac, onDone }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const save = async () => {
    if (!/^\d{4}$/.test(code) || busy) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await B.setFacilitatorCode(fac.id, code)
      setMsg(fac.hasCode ? 'Code rotated' : 'Code set')
      setCode('')
      if (onDone) onDone(true)
    } catch (e) {
      setErr(e.message || 'Could not save the code')
    }
    setBusy(false)
  }
  const clear = async () => {
    if (busy) return
    setBusy(true); setErr(''); setMsg('')
    try {
      await B.setFacilitatorCode(fac.id, null)
      setMsg('Code removed')
      if (onDone) onDone(false)
    } catch (e) {
      setErr(e.message || 'Could not remove the code')
    }
    setBusy(false)
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        <input className="input" style={{ margin: 0, maxWidth: 120 }} inputMode="numeric"
          value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr('') }}
          placeholder="4 digits" />
        <ActionButton label={fac.hasCode ? 'Rotate' : 'Set code'} color="#1F7A56" border="#BBE3D0" onClick={save} />
        {fac.hasCode && <ActionButton label="Remove" color="#B14233" border="#E6BCB5" onClick={clear} />}
      </div>
      {(msg || err) && (
        <div style={{ font: '600 12px Inter', marginTop: 6, color: err ? '#B14233' : '#1F7A56' }}>{err || msg}</div>
      )}
    </div>
  )
}

// Leadership: every facilitator's personal kiosk code.
function KioskCodes({ store }) {
  const { state: st } = store
  const [overrides, setOverrides] = useState({}) // id -> hasCode after a change
  const facs = st.org.facilitators.filter((f) => f.active !== false)
  const withState = facs.map((f) => ({ ...f, hasCode: overrides[f.id] ?? f.hasCode ?? false }))

  return (
    <div className="admin-section">
      <div className="admin-h">Facilitator kiosk codes</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        Each facilitator unlocks the kiosks with their own 4-digit code, and the
        kiosk records whose code opened it. Codes are stored only as a hash and
        can't be read back — set a new one to rotate. {CODE_GUIDANCE}
      </div>
      <div className="card" style={{ padding: withState.length ? '4px 16px' : 16 }}>
        {withState.length ? withState.map((f) => (
          <div className="roster-row" key={f.id}>
            <div style={{ minWidth: 0 }}>
              <div className="roster-name">{f.name}{f.credential ? ', ' + f.credential : ''}</div>
              <div className="roster-meta">
                <span>{f.email || 'no email'}</span>
                <span style={{ color: f.hasCode ? '#1F7A56' : '#B5742A' }}>
                  {f.hasCode ? 'code set' : 'no code yet'}
                </span>
              </div>
            </div>
            <CodeControls fac={f} onDone={(has) => setOverrides((o) => ({ ...o, [f.id]: has }))} />
          </div>
        )) : <Empty>No facilitators yet — add them in the Team section above</Empty>}
      </div>
    </div>
  )
}

// A facilitator managing their OWN code (matched by account email).
function MyKioskCode({ store }) {
  const { state: st } = store
  const email = (st.authUser?.email || '').toLowerCase()
  const [override, setOverride] = useState(null)
  const mine = st.org.facilitators.find(
    (f) => f.active !== false && String(f.email || '').toLowerCase() === email
  )

  return (
    <div className="admin-section">
      <div className="admin-h">My kiosk code</div>
      <div className="card">
        {mine ? (
          <>
            <div className="section-sub" style={{ marginTop: 0, marginBottom: 10 }}>
              Your personal 4-digit code unlocks the check-in kiosks and records
              that it was you. {CODE_GUIDANCE}
            </div>
            <CodeControls
              fac={{ ...mine, hasCode: override ?? mine.hasCode ?? false }}
              onDone={setOverride}
            />
          </>
        ) : (
          <Empty title="No facilitator record linked">
            Your sign-in email isn't on a facilitator record yet — ask
            leadership to add you (with this email) in Settings.
          </Empty>
        )}
      </div>
    </div>
  )
}

// ----- facilitators can ADD clients into their own groups -----
// (Owner-flagged split: leadership manages the master client list; a
// facilitator can add — single or bulk — but only into their own groups.)
function FacilitatorAddClients({ store }) {
  const { state: st, actions: a, myGroups } = store
  const groups = myGroups()
  const [groupSel, setGroupSel] = useState('')
  const [bulk, setBulk] = useState('')
  const [result, setResult] = useState('')

  const names = parseNames(bulk)
  const sel = groups.find((g) => g.id === groupSel) || groups[0] || null

  const add = async () => {
    if (!sel || !names.length) return
    setResult('')
    const out = await a.addClientsBulk(names.map((name) => ({ name, session: sel.session, n: sel.n })))
    if (out) {
      setResult('Added ' + (out.added ? out.added.length : 0) + ' client(s) to ' + sel.session + ' Group ' + sel.n
        + (out.duplicates && out.duplicates.length ? ' · ' + out.duplicates.length + ' duplicate(s) skipped' : '')
        + (out.invalid ? ' · ' + out.invalid + ' unreadable line(s) skipped' : ''))
      setBulk('')
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-h">Add clients to my groups</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        Add one name — or paste a list, one per line — into a group you run.
        Duplicates are skipped, never added twice.
      </div>
      {st.clientsErr && <div className="signin-err" style={{ marginBottom: 10 }}>{st.clientsErr}</div>}
      <div className="card">
        {groups.length ? (
          <>
            <Field label="My group">
              <select className="select" value={sel ? sel.id : ''} onChange={(e) => setGroupSel(e.target.value)}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.session} · Group {g.n} · {g.name}</option>)}
              </select>
            </Field>
            <textarea className="input bulk-paste" rows={4} value={bulk}
              onChange={(e) => { setBulk(e.target.value); setResult('') }}
              placeholder={'One name per line'} />
            <button className="btn" style={{ marginTop: 10, width: 'auto' }}
              disabled={st.clientsBusy || !sel || !names.length} onClick={add}>
              {st.clientsBusy ? 'Saving…' : 'Add ' + (names.length || '') + ' client(s)'}
            </button>
            {result && <div style={{ color: '#1F7A56', font: '600 12.5px Inter', marginTop: 10 }}>{result}</div>}
          </>
        ) : (
          <Empty title="No groups linked to your account">
            Ask leadership to add you as a facilitator (with this email) and
            assign your group.
          </Empty>
        )}
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
  const [notice, setNotice] = useState('')

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
    setBusy(true); setErr(''); setNotice('')
    try { await fn(); await load() } catch (e) { setErr(e.message || 'Action failed') }
    setBusy(false)
  }

  const add = () => run(async () => {
    const out = await B.upsertStaffAccount({ email: form.email.trim(), name: form.name.trim(), role: form.role, active: true })
    setForm({ email: '', name: '', role: 'facilitator' })
    setNotice(out && out.welcomed ? 'Account created — a welcome email is on its way' : 'Account created')
  })
  const setRole = (rec, role) => run(() => B.upsertStaffAccount({ ...rec, role }))
  const setActive = (rec, active) => run(() => B.upsertStaffAccount({ ...rec, active }))
  const remove = (rec) => run(() => B.removeStaffAccount(rec.email))

  const formValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && form.name.trim().length >= 2
  const isSuper = (rec) => adminEmails.includes((rec.email || '').toLowerCase())
  const canManage = (rec) => (isAdmin || rec.role === 'facilitator') && !isSuper(rec)
  const self = (rec) => rec.email === st.authUser?.email

  return (
    <div className="admin-section">
      <div className="admin-h">Sign-in accounts</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        People added here sign in with their Microsoft work account — no
        password to set up. New active accounts get a welcome email
        automatically. Their role decides what they can
        see{isAdmin ? '' : ' — leaders can manage facilitator accounts; ask an admin for leader or admin access'}.
      </div>
      {err && <div className="signin-err" style={{ marginBottom: 12 }}>{err}</div>}
      {notice && <div className="card" style={{ marginBottom: 12, color: '#1F7A56', font: '600 13px Inter' }}>{notice}</div>}

      <div className="card admin-form">
        <DirectoryPicker onPick={(u) => setForm((p) => ({ ...p, name: u.name, email: u.email }))} />
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
                {isSuper(rec) && <span style={{ color: '#BE6A45', fontWeight: 700 }}>super admin</span>}
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
          <div className="roster-name">Super admins (ADMIN_EMAILS app setting)</div>
          <div className="roster-meta" style={{ marginTop: 4 }}>
            {adminEmails.map((e) => <span key={e}>{e}</span>)}
          </div>
          <div className="section-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            These addresses always have admin access, and only they can create,
            promote, demote or remove other admin accounts. Nobody can change a
            super admin's record here — manage the list in the Static Web App's
            environment variables.
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
        <div className="roster-name">Kiosk codes</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Every active facilitator has their own 4-digit kiosk code, set and
          rotated under Settings → Facilitator kiosk codes (stored hashed —
          never in the clear, never in this browser). The kiosk records whose
          code unlocked it. The <b>KIOSK_CODE</b> environment variable remains
          as the admin master/fallback code during the transition; rotate or
          remove it in the Azure portal → your Static Web App →
          <b> Environment variables</b>. Guidance for the team: {CODE_GUIDANCE}
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">Sign-in &amp; email settings</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Staff sign in with Microsoft (Entra ID) only. Welcome/onboarding and
          report emails are sent through Azure Communication Services
          (<b>ACS_CONNECTION_STRING</b> / <b>ACS_SENDER</b>); sessions are
          signed with <b>SESSION_SECRET</b>; super admins come from
          <b> ADMIN_EMAILS</b>. The full runbook lives in <b>GO-LIVE.md</b> in
          the repository.
        </div>
      </div>
    </div>
  )
}
