import { useEffect, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Kpi, Pill, ActionButton, Field, Empty } from '../ui'

// Facility panel — who is in the building. Shared by the Facilitator and
// Leadership dashboards. Reads the front-door log (separate table from group
// rosters); the log is date-keyed so it resets at midnight, and anyone never
// checked out on a past day displays as auto-departed at midnight.

function nowClock() {
  const d = new Date()
  return S.fmtClock(d.getHours() * 60 + d.getMinutes())
}

export default function FrontDoor({ store }) {
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
          {isToday ? 'Visitors appear here the moment they check in at the front-door kiosk' : 'No arrivals were recorded on ' + S.fmtDate(date)}
        </Empty>}
      </div>
    </>
  )
}
