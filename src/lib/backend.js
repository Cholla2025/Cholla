// Backend layer — Microsoft Azure Static Web Apps edition.
//
// The app talks to an Azure Functions API (under /api) backed by Azure Table
// Storage, with staff auth handled by the Static Web Apps built-in Entra ID
// (Azure AD) provider. Everything Azure-specific lives in this file so the UI
// never has to know which backend it is on.
//
// DEMO MODE IS DEV-ONLY. When the API is unreachable during local `npm run
// dev`, the app runs on deterministic fictional sample data so the flows can
// be exercised. In a PRODUCTION build (import.meta.env.DEV === false) demo
// mode is impossible: an unreachable API renders honest empty/error states,
// never mock data — nothing fictional can ever appear on a clinic screen.
export const DEMO_ALLOWED = import.meta.env.DEV

let live = false
let down = false

export function liveMode() {
  return live
}

// True when the production build could not reach its API — the UI shows a
// connection banner instead of silently empty dashboards.
export function backendDown() {
  return down
}

// Probe the API once at startup. A Static Web App always serves /api/health
// from the linked Functions app; anywhere else this fails fast. SPA hosts
// answer unknown paths with index.html and a 200, so a 200 alone is not proof
// of an API — insist on the JSON body.
export async function initBackend() {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 3000)
    const res = await fetch('/api/health', { signal: ctl.signal, headers: { Accept: 'application/json' } })
    clearTimeout(t)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) {
      live = false
    } else {
      const body = await res.json()
      live = Boolean(body && body.ok)
    }
  } catch {
    live = false
  }
  if (!live && !DEMO_ALLOWED) {
    // Production with no reachable API: stay in LIVE code paths (so every
    // surface talks to the real API and reports real failures) — demo data is
    // not a fallback outside dev.
    live = true
    down = true
  }
  return live
}

// ---------------------------------------------------------------------------
// Auth — Static Web Apps built-in Entra ID.
//
// Roles are assigned in the Azure portal (Static Web App → Role management):
// invite each staff member as `facilitator`, `leader`, or `admin`. A signed-in
// user with none of those roles gets role `null` and sees an "access pending"
// screen — nobody reads client data just by having a Microsoft account.
// ---------------------------------------------------------------------------

// Top-level surfaces by role. Facilitators get their dashboard and Member
// Check-In only — no Community surface (the API enforces the same 403).
export const ACCESS = {
  facilitator: ['staff', 'member', 'settings'],
  leader: ['staff', 'member', 'community', 'leader', 'analytics', 'settings', 'ai'],
  admin: ['staff', 'member', 'community', 'leader', 'analytics', 'settings', 'adminportal', 'ai'],
}

export function canAccess(role, surface) {
  return (ACCESS[role] || []).includes(surface)
}

// ----- email-code session token -----
// Issued by /api/auth/verify-code, signed server-side, held only in this
// browser. Sent as a Bearer header; the API re-checks the staff record on
// every request so deactivating an account revokes access immediately.

const TOKEN_KEY = 'cholla-session'

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* private mode — session lasts the tab */ }
}

// Who is signed in right now? The API resolves BOTH paths — the platform's
// Entra ID principal (cookie) and our email-code Bearer token — and returns
// the effective role, so the client never computes authorization itself.
export async function getUser() {
  if (!live && DEMO_ALLOWED) {
    // Dev-only demo mode: the dashboards are open so the flows can be exercised.
    return { id: 'demo', name: 'Demo Leader', email: 'demo@example.org', role: 'admin', provider: 'demo' }
  }
  try {
    const headers = { Accept: 'application/json' }
    const token = getToken()
    if (token) headers.Authorization = 'Bearer ' + token
    const res = await fetch('/api/auth/me', { headers })
    if (!res.ok) {
      if (res.status === 401) setToken(null) // stale/expired token
      return null
    }
    const { user } = await res.json()
    if (!user) return null
    return { id: user.email, name: user.name, email: user.email, role: user.role || null, provider: user.provider }
  } catch {
    return null
  }
}

// Ask the server to email a 6-digit sign-in code. Always resolves ok for a
// well-formed email (the server never reveals which addresses exist). In
// local dev with no email service the code comes back as devCode.
export async function requestLoginCode(email) {
  return api('/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) })
}

// Exchange the emailed code for a 12-hour session. Stores the token and
// returns { email, name, role } — throws with a friendly message otherwise.
export async function verifyLoginCode(email, code) {
  const out = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) })
  if (out && out.token) setToken(out.token)
  return out ? out.user : null
}

export async function updateProfile(name) {
  const out = await api('/auth/profile', { method: 'POST', body: JSON.stringify({ name }) })
  return out ? out.user : null
}

