// Analytics — attendance over time for the leadership Analytics page.
//
//   GET /api/analytics?days=7|14|30|90|180 — leader/admin ONLY (facilitators
//   get the requireLeader 403; there is no kiosk path).
//
// The response keeps the clinic's three streams STRICTLY separate — group
// attendance (clients in groups), Member Check-In (clients at the door), and
// Community Check-In (non-client visitors) — never blended into one series:
//
//   { from, to,
//     groups:    { perDay, byGroup, total }
//     member:    { perDay, total, stillIn, neverCheckedOut, avgDurationMinutes,
//                  durationsCounted, peakHours }
//     community: { perDay, total, stillIn, neverCheckedOut, avgDurationMinutes,
//                  durationsCounted, peakHours, byReason } }
//
// PHI boundary: aggregates ONLY — counts, percentages, durations and hour
// buckets. No client, member or visitor name (or any per-person row) is ever
// returned or logged by this endpoint.

const { app } = require('@azure/functions')
const { odata } = require('@azure/data-tables')
const { json, guard } = require('../lib/util')
const { requireLeader } = require('../lib/auth')
const { rostersTable, frontdoorTable, visitorsTable, listOrgEntities } = require('../lib/storage')
const { ATTENDED_STATUSES } = require('../lib/metrics')

const RANGES = [7, 14, 30, 90, 180]
const DEFAULT_TZ = 'America/Phoenix'

function clinicToday(offsetDays = 0) {
  const tz = process.env.CLINIC_TIMEZONE || DEFAULT_TZ
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ }).format(d)
  }
}

// Parse the clock strings the kiosks store ('9:05 AM') into minutes since
// midnight; null for anything unparseable.
function clockToMinutes(v) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(v || '').trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  if (h < 1 || h > 12 || min > 59) return null
  if (/pm/i.test(m[3]) && h !== 12) h += 12
  if (/am/i.test(m[3]) && h === 12) h = 0
  return h * 60 + min
}

function hourLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const display = h % 12 === 0 ? 12 : h % 12
  return display + ' ' + ampm
}

