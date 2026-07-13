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

// The configured kiosk day code. '0000' is ONLY a fallback for local dev when
// the app setting is missing — a deployment without KIOSK_CODE logs a warning
// on every cold start so it gets noticed.
function configuredKioskCode(context) {
  const code = process.env.KIOSK_CODE
  if (code) return code
  if (!warnedDefaultCode) {
    warnedDefaultCode = true
    const warn = context && context.warn ? context.warn.bind(context) : console.warn
    warn('[cholla-api] KIOSK_CODE app setting is not set — falling back to the default "0000". Set KIOSK_CODE before go-live.')
  }
  return '0000'
}

// Did this request carry a valid kiosk day code header?
function hasValidKioskCode(request, context) {
  const sent = request.headers.get('x-kiosk-code')
  if (!sent) return false
  return timingSafeEqual(sent, configuredKioskCode(context))
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
  configuredKioskCode,
  hasValidKioskCode,
  isStaffOrKiosk,
}