// ----- staff sign-in accounts (Settings → Admin / Team) -----

export async function fetchStaffAccounts() {
  if (!live) return { staff: [], adminEmails: ['demo-admin@example.org'] }
  return api('/staff')
}

export async function upsertStaffAccount(rec) {
  if (!live) return { staff: rec }
  return api('/staff', { method: 'POST', body: JSON.stringify(rec) })
}

export async function removeStaffAccount(email) {
  if (!live) return null
  return api('/staff/' + encodeURIComponent(email), { method: 'DELETE' })
}

export function loginUrl() {
  return '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname)
}

export function logoutUrl() {
  return '/.auth/logout?post_logout_redirect_uri=/'
}

// End whichever kind of session is active. Email-code sessions live in this
// browser only; Microsoft sessions must round-trip the platform logout.
export function signOut(provider) {
  setToken(null)
  if (provider === 'aad') window.location.href = logoutUrl()
  else window.location.reload()
}

// ---------------------------------------------------------------------------
// API plumbing. The kiosk is a shared, unauthenticated device: after the
// facilitator unlocks it with the day code, every kiosk request carries that
// code in a header and the API validates it server-side.
// ---------------------------------------------------------------------------

let kioskCode = null

export function setKioskCode(code) {
  kioskCode = code
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (kioskCode) headers['x-kiosk-code'] = kioskCode
  const token = getToken()
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch('/api' + path, { ...opts, headers })
  if (!res.ok) {
    let msg = 'Request failed (' + res.status + ')'
    try {
      const body = await res.json()
      if (body && body.error) msg = body.error
    } catch { /* keep default message */ }
    throw new Error(msg)
  }
  return res.status === 204 ? null : res.json()
}

// ---------------------------------------------------------------------------
// Kiosk unlock — the facilitator day code is verified server-side; the code
// itself lives in an Azure app setting, never in this repository.
// ---------------------------------------------------------------------------

export const DEMO_KIOSK_CODE = '0000'

// Verify a kiosk code. Resolves to { ok, facilitator? } — `facilitator` is
// set ({id, name}) when a facilitator's personal code (rather than the admin
// master code) unlocked the kiosk.
export async function verifyKioskCode(code) {
  if (!live) return { ok: code === DEMO_KIOSK_CODE }
  try {
    const out = await api('/kiosk/verify', { method: 'POST', body: JSON.stringify({ code }) })
    return out && out.ok ? { ok: true, facilitator: out.facilitator || null } : { ok: false }
  } catch {
    return { ok: false }
  }
}

