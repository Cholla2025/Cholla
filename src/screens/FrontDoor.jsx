import { useEffect, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Seg, Kpi, Pill, ActionButton, Field, Empty } from '../ui'

// Facility panel — who is in the building. Shared by the Facilitator and
// Leadership dashboards, split into two sub-dashboards: Clients (the member
// front-door log) and Visitors (guests/vendors/family). Both logs are
// date-keyed so they reset at midnight; anyone never checked out on a past
// day displays as auto-departed at midnight.

function nowClock() {
  const d = new Date()
  return S.fmtClock(d.getHours() * 60 + d.getMinutes())
}

export default function FrontDoor({ store }) {
  const [view, setView] = useState('Clients')
  return (
    <>
      <div style={{ marginTop: 14, maxWidth: 320 }}>
        <Seg options={['Clients', 'Visitors']} value={view} onChange={setView} />
      </div>
      {view === 'Clients' ? <ClientsPanel store={store} /> : <VisitorsPanel store={store} />}
    </>
  )
}

function ClientsPanel({ store }) {
  const { state: st } = store
  const [date, setDate] = useState(st.today)
  const [rows, setRows] = useState(null) // null = loading
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const isToday = date === st.today
  const load = async (d) => {
    setErr('')
    if (!st.live) {
      setRows(d === st.today ? S.defaultDoor() : [])
      return
    }
    setRows(null)
    const fresh = await B.fetchDoorRows(d)
    if (fresh) setRows(fresh)
    else { setRows([]); setErr('Could not load the front-door log — check the connection') }
  }
  useEffect(() => { load(date) }, [date, st.live]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live view stays honest while the tab is open.
  useEffect(() => {
    if (!isToday || !st.live) return
    const iv = setInterval(() => load(date), 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isToday, st.live])

  const list = rows || []
  const present = list.filter((r) => !r.out).length
  const departed = list.filter((r) => r.out).length
  const kpis = [
    { label: isToday ? 'In facility now' : 'Never checked out', value: String(present), color: '#1F7A56', sub: isToday ? 'currently on-site' : 'auto-departed at midnight' },
    { label: 'Total arrivals', value: String(list.length), color: '#21314F', sub: S.fmtDate(date) },
    { label: 'Departed', value: String(departed), color: '#3A4A66', sub: 'checked out' },
  ]

  const checkOut = async (row) => {
    if (busy) return
    setBusy(true); setErr('')
    const updated = { ...row, out: nowClock(), status: 'Departed' }
    if (st.live) {
      try {
        const merged = await B.saveDoorRow(date, updated)
        if (merged) setRows(merged)
      } catch (e) {
        setErr('Could not save — ' + (e.message || 'try again'))
      }
    } else {
      setRows((cur) => cur.map((r) => (r.id === row.id ? updated : r)))
    }
    setBusy(false)
  }

  let shown = list
  if (search.trim()) shown = shown.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <div className="kpi-grid" style={{ marginTop: 14 }}>
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="&nbsp;"><button className="btn btn-ghost" onClick={() => setDate(st.today)}>Today</button></Field>
        </div>
        <div className="muted" style={{ font: '500 12px Inter' }}>
          The front-door list starts fresh every day at midnight — anyone not
          checked out is recorded as departing at 11:59 PM.
        </div>
      </div>

      <input className="input" style={{ marginTop: 12 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search visitor name" />
      {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 14, padding: shown.length ? '6px 16px' : 16 }}>
        {rows === null ? <Empty>Loading front-door log…</Empty> : shown.length ? shown.map((r) => {
          const autoOut = !r.out && !isToday
          return (
            <div className="roster-row" key={r.id}>
              <div>
                <div className="roster-name">{r.name}</div>
                <div className="roster-meta">
                  <span>In {r.in || '—'}</span>
                  <span>Out {r.out || (autoOut ? 'Auto · 11:59 PM' : '—')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Pill status={autoOut ? 'Departed' : r.status} />
                {isToday && !r.out && (
                  <ActionButton label="Check out" color="#3A4A66" border="#CCD6E5" onClick={() => checkOut(r)} />
                )}
              </div>
            </div>
          )
        }) : <Empty title={isToday ? 'Nobody has checked in yet' : 'No front-door activity'}>
          {isToday ? 'Members appear here the moment they check in at the site kiosk' : 'No arrivals were recorded on ' + S.fmtDate(date)}
        </Empty>}
      </div>
    </>
  )
}

// Guests, vendors, and family — the visitor log, with company / host / reason
// detail and the same date lookback and midnight-reset semantics.
function VisitorsPanel({ store }) {
  const { state: st } = store
  const [date, setDate] = useState(st.today)
  const [rows, setRows] = useState(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const isToday = date === st.today
  const load = async (d) => {
    setErr('')
    if (!st.live) {
      setRows(d === st.today ? S.defaultVisitors() : [])
      return
    }
    setRows(null)
    const fresh = await B.fetchVisitorRows(d)
    if (fresh) setRows(fresh)
    else { setRows([]); setErr('Could not load the visitor log — check the connection') }
  }
  useEffect(() => { load(date) }, [date, st.live]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isToday || !st.live) return
    const iv = setInterval(() => load(date), 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isToday, st.live])

  const list = rows || []
  const onSite = list.filter((r) => !r.out).length
  const kpis = [
    { label: isToday ? 'On site now' : 'Never signed out', value: String(onSite), color: '#BE6A45', sub: isToday ? 'visitors in the building' : 'auto-departed at midnight' },
    { label: 'Total visitors', value: String(list.length), color: '#21314F', sub: S.fmtDate(date) },
    { label: 'Departed', value: String(list.length - onSite), color: '#3A4A66', sub: 'signed out' },
  ]

  const checkOut = async (row) => {
    if (busy) return
    setBusy(true); setErr('')
    const updated = { ...row, out: nowClock(), status: 'Departed' }
    if (st.live) {
      try {
        const merged = await B.saveVisitorRow(date, updated)
        if (merged) setRows(merged)
      } catch (e) {
        setErr('Could not save — ' + (e.message || 'try again'))
      }
    } else {
      setRows((cur) => cur.map((r) => (r.id === row.id ? updated : r)))
    }
    setBusy(false)
  }

  let shown = list
  if (search.trim()) {
    const q = search.toLowerCase()
    shown = shown.filter((r) =>
      (r.first + ' ' + r.last).toLowerCase().includes(q) ||
      (r.company || '').toLowerCase().includes(q) ||
      (r.visiting || '').toLowerCase().includes(q))
  }

  return (
    <>
      <div className="kpi-grid" style={{ marginTop: 14 }}>
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="&nbsp;"><button className="btn btn-ghost" onClick={() => setDate(st.today)}>Today</button></Field>
        </div>
        <div className="muted" style={{ font: '500 12px Inter' }}>
          Every visitor accepted the HIPAA confidentiality acknowledgment at
          check-in. The list resets at midnight.
        </div>
      </div>

      <input className="input" style={{ marginTop: 12 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, or host" />
      {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}

      <div className="card" style={{ marginTop: 14, padding: shown.length ? '6px 16px' : 16 }}>
        {rows === null ? <Empty>Loading visitor log…</Empty> : shown.length ? shown.map((r) => {
          const autoOut = !r.out && !isToday
          return (
            <div className="roster-row" key={r.id || r.first + r.last}>
              <div style={{ minWidth: 0 }}>
                <div className="roster-name">{r.first} {r.last}</div>
                <div className="roster-meta">
                  <span>{r.company}</span>
                  {r.visiting && <span>Visiting {r.visiting}</span>}
                  <span>{r.reason}</span>
                </div>
                <div className="roster-meta" style={{ marginTop: 4 }}>
                  <span>{r.phone}</span>
                  {r.email && <span>{r.email}</span>}
                  <span>In {r.in || '—'}</span>
                  <span>Out {r.out || (autoOut ? 'Auto · 11:59 PM' : '—')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Pill status={autoOut ? 'Departed' : r.status} />
                {isToday && !r.out && (
                  <ActionButton label="Sign out" color="#3A4A66" border="#CCD6E5" onClick={() => checkOut(r)} />
                )}
              </div>
            </div>
          )
        }) : <Empty title={isToday ? 'No visitors yet today' : 'No visitor activity'}>
          {isToday ? 'Visitors appear here as they sign in at the visitor kiosk' : 'No visitors were recorded on ' + S.fmtDate(date)}
        </Empty>}
      </div>
    </>
  )
}
