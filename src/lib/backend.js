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
  facilitator: ['staff'],
  leader: ['staff', 'leader'],
  admin: ['staff', 'leader'],
}

export function canAccess(role, surface) {
  return (ACCESS[role] || []).includes(surface)
}

const KNOWN_ROLES = ['admin', 'leader', 'facilitator']

export async function getUser() {
  if (!live) {
    // Demo mode: the dashboards are open so the flows can be exercised.
    return { id: 'demo', name: 'Demo Leader', email: 'demo@example.org', role: 'admin' }
  }
  try {
    const res = await fetch('/.auth/me')
    if (!res.ok) return null
    const { clientPrincipal } = await res.json()
    if (!clientPrincipal) return null
    const roles = clientPrincipal.userRoles || []
    const role = KNOWN_ROLES.find((r) => roles.includes(r)) || null
    return {
      id: clientPrincipal.userId,
      name: clientPrincipal.userDetails,
      email: clientPrincipal.userDetails,
      role,
    }
  } catch {
    return null
  }
}

export function loginUrl() {
  return '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname)
}

export function logoutUrl() {
  return '/.auth/logout?post_logout_redirect_uri=/'
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
