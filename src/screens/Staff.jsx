import * as S from '../seed'
import { Seg, Chips, Kpi, Pill, ActionButton, Field, Empty } from '../ui'

const TODAY_LABEL = 'Thursday, June 19, 2026'
const STATUS_FILTERS = ['All', 'Checked In', 'Checked Out', 'Expected', 'Late', 'Absent']

export default function Staff({ store }) {
  return <Dashboard store={store} />
}

function Auth({ store }) {
  const { state: st, set, actions: a } = store
  const ready = st.staffMfa.length === 6 && st.staffEmail.includes('@')
  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Staff sign-in</div>
      <div className="section-sub">Authenticate with your work email and MFA code</div>
      <div className="card" style={{ marginTop: 18 }}>
        <Field label="Work email">
          <input className="input" type="email" value={st.staffEmail} onChange={(e) => set({ staffEmail: e.target.value })} placeholder="you@chollabh.org" />
        </Field>
        <Field label="6-digit authenticator code">
          <input className="input" inputMode="numeric" value={st.staffMfa} onChange={a.onStaffMfa} placeholder="••••••" />
        </Field>
        <button className="btn" disabled={!ready} onClick={a.staffVerify}
          style={{ background: ready ? '#BE6A45' : '#D8C3B8', boxShadow: ready ? '0 10px 22px -8px rgba(190,106,69,.6)' : 'none' }}>
          Verify &amp; continue
        </button>
        <div className="muted" style={{ textAlign: 'center', font: '500 12px Inter', marginTop: 12 }}>Demo: any email · any 6 digits</div>
      </div>
    </div>
  )
}

function Dashboard({ store }) {
  const { state: st, set, actions: a, getRoster, stats } = store
  const g = S.group(st.staffSession, st.staffGroup)
  const inRange = S.rangeHasToday(st.staffFrom, st.staffTo)
  const base = !inRange || st.staffView === 'empty' ? [] : getRoster(g)

  const ci = base.filter((r) => r.checkin).length
  const present = base.filter((r) => r.checkin && !r.checkout).length
  const co = base.filter((r) => r.checkout).length
  const exp = base.length
  const att = exp ? Math.round((ci / exp) * 100) : 0
  const kpis = [
    { label: 'Checked in', value: String(ci), color: '#1F7A56', sub: 'today' },
    { label: 'Expected', value: String(exp), color: '#21314F', sub: 'enrolled' },
    { label: 'Currently present', value: String(present), color: '#4C84C4', sub: 'in the room now' },
    { label: 'Checked out', value: String(co), color: '#3A4A66', sub: 'completed' },
    { label: 'Attendance', value: att + '%', color: '#BE6A45', sub: ci + ' of ' + exp },
  ]

  let rows = base
  if (st.staffStatus !== 'All') rows = rows.filter((r) => r.status === st.staffStatus)
  if (st.staffSearch.trim()) rows = rows.filter((r) => r.name.toLowerCase().includes(st.staffSearch.toLowerCase()))
  const editable = st.staffView === 'live' && inRange

  const groupOptions = S.GROUPS.filter((x) => x.session === st.staffSession)
  const emptyMsg = !inRange
    ? 'No session records for ' + S.rangeLabel(st.staffFrom, st.staffTo)
    : st.staffView === 'empty'
      ? 'Switch to live state to see a populated roster'
      : 'No members have checked in to ' + S.groupLabel(st.staffSession, st.staffGroup) + ' yet'

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Facilitator dashboard</div>
      <div className="section-sub">{st.staffName} · {TODAY_LABEL}</div>

      <div style={{ marginTop: 16 }}>
        <Seg options={S.SESSIONS} value={st.staffSession} onChange={a.staffSetSession} activeBg="#4C84C4" inactiveFg="#7A8AA3" />
      </div>

      <div className="kpi-grid" style={{ marginTop: 14 }}>
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <Field label="Group">
          <select className="select" value={st.staffGroup} onChange={a.onStaffGroup}>
            {groupOptions.map((o) => <option key={o.n} value={o.n}>Group {o.n} · {o.name}</option>)}
          </select>
        </Field>
        <div className="row">
          <Field label="Dates"><input className="input" type="date" value={st.staffFrom} onChange={(e) => set({ staffFrom: e.target.value })} /></Field>
          <Field label="&nbsp;"><input className="input" type="date" value={st.staffTo} onChange={(e) => set({ staffTo: e.target.value })} /></Field>
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => set({ staffFrom: S.TODAY, staffTo: S.TODAY })}>Today</button>
          <button className="btn btn-ghost" onClick={a.toggleStaffView}>{st.staffView === 'live' ? 'Show empty state' : 'Show live state'}</button>
        </div>
      </div>

      <div style={{ marginTop: 14, overflowX: 'auto' }} className="cholla-scroll">
        <Chips options={STATUS_FILTERS} value={st.staffStatus} onChange={(o) => set({ staffStatus: o })} />
      </div>
      <input className="input" style={{ marginTop: 12 }} value={st.staffSearch} onChange={(e) => set({ staffSearch: e.target.value })} placeholder="Search client name" />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="lab" style={{ marginBottom: 10 }}>Add client to {S.groupLabel(st.staffSession, st.staffGroup)}</div>
        <input className="input" value={st.newName} onChange={a.onNewName} placeholder="Client name" />
        <input className="input" style={{ marginTop: 10 }} inputMode="numeric" value={st.newId} onChange={a.onNewId} placeholder="ID (optional)" />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => a.addClient(false)}>Add as expected</button>
          <button className="btn" onClick={() => a.addClient(true)}>Add &amp; check in</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, padding: rows.length ? '6px 16px' : 16 }}>
        {rows.length ? rows.map((r) => (
          <div className="roster-row" key={r.id}>
            <div style={{ minWidth: 0 }}>
              <div className="roster-name">{r.name}</div>
              <div className="roster-meta">
                <span>ID {r.id}</span>
                <span>In {r.checkin || '—'}</span>
                <span>Out {r.checkout || '—'}</span>
              </div>
              <div style={{ marginTop: 8 }}><Pill status={r.status} /></div>
              {editable && (
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  {(r.status === 'Absent' || !r.checkin) && <ActionButton label="Check in" color="#1F7A56" border="#BBE3D0" onClick={() => a.checkInClient(r.id)} />}
                  {r.checkin && !r.checkout && <ActionButton label="Check out" color="#3A4A66" border="#CCD6E5" onClick={() => a.checkOutClient(r.id)} />}
                  {r.status !== 'Absent' && !r.checkout && <ActionButton label="Absent" color="#B14233" border="#EAC6C0" onClick={() => a.markAbsent(r.id)} />}
                </div>
              )}
            </div>
          </div>
        )) : <Empty title="Roster fills as members check in">{emptyMsg}</Empty>}
      </div>
    </div>
  )
}
