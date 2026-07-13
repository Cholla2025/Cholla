import { useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Seg, Field } from '../ui'
import { Accounts } from './Settings'
import { OrgSettings } from './Leader'
import Reports from './Reports'

// Global Admin Portal — the owner's control surface, visible ONLY to the
// admin role. Everything here is enforced server-side too; this page is a
// cockpit, not the lock.
//
//   Access     — every sign-in account incl. other admins and leadership
//   Organization — master group & facilitator controls
//   Reports    — preview any report exactly as it will be emailed; send now
//   Data       — CSV export of rosters and the Member Check-In log by date range
//   Danger     — reset groups to the default schedule (type-to-confirm)

const VIEWS = ['Access', 'Organization', 'Reports', 'Data', 'Danger zone']

export default function AdminPortal({ store }) {
  const { state: st } = store
  const [view, setView] = useState('Access')
  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Admin portal</div>
      <div className="section-sub">{st.authName || 'Administrator'} · global controls · {st.todayLabel}</div>
      <div style={{ marginTop: 14, maxWidth: 640 }}>
        <Seg options={VIEWS} value={view} onChange={setView} />
      </div>

      {view === 'Access' && (
        <>
          <div className="section-sub" style={{ marginTop: 16, marginBottom: -6 }}>
            Full account control — add or remove admins, leadership, and facilitators.
            Deactivating an account signs it out within one request; removing it
            deletes the sign-in entirely. You cannot remove your own account.
          </div>
          <Accounts store={store} isAdmin />
        </>
      )}

      {view === 'Organization' && (
        <div className="admin-section">
          <div className="admin-h">Groups &amp; facilitators (master controls)</div>
          <OrgSettings store={store} />
        </div>
      )}

      {view === 'Reports' && <Reports store={store} />}
      {view === 'Data' && <Exports store={store} />}
      {view === 'Danger zone' && <Danger store={store} />}
    </div>
  )
}

function dateRange(from, to, cap = 92) {
  const out = []
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv(name, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

function Exports({ store }) {
  const { state: st } = store
  const [from, setFrom] = useState(st.today)
  const [to, setTo] = useState(st.today)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const run = async (kind) => {
    if (busy) return
    const days = dateRange(from, to)
    if (!days.length) { setErr('Pick a valid date range (oldest first)'); return }
    setBusy(true); setErr(''); setMsg('Exporting ' + days.length + ' day(s)…')
    try {
      const rows = []
      for (const d of days) {
        if (kind === 'rosters') {
          const byGroup = st.live ? await B.fetchRosters(d) : {}
          if (!st.live && d === st.today) {
            st.org.groups.forEach((g) => S.defaultRoster(g).forEach((r) =>
              rows.push([d, g.session, g.n, r.name, r.id, r.checkin || '', r.checkout || '', r.status])))
          }
          Object.entries(byGroup).forEach(([key, list]) => {
            const dash = key.lastIndexOf('-')
            const session = key.slice(0, dash); const n = key.slice(dash + 1)
            list.forEach((r) => rows.push([d, session, n, r.name, r.id, r.checkin || '', r.checkout || '', r.status]))
          })
        } else {
          const list = st.live ? (await B.fetchDoorRows(d)) || [] : (d === st.today ? S.defaultDoor() : [])
          list.forEach((r) => rows.push([d, r.name, r.in || '', r.out || (d < st.today ? 'Auto 11:59 PM' : ''), r.status]))
        }
      }
      const stamp = from === to ? from : from + '_to_' + to
      if (kind === 'rosters') downloadCsv('cholla-rosters-' + stamp + '.csv', ['date', 'session', 'group', 'client', 'id', 'check_in', 'check_out', 'status'], rows)
      else downloadCsv('cholla-member-checkin-' + stamp + '.csv', ['date', 'name', 'in', 'out', 'status'], rows)
      setMsg('Exported ' + rows.length + ' row(s) across ' + days.length + ' day(s)')
    } catch (e) {
      setErr(e.message || 'Export failed'); setMsg('')
    }
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-h">Data export (CSV)</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        Downloads go straight to this device — handle exported files under the
        same privacy rules as any client record. Ranges are capped at 92 days
        per export.
      </div>
      <div className="card admin-form">
        <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={() => run('rosters')}>Export group rosters</button>
        <button className="btn btn-ghost" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={() => run('door')}>Export Member Check-In log</button>
      </div>
      {msg && <div className="card" style={{ marginTop: 12, color: '#1F7A56', font: '600 13px Inter' }}>{msg}</div>}
      {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  )
}

function Danger({ store }) {
  const { state: st, actions: a } = store
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const armed = confirmText === 'RESET GROUPS'

  const resetGroups = async () => {
    if (!armed || busy) return
    setBusy(true); setErr(''); setMsg('Removing ' + st.org.groups.length + ' group(s)…')
    try {
      for (const g of st.org.groups.slice()) {
        // eslint-disable-next-line no-await-in-loop
        await a.removeGroup(g.id)
      }
      // Re-reading the org after it empties re-seeds the standard schedule.
      const org = await B.fetchOrg()
      if (org && Array.isArray(org.groups)) {
        store.set({ org: { groups: org.groups, facilitators: org.facilitators || [] } })
        setMsg('Done — schedule reset to ' + org.groups.length + ' default groups (facilitator assignments cleared)')
      } else {
        setMsg('Groups removed — the default schedule re-seeds on the next load')
      }
      setConfirmText('')
    } catch (e) {
      setErr(e.message || 'Reset failed part-way — reload and review the Organization tab')
    }
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-h" style={{ color: '#B14233' }}>Danger zone</div>
      <div className="card" style={{ border: '1px solid #E6BCB5' }}>
        <div className="roster-name">Reset the group schedule</div>
        <div className="section-sub" style={{ marginTop: 6 }}>
          Removes every group and re-seeds the standard 20 (Morning/Afternoon ×
          1–10). Facilitator assignments are cleared; facilitators themselves,
          sign-in accounts, and all roster history are untouched. Type
          <b> RESET GROUPS</b> to arm.
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type RESET GROUPS" />
          <button className="btn" style={{ width: 'auto', background: armed ? '#B14233' : '#D8C3B8' }} disabled={!armed || busy} onClick={resetGroups}>
            {busy ? 'Working…' : 'Reset schedule'}
          </button>
        </div>
        {msg && <div style={{ color: '#1F7A56', font: '600 12.5px Inter', marginTop: 10 }}>{msg}</div>}
        {err && <div className="signin-err" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">Deleting client data</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          Roster and Member Check-In history is deliberately NOT deletable from this
          screen — purging PHI is a compliance action. Delete specific dates in
          Azure: Storage Account → <b>Storage browser → Tables</b> →
          <b> rosters</b> / <b>frontdoor</b>, where each day is one row keyed by
          date. Export first if your retention policy requires it.
        </div>
      </div>
    </div>
  )
}
