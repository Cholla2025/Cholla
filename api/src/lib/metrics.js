// Attendance + volume math for the reporting endpoints. Pure functions, no
// I/O — functions/reports.js fetches the stored entities and hands plain data
// in, so everything here is unit-testable without a table in sight.
//
// PHI note: inputs contain roster ROWS only so they can be counted; every
// output is group labels and numbers — no individual name ever leaves this
// module.

const { SESSIONS } = require('./util')

// A person "attended" once they checked in, whether or not they have since
// checked out.
const ATTENDED_STATUSES = ['Checked In', 'Checked Out']

function round1(x) {
  return Math.round(x * 10) / 10
}

// Whole-number attendance percentage; null when nothing was expected (a 0/0
// group is "no data", not "0%").
function pct(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 100)
}

function countCheckedIn(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && ATTENDED_STATUSES.includes(r.status)).length
}

// One clinic day, aggregated. `rosters` = [{session, n, name, rows}] for the
// date; `doorRows` = the front-door log ({status: 'In Facility'|'Departed'}).
function dailyMetrics({ date, rosters, doorRows }) {
  const perSession = {}
  for (const session of SESSIONS) perSession[session] = { checkedIn: 0, expected: 0, attendancePct: null }

  const groups = []
  let groupTotal = 0
  for (const g of rosters || []) {
    const rows = Array.isArray(g.rows) ? g.rows : []
    const checkedIn = countCheckedIn(rows)
    const expected = rows.length
    groups.push({ session: g.session, n: g.n, name: g.name, checkedIn, expected, attendancePct: pct(checkedIn, expected) })
    groupTotal += checkedIn
    const s = perSession[g.session] || (perSession[g.session] = { checkedIn: 0, expected: 0, attendancePct: null })
    s.checkedIn += checkedIn
    s.expected += expected
  }
  for (const s of Object.values(perSession)) s.attendancePct = pct(s.checkedIn, s.expected)
  groups.sort((a, b) => {
    const s = SESSIONS.indexOf(a.session) - SESSIONS.indexOf(b.session)
    return s !== 0 ? s : a.n - b.n
  })

  const door = Array.isArray(doorRows) ? doorRows : []
  return {
    date,
    groupTotal,
    perSession,
    groups,
    door: {
      total: door.length,
      stillIn: door.filter((r) => r && r.status === 'In Facility').length,
    },
  }
}

// Percent change from previous to current, one decimal. Null-safe: no
// previous period (or a zero previous) means "no comparison", never Infinity.
function trendPct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return round1(((current - previous) / previous) * 100)
}

// A run of clinic days rolled up. `days` = dailyMetrics results in date
// order. `trendPct` starts null — the caller compares against the previous
// period (it has the data; this function stays pure). `from`/`to` default to
// the first/last day but may be passed explicitly for calendar periods whose
// edges have no data.
function periodMetrics({ label, days, from, to }) {
  const list = (days || []).filter(Boolean)
  const totalCheckins = list.reduce((s, d) => s + d.groupTotal, 0)
  const doorTotal = list.reduce((s, d) => s + d.door.total, 0)

  // Aggregate per group across the period to find the best and lowest.
  const byGroup = new Map()
  for (const d of list) {
    for (const g of d.groups) {
      const key = g.session + '-' + g.n
      const agg = byGroup.get(key) || { session: g.session, n: g.n, name: g.name, checkedIn: 0, expected: 0 }
      agg.checkedIn += g.checkedIn
      agg.expected += g.expected
      agg.name = g.name || agg.name
      byGroup.set(key, agg)
    }
  }
  let bestGroup = null
  let lowestGroup = null
  for (const agg of byGroup.values()) {
    const entry = { ...agg, attendancePct: pct(agg.checkedIn, agg.expected) }
    if (!bestGroup || entry.checkedIn > bestGroup.checkedIn) bestGroup = entry
    if (!lowestGroup || entry.checkedIn < lowestGroup.checkedIn) lowestGroup = entry
  }

  return {
    label,
    from: from || (list.length ? list[0].date : null),
    to: to || (list.length ? list[list.length - 1].date : null),
    daysCount: list.length,
    totalCheckins,
    avgPerDay: list.length ? round1(totalCheckins / list.length) : 0,
    doorTotal,
    trendPct: null,
    bestGroup,
    lowestGroup,
    perDay: list.map((d) => ({ date: d.date, groupTotal: d.groupTotal, doorTotal: d.door.total })),
  }
}

function alertThreshold(name, fallback) {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Declining-volume detection over the last 4 clinic days. `groups` =
// [{id, session, n, name}] (org config); `history` = [{date, counts:
// {'<session>-<n>': checkedIn}}] oldest→newest. A group alerts only when the
// decline is STEADY (each of the last 2 days ≤ the day before it) AND the
// last-2-day average fell more than ALERT_DROP_PCT below the prior-2-day
// average (ALERT_CRITICAL_PCT escalates to 'critical'). Groups averaging
// under 3 in the prior window are skipped — tiny numbers are all noise.
function volumeAlerts({ groups, history }) {
  const h = Array.isArray(history) ? history : []
  if (h.length < 4) return []
  const last4 = h.slice(-4)
  const warnAbove = alertThreshold('ALERT_DROP_PCT', 5)
  const criticalAbove = alertThreshold('ALERT_CRITICAL_PCT', 10)

  const alerts = []
  for (const g of groups || []) {
    const key = g.session + '-' + g.n
    const [d0, d1, d2, d3] = last4.map((day) => Number((day.counts || {})[key]) || 0)
    const prior2Avg = (d0 + d1) / 2
    const recent2Avg = (d2 + d3) / 2
    if (prior2Avg < 3) continue
    if (!(d3 <= d2 && d2 <= d1)) continue
    const dropPct = ((prior2Avg - recent2Avg) / prior2Avg) * 100
    if (dropPct <= warnAbove) continue
    alerts.push({
      groupId: g.id || (String(g.session).toLowerCase() + '-' + g.n),
      session: g.session,
      n: g.n,
      name: g.name,
      prior2Avg,
      recent2Avg,
      dropPct: round1(dropPct),
      severity: dropPct > criticalAbove ? 'critical' : 'warning',
    })
  }
  return alerts
}

module.exports = {
  ATTENDED_STATUSES,
  dailyMetrics,
  periodMetrics,
  trendPct,
  volumeAlerts,
}
