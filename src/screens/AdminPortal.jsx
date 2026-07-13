import { useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Seg, Field, Empty } from '../ui'
import { Accounts } from './Settings'
import { OrgSettings } from './Leader'

// Global Admin Portal — the owner's control surface, visible ONLY to the
// admin role. Everything here is enforced server-side too; this page is a
// cockpit, not the lock.
//
//   Access     — every sign-in account incl. other admins and leadership
//   Organization — master group & facilitator controls
//   Reports    — preview any report exactly as it will be emailed; send now
//   Data       — CSV export of rosters and the front-door log by date range
//   Danger     — reset groups to the default schedule (type-to-confirm)

const VIEWS = ['Access', 'Organization', 'Reports', 'Data', 'Danger zone']
const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly']

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

function Reports({ store }) {
  const { state: st } = store
  const [period, setPeriod] = useState('daily')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const loadPreview = async () => {
    setBusy(true); setErr(''); setMsg(''); setPreview(null)
    try {
      const out = await B.previewReport(period)
      if (out && out.html) setPreview(out)
      else setErr(st.live ? 'No preview returned — is any data recorded yet?' : 'Demo mode: report previews need the live backend')
    } catch (e) {
      setErr(e.message || 'Could not build the preview')
    }
    setBusy(false)
  }

  const sendNow = async () => {
    if (!window.confirm('Send the ' + period + ' report to the configured leadership recipients right now?')) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const out = await B.sendReportNow(period)
      const sent = (out && (out.sent || out.wouldSend)) || []
      setMsg(sent.length ? 'Sent: ' + sent.join(' · ') : 'Nothing to send')
    } catch (e) {
      setErr(e.message || 'Send failed')
    }
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-h">Reports &amp; volume alerts</div>
      <div className="card admin-form">
        <Field label="Report">
          <select className="select" value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); setMsg('') }}>
            {PERIODS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
        <button className="btn btn-ghost" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={loadPreview}>
          {busy ? 'Working…' : 'Preview'}
        </button>
        <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={sendNow}>Send now</button>
      </div>
      {msg && <div className="card" style={{ marginTop: 12, color: '#1F7A56', font: '600 13px Inter' }}>{msg}</div>}
      {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">How the automation works</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          A scheduled job calls the reports API daily (plus weekly on Mondays,
          monthly on the 1st, quarterly each Jan/Apr/Jul/Oct). Recipients come
          from the <b>REPORT_EMAILS</b> setting. The daily run also checks every
          group for a steady two-day drop — more than <b>5%</b> emails leadership
          a Volume Alert; more than <b>10%</b> is marked <b>CRITICAL</b>
          (thresholds: <b>ALERT_DROP_PCT</b> / <b>ALERT_CRITICAL_PCT</b>).
          Reports contain counts and trends only — never client names.
        </div>
      </div>

      {preview && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E4E9F1', font: '600 13px Inter' }}>
            {preview.subject}
          </div>
          <iframe title="Report preview" srcDoc={preview.html} sandbox="" style={{ width: '100%', height: 640, border: 'none', background: '#F4F7FB' }} />
        </div>
      )}
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
      else downloadCsv('cholla-front-door-' + stamp + '.csv', ['date', 'name', 'in', 'out', 'status'], rows)
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
        <button className="btn btn-ghost" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={() => run('door')}>Export front-door log</button>
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
          Roster and front-door history is deliberately NOT deletable from this
          screen — purging PHI is a compliance action. Delete specific dates in
          Azure: Storage Account → <b>Storage browser → Tables</b> →
          <b> rosters</b> / <b>frontdoor</b>, where each day is one row keyed by
          date. Export first if your retention policy requires it.
        </div>
      </div>
    </div>
  )
}
