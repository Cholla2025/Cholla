import { useEffect } from 'react'
import * as S from '../seed'
import { Seg, Chips, Kpi, Pill, ActionButton, Field, Empty } from '../ui'

const STATUS_FILTERS = ['All', 'Checked In', 'Checked Out', 'Expected', 'Late', 'Absent']

export default function Staff({ store }) {
  const { state: st, set, actions: a, getRoster, getGroup, facLabelFor, myGroups, myGroupsFor } = store
  // Facilitators are auto-scoped to their OWN assigned groups (matched from
  // their account email to their facilitator record); leadership sees all.
  const isFacilitator = st.authRole === 'facilitator'
  const scopedAll = myGroups()
  const groupOptions = myGroupsFor(st.staffSession)
  let g = st.staffGroup == null ? undefined : getGroup(st.staffSession, st.staffGroup)
  if (isFacilitator && g && !groupOptions.some((x) => x.n === g.n)) g = undefined

  // Keep the selection inside the facilitator's own groups.
  useEffect(() => {
    if (!isFacilitator) return
    if (g || !scopedAll.length) return
    const first = groupOptions[0] || scopedAll[0]
    if (first) set({ staffSession: first.session, staffGroup: first.n })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFacilitator, g, scopedAll.length])
  const inRange = S.rangeHasToday(st.staffFrom, st.staffTo)
  const base = !g || !inRange || st.staffView === 'empty' ? [] : getRoster(g)

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

  const emptyMsg = !inRange
    ? 'No session records for ' + S.rangeLabel(st.staffFrom, st.staffTo)
    : st.staffView === 'empty'
      ? 'Switch to live state to see a populated roster'
      : st.live
        ? 'No clients have been added to ' + (g ? S.groupLabel(g.session, g.n) : 'this group') + ' yet — clients appear here as they check in at the kiosk, or add one with the form below'
        : 'No members have checked in to ' + (g ? S.groupLabel(g.session, g.n) : 'this group') + ' yet'

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Facilitator dashboard</div>
      <div className="section-sub">
        {st.staffName} · {st.todayLabel}
        {isFacilitator ? ' · your assigned groups' : ''}
      </div>

      {isFacilitator && !scopedAll.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <Empty title="No groups linked to your account">
            Your sign-in email isn't linked to a facilitator with assigned
            groups yet — ask leadership to add you as a facilitator (with this
            email) and assign your group in Settings.
          </Empty>
        </div>
      ) : (<>

      <div style={{ marginTop: 16 }}>
        <Seg options={S.SESSIONS} value={st.staffSession} onChange={a.staffSetSession} activeBg="#4C84C4" inactiveFg="#7A8AA3" />
      </div>

      {g && (
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          {kpis.map((k) => <Kpi key={k.label} {...k} />)}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <Field label="Group">
          <select className="select" value={st.staffGroup ?? ''} onChange={a.onStaffGroup}>
            {groupOptions.map((o) => <option key={o.id} value={o.n}>Group {o.n} · {o.name} · {facLabelFor(o)}</option>)}
          </select>
        </Field>
        {g && (
          <div className="muted" style={{ font: '500 12px Inter', margin: '-4px 0 12px' }}>
            Facilitator · {facLabelFor(g)}
          </div>
        )}
        <div className="row">
          <Field label="Dates"><input className="input" type="date" value={st.staffFrom} onChange={(e) => set({ staffFrom: e.target.value })} /></Field>
          <Field label="&nbsp;"><input className="input" type="date" value={st.staffTo} onChange={(e) => set({ staffTo: e.target.value })} /></Field>
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => set({ staffFrom: st.today, staffTo: st.today })}>Today</button>
          {!st.live && (
            <button className="btn btn-ghost" onClick={a.toggleStaffView}>{st.staffView === 'live' ? 'Show empty state' : 'Show live state'}</button>
          )}
        </div>
      </div>

      {!g ? (
        <div className="card" style={{ marginTop: 14 }}>
          <Empty title="No groups yet">No groups in this session yet — leadership can add one in Day-of settings</Empty>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, overflowX: 'auto' }} className="cholla-scroll">
            <Chips options={STATUS_FILTERS} value={st.staffStatus} onChange={(o) => set({ staffStatus: o })} />
          </div>
          <input className="input" style={{ marginTop: 12 }} value={st.staffSearch} onChange={(e) => set({ staffSearch: e.target.value })} placeholder="Search client name" />

          {st.rosterErr && <div className="signin-err" style={{ marginTop: 12 }}>{st.rosterErr}</div>}

          {editable && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="lab" style={{ marginBottom: 10 }}>Add client to {S.groupLabel(g.session, g.n)}</div>
              <input className="input" value={st.newName} onChange={a.onNewName} placeholder="Client name" />
              <input className="input" style={{ marginTop: 10 }} inputMode="numeric" value={st.newId} onChange={a.onNewId} placeholder="ID (optional)" />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-ghost" onClick={() => a.addClient(false)}>Add as expected</button>
                <button className="btn" onClick={() => a.addClient(true)}>Add &amp; check in</button>
              </div>
            </div>
          )}

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
        </>
      )}

      </>)}
    </div>
  )
}
