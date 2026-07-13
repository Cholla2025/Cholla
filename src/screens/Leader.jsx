import { useState } from 'react'
import * as S from '../seed'
import { Seg, Chips, Kpi, Pill, Badge, ActionButton, Field, Empty } from '../ui'
import Clients from './Clients'
import Reports from './Reports'
import DirectoryPicker from '../DirectoryPicker'

const LEADER_VIEWS = { Overview: 'overview', Clients: 'clients', Reports: 'reports', 'Day-of settings': 'settings' }

export default function Leader({ store }) {
  const { state: st, actions: a } = store
  if (st.screen === 'leader-detail' && st.leaderGroupN) return <Detail store={store} />
  const viewLabel = Object.keys(LEADER_VIEWS).find((k) => LEADER_VIEWS[k] === st.leaderView) || 'Overview'
  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Leadership overview</div>
      <div className="section-sub">{st.leaderName} · {st.todayLabel}</div>
      <div style={{ marginTop: 14, maxWidth: 640 }}>
        <Seg options={Object.keys(LEADER_VIEWS)} value={viewLabel}
          onChange={(o) => a.setLeaderView(LEADER_VIEWS[o])} />
      </div>
      {st.leaderView === 'settings' ? <OrgSettings store={store} />
        : st.leaderView === 'clients' ? <Clients store={store} />
        : st.leaderView === 'reports' ? <Reports store={store} />
        : <Overview store={store} />}
    </div>
  )
}

function Overview({ store }) {
  const { state: st, set, stats, groupClients, facLabelFor, actions: a } = store
  const groups = st.org.groups
  const started = groups.filter((g) => S.statusOf(g) !== 'Upcoming')
  const startedCap = started.reduce((acc, g) => acc + stats(g).cap, 0)
  const totalCi = started.reduce((acc, g) => acc + stats(g).ci, 0)
  const totalPresent = groups.reduce((acc, g) => acc + stats(g).present, 0)
  const activeNow = groups.filter((g) => S.statusOf(g) === 'In Progress').length
  const rollup = [
    { label: 'Active groups now', value: String(activeNow), color: '#1F7A56', sub: 'in progress' },
    { label: 'Total checked in', value: String(totalCi), color: '#21314F', sub: 'across all groups today' },
    { label: 'Currently present', value: String(totalPresent), color: '#4C84C4', sub: 'clients on-site now' },
    { label: 'Overall attendance', value: (startedCap ? Math.round((totalCi / startedCap) * 100) : 0) + '%', color: '#BE6A45', sub: totalCi + ' of ' + startedCap + ' expected' },
  ]

  let cards = groups.slice()
  if (!S.rangeHasToday(st.leaderFrom, st.leaderTo)) cards = []
  if (st.leaderSessionF && st.leaderSessionF !== 'All') cards = cards.filter((g) => g.session === st.leaderSessionF)
  if (st.leaderFac !== 'All') cards = cards.filter((g) => g.facilitatorId === st.leaderFac)
  if (st.leaderStatusF !== 'All') cards = cards.filter((g) => S.statusOf(g) === st.leaderStatusF)
  if (st.leaderSearch.trim()) {
    const q = st.leaderSearch.toLowerCase()
    cards = cards.filter((g) => g.name.toLowerCase().includes(q) || facLabelFor(g).toLowerCase().includes(q) || ('group ' + g.n).includes(q) || groupClients(g).some((n) => n.includes(q)))
  }

  const facs = st.org.facilitators.filter((f) => f.active !== false)
  const noCardsMsg = !S.rangeHasToday(st.leaderFrom, st.leaderTo)
    ? 'No active groups for ' + S.rangeLabel(st.leaderFrom, st.leaderTo)
    : 'No groups match the current filters'

  return (
    <>
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
            {facs.map((f) => <option key={f.id} value={f.id}>{S.facLabel(f)}</option>)}
          </select>
        </Field>
        <div className="row">
          <Field label="Dates"><input className="input" type="date" value={st.leaderFrom} onChange={(e) => set({ leaderFrom: e.target.value })} /></Field>
          <Field label="&nbsp;"><input className="input" type="date" value={st.leaderTo} onChange={(e) => set({ leaderTo: e.target.value })} /></Field>
        </div>
        <button className="btn btn-ghost" onClick={() => set({ leaderFrom: st.today, leaderTo: st.today })}>Today</button>
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
                  <div className="muted" style={{ font: '500 12.5px Inter', marginTop: 2 }}>{facLabelFor(g)}</div>
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
    </>
  )
}

