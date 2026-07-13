import { useEffect, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Kpi, Pill, ActionButton, Field, Empty } from '../ui'
import PreregQueue from './PreregQueue'

// Community Check-In — non-client visitors (guests, vendors, family).
// LEADERSHIP ONLY: facilitators have no community surface and the API answers
// them with a 403. This screen combines the day's visitor log with the
// pre-registration queue (people who registered an upcoming visit on the
// public /preregister page) so the front desk can confirm arrivals.

function nowClock() {
  const d = new Date()
  return S.fmtClock(d.getHours() * 60 + d.getMinutes())
}

export default function Community({ store }) {
  const { state: st } = store
  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Community Check-In</div>
      <div className="section-sub">Guests, vendors &amp; family · never blended with client data · {st.todayLabel}</div>
      <PreregQueue today={st.today} live={st.live} />
      <VisitorLog store={store} />
    </div>
  )
}

function VisitorLog({ store }) {
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
    else { setRows([]); setErr('Could not load the Community Check-In log — check the connection') }
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
        {rows === null ? <Empty>Loading the Community Check-In log…</Empty> : shown.length ? shown.map((r) => {
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
        }) : <Empty title={isToday ? 'No visitors yet today' : 'No Community Check-In activity'}>
          {isToday ? 'Visitors appear here as they sign in at the Community Check-In kiosk' : 'No visitors were recorded on ' + S.fmtDate(date)}
        </Empty>}
      </div>
    </>
  )
}
