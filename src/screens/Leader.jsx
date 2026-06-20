import * as S from '../seed'
import { Seg, Chips, Kpi, Pill, Badge, Field, Empty } from '../ui'

const TODAY_LABEL = 'Thursday, June 19, 2026'

export default function Leader({ store }) {
  const { state: st } = store
  if (st.screen === 'leader-detail' && st.leaderGroupN) return <Detail store={store} />
  return <Overview store={store} />
}

function Auth({ store }) {
  const { state: st, set, actions: a } = store
  const ready = st.leaderMfa.length === 6 && st.leaderEmail.includes('@')
  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Leadership sign-in</div>
      <div className="section-sub">Organization-wide roll-up access</div>
      <div className="card" style={{ marginTop: 18 }}>
        <Field label="Work email">
          <input className="input" type="email" value={st.leaderEmail} onChange={(e) => set({ leaderEmail: e.target.value })} placeholder="you@chollabh.org" />
        </Field>
        <Field label="6-digit authenticator code">
          <input className="input" inputMode="numeric" value={st.leaderMfa} onChange={a.onLeaderMfa} placeholder="••••••" />
        </Field>
        <button className="btn" disabled={!ready} onClick={a.leaderVerify}
          style={{ background: ready ? '#BE6A45' : '#D8C3B8', boxShadow: ready ? '0 10px 22px -8px rgba(190,106,69,.6)' : 'none' }}>
          Verify &amp; continue
        </button>
        <div className="muted" style={{ textAlign: 'center', font: '500 12px Inter', marginTop: 12 }}>Demo: any email · any 6 digits</div>
      </div>
    </div>
  )
}