// Org management (facilitators + groups). Shared: it renders inside the
// Leadership "Day-of settings" view AND the Settings tab's Team section.
export function OrgSettings({ store }) {
  const { state: st, facLabelFor, actions: a } = store
  const [nf, setNf] = useState({ name: '', credential: '', email: '' })
  const [ng, setNg] = useState({ session: 'Morning', n: '', name: 'Morning IOP', facilitatorId: '' })

  const facs = st.org.facilitators.filter((f) => f.active !== false)
  const groups = st.org.groups.slice().sort((x, y) =>
    x.session === y.session ? x.n - y.n : S.SESSIONS.indexOf(x.session) - S.SESSIONS.indexOf(y.session))
  const groupCount = (f) => st.org.groups.filter((g) => g.facilitatorId === f.id).length

  const ngNum = parseInt(ng.n, 10)
  const ngValid = ngNum >= 1 && ngNum <= 10
  const nfValid = nf.name.trim().length >= 2

  // Keep the group-name default in sync with the session unless it was customized.
  const setNgSession = (session) => setNg((p) => ({
    ...p,
    session,
    name: !p.name.trim() || p.name === p.session + ' IOP' ? session + ' IOP' : p.name,
  }))

  const addFac = async () => {
    if (await a.addFacilitator(nf)) setNf({ name: '', credential: '', email: '' })
  }
  const addGrp = async () => {
    if (await a.addGroup({ session: ng.session, n: ngNum, name: ng.name, facilitatorId: ng.facilitatorId || null })) {
      setNg((p) => ({ session: p.session, n: '', name: p.session + ' IOP', facilitatorId: '' }))
    }
  }

  return (
    <>
      {st.orgErr && <div className="signin-err" style={{ marginTop: 14 }}>{st.orgErr}</div>}

      <div className="admin-section">
        <div className="admin-h">Facilitators</div>
        <div className="card admin-form">
          <DirectoryPicker onPick={(u) => setNf((p) => ({ ...p, name: u.name, email: u.email }))} />
          <Field label="Name"><input className="input" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Credential"><input className="input" value={nf.credential} onChange={(e) => setNf({ ...nf, credential: e.target.value })} placeholder="LPC, LCSW…" /></Field>
          <Field label="Email"><input className="input" type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="name@chollabh.org" /></Field>
          <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={st.orgBusy || !nfValid} onClick={addFac}>Add facilitator</button>
        </div>
        <div className="card" style={{ marginTop: 12, padding: facs.length ? '4px 16px' : 16 }}>
          {facs.length ? facs.map((f) => (
            <div className="roster-row" key={f.id}>
              <div>
                <div className="roster-name">{S.facLabel(f)}</div>
                <div className="roster-meta">
                  <span>{f.email || 'no email'}</span>
                  <span>{groupCount(f)} {groupCount(f) === 1 ? 'group' : 'groups'} assigned</span>
                </div>
              </div>
              <ActionButton label="Remove" color="#B14233" border="#E6BCB5" onClick={() => !st.orgBusy && a.removeFacilitator(f.id)} />
            </div>
          )) : <Empty>No facilitators yet</Empty>}
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-h">Groups</div>
        <div className="card admin-form">
          <Field label="Session">
            <select className="select" value={ng.session} onChange={(e) => setNgSession(e.target.value)}>
              {S.SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Group # (1–10)"><input className="input" inputMode="numeric" value={ng.n} onChange={(e) => setNg({ ...ng, n: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="1–10" /></Field>
          <Field label="Name"><input className="input" value={ng.name} onChange={(e) => setNg({ ...ng, name: e.target.value })} placeholder={ng.session + ' IOP'} /></Field>
          <Field label="Facilitator">
            <select className="select" value={ng.facilitatorId} onChange={(e) => setNg({ ...ng, facilitatorId: e.target.value })}>
              <option value="">Unassigned</option>
              {facs.map((f) => <option key={f.id} value={f.id}>{S.facLabel(f)}</option>)}
            </select>
          </Field>
          <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={st.orgBusy || !ngValid} onClick={addGrp}>Add group</button>
        </div>
        <div className="card" style={{ marginTop: 12, padding: groups.length ? '4px 16px' : 16 }}>
          {groups.length ? groups.map((g) => (
            <div className="roster-row" key={g.id}>
              <div>
                <div className="roster-name">{g.session} · Group {g.n} · {g.name}</div>
                <div className="roster-meta"><span>{facLabelFor(g)}</span></div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="select" style={{ width: 'auto', padding: '8px 10px' }} disabled={st.orgBusy} value={g.facilitatorId || ''} onChange={(e) => a.assignFacilitator(g.id, e.target.value || null)}>
                  <option value="">Unassigned</option>
                  {facs.map((f) => <option key={f.id} value={f.id}>{S.facLabel(f)}</option>)}
                </select>
                <ActionButton label="Remove" color="#B14233" border="#E6BCB5" onClick={() => !st.orgBusy && a.removeGroup(g.id)} />
              </div>
            </div>
          )) : <Empty>No groups yet</Empty>}
        </div>
      </div>
    </>
  )
}

function Detail({ store }) {
  const { state: st, set, getRoster, getGroup, facLabelFor, actions: a } = store
  const g = getGroup(st.leaderGroupSession, st.leaderGroupN)
  if (!g) {
    return (
      <div className="scroll fade cholla-scroll">
        <button className="btn btn-ghost" style={{ width: 'auto', padding: '8px 14px', font: '600 13px Inter' }} onClick={a.backToOverview}>← All groups</button>
        <div className="card" style={{ marginTop: 14 }}>
          <Empty title="Group not found">This group no longer exists — it may have been removed in Day-of settings</Empty>
        </div>
      </div>
    )
  }
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
      <div className="section-sub">{facLabelFor(g)} · {g.session} session · {st.todayLabel}</div>
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
