// Cholla Check-In — sample data + deterministic roster generation.
// Ported faithfully from the original design prototype. Everything here is
// demo/sample data: fictional clients, facilitators, and groups.

export const CLIENTS = [
  'Maria Alvarez', 'James Carter', 'Dana Whitfield', 'Robert Nguyen', 'Latoya Brooks',
  'Kevin Park', 'Angela Ruiz', 'Marcus Webb', 'Priya Shah', 'Thomas Reed',
]
export const WALKINS = ['Sofia Delgado', 'Aaron Pike', 'Renee Coleman', 'Victor Hahn', 'Bianca Ford']
export const SESSIONS = ['Morning', 'Afternoon', 'Evening']
export const CURRENT = 'Afternoon'
export const FACS = [
  'R. Okafor, LPC', 'S. Tran, LCSW', 'D. Alvarez, LISAC', 'M. Greene, LPC', 'J. Whitman, LCSW',
  'A. Castillo, LISAC', 'P. Bennett, LMFT', 'K. Rios, LCSW', 'L. Foster, PMHNP', 'T. Nash, LPC',
]
export const LIVE_SESSION = 'Afternoon'
export const LIVE_N = 3
export const TODAY = '2026-06-19'
export const FACILITATOR_CODE = '0000'

export function statusOf(g) {
  const i = SESSIONS.indexOf(g.session)
  const c = SESSIONS.indexOf(CURRENT)
  return i < c ? 'Complete' : i === c ? 'In Progress' : 'Upcoming'
}

// The 10 base groups per session (30 total).
export const GROUPS = (() => {
  const out = []
  SESSIONS.forEach((session) => {
    for (let n = 1; n <= 10; n++) {
      const status = statusOf({ session })
      const cap = 9 + ((n + SESSIONS.indexOf(session)) % 4)
      let ci = 0, present = 0
      if (status === 'Complete') { ci = Math.max(0, cap - (n % 3)); present = 0 }
      else if (status === 'In Progress') { ci = Math.max(0, cap - (n % 3)); present = Math.max(1, ci - 2 - (n % 3)) }
      out.push({ session, n, name: session + ' IOP', fac: FACS[(n - 1) % FACS.length], cap, ci, present })
    }
  })
  return out
})()

export function group(session, n) {
  return GROUPS.find((g) => g.session === session && g.n === n)
}
export function groupLabel(session, n) {
  return 'Group ' + n + ' · ' + session + ' IOP'
}
export function rosterKey(g) {
  return g.session + '-' + g.n
}
export function isLive(g) {
  return g.session === LIVE_SESSION && g.n === LIVE_N
}

export function fmtClock(m) {
  let h = Math.floor(m / 60) % 24
  const mm = m % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  let hr = h % 12
  if (hr === 0) hr = 12
  return hr + ':' + String(mm).padStart(2, '0') + ' ' + ap
}

function slotTime(session, i) {
  const base = { Morning: 9 * 60 + 5, Afternoon: 13 * 60 + 2, Evening: 17 * 60 + 3 }[session]
  return fmtClock(base + i)
}

// The live ("Afternoon · Group 3") roster shown in the kiosk by default.
export function initialRoster() {
  return [
    { id: '1042', name: 'Maria Alvarez', checkin: '1:02 PM', checkout: null, status: 'Checked In' },
    { id: '1108', name: 'James Carter', checkin: '1:05 PM', checkout: '2:48 PM', status: 'Checked Out' },
    { id: '1190', name: 'Dana Whitfield', checkin: '1:08 PM', checkout: null, status: 'Checked In' },
    { id: '1234', name: 'Robert Nguyen', checkin: '1:21 PM', checkout: null, status: 'Late' },
    { id: '1356', name: 'Latoya Brooks', checkin: '1:03 PM', checkout: null, status: 'Checked In' },
    { id: '1401', name: 'Kevin Park', checkin: null, checkout: null, status: 'Expected' },
    { id: '1478', name: 'Angela Ruiz', checkin: '1:10 PM', checkout: null, status: 'Checked In' },
    { id: '1502', name: 'Marcus Webb', checkin: null, checkout: null, status: 'Absent' },
    { id: '1560', name: 'Priya Shah', checkin: '1:00 PM', checkout: '2:50 PM', status: 'Checked Out' },
    { id: '1633', name: 'Thomas Reed', checkin: '1:15 PM', checkout: null, status: 'Checked In' },
  ]
}

// Deterministic roster for any non-live group.
export function buildRoster(g) {
  const rows = []
  const ci = g.ci, pres = g.present, cap = g.cap
  const started = statusOf(g) !== 'Upcoming'
  const off = (g.session.length + g.n) % 10
  const si = SESSIONS.indexOf(g.session)
  for (let i = 0; i < cap; i++) {
    const name = CLIENTS[(i + off) % 10]
    let status = 'Expected', checkin = null, checkout = null
    if (i < pres) { status = 'Checked In'; checkin = slotTime(g.session, i) }
    else if (i < ci) { status = 'Checked Out'; checkin = slotTime(g.session, i); checkout = slotTime(g.session, i + 95) }
    else if (started && i === cap - 1 && ci < cap) { status = 'Absent' }
    rows.push({ id: String(2000 + si * 1000 + g.n * 30 + i), name, checkin, checkout, status })
  }
  return rows
}

export function defaultRoster(g) {
  return isLive(g) ? initialRoster() : buildRoster(g)
}

export function statsOf(rows) {
  return {
    ci: rows.filter((x) => x.checkin).length,
    present: rows.filter((x) => x.checkin && !x.checkout).length,
    co: rows.filter((x) => x.checkout).length,
    cap: rows.length,
    absent: rows.filter((x) => x.status === 'Absent').length,
  }
}

// ----- display helpers -----
export function accentFor(session) {
  return { Morning: '#4C84C4', Afternoon: '#BE6A45', Evening: '#21314F' }[session]
}
export function accentChip(session) {
  return { Morning: ['#DCE8F6', '#2C5C94'], Afternoon: ['#F6E5DD', '#A9572F'], Evening: ['#E1E6EF', '#21314F'] }[session]
}
export function pillColors(status) {
  const M = {
    'Checked In': ['#E3F3EC', '#1F7A56'],
    'Checked Out': ['#E8ECF3', '#3A4A66'],
    'Expected': ['#DCE8F6', '#2C5C94'],
    'Late': ['#FBEEDD', '#B5742A'],
    'Absent': ['#F7E3E0', '#B14233'],
  }
  return M[status] || ['#eee', '#333']
}
export function badgeColors(status) {
  const M = {
    'In Progress': ['#E3F3EC', '#1F7A56'],
    'Complete': ['#E8ECF3', '#3A4A66'],
    'Upcoming': ['#DCE8F6', '#2C5C94'],
  }
  return M[status] || ['#eee', '#333']
}

export function titleCase(s) {
  return s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
export function fmtDate(iso) {
  if (!iso) return '—'
  const p = iso.split('-')
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return M[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0]
}
export function rangeHasToday(from, to) {
  const f = from || TODAY, t = to || TODAY
  const lo = f <= t ? f : t, hi = f <= t ? t : f
  return lo <= TODAY && TODAY <= hi
}
export function rangeLabel(from, to) {
  const f = from || TODAY, t = to || TODAY
  const lo = f <= t ? f : t, hi = f <= t ? t : f
  return lo === hi ? fmtDate(lo) : fmtDate(lo) + ' – ' + fmtDate(hi)
}
