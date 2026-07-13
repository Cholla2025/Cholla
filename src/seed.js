// Cholla Check-In — deterministic sample data + roster generation.
//
// Everything in this file is fictional demo data (clients, facilitators,
// groups). It is only ever used when the app is NOT connected to the Azure
// backend, so no real client information can exist in this repository. In
// live mode the org structure and rosters come from the API and the demo
// generators below are never consulted.

export const CLIENTS = [
  'Maria Alvarez', 'James Carter', 'Dana Whitfield', 'Robert Nguyen', 'Latoya Brooks',
  'Kevin Park', 'Angela Ruiz', 'Marcus Webb', 'Priya Shah', 'Thomas Reed',
]
export const WALKINS = ['Sofia Delgado', 'Aaron Pike', 'Renee Coleman', 'Victor Hahn', 'Bianca Ford']

// Two daily IOP sessions, ten groups each. (There is no evening programming.)
export const SESSIONS = ['Morning', 'Afternoon']
export const GROUPS_PER_SESSION = 10

export const FAC_NAMES = [
  ['R. Okafor', 'LPC'], ['S. Tran', 'LCSW'], ['D. Alvarez', 'LISAC'], ['M. Greene', 'LPC'],
  ['J. Whitman', 'LCSW'], ['A. Castillo', 'LISAC'], ['P. Bennett', 'LMFT'], ['K. Rios', 'LCSW'],
  ['L. Foster', 'PMHNP'], ['T. Nash', 'LPC'],
]

// ----- clock & date -----
// Kiosks and dashboards are long-lived pages (a tablet can sit open for
// days), so "today" and "which session is it" are FUNCTIONS evaluated on
// demand, never module constants — the store re-checks them on an interval
// and rolls the app over at midnight / midday.
export function todayISO(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export function todayLabel(d = new Date()) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

// Which session is "now" (drives In Progress / Complete / Upcoming).
export function currentSession(d = new Date()) {
  return d.getHours() < 12 ? 'Morning' : 'Afternoon'
}

export const DEMO_LIVE_SESSION = 'Afternoon'
export const DEMO_LIVE_N = 3

export function statusOf(g) {
  const i = SESSIONS.indexOf(g.session)
  const c = SESSIONS.indexOf(currentSession())
  return i < c ? 'Complete' : i === c ? 'In Progress' : 'Upcoming'
}

// ----- default org (demo mode only) -----
// 10 fictional facilitators and 20 groups. In live mode the equivalent comes
// from /api/org and is managed on the Leadership dashboard.
export function defaultFacilitators() {
  return FAC_NAMES.map(([name, credential], i) => ({
    id: 'f' + (i + 1),
    name,
    credential,
    email: name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.+|\.+$/g, '') + '@example.org',
    active: true,
  }))
}

export function defaultGroups(facilitators) {
  const out = []
  SESSIONS.forEach((session) => {
    for (let n = 1; n <= GROUPS_PER_SESSION; n++) {
      const f = facilitators[(n - 1) % facilitators.length]
      const cap = 9 + ((n + SESSIONS.indexOf(session)) % 4)
      out.push({
        id: session.toLowerCase() + '-' + n,
        session,
        n,
        name: session + ' IOP',
        facilitatorId: f.id,
        cap,
      })
    }
  })
  return out
}

export function defaultOrg() {
  const facilitators = defaultFacilitators()
  return { facilitators, groups: defaultGroups(facilitators) }
}

export function facLabel(f) {
  if (!f) return 'Unassigned'
  return f.credential ? f.name + ', ' + f.credential : f.name
}

export function groupLabel(session, n) {
  return 'Group ' + n + ' · ' + session + ' IOP'
}
export function rosterKey(g) {
  return g.session + '-' + g.n
}
export function isDemoLive(g) {
  return g.session === DEMO_LIVE_SESSION && g.n === DEMO_LIVE_N
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
  const base = { Morning: 9 * 60 + 5, Afternoon: 13 * 60 + 2 }[session] || 9 * 60
  return fmtClock(base + i)
}

// The live ("Afternoon · Group 3") roster shown in the demo by default.
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

// Deterministic roster for any other demo group.
export function buildRoster(g) {
  const rows = []
  const cap = g.cap || 10
  const status = statusOf(g)
  const started = status !== 'Upcoming'
  const ci = started ? Math.max(0, cap - (g.n % 3)) : 0
  const pres = status === 'In Progress' ? Math.max(1, ci - 2 - (g.n % 3)) : 0
  const off = (g.session.length + g.n) % 10
  const si = SESSIONS.indexOf(g.session)
  for (let i = 0; i < cap; i++) {
    const name = CLIENTS[(i + off) % 10]
    let rowStatus = 'Expected', checkin = null, checkout = null
    if (i < pres) { rowStatus = 'Checked In'; checkin = slotTime(g.session, i) }
    else if (i < ci) { rowStatus = 'Checked Out'; checkin = slotTime(g.session, i); checkout = slotTime(g.session, i + 95) }
    else if (started && i === cap - 1 && ci < cap) { rowStatus = 'Absent' }
    rows.push({ id: String(2000 + si * 1000 + g.n * 30 + i), name, checkin, checkout, status: rowStatus })
  }
  return rows
}

export function defaultRoster(g) {
  return isDemoLive(g) ? initialRoster() : buildRoster(g)
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
  return { Morning: '#4C84C4', Afternoon: '#BE6A45' }[session] || '#21314F'
}
export function accentChip(session) {
  return { Morning: ['#DCE8F6', '#2C5C94'], Afternoon: ['#F6E5DD', '#A9572F'] }[session] || ['#E1E6EF', '#21314F']
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
  const today = todayISO()
  const f = from || today, t = to || today
  const lo = f <= t ? f : t, hi = f <= t ? t : f
  return lo <= today && today <= hi
}
export function rangeLabel(from, to) {
  const today = todayISO()
  const f = from || today, t = to || today
  const lo = f <= t ? f : t, hi = f <= t ? t : f
  return lo === hi ? fmtDate(lo) : fmtDate(lo) + ' – ' + fmtDate(hi)
}
