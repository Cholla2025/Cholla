// Shared constants + small HTTP/validation helpers for every handler.
//
// This API guards PHI (client names on rosters), so validation is strict:
// every string that reaches storage is sanitized, every enum is checked
// against a closed list, and anything unexpected is rejected with a 400.

const SESSIONS = ['Morning', 'Afternoon']
const GROUPS_PER_SESSION = 10
const ROW_STATUSES = ['Checked In', 'Checked Out', 'Expected', 'Late', 'Absent']
const MAX_ROSTER_ROWS = 200

// JSON response helper — every response body this API produces goes through
// here so the shape is always { ...data } or { error }.
function json(status, body) {
  return { status, jsonBody: body }
}

function noContent() {
  return { status: 204 }
}

// Wrap a handler so unexpected failures become a clean 500 and never leak
// internals (stack traces, connection strings) to the client.
function guard(fn) {
  return async (request, context) => {
    try {
      return await fn(request, context)
    } catch (err) {
      context.error('[cholla-api] unhandled error:', err && err.stack ? err.stack : err)
      return json(500, { error: 'Internal server error' })
    }
  }
}

// Parse a JSON request body; null when missing/invalid (caller returns 400).
async function readJson(request) {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

// Strip control characters, collapse whitespace, trim, and cap length.
function cleanString(v, max) {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.slice(0, max)
}

function isValidSession(session) {
  return SESSIONS.includes(session)
}

function isValidN(n) {
  return Number.isInteger(n) && n >= 1 && n <= 99
}

function isValidDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map((x) => parseInt(x, 10))
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2200) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// Table Storage row keys may not contain / \ # ? or control chars; we are
// stricter still and only accept slug-shaped ids.
function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)
}

// Email shape check that ALSO rejects the four characters Table Storage
// forbids in row keys (/ \ # ?) — staff row keys are lowercase emails, so an
// address that passes here is always a legal rowKey.
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 120 && /^[^\s@/\\#?]+@[^\s@/\\#?]+\.[^\s@/\\#?]+$/.test(email)
}

// Validate + sanitize a roster rows array. Returns { rows } on success or
// { error } describing the first problem found. Unknown properties are
// dropped — only the five known fields are ever stored.
function cleanRosterRows(rows) {
  if (!Array.isArray(rows)) return { error: 'rows must be an array' }
  if (rows.length > MAX_ROSTER_ROWS) return { error: 'rows exceeds maximum of ' + MAX_ROSTER_ROWS }
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'rows[' + i + '] must be an object' }
    const name = cleanString(r.name, 120)
    if (!name) return { error: 'rows[' + i + '].name is required' }
    if (!ROW_STATUSES.includes(r.status)) return { error: 'rows[' + i + '].status must be one of: ' + ROW_STATUSES.join(', ') }
    let id = null
    if (r.id !== undefined && r.id !== null) {
      id = cleanString(String(r.id), 40)
      if (!id) return { error: 'rows[' + i + '].id must be a non-empty string when present' }
    }
    let checkin = null
    if (r.checkin !== undefined && r.checkin !== null) {
      checkin = cleanString(r.checkin, 20)
      if (!checkin) return { error: 'rows[' + i + '].checkin must be a string or null' }
    }
    let checkout = null
    if (r.checkout !== undefined && r.checkout !== null) {
      checkout = cleanString(r.checkout, 20)
      if (!checkout) return { error: 'rows[' + i + '].checkout must be a string or null' }
    }
    out.push({ id, name, checkin, checkout, status: r.status })
  }
  return { rows: out }
}

module.exports = {
  SESSIONS,
  GROUPS_PER_SESSION,
  ROW_STATUSES,
  MAX_ROSTER_ROWS,
  json,
  noContent,
  guard,
  readJson,
  cleanString,
  isValidSession,
  isValidN,
  isValidDate,
  isValidId,
  isValidEmail,
  cleanRosterRows,
}
