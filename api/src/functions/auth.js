// Email one-time-code sign-in.
//
//   POST /api/auth/request-code — anonymous; emails a 6-digit code to active
//                                 staff (or bootstrap admins), but ALWAYS
//                                 answers { ok: true } for a well-formed
//                                 address so account existence never leaks
//   POST /api/auth/verify-code  — anonymous; swaps a correct code for a
//                                 12-hour HMAC session token
//   GET  /api/auth/me           — whoami for the signed-in identity
//   POST /api/auth/profile      — staff; update the caller's own display name
//
// Codes live in the org table (partitionKey 'logincode', rowKey = lowercase
// email — one active code per address), stored only as sha256(email|code|
// secret), expire after 10 minutes, and allow 5 verify attempts. The code is
// NEVER logged and never stored in the clear.

const crypto = require('crypto')
const { app } = require('@azure/functions')
const { json, guard, readJson, cleanString, isValidEmail } = require('../lib/util')
const {
  identityOf,
  requireStaff,
  isAdminEmail,
  sessionSecret,
  issueSessionToken,
  timingSafeEqual,
  isLocalDev,
  clientIp,
} = require('../lib/auth')
const {
  orgTable,
  getEntity,
  getStaffByEmail,
  staffFromEntity,
  staffToEntity,
} = require('../lib/storage')
const { acsConfigured, sendEmail } = require('../lib/mailer')

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_VERIFY_ATTEMPTS = 5

// ----- code-request throttle -----
// Same in-memory pattern as the kiosk throttle in lib/auth.js, but a separate
// set of maps: code REQUESTS (not failures) are counted per email, per IP and
// globally — every accepted request can send an email, so this also caps
// outbound mail abuse.
const WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_EMAIL = 5
const MAX_REQUESTS_PER_IP = 10
const MAX_REQUESTS_GLOBAL = 200
const requestsByEmail = new Map() // lowercase email -> [timestamps]
const requestsByIp = new Map() // ip -> [timestamps]
let globalRequests = []

function prune(list, now) {
  return list.filter((t) => now - t < WINDOW_MS)
}

function codeRequestThrottled(request, email) {
  const now = Date.now()
  globalRequests = prune(globalRequests, now)
  if (globalRequests.length >= MAX_REQUESTS_GLOBAL) return true
  const ipList = prune(requestsByIp.get(clientIp(request)) || [], now)
  if (ipList.length >= MAX_REQUESTS_PER_IP) return true
  const emailList = prune(requestsByEmail.get(email) || [], now)
  return emailList.length >= MAX_REQUESTS_PER_EMAIL
}

function registerCodeRequest(request, email) {
  const now = Date.now()
  globalRequests.push(now)
  const ip = clientIp(request)
  requestsByIp.set(ip, [...prune(requestsByIp.get(ip) || [], now), now])
  requestsByEmail.set(email, [...prune(requestsByEmail.get(email) || [], now), now])
  // Bound memory the same way the kiosk throttle does.
  for (const map of [requestsByIp, requestsByEmail]) {
    if (map.size > 10000) {
      for (const key of map.keys()) {
        map.delete(key)
        if (map.size <= 5000) break
      }
    }
  }
}

// ----- code hashing + delivery -----

// Codes are never stored in the clear: sha256(email|code|secret). Mixing in
// the signing secret means a leaked table dump cannot be brute-forced offline
// against the million-code space without also holding the app setting.
function hashCode(email, code) {
  return crypto.createHash('sha256').update(email + '|' + code + '|' + sessionSecret()).digest('hex')
}

// Send the code via Azure Communication Services (lib/mailer.js — lazy SDK
// load, nothing logged). The code and the message body stay out of the logs.
async function sendCodeEmail(email, code) {
  await sendEmail({
    to: [email],
    subject: 'Your Cholla sign-in code',
    text:
      'Your Cholla sign-in code is: ' + code + '\n\n' +
      'It expires in 10 minutes. If you did not request this code, you can ignore this email.',
    html:
      '<p>Your Cholla sign-in code is:</p>' +
      '<p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:16px 0">' + code + '</p>' +
      '<p>It expires in 10 minutes. If you did not request this code, you can ignore this email.</p>',
  })
}