// Shared per-day rollup for the two door-style logs (member + community).
// `today` marks the one date where "still here" is normal, not a flag.
function doorStreamStats(byDate, dates, today, statusIn) {
  const perDay = []
  let total = 0
  let stillIn = 0
  let neverCheckedOut = 0
  let durationSum = 0
  let durationsCounted = 0
  const hourCounts = new Map()

  for (const date of dates) {
    const rows = byDate.get(date) || []
    let dayStill = 0
    for (const r of rows) {
      if (!r) continue
      const inMin = clockToMinutes(r.in)
      const outMin = r.out ? clockToMinutes(r.out) : null
      if (inMin !== null) {
        const label = hourLabel(inMin)
        hourCounts.set(label, (hourCounts.get(label) || 0) + 1)
      }
      if (r.status === statusIn) {
        dayStill++
        if (date < today) neverCheckedOut++
      } else if (inMin !== null && outMin !== null && outMin >= inMin) {
        durationSum += outMin - inMin
        durationsCounted++
      }
    }
    total += rows.length
    perDay.push({ date, total: rows.length, stillIn: dayStill })
    if (date === today) stillIn = dayStill
  }

  const peakHours = [...hourCounts.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  return {
    perDay,
    total,
    stillIn,
    neverCheckedOut,
    avgDurationMinutes: durationsCounted ? Math.round(durationSum / durationsCounted) : null,
    durationsCounted,
    peakHours,
  }
}

app.http('analytics-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'analytics',
  handler: guard(async (request, context) => {
    const who = await requireLeader(request)
    if (who.status) return who

    let days = Number(request.query.get('days') || 30)
    if (!RANGES.includes(days)) days = 30
    const to = clinicToday()
    const from = clinicToday(-(days - 1))
    const filter = odata`PartitionKey ge ${from} and PartitionKey le ${to}`

    // ----- stream 1: group attendance (rosters) -----
    const { groups } = await listOrgEntities()
    const groupMeta = new Map()
    for (const g of groups) {
      groupMeta.set(g.session + '-' + g.n, { session: g.session, n: Number(g.n), name: g.name })
    }
    const rosterDays = new Map() // date -> Map(rowKey -> {checkedIn, expected})
    const rc = await rostersTable()
    for await (const e of rc.listEntities({ queryOptions: { filter } })) {
      try {
        const rows = JSON.parse(e.rows)
        if (!Array.isArray(rows)) continue
        if (!rosterDays.has(e.partitionKey)) rosterDays.set(e.partitionKey, new Map())
        rosterDays.get(e.partitionKey).set(e.rowKey, {
          checkedIn: rows.filter((r) => r && ATTENDED_STATUSES.includes(r.status)).length,
          expected: rows.length,
        })
      } catch {
        context.warn('[cholla-api] analytics: skipping unreadable roster ' + e.partitionKey + '/' + e.rowKey)
      }
    }

    // ----- streams 2 + 3: member + community door logs -----
    const memberByDate = new Map()
    const fc = await frontdoorTable()
    for await (const e of fc.listEntities({ queryOptions: { filter } })) {
      try {
        const rows = JSON.parse(e.rows)
        if (Array.isArray(rows)) memberByDate.set(e.partitionKey, rows)
      } catch {
        context.warn('[cholla-api] analytics: skipping unreadable member log ' + e.partitionKey)
      }
    }
    const communityByDate = new Map()
    const vc = await visitorsTable()
    for await (const e of vc.listEntities({ queryOptions: { filter } })) {
      try {
        const rows = JSON.parse(e.rows)
        if (Array.isArray(rows)) communityByDate.set(e.partitionKey, rows)
      } catch {
        context.warn('[cholla-api] analytics: skipping unreadable community log ' + e.partitionKey)
      }
    }

    // Clinic days = dates where ANY stream has data, ascending.
    const dates = [...new Set([
      ...rosterDays.keys(),
      ...memberByDate.keys(),
      ...communityByDate.keys(),
    ])].sort()

    // Group stream rollup.
    const groupPerDay = []
    const byGroupAgg = new Map()
    let groupsTotal = 0
    for (const date of dates) {
      const day = rosterDays.get(date) || new Map()
      let dayTotal = 0
      for (const [rowKey, counts] of day) {
        dayTotal += counts.checkedIn
        const meta = groupMeta.get(rowKey) || (() => {
          const dash = rowKey.lastIndexOf('-')
          return { session: rowKey.slice(0, dash), n: Number(rowKey.slice(dash + 1)), name: null }
        })()
        const agg = byGroupAgg.get(rowKey) || { ...meta, perDay: [], checkedIn: 0, expected: 0 }
        agg.perDay.push({ date, checkedIn: counts.checkedIn, expected: counts.expected })
        agg.checkedIn += counts.checkedIn
        agg.expected += counts.expected
        byGroupAgg.set(rowKey, agg)
      }
      groupsTotal += dayTotal
      groupPerDay.push({ date, total: dayTotal })
    }
    const byGroup = [...byGroupAgg.values()]
      .map((g) => ({
        ...g,
        attendancePct: g.expected ? Math.round((g.checkedIn / g.expected) * 100) : null,
      }))
      .sort((a, b) => (a.session === b.session ? a.n - b.n : a.session < b.session ? 1 : -1))

    return json(200, {
      from,
      to,
      days,
      groups: { perDay: groupPerDay, byGroup, total: groupsTotal },
      member: doorStreamStats(memberByDate, dates, to, 'In Facility'),
      community: {
        ...doorStreamStats(communityByDate, dates, to, 'On Site'),
        byReason: (() => {
          const counts = new Map()
          for (const date of dates) {
            for (const r of communityByDate.get(date) || []) {
              if (r && r.reason) counts.set(r.reason, (counts.get(r.reason) || 0) + 1)
            }
          }
          return [...counts.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
        })(),
      },
    })
  }),
})
