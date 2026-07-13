// Backend layer — Microsoft Azure Static Web Apps edition.
//
// The app talks to an Azure Functions API (under /api) backed by Azure Table
// Storage, with staff auth handled by the Static Web Apps built-in Entra ID
// (Azure AD) provider. Everything Azure-specific lives in this file so the UI
// never has to know which backend it is on.
//
// When the API is unreachable (local `npm run dev` with no `swa start`, or a
// static preview), the app runs in DEMO mode: deterministic fictional sample
// data generated client-side, nothing persisted, nothing sent anywhere. This
// is why the repository contains no client information at all — real client
// data only ever exists inside the customer's Azure tenant.

let live = false

export function liveMode() {
  return live
}

// Probe the API once at startup. A Static Web App always serves /api/health
// from the linked Functions app; anywhere else this fails fast and we stay in
// demo mode. SPA hosts answer unknown paths with index.html and a 200, so a
// 200 alone is not proof of an API — insist on the JSON body.
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

export const ACCESS = {
  facilitator: ['staff', 'settings'],
  leader: ['staff', 'leader', 'settings'],
  admin: ['staff', 'leader', 'settings'],
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
  if (!live) {
    // Demo mode: the dashboards are open so the flows can be exercised.
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

export async function verifyKioskCode(code) {
  if (!live) return code === DEMO_KIOSK_CODE
  try {
    const out = await api('/kiosk/verify', { method: 'POST', body: JSON.stringify({ code }) })
    return Boolean(out && out.ok)
  } catch {
    return false
  }
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

export async function fetchRosters(date) {
  if (!live) return {}
  try {
    const out = await api('/rosters?date=' + encodeURIComponent(date))
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
