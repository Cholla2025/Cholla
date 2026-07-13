// AuthN/AuthZ helpers.
//
// Three ways a caller proves who they are:
//
//  1. Entra ID via Static Web Apps — the platform validates the session cookie
//     and injects the verified identity into every API request as the
//     `x-ms-client-principal` header (base64-encoded JSON). Roles come from
//     the Static Web App's Role management blade — never from the client.
//  2. Email one-time-code sign-in — the client presents the compact HMAC
//     session token this API issued after a code verify (functions/auth.js)
//     in the standard `Authorization: Bearer` header. The staff record is
//     re-read on every request, so deactivating an account revokes its
//     outstanding tokens immediately.
//  3. The kiosk — a shared, unauthenticated tablet that proves itself with the
//     facilitator day code in the `x-kiosk-code` header, compared timing-safe
//     against the KIOSK_CODE app setting.

const crypto = require('crypto')
const { json, isValidEmail } = require('./util')
const { getStaffByEmail } = require('./storage')

const STAFF_ROLES = ['facilitator', 'leader', 'admin']
const LEADER_ROLES = ['leader', 'admin']
// When a principal carries several staff roles, the highest one wins.
const ROLE_PRIORITY = ['admin', 'leader', 'facilitator']

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

// Timing-safe string comparison. Hashing both sides first means the compare
// runs in constant time regardless of input lengths, so neither length nor
// prefix information leaks through response timing.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// Running in Azure vs on a developer machine. FAIL-CLOSED: this only says
// "local dev" when the storage connection is missing or points at the Azurite
// emulator AND the platform's WEBSITE_INSTANCE_ID is absent. Neither signal is
// trusted alone (SWA-managed Functions don't always set WEBSITE_INSTANCE_ID),
// so anything ambiguous is treated as production and the dev fallbacks below
// stay off.
function isLocalDev() {
  if (process.env.WEBSITE_INSTANCE_ID) return false
  const conn = process.env.STORAGE_CONNECTION_STRING || ''
  return !conn || conn.includes('UseDevelopmentStorage=true')
}

// ----- email sign-in session tokens -----
// Compact JWT-shaped HMAC tokens built with plain node crypto — no external
// JWT library. The signing secret comes from the SESSION_SECRET app setting;
// the 'cholla-dev-secret' fallback exists ONLY on a local dev machine, so in
// Azure email sign-in FAILS CLOSED until the setting is configured.

const SESSION_TTL_SECONDS = 12 * 60 * 60

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  return isLocalDev() ? 'cholla-dev-secret' : null
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// A signed session token for a verified email sign-in, or null when no
// signing secret is configured.
function issueSessionToken(email, name) {
  const secret = sessionSecret()
  if (!secret) return null
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ sub: email.toLowerCase(), name, iat: now, exp: now + SESSION_TTL_SECONDS }))
  const signature = base64url(crypto.createHmac('sha256', secret).update(header + '.' + payload).digest())
  return header + '.' + payload + '.' + signature
}

// The verified payload of a session token, or null. Signature first (checked
// timing-safe), then expiry — nothing in the payload is trusted before the
// HMAC checks out.
function verifySessionToken(token) {
  const secret = sessionSecret()
  if (!secret || typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest()
  const given = Buffer.from(parts[2], 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) return null
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ----- bootstrap admins -----
// Comma-separated addresses in the ADMIN_EMAILS app setting always resolve to
// the admin role, staff record or not — this is how the first admin gets into
// the staff panel before any records exist.

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function isAdminEmail(email) {
  return typeof email === 'string' && adminEmails().includes(email.toLowerCase())
}

// ----- identity resolution -----

// Who is making this request? Returns { email, name, role, provider } or
// null. `role` may be null: signed in via Entra but holding no staff role and
// matching no staff record — authenticated, but no access.
async function identityOf(request) {
  // 1. Platform-verified Entra principal.
  const principal = getPrincipal(request)
  if (principal) {
    const email = principal.userDetails || ''
    let role = ROLE_PRIORITY.find((r) => principal.userRoles.includes(r)) || null
    let name = email
    if (!role && isValidEmail(email)) {
      // No platform role — an ACTIVE staff record for this address still
      // grants its role, so email-invited staff can also sign in with Entra.
      const record = await getStaffByEmail(email)
      if (record && record.active !== false && STAFF_ROLES.includes(record.role)) {
        role = record.role
        name = record.name || name
      }
    }
    return { email, name, role, provider: 'aad' }
  }

  // 2. Email sign-in bearer token.
  const authorization = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  if (match) {
    const payload = verifySessionToken(match[1].trim())
    if (!payload) return null
    const record = await getStaffByEmail(payload.sub)
    if (isAdminEmail(payload.sub)) {
      // Bootstrap admins always resolve to admin, record or not.
      return {
        email: (record && record.email) || payload.sub,
        name: (record && record.name) || payload.name || payload.sub.split('@')[0],
        role: 'admin',
        provider: 'email',
      }
    }
    // Re-read on every request so deactivating (or deleting) an account
    // revokes its outstanding tokens within one request.
    if (!record || record.active === false || !STAFF_ROLES.includes(record.role)) return null
    return { email: record.email || payload.sub, name: record.name || payload.sub, role: record.role, provider: 'email' }
  }

  return null
}

// ----- route guards -----
// Each returns the resolved identity, or a json() error response the handler
// returns as-is — callers branch on `.status`, which no identity carries.

async function requireStaff(request) {
  const who = await identityOf(request)
  if (!who) return json(401, { error: 'Sign in required' })
  if (!STAFF_ROLES.includes(who.role)) return json(403, { error: 'Staff role required' })
  return who
}

// Leadership-only operations (org structure changes, staff management).
async function requireLeader(request) {
  const who = await identityOf(request)
  if (!who) return json(401, { error: 'Sign in required' })
  if (!LEADER_ROLES.includes(who.role)) return json(403, { error: 'Leadership role required' })
  return who
}

// Any identity holding facilitator/leader/admin — boolean form for handlers
// that only branch on it (org-get email redaction, roster access).
async function isStaff(request) {
  const who = await identityOf(request)
  return Boolean(who && STAFF_ROLES.includes(who.role))
}

async function isLeader(request) {
  const who = await identityOf(request)
  return Boolean(who && LEADER_ROLES.includes(who.role))
}

let warnedDefaultCode = false

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
async function isStaffOrKiosk(request, context) {
  return (await isStaff(request)) || hasValidKioskCode(request, context)
}

module.exports = {
  STAFF_ROLES,
  LEADER_ROLES,
  getPrincipal,
  identityOf,
  requireStaff,
  requireLeader,
  isStaff,
  isLeader,
  adminEmails,
  isAdminEmail,
  sessionSecret,
  issueSessionToken,
  verifySessionToken,
  timingSafeEqual,
  isLocalDev,
  clientIp,
  configuredKioskCode,
  kioskThrottled,
  registerKioskFailure,
  hasValidKioskCode,
  isStaffOrKiosk,
}
