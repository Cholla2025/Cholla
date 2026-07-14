import { useEffect, useState } from 'react'
import * as S from '../seed'
import { Kpi, Pill, ActionButton, Empty } from '../ui'
import SignIn from './SignIn'

// Staff dashboards on a phone — reached from the kiosk launcher's
// "Staff & Leadership" button. Deliberately TRIMMED and read-only: leadership
// sees the live KPI roll-up and per-group counts, nothing editable. The one
// exception (by owner request): group facilitators can check a member in to
// their own group from their phone, including adding a walk-in by name.

export default function MobileDash({ store }) {
  const { state: st } = store

  if (!st.authReady) {
    return <div className="scroll fade cholla-scroll"><Empty>Loading…</Empty></div>
  }
  if (!st.authUser) {
    return (
      <div className="scroll fade cholla-scroll">
        <SignIn store={store} compact />
      </div>
    )
  }
  if (!st.authRole) {
    return (
      <div className="scroll fade cholla-scroll" style={{ textAlign: 'center' }}>
        <div className="section-title" style={{ marginTop: 24 }}>Access pending</div>
        <div className="section-sub" style={{ marginTop: 8 }}>
          You're signed in, but no dashboard role has been assigned yet — ask
          leadership to add you, then sign in again.
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={store.actions.signOutUser}>Sign out</button>
      </div>
    )
  }

  return st.authRole === 'facilitator'
    ? <FacilitatorPhone store={store} />
    : <LeaderPhone store={store} />
}

// Facilitator on a phone: own groups only, with check-in powers.
function FacilitatorPhone({ store }) {
  const { state: st, set, actions: a, getRoster, stats, myGroups } = store
  const groups = myGroups()
  const [sel, setSel] = useState(null)
  const g = sel || groups[0] || null

  // Bind the shared staff-dashboard actions (check in/out, add) to the
  // selected group.
  const bind = (grp) => set({ staffSession: grp.session, staffGroup: grp.n, staffView: 'live' })
  useEffect(() => {
    if (g && (st.staffSession !== g.session || st.staffGroup !== g.n)) bind(g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g && g.id])

  if (!groups.length) {
    return (
      <div className="scroll fade cholla-scroll">
        <div className="section-title">Facilitator</div>
        <div className="section-sub">{st.authName}</div>
        <div className="card" style={{ marginTop: 14 }}>
          <Empty title="No groups linked to your account">
            Ask leadership to add you as a facilitator (with this email) and
            assign your group in Settings.
          </Empty>
        </div>
      </div>
    )
  }

  const rows = g ? getRoster(g) : []
  const s = g ? stats(g) : { ci: 0, present: 0 }
  const canAdd = st.newName.trim().length >= 2

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">My group</div>
      <div className="section-sub">{st.authName} · {st.todayLabel}</div>

      {groups.length > 1 && (
        <select className="select" style={{ marginTop: 12 }} value={g ? g.id : ''}
          onChange={(e) => {
            const next = groups.find((x) => x.id === e.target.value)
            if (next) { setSel(next); bind(next) }
          }}>
          {groups.map((x) => <option key={x.id} value={x.id}>{x.session} · Group {x.n} · {x.name}</option>)}
        </select>
      )}
      {g && <div className="section-sub" style={{ marginTop: 10 }}>{S.groupLabel(g.session, g.n)}</div>}

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <Kpi label="Checked in" value={String(s.ci)} color="#1F7A56" sub="today" />
        <Kpi label="Present now" value={String(s.present)} color="#4C84C4" sub="in the room" />
      </div>

      {st.rosterErr && <div className="signin-err" style={{ marginTop: 12 }}>{st.rosterErr}</div>}

      <div className="card" style={{ marginTop: 14 }}>
        <span className="lab">Add &amp; check in a member</span>
        <input className="input" value={st.newName} onChange={a.onNewName} placeholder="Member name" />
        <button className="btn" style={{ marginTop: 10 }} disabled={!canAdd} onClick={() => a.addClient(true)}>
          Add &amp; check in
        </button>
      </div>

      <div className="card" style={{ marginTop: 14, padding: rows.length ? '6px 16px' : 16 }}>
        {rows.length ? rows.map((r) => (
          <div className="roster-row" key={r.id}>
            <div style={{ minWidth: 0 }}>
              <div className="roster-name">{r.name}</div>
              <div className="roster-meta">
                <span>In {r.checkin || '—'}</span>
                <span>Out {r.checkout || '—'}</span>
              </div>
              <div style={{ marginTop: 6 }}><Pill status={r.status} /></div>
            </div>
            <div>
              {!r.checkin && <ActionButton label="Check in" color="#1F7A56" border="#BBE3D0" onClick={() => a.checkInClient(r.id)} />}
              {r.checkin && !r.checkout && <ActionButton label="Check out" color="#3A4A66" border="#CCD6E5" onClick={() => a.checkOutClient(r.id)} />}
            </div>
          </div>
        )) : <Empty title="No one on the roster yet">Members appear as they check in, or add one above</Empty>}
      </div>

      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={a.signOutUser}>Sign out</button>
    </div>
  )
}

// Leadership on a phone: clean, readable, READ-ONLY.
function LeaderPhone({ store }) {
  const { state: st, stats, facLabelFor, actions: a } = store
  const groups = st.org.groups
  const started = groups.filter((g) => S.statusOf(g) !== 'Upcoming')
  const startedCap = started.reduce((acc, g) => acc + stats(g).cap, 0)
  const totalCi = started.reduce((acc, g) => acc + stats(g).ci, 0)
  const totalPresent = groups.reduce((acc, g) => acc + stats(g).present, 0)
  const activeNow = groups.filter((g) => S.statusOf(g) === 'In Progress').length

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Leadership</div>
      <div className="section-sub">{st.authName} · read-only on this device · {st.todayLabel}</div>

      <div className="kpi-grid" style={{ marginTop: 14 }}>
        <Kpi label="Total checked in" value={String(totalCi)} color="#21314F" sub="all groups today" />
        <Kpi label="Active groups now" value={String(activeNow)} color="#1F7A56" sub="in progress" />
        <Kpi label="Currently present" value={String(totalPresent)} color="#4C84C4" sub="on-site now" />
        <Kpi label="Attendance" value={(startedCap ? Math.round((totalCi / startedCap) * 100) : 0) + '%'} color="#BE6A45" sub={totalCi + ' of ' + startedCap} />
      </div>

      <div className="card" style={{ marginTop: 14, padding: groups.length ? '6px 16px' : 16 }}>
        {groups.length ? groups.map((g) => {
          const s = stats(g)
          return (
            <div className="roster-row" key={S.rosterKey(g)}>
              <div style={{ minWidth: 0 }}>
                <div className="roster-name">{g.session} · Group {g.n}</div>
                <div className="roster-meta">
                  <span>{facLabelFor(g)}</span>
                  <span style={{ color: '#1F7A56' }}>{s.ci}/{s.cap} in</span>
                  <span style={{ color: '#4C84C4' }}>{s.present} present</span>
                </div>
              </div>
            </div>
          )
        }) : <Empty title="No groups yet">The schedule appears here once groups are set up</Empty>}
      </div>

      <div className="muted" style={{ font: '500 12px Inter', textAlign: 'center', marginTop: 12 }}>
        For editing, reports and analytics, use the full dashboard on a computer.
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={a.signOutUser}>Sign out</button>
    </div>
  )
}
