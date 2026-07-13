import { useEffect, useMemo, useState } from 'react'
import * as S from '../seed'
import * as B from '../lib/backend'
import { Seg, Kpi, ActionButton, Field, Empty } from '../ui'

// Analytics — attendance over time, for leadership. Three STRICTLY separate
// streams, never blended: group attendance (clients in groups), Member
// Check-In (clients at the door), and Community Check-In (non-client
// visitors). Everything here is aggregate counts from /api/analytics — no
// individual names are fetched or shown.
//
// The page also hosts the personal alert subscriptions (AlertsPanel below):
// per-user, stored server-side, evaluated at day close with the nightly
// report run.

const RANGE_LABELS = { 'Last 7 days': 7, 'Last 30 days': 30, 'Last 90 days': 90 }

export default function Analytics({ store }) {
  const { state: st } = store
  const [rangeLabel, setRangeLabel] = useState('Last 30 days')
  const [data, setData] = useState(null) // null = loading
  const [err, setErr] = useState('')

  const days = RANGE_LABELS[rangeLabel]
  useEffect(() => {
    let alive = true
    setData(null); setErr('')
    ;(async () => {
      if (!st.live) {
        if (alive) { setData(false); setErr('Analytics needs the live backend') }
        return
      }
      try {
        const out = await B.fetchAnalytics(days)
        if (alive) setData(out || false)
      } catch (e) {
        if (alive) { setData(false); setErr(e.message || 'Could not load analytics') }
      }
    })()
    return () => { alive = false }
  }, [days, st.live])

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Analytics</div>
      <div className="section-sub">{st.leaderName || st.authName} · attendance over time · {st.todayLabel}</div>

      <div style={{ marginTop: 14, maxWidth: 480 }}>
        <Seg options={Object.keys(RANGE_LABELS)} value={rangeLabel} onChange={setRangeLabel} />
      </div>

      {err && <div className="signin-err" style={{ marginTop: 14 }}>{err}</div>}
      {data === null && <div className="card" style={{ marginTop: 14 }}><Empty>Loading analytics…</Empty></div>}

      {data && (
        <>
          <GroupsSection data={data} />
          <StreamSection
            title="Member Check-In trends"
            sub="Clients at the facility door — separate from group attendance."
            stream={data.member}
            color="#4C84C4"
            noun="member check-in(s)"
          />
          <StreamSection
            title="Community Check-In trends"
            sub="Non-client visitors only — guests, vendors and family."
            stream={data.community}
            color="#BE6A45"
            noun="visitor(s)"
            extra={data.community.byReason && data.community.byReason.length > 0 && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="roster-name">Visits by reason</div>
                <div style={{ marginTop: 8 }}>
                  {data.community.byReason.map((r) => (
                    <div key={r.reason} className="roster-meta" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span>{r.reason}</span><span style={{ fontWeight: 600 }}>{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          />
        </>
      )}

      <AlertsPanel store={store} />
    </div>
  )
}

// Simple dependency-free bar chart: one bar per day.
function Bars({ series, color, height = 96 }) {
  const max = Math.max(1, ...series.map((p) => p.value))
  if (!series.length) return <Empty>No activity recorded in this range</Empty>
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, marginTop: 10 }}>
      {series.map((p) => (
        <div key={p.date} title={S.fmtDate(p.date) + ': ' + p.value}
          style={{
            flex: 1,
            minWidth: 2,
            height: Math.max(2, Math.round((p.value / max) * height)),
            background: color,
            opacity: p.value ? 0.9 : 0.25,
            borderRadius: 3,
          }} />
      ))}
    </div>
  )
}

function GroupsSection({ data }) {
  const perDay = data.groups.perDay.map((d) => ({ date: d.date, value: d.total }))
  return (
    <div className="admin-section">
      <div className="admin-h">Group attendance trends</div>
      <div className="card" style={{ marginTop: 4 }}>
        <div className="roster-name">Clinic-wide group check-ins per day</div>
        <div className="roster-meta" style={{ marginTop: 2 }}>
          <span>{data.groups.total} check-ins · {S.fmtDate(data.from)} – {S.fmtDate(data.to)}</span>
        </div>
        <Bars series={perDay} color="#1F7A56" />
      </div>
      <div className="card" style={{ marginTop: 12, padding: data.groups.byGroup.length ? '4px 16px' : 16 }}>
        {data.groups.byGroup.length ? data.groups.byGroup.map((g) => (
          <div className="roster-row" key={g.session + '-' + g.n}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="roster-name">{g.session} · Group {g.n}{g.name ? ' · ' + g.name : ''}</div>
              <div className="roster-meta">
                <span>{g.checkedIn} check-ins</span>
                <span>{g.expected} expected</span>
                <span>{g.attendancePct === null ? '—' : g.attendancePct + '%'} attendance</span>
              </div>
              <div className="bar" style={{ marginTop: 8 }}>
                <span style={{ width: (g.attendancePct || 0) + '%', background: S.accentFor(g.session) }} />
              </div>
            </div>
          </div>
        )) : <Empty>No group activity in this range</Empty>}
      </div>
    </div>
  )
}

// Shared layout for the two door-style streams (member + community).
function StreamSection({ title, sub, stream, color, noun, extra }) {
  const perDay = stream.perDay.map((d) => ({ date: d.date, value: d.total }))
  const kpis = [
    { label: 'Total', value: String(stream.total), color, sub: noun + ' in range' },
    { label: 'Still here today', value: String(stream.stillIn), color: '#1F7A56', sub: 'not yet checked out' },
    { label: 'Never checked out', value: String(stream.neverCheckedOut), color: '#B14233', sub: 'past days, auto-departed' },
    { label: 'Avg visit', value: stream.avgDurationMinutes === null ? '—' : stream.avgDurationMinutes + ' min', color: '#21314F', sub: stream.durationsCounted + ' completed visit(s)' },
  ]
  return (
    <div className="admin-section">
      <div className="admin-h">{title}</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 8 }}>{sub}</div>
      <div className="kpi-grid">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">Per day</div>
        <Bars series={perDay} color={color} />
      </div>
      {stream.peakHours && stream.peakHours.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="roster-name">Peak check-in hours</div>
          <div style={{ marginTop: 8 }}>
            {stream.peakHours.map((h) => (
              <div key={h.hour} className="roster-meta" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{h.hour}</span><span style={{ fontWeight: 600 }}>{h.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {extra}
    </div>
  )
}

// ----- personal alert subscriptions -----
// Two kinds: group thresholds ("email me when Group 3 closes under 6") and
// per-client missed-check-in alerts (checkbox list from the client roster —
// the API scopes facilitators to their own groups' clients automatically).
// Evaluated server-side at day close; alert emails carry the client's name
// and missed status ONLY.
export function AlertsPanel({ store }) {
  const { state: st, myGroups } = store
  const [subs, setSubs] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [groupSel, setGroupSel] = useState('')
  const [threshold, setThreshold] = useState('5')
  const [clientSearch, setClientSearch] = useState('')

  const load = async () => {
    try {
      const out = await B.fetchAlertSubs()
      setSubs(out.subscriptions || [])
    } catch (e) {
      setSubs([]); setErr(e.message || 'Could not load your alerts')
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setErr('')
    try { await fn(); await load() } catch (e) { setErr(e.message || 'Action failed') }
    setBusy(false)
  }

  // Groups the caller may subscribe to (facilitators: own groups only —
  // enforced again server-side).
  const groups = myGroups()
  const groupKey = (g) => g.session + '|' + g.n
  const list = subs || []
  const groupSubs = list.filter((s) => s.type === 'group')
  const clientSubs = list.filter((s) => s.type === 'client')
  const subscribedClientIds = useMemo(() => new Set(clientSubs.map((s) => s.clientId)), [subs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Assigned, active clients the caller can subscribe to. st.clients is
  // already role-scoped by the API (facilitators receive only their own
  // groups' clients).
  let clientChoices = st.clients.filter((c) => c.active && c.session)
  if (clientSearch.trim()) {
    clientChoices = clientChoices.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
  }

  const addGroupSub = () => run(async () => {
    const [session, n] = groupSel.split('|')
    await B.createAlertSub({ type: 'group', session, n: Number(n), threshold: Number(threshold) })
    setGroupSel('')
  })

  const toggleClient = (c) => {
    const existing = clientSubs.find((s) => s.clientId === c.id)
    if (existing) return run(() => B.deleteAlertSub(existing.id))
    return run(() => B.createAlertSub({ type: 'client', clientId: c.id }))
  }

  const thresholdOk = Number(threshold) >= 1 && Number(threshold) <= 200

  return (
    <div className="admin-section">
      <div className="admin-h">My alerts</div>
      <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
        Personal email alerts, evaluated at day close with the nightly report
        run — they go only to you ({st.authUser?.email || 'your account'}).
        Client alerts contain the name and missed status only, nothing else.
      </div>
      {err && <div className="signin-err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="card">
        <div className="roster-name">Group attendance thresholds</div>
        <div className="section-sub" style={{ marginTop: 4, marginBottom: 8 }}>
          Get an email when a group closes the day under your check-in threshold.
        </div>
        <div className="admin-form" style={{ padding: 0, border: 'none', boxShadow: 'none' }}>
          <Field label="Group">
            <select className="select" value={groupSel} onChange={(e) => setGroupSel(e.target.value)}>
              <option value="">Select a group…</option>
              {groups.map((g) => (
                <option key={g.id} value={groupKey(g)}>{g.session} · Group {g.n} · {g.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Alert when check-ins fall below">
            <input className="input" inputMode="numeric" value={threshold}
              onChange={(e) => setThreshold(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </Field>
          <button className="btn" style={{ width: 'auto', alignSelf: 'end' }}
            disabled={busy || !groupSel || !thresholdOk} onClick={addGroupSub}>
            Subscribe
          </button>
        </div>
        {groupSubs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {groupSubs.map((s) => (
              <div className="roster-row" key={s.id}>
                <div>
                  <div className="roster-name">{s.session} · Group {s.n}</div>
                  <div className="roster-meta"><span>Alert below {s.threshold} check-ins</span></div>
                </div>
                <ActionButton label="Unsubscribe" color="#B14233" border="#E6BCB5" onClick={() => run(() => B.deleteAlertSub(s.id))} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">Per-client check-in alerts</div>
        <div className="section-sub" style={{ marginTop: 4, marginBottom: 8 }}>
          Check a client to be emailed whenever they don't check in to their
          group that day.{st.authRole === 'facilitator' ? ' You can subscribe to clients in your own groups.' : ''}
        </div>
        <input className="input" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search client name" />
        <div className="preview-list cholla-scroll" style={{ marginTop: 10 }}>
          {subs === null ? <Empty>Loading…</Empty> : clientChoices.length ? clientChoices.map((c) => (
            <label key={c.id} className="preview-row" style={{ cursor: 'pointer', gap: 10, justifyContent: 'flex-start' }}>
              <input type="checkbox" disabled={busy} checked={subscribedClientIds.has(c.id)} onChange={() => toggleClient(c)} />
              <span style={{ flex: 1 }}>{c.name}</span>
              <span className="preview-tag">{c.session} · Group {c.n}</span>
            </label>
          )) : <Empty>{clientSearch.trim() ? 'No clients match' : 'No assigned clients to subscribe to yet'}</Empty>}
        </div>
      </div>
    </div>
  )
}
