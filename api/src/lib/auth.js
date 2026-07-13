// AuthN/AuthZ helpers.
//
// Static Web Apps authenticates staff with the built-in Entra ID provider and
// injects the verified identity into every API request as the
// `x-ms-client-principal` header (base64-encoded JSON). That header is set by
// the platform after validating the session cookie — it is the ONLY source of
// truth for roles here. Nothing else the client sends is trusted.
//
// The kiosk is a shared, unauthenticated tablet: it proves itself with the
// facilitator day code in the `x-kiosk-code` header, compared timing-safe
// against the KIOSK_CODE app setting.

const crypto = require('crypto')

const STAFF_ROLES = ['facilitator', 'leader', 'admin']
const LEADER_ROLES = ['leader', 'admin']

// Parse the Static Web Apps client principal header. Returns
// { userId, userDetails, identityProvider, userRoles } or null.
function getPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal')
  if (!header) return null
  try {
    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    if (!principal || typeof principal !== 'object') return null
    if (!Array.isArray(principal.userRoles)) principal.userRoles = []
    return principal
  } catch {
    return null
  }
}

function rolesOf(request) {
  const p = getPrincipal(request)
  return p ? p.userRoles : []
}

// Any signed-in user holding facilitator/leader/admin (assigned via the
// Static Web App's Role management blade — never client-supplied).
function isStaff(request) {
  const roles = rolesOf(request)
  return STAFF_ROLES.some((r) => roles.includes(r))
}

// Leadership-only operations (org structure changes).
function isLeader(request) {
  const roles = rolesOf(request)
  return LEADER_ROLES.some((r) => roles.includes(r))
}

// Timing-safe string comparison. Hashing both sides first means the compare
// runs in constant time regardless of input lengths, so neither length nor
// prefix information leaks through response timing.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

let warnedDefaultCode = false

// Running in Azure vs on a developer machine. WEBSITE_INSTANCE_ID is set by
// the App Service/Functions platform and never by the local func host.
function isLocalDev() {
  return !process.env.WEBSITE_INSTANCE_ID
}

// The configured kiosk day code. FAILS CLOSED in Azure: with no KIOSK_CODE app
// setting the kiosk simply cannot be unlocked (null never matches). The '0000'
// fallback exists only on a local dev machine.
function configuredKioskCode(context) {
  const code = process.env.KIOSK_CODE
  if (code) return code
  if (!warnedDefaultCode) {
    warnedDefaultCode = true
    const warn = context && context.warn ? context.warn.bind(context) : console.warn
    warn(isLocalDev()
      ? '[cholla-api] KIOSK_CODE is not set — using the local-dev default "0000".'
      : '[cholla-api] KIOSK_CODE app setting is not set — kiosk unlock is DISABLED until it is configured.')
  }
  return isLocalDev() ? '0000' : null
}

// ----- kiosk brute-force throttle -----
// The verify endpoint is anonymous and the code space is small, so failed
// attempts are rate limited per client IP and globally. In-memory per
// instance — SWA-managed Functions run few instances, and the window is short
// enough that this meaningfully slows an online guessing attack. Weekly code
// rotation is documented in DEPLOYMENT.md as the second layer.
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES_PER_IP = 10
const MAX_FAILURES_GLOBAL = 100
const failures = new Map() // ip -> [timestamps]
let globalFailures = []

function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0].trim() || 'unknown'
}

function prune(list, now) {
  return list.filter((t) => now - t < WINDOW_MS)
}

// True when this client (or the whole instance) has too many recent failures.
function kioskThrottled(request) {
  const now = Date.now()
  globalFailures = prune(globalFailures, now)
  if (globalFailures.length >= MAX_FAILURES_GLOBAL) return true
  const ip = clientIp(request)
  const list = prune(failures.get(ip) || [], now)
  failures.set(ip, list)
  return list.length >= MAX_FAILURES_PER_IP
}

function registerKioskFailure(request) {
  const now = Date.now()
  const ip = clientIp(request)
  const list = prune(failures.get(ip) || [], now)
  list.push(now)
  failures.set(ip, list)
  globalFailures = prune(globalFailures, now)
  globalFailures.push(now)
  // Bound memory: drop the oldest IPs once the map grows unreasonably.
  if (failures.size > 10000) {
    for (const key of failures.keys()) {
      failures.delete(key)
      if (failures.size <= 5000) break
    }
  }
}

// Did this request carry a valid kiosk day code header?
function hasValidKioskCode(request, context) {
  const sent = request.headers.get('x-kiosk-code')
  if (!sent) return false
  const code = configuredKioskCode(context)
  if (!code) return false
  if (kioskThrottled(request)) return false
  const ok = timingSafeEqual(sent, code)
  if (!ok) registerKioskFailure(request)
  return ok
}

// Staff session OR unlocked kiosk — the two ways to touch rosters.
function isStaffOrKiosk(request, context) {
  return isStaff(request) || hasValidKioskCode(request, context)
}

module.exports = {
  STAFF_ROLES,
  LEADER_ROLES,
  getPrincipal,
  isStaff,
  isLeader,
  timingSafeEqual,
  isLocalDev,
  configuredKioskCode,
  kioskThrottled,
  registerKioskFailure,
  hasValidKioskCode,
  isStaffOrKiosk,
}