function Overview({ store }) {
  const { state: st, set, stats, groupClients, actions: a } = store
  const started = S.GROUPS.filter((g) => S.statusOf(g) !== 'Upcoming')
  const startedCap = started.reduce((acc, g) => acc + stats(g).cap, 0)
  const totalCi = started.reduce((acc, g) => acc + stats(g).ci, 0)
  const totalPresent = S.GROUPS.reduce((acc, g) => acc + stats(g).present, 0)
  const activeNow = S.GROUPS.filter((g) => S.statusOf(g) === 'In Progress').length
  const rollup = [
    { label: 'Active groups now', value: String(activeNow), color: '#1F7A56', sub: 'in progress' },
    { label: 'Total checked in', value: String(totalCi), color: '#21314F', sub: 'across all groups today' },
    { label: 'Currently present', value: String(totalPresent), color: '#4C84C4', sub: 'clients on-site now' },
    { label: 'Overall attendance', value: (startedCap ? Math.round((totalCi / startedCap) * 100) : 0) + '%', color: '#BE6A45', sub: totalCi + ' of ' + startedCap + ' expected' },
  ]

  let cards = S.GROUPS.slice()
  if (!S.rangeHasToday(st.leaderFrom, st.leaderTo)) cards = []
  if (st.leaderSessionF && st.leaderSessionF !== 'All') cards = cards.filter((g) => g.session === st.leaderSessionF)
  if (st.leaderFac !== 'All') cards = cards.filter((g) => g.fac === st.leaderFac)
  if (st.leaderStatusF !== 'All') cards = cards.filter((g) => S.statusOf(g) === st.leaderStatusF)
  if (st.leaderSearch.trim()) {
    const q = st.leaderSearch.toLowerCase()
    cards = cards.filter((g) => g.name.toLowerCase().includes(q) || g.fac.toLowerCase().includes(q) || ('group ' + g.n).includes(q) || groupClients(g).some((n) => n.includes(q)))
  }

  const facs = ['All', ...new Set(S.GROUPS.map((g) => g.fac))]
  const noCardsMsg = !S.rangeHasToday(st.leaderFrom, st.leaderTo)
    ? 'No active groups for ' + S.rangeLabel(st.leaderFrom, st.leaderTo)
    : 'No groups match the current filters'

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Leadership overview</div>
      <div className="section-sub">{st.leaderName} · {TODAY_LABEL}</div>

      <div style={{ marginTop: 16, overflowX: 'auto' }} className="cholla-scroll">
        <Chips options={['All', ...S.SESSIONS]} value={st.leaderSessionF || 'All'} onChange={(o) => set({ leaderSessionF: o })} />
      </div>

      <div className="kpi-grid" style={{ marginTop: 14 }}>
        {rollup.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <Field label="Filter">
          <select className="select" value={st.leaderFac} onChange={(e) => set({ leaderFac: e.target.value })}>
            <option value="All">All facilitators</option>
            {facs.slice(1).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <div className="row">
          <Field label="Dates"><input className="input" type="date" value={st.leaderFrom} onChange={(e) => set({ leaderFrom: e.target.value })} /></Field>
          <Field label="&nbsp;"><input className="input" type="date" value={st.leaderTo} onChange={(e) => set({ leaderTo: e.target.value })} /></Field>
        </div>
        <button className="btn btn-ghost" onClick={() => set({ leaderFrom: S.TODAY, leaderTo: S.TODAY })}>Today</button>
      </div>

      <div style={{ marginTop: 14, overflowX: 'auto' }} className="cholla-scroll">
        <Chips options={['All', 'In Progress', 'Upcoming', 'Complete']} value={st.leaderStatusF} onChange={(o) => set({ leaderStatusF: o })} />
      </div>
      <input className="input" style={{ marginTop: 12 }} value={st.leaderSearch} onChange={(e) => set({ leaderSearch: e.target.value })} placeholder="Search group, facilitator, or client" />

      <div className="groups-grid" style={{ marginTop: 14 }}>
        {cards.length ? cards.map((g) => {
          const s = stats(g)
          const att = s.cap ? Math.round((s.ci / s.cap) * 100) : 0
          const [chipBg, chipFg] = S.accentChip(g.session)
          return (
            <button className="group-card" key={S.rosterKey(g)} onClick={() => a.openGroup(g.session, g.n)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <div style={{ font: '700 16px Inter' }}>Group {g.n}</div>
                  <div className="muted" style={{ font: '500 12.5px Inter', marginTop: 2 }}>{g.fac}</div>
                </div>
                <Badge status={S.statusOf(g)} />
              </div>
              <span className="pill" style={{ background: chipBg, color: chipFg, marginTop: 10, font: '600 11.5px Inter' }}>{g.name}</span>
              <div style={{ display: 'flex', gap: 16, marginTop: 12, font: '600 13px Inter' }}>
                <span style={{ color: '#1F7A56' }}>{s.ci} / {s.cap} checked in</span>
                <span style={{ color: '#4C84C4' }}>{s.present} present now</span>
              </div>
              <div className="bar" style={{ marginTop: 10 }}>
                <span style={{ width: att + '%', background: S.accentFor(g.session) }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span className="muted" style={{ font: '600 12px Inter' }}>{att}% attendance</span>
                <span style={{ color: '#4C84C4', font: '600 12.5px Inter' }}>View roster →</span>
              </div>
            </button>
          )
        }) : <Empty title="No groups to show">{noCardsMsg}</Empty>}
      </div>
    </div>
  )
}

function Detail({ store }) {
  const { state: st, set, getRoster, actions: a } = store
  const g = S.group(st.leaderGroupSession, st.leaderGroupN)
  const rows = getRoster(g)
  const ci = rows.filter((r) => r.checkin).length
  const pr = rows.filter((r) => r.checkin && !r.checkout).length
  const co = rows.filter((r) => r.checkout).length
  const exp = rows.length
  const kpis = [
    { label: 'Checked in', value: String(ci), color: '#1F7A56', sub: 'today' },
    { label: 'Expected', value: String(exp), color: '#21314F', sub: 'enrolled' },
    { label: 'Currently present', value: String(pr), color: '#4C84C4', sub: 'in the room now' },
    { label: 'Checked out', value: String(co), color: '#3A4A66', sub: 'completed' },
    { label: 'Attendance', value: (exp ? Math.round((ci / exp) * 100) : 0) + '%', color: '#BE6A45', sub: ci + ' of ' + exp },
  ]
  let drows = rows
  if (st.detailStatus !== 'All') drows = drows.filter((r) => r.status === st.detailStatus)
  if (st.detailSearch.trim()) drows = drows.filter((r) => r.name.toLowerCase().includes(st.detailSearch.toLowerCase()))
  const [chipBg, chipFg] = S.accentChip(g.session)

  return (
    <div className="scroll fade cholla-scroll">
      <button className="btn btn-ghost" style={{ width: 'auto', padding: '8px 14px', font: '600 13px Inter' }} onClick={a.backToOverview}>← All groups</button>
      <div className="section-title" style={{ marginTop: 14 }}>Group {g.n}</div>
      <div className="section-sub">{g.fac} · {g.session} session · {TODAY_LABEL}</div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="pill" style={{ background: chipBg, color: chipFg, font: '600 11.5px Inter' }}>{g.name}</span>
        <Badge status={S.statusOf(g)} />
      </div>

      <div className="kpi-grid" style={{ marginTop: 14 }}>
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <div style={{ marginTop: 14, overflowX: 'auto' }} className="cholla-scroll">
        <Chips options={['All', 'Checked In', 'Checked Out', 'Expected', 'Late', 'Absent']} value={st.detailStatus} onChange={(o) => set({ detailStatus: o })} />
      </div>
      <input className="input" style={{ marginTop: 12 }} value={st.detailSearch} onChange={(e) => set({ detailSearch: e.target.value })} placeholder="Search client name" />

      <div className="card" style={{ marginTop: 14, padding: drows.length ? '6px 16px' : 16 }}>
        {drows.length ? drows.map((r) => (
          <div className="roster-row" key={r.id}>
            <div>
              <div className="roster-name">{r.name}</div>
              <div className="roster-meta">
                <span>ID {r.id}</span>
                <span>In {r.checkin || '—'}</span>
                <span>Out {r.checkout || '—'}</span>
              </div>
            </div>
            <Pill status={r.status} />
          </div>
        )) : <Empty>No clients match the current filters</Empty>}
      </div>
    </div>
  )
}