// Set, rotate or clear a facilitator's personal kiosk code (leadership, or
// the facilitator's own record). The code travels once in this POST body and
// is stored server-side as a hash only.
export async function setFacilitatorCode(id, code) {
  return api('/org/facilitators/' + encodeURIComponent(id) + '/code', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// ---------------------------------------------------------------------------
// Org structure — groups and facilitators. Managed from the Leadership
// dashboard; readable by the kiosk (group names only, never rosters).
// ---------------------------------------------------------------------------

export async function fetchOrg() {
  if (!live) return null
  return api('/org')
}

export async function addGroup(group) {
  if (!live) return { group: { ...group, id: 'demo-g-' + group.session + '-' + group.n } }
  return api('/org/groups', { method: 'POST', body: JSON.stringify(group) })
}

export async function removeGroup(id) {
  if (!live) return null
  return api('/org/groups/' + encodeURIComponent(id), { method: 'DELETE' })
}

export async function assignFacilitator(groupId, facilitatorId) {
  if (!live) return null
  return api('/org/groups/' + encodeURIComponent(groupId) + '/assign', {
    method: 'POST',
    body: JSON.stringify({ facilitatorId: facilitatorId || null }),
  })
}

export async function addFacilitator(fac) {
  if (!live) return { facilitator: { ...fac, id: 'demo-f-' + (fac.name || '').toLowerCase().replace(/\W+/g, '-') } }
  return api('/org/facilitators', { method: 'POST', body: JSON.stringify(fac) })
}

export async function removeFacilitator(id) {
  if (!live) return null
  return api('/org/facilitators/' + encodeURIComponent(id), { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Rosters — one record per (session, group, date), the full day's roster as
// a JSON document. This is the only place client names exist, and it lives in
// Azure Table Storage inside the customer's tenant.
// ---------------------------------------------------------------------------

// `scope` ({session, n}) is REQUIRED for kiosk callers: an unlocked kiosk is
// scoped server-side to the one group it is running and never receives other
// groups' rows. Staff sessions omit it and get the whole day.
export async function fetchRosters(date, scope) {
  if (!live) return {}
  try {
    const qs = scope && scope.session
      ? '&session=' + encodeURIComponent(scope.session) + '&n=' + encodeURIComponent(scope.n)
      : ''
    const out = await api('/rosters?date=' + encodeURIComponent(date) + qs)
    return out && out.rosters ? out.rosters : {}
  } catch (err) {
    console.warn('[cholla] could not load rosters:', err.message)
    return {}
  }
}

// Merge ONE row into the server's copy of a roster. The server does a
// read-merge-write with conflict retries, so a kiosk and a dashboard writing
// at the same moment never wipe each other's check-ins. Returns the merged
// rows array; THROWS on failure — callers must surface the error rather than
// show a false "checked in" confirmation.
export async function saveRosterRow(session, n, date, row) {
  if (!live) return null
  const out = await api('/rosters/row', { method: 'POST', body: JSON.stringify({ session, n, date, row }) })
  return out && Array.isArray(out.rows) ? out.rows : null
}

// Whole-document replace (staff only server-side). Not used by the normal
// check-in flows — those go through saveRosterRow so writes merge.
export async function saveRoster(session, n, date, rows) {
  if (!live) return
  await api('/rosters', { method: 'PUT', body: JSON.stringify({ session, n, date, rows }) })
}

// ---------------------------------------------------------------------------
// Member Check-In log — clients in the facility. A separate table from the group
// rosters; date-keyed, so the list starts fresh every clinic day. Access
// mirrors rosters: staff any date, unlocked kiosk today only.
// ---------------------------------------------------------------------------

export async function fetchDoorRows(date) {
  if (!live) return null
  try {
    const out = await api('/frontdoor?date=' + encodeURIComponent(date))
    return out && Array.isArray(out.rows) ? out.rows : []
  } catch (err) {
    console.warn('[cholla] could not load member check-in log:', err.message)
    return null
  }
}

// Merge ONE member check-in row (same conflict-safe merge as rosters). Throws on
// failure so the door kiosk never shows a false welcome.
export async function saveDoorRow(date, row) {
  if (!live) return null
  const out = await api('/frontdoor/row', { method: 'POST', body: JSON.stringify({ date, row }) })
  return out && Array.isArray(out.rows) ? out.rows : null
}

// ---------------------------------------------------------------------------
// Reports & alerts (leader/admin). Previews return the same HTML the emailed
// report uses; send-now goes to the REPORT_EMAILS recipients immediately.
// ---------------------------------------------------------------------------

export async function previewReport(period, date) {
  if (!live) return null
  return api('/reports/preview?period=' + encodeURIComponent(period) + (date ? '&date=' + encodeURIComponent(date) : ''))
}

export async function sendReportNow(period, date) {
  if (!live) return { ok: true, wouldSend: ['(demo mode — nothing sent)'] }
  return api('/reports/send', { method: 'POST', body: JSON.stringify(date ? { period, date } : { period }) })
}

// ---------------------------------------------------------------------------
// Client list — the clinic's master roster. Names travel only in request and
// response BODIES; the update route uses the opaque server-generated id.
// ---------------------------------------------------------------------------

export async function fetchClients() {
  if (!live) return null
  try {
    const out = await api('/clients')
    return out && Array.isArray(out.clients) ? out.clients : []
  } catch (err) {
    console.warn('[cholla] could not load the client list') // never log names
    return null
  }
}

// Bulk/single add. entries: [{name, session?, n?}]. Returns
// { added, duplicates, invalid } — duplicates are reported, never re-added.
export async function addClients(entries) {
  if (!live) {
    return { added: entries.map((e, i) => ({ id: 'demo-c' + Date.now() + i, ...e, session: e.session || null, n: e.n || null, active: true })), duplicates: [], invalid: 0 }
  }
  return api('/clients', { method: 'POST', body: JSON.stringify({ entries }) })
}

export async function updateClient(id, patch) {
  if (!live) return { client: { id, ...patch } }
  const out = await api('/clients/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(patch) })
  return out
}

// Kiosk: the active clients of ONE group (post-unlock), for name matching.
export async function fetchGroupClients(session, n) {
  if (!live) return null
  try {
    const out = await api('/clients?session=' + encodeURIComponent(session) + '&n=' + encodeURIComponent(n))
    return out && Array.isArray(out.clients) ? out.clients : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Visitor log — non-client, non-staff people on site. Separate table, same
// access rules and midnight reset as the Member Check-In log — but reads are
// LEADERSHIP-only on the staff side (facilitators get a 403).
// ---------------------------------------------------------------------------

export async function fetchVisitorRows(date) {
  if (!live) return null
  try {
    const out = await api('/visitors?date=' + encodeURIComponent(date))
    return out && Array.isArray(out.rows) ? out.rows : []
  } catch (err) {
    console.warn('[cholla] could not load visitor log:', err.message)
    return null
  }
}

export async function saveVisitorRow(date, row) {
  if (!live) return null
  const out = await api('/visitors/row', { method: 'POST', body: JSON.stringify({ date, row }) })
  return out && Array.isArray(out.rows) ? out.rows : null
}

// Autocomplete data for the visitor form: recent companies + the staff /
// facilitator directory (the Microsoft-backed accounts) for "visiting".
export async function fetchVisitorOptions() {
  if (!live) {
    return DEMO_ALLOWED
      ? {
        companies: ['Desert Sky Supplies', 'Maricopa Health Partners', 'Family'],
        people: ['D. Alvarez, LISAC', 'R. Okafor, LPC', 'Ruth Okafor, Clinical Director', 'S. Tran, LCSW'],
      }
      : { companies: [], people: [] }
  }
  try {
    return await api('/visitors/options')
  } catch {
    return { companies: [], people: [] }
  }
}

// ---------------------------------------------------------------------------
// AI assistant (leader/admin). The server builds the model's context from
// de-identified aggregates only — client names never reach the AI.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Analytics (leader/admin) — aggregate trends for the Analytics page. Three
// separate streams (groups / member / community), counts only, no names.
// ---------------------------------------------------------------------------

export async function fetchAnalytics(days) {
  if (!live) return null
  return api('/analytics?days=' + encodeURIComponent(days || 30))
}

// ----- personal alert subscriptions (Analytics page) -----

export async function fetchAlertSubs() {
  if (!live) return { subscriptions: [] }
  return api('/alerts')
}

export async function createAlertSub(sub) {
  if (!live) return { subscription: { id: 'demo-s1', ...sub } }
  return api('/alerts', { method: 'POST', body: JSON.stringify(sub) })
}

export async function deleteAlertSub(id) {
  if (!live) return null
  return api('/alerts/' + encodeURIComponent(id), { method: 'DELETE' })
}

// ----- Microsoft 365 directory (leader/admin) -----
// People from the tenant, for autofilling staff/facilitator forms. Returns
// null when the directory is not configured/available — pickers simply don't
// render then.

export async function fetchDirectory() {
  if (!live) {
    return { users: [{ name: 'Demo Person', email: 'demo.person@example.org' }] }
  }
  try {
    const out = await api('/directory')
    return out && Array.isArray(out.users) ? out : null
  } catch {
    return null
  }
}

// ----- community visitor pre-registration -----

// PUBLIC route (the /preregister page) — no auth of any kind.
export async function submitPreregistration(payload) {
  if (!live) return { ok: true }
  const res = await fetch('/api/preregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let msg = 'Could not submit (' + res.status + ')'
    try {
      const body = await res.json()
      if (body && body.error) msg = body.error
    } catch { /* keep default */ }
    throw new Error(msg)
  }
  return res.json()
}

// Front-desk queue (leadership or unlocked kiosk).
export async function fetchPreregistrations(date) {
  if (!live) return []
  try {
    const out = await api('/preregister?date=' + encodeURIComponent(date))
    return out && Array.isArray(out.entries) ? out.entries : []
  } catch {
    return null
  }
}

export async function confirmPreregistration(id, date, extras) {
  return api('/preregister/' + encodeURIComponent(id) + '/confirm', {
    method: 'POST',
    body: JSON.stringify({ date, ...extras }),
  })
}

export async function cancelPreregistration(id, date) {
  return api('/preregister/' + encodeURIComponent(id) + '/cancel', {
    method: 'POST',
    body: JSON.stringify({ date }),
  })
}

// ----- reports configuration (read-only recipients list) -----

export async function fetchReportConfig() {
  if (!live) return { recipients: [], alertDropPct: 5, alertCriticalPct: 10 }
  try {
    return await api('/reports/config')
  } catch {
    return null
  }
}

export async function askAi(question, history) {
  if (!live) {
    await new Promise((r) => setTimeout(r, 400))
    return {
      answer:
        'Preview build — the live assistant answers from your real attendance data once the backend and its API key are connected. A real answer looks like this:\n\n' +
        '**Attendance is up 6.4% this week** (312 group check-ins vs 293 last week).\n\n' +
        '| Group | This week | Last week | Trend |\n|---|---|---|---|\n| Morning 3 | 58 | 49 | ▲ +18% |\n| Afternoon 1 | 44 | 47 | ▼ −6% |\n| Afternoon 7 | 31 | 38 | ▼ −18% |\n\n' +
        'Afternoon 7 has declined two days running — it will trigger a Volume Alert if the slide continues.',
      model: 'preview',
    }
  }
  return api('/ai/ask', { method: 'POST', body: JSON.stringify(history && history.length ? { question, history } : { question }) })
}