app.http('auth-request-code', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/request-code',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body || !isValidEmail(body.email)) {
      return json(400, { error: 'Body must include a valid email address' })
    }
    // Fail closed in Azure: without the signing secret no code could ever be
    // verified, and without ACS no code could be delivered. Both checks run
    // before the account lookup so the answer never depends on whether the
    // address exists.
    if (!sessionSecret()) {
      return json(503, { error: 'Email sign-in is not configured (SESSION_SECRET app setting missing)' })
    }
    if (!acsConfigured() && !isLocalDev()) {
      return json(503, { error: 'Email sign-in is not configured' })
    }

    const email = body.email.trim()
    const lower = email.toLowerCase()
    if (codeRequestThrottled(request, lower)) {
      context.warn('[cholla-api] login code request throttled')
      return json(429, { error: 'Too many code requests — wait a few minutes and try again' })
    }
    registerCodeRequest(request, lower)

    // Only ACTIVE staff (or bootstrap admins) actually get a code — but the
    // response is identical either way, so nothing enumerates accounts.
    const record = await getStaffByEmail(lower)
    const eligible = (record && record.active !== false) || isAdminEmail(lower)
    if (!eligible) return json(200, { ok: true })

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
    const now = new Date()
    const client = await orgTable()
    // Replace = a single active code per address; requesting again voids the
    // previous code and resets the attempt counter.
    await client.upsertEntity(
      {
        partitionKey: 'logincode',
        rowKey: lower,
        codeHash: hashCode(lower, code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
        attempts: 0,
        createdAt: now.toISOString(),
      },
      'Replace'
    )

    if (!acsConfigured()) {
      // Local dev with no email service: hand the code straight back so the
      // sign-in flow works end to end. Unreachable in Azure (503 above).
      return json(200, { ok: true, devCode: code })
    }
    await sendCodeEmail(email, code)
    return json(200, { ok: true })
  }),
})

app.http('auth-verify-code', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/verify-code',
  handler: guard(async (request) => {
    const body = await readJson(request)
    if (!body || !isValidEmail(body.email) || typeof body.code !== 'string' || body.code.length > 16) {
      return json(400, { error: 'Body must include email and code' })
    }
    if (!sessionSecret()) {
      return json(503, { error: 'Email sign-in is not configured (SESSION_SECRET app setting missing)' })
    }

    const lower = body.email.trim().toLowerCase()
    // One generic failure answer — never reveals whether the address, the
    // code, or the expiry was the problem.
    const failed = () => json(401, { error: 'Code is incorrect or expired — request a new one' })

    const entry = await getEntity('logincode', lower)
    if (!entry) return failed()
    const attempts = Number(entry.attempts) || 0
    if (attempts >= MAX_VERIFY_ATTEMPTS) return failed()
    if (!entry.expiresAt || new Date(entry.expiresAt).getTime() <= Date.now()) return failed()

    const client = await orgTable()
    if (!timingSafeEqual(hashCode(lower, body.code.trim()), String(entry.codeHash))) {
      // Count the miss so the 6-digit space cannot be walked online.
      await client.updateEntity(
        { partitionKey: 'logincode', rowKey: lower, attempts: attempts + 1 },
        'Merge'
      )
      return failed()
    }

    // Success — codes are single-use.
    await client.deleteEntity('logincode', lower)

    let record = await getStaffByEmail(lower)
    if (!record && isAdminEmail(lower)) {
      // Bootstrap admin with no staff record yet: create one so they appear
      // in the staff panel like everyone else.
      record = staffToEntity({ email: body.email.trim(), name: lower.split('@')[0], role: 'admin', active: true })
      await client.upsertEntity(record, 'Replace')
    }
    if (!record) return failed()
    if (record.active === false && !isAdminEmail(lower)) {
      return json(403, { error: 'This account has been deactivated' })
    }

    const user = staffFromEntity(record)
    if (isAdminEmail(lower)) user.role = 'admin'
    const token = issueSessionToken(lower, user.name)
    return json(200, { ok: true, token, user: { email: user.email, name: user.name, role: user.role } })
  }),
})

app.http('auth-me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: guard(async (request) => {
    const who = await identityOf(request)
    if (!who) return json(401, { error: 'Not signed in' })
    return json(200, { user: { email: who.email, name: who.name, role: who.role, provider: who.provider } })
  }),
})

app.http('auth-profile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/profile',
  handler: guard(async (request) => {
    const who = await requireStaff(request)
    if (who.status) return who
    // An Entra identity is keyed by userDetails — it must be email-shaped to
    // become a staff rowKey.
    if (!isValidEmail(who.email)) {
      return json(400, { error: 'Your account has no email address to store a profile against' })
    }

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })
    const name = cleanString(body.name, 80)
    if (!name) return json(400, { error: 'name is required' })

    // Callers may only rename THEMSELVES; role and active are preserved. An
    // Entra user with no record yet gets one created at their resolved role.
    const existing = await getStaffByEmail(who.email)
    const staff = existing
      ? { ...staffFromEntity(existing), name }
      : { email: who.email, name, role: who.role, active: true }
    const client = await orgTable()
    await client.upsertEntity(staffToEntity(staff), 'Replace')
    return json(200, { user: { email: staff.email, name: staff.name, role: staff.role } })
  }),
})
