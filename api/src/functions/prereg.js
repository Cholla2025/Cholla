// Community visitor pre-registration — NON-CLIENTS ONLY, kept in its own
// table entirely separate from anything client-related.
//
//   POST /api/preregister              — PUBLIC (anonymous, write-only). A
//                                        visitor registers an upcoming visit:
//                                        name, date, purpose, optional host/
//                                        company/phone. Hardened: per-IP and
//                                        global rate limits, strict validation,
//                                        length caps, per-day row cap — and the
//                                        public route can never read anything
//                                        back (the response is { ok } only).
//   GET  /api/preregister?date=…       — leader/admin, OR kiosk code (today ±1):
//                                        the front-desk confirmation queue.
//   POST /api/preregister/{id}/confirm — leader/admin or kiosk (today ±1):
//                                        converts a pre-registration into a
//                                        normal Community Check-In row (HIPAA
//                                        acknowledgment collected at the desk,
//                                        enforced here like every check-in).
//   POST /api/preregister/{id}/cancel  — leader/admin or kiosk: mark no-show/
//                                        cancelled so the queue stays clean.
//
// Facilitators have NO access to any of this — it is community data.
// PHI rules apply to visitors too: names travel in POST bodies, the {id}
// route param is an opaque server-generated id, and names are never logged.

const crypto = require('crypto')
const { app } = require('@azure/functions')
const { json, guard, readJson, isValidDate, isValidId, cleanString } = require('../lib/util')
const { identityOf, hasValidKioskCode, clientIp } = require('../lib/auth')
const { preregTable, visitorsTable } = require('../lib/storage')

const NAME_RE = /^[\p{L}][\p{L} .'’-]*$/u
const MAX_PER_DAY = 200
const DAYS_AHEAD_MAX = 60
const STATUSES = ['pending', 'arrived', 'cancelled']

const DEFAULT_TZ = 'America/Phoenix'

function clinicToday(offsetDays = 0) {
  const tz = process.env.CLINIC_TIMEZONE || DEFAULT_TZ
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ }).format(d)
  }
}

function kioskDateAllowed(date) {
  return [clinicToday(-1), clinicToday(0), clinicToday(1)].includes(date)
}

// ----- public-route rate limit -----
// Same in-memory pattern as the kiosk throttle: per-IP and global caps on
// SUBMISSIONS (not failures) — this route is anonymous and public.
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_IP = 5
const MAX_GLOBAL = 100
const byIp = new Map()
let globalHits = []

function prune(list, now) {
  return list.filter((t) => now - t < WINDOW_MS)
}

function preregThrottled(request) {
  const now = Date.now()
  globalHits = prune(globalHits, now)
  if (globalHits.length >= MAX_GLOBAL) return true
  const ip = clientIp(request)
  const list = prune(byIp.get(ip) || [], now)
  byIp.set(ip, list)
  return list.length >= MAX_PER_IP
}

function registerPrereg(request) {
  const now = Date.now()
  globalHits.push(now)
  const ip = clientIp(request)
  byIp.set(ip, [...prune(byIp.get(ip) || [], now), now])
  if (byIp.size > 10000) {
    for (const key of byIp.keys()) {
      byIp.delete(key)
      if (byIp.size <= 5000) break
    }
  }
}

// Staff-side access: leadership always; kiosk for the current day only;
// facilitators explicitly 403 (community data).
async function deskAccess(request, context, date) {
  const who = await identityOf(request)
  if (who && ['leader', 'admin'].includes(who.role)) return null
  if (who && who.role === 'facilitator') {
    return json(403, { error: 'Community Check-In is available to leadership only' })
  }
  if (await hasValidKioskCode(request, context)) {
    if (date && !kioskDateAllowed(date)) {
      return json(403, { error: 'The kiosk can only access the current day' })
    }
    return null
  }
  return json(401, { error: 'Sign in as leadership or unlock the kiosk to access pre-registrations' })
}

function fromEntity(e) {
  return {
    id: e.rowKey,
    date: e.partitionKey,
    first: e.first,
    last: e.last,
    company: e.company || '',
    phone: e.phone || '',
    purpose: e.purpose,
    host: e.host || '',
    status: STATUSES.includes(e.status) ? e.status : 'pending',
  }
}

app.http('prereg-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'preregister',
  handler: guard(async (request, context) => {
    if (preregThrottled(request)) {
      context.warn('[cholla-api] pre-registration throttled')
      return json(429, { error: 'Too many requests — please try again later or check in at the front desk' })
    }

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const first = cleanString(body.first, 40)
    const last = cleanString(body.last, 40)
    if (!first || !NAME_RE.test(first)) return json(400, { error: 'First name is required (letters only)' })
    if (!last || !NAME_RE.test(last)) return json(400, { error: 'Last name is required (letters only)' })

    const date = body.date
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })
    if (date < clinicToday() || date > clinicToday(DAYS_AHEAD_MAX)) {
      return json(400, { error: 'The visit date must be today or within the next ' + DAYS_AHEAD_MAX + ' days' })
    }

    const purpose = cleanString(body.purpose, 80)
    if (!purpose) return json(400, { error: 'The purpose of the visit is required' })
    const host = body.host ? cleanString(body.host, 80) : ''
    const company = body.company ? cleanString(body.company, 80) : ''

    let phone = ''
    if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
      const digits = String(body.phone).replace(/\D/g, '')
      if (digits.length < 7 || digits.length > 15) {
        return json(400, { error: 'Phone must be 7–15 digits (or left blank)' })
      }
      phone = cleanString(String(body.phone), 24)
    }

    const client = await preregTable()
    // Per-day cap so the public route cannot flood a date.
    const { odata } = require('@azure/data-tables')
    let count = 0
    for await (const e of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${date}`, select: ['rowKey'] } })) {
      count++
      if (count >= MAX_PER_DAY) break
    }
    if (count >= MAX_PER_DAY) {
      return json(429, { error: 'Pre-registration for that date is full — please check in at the front desk' })
    }

    registerPrereg(request)
    await client.createEntity({
      partitionKey: date,
      rowKey: 'p' + crypto.randomBytes(5).toString('hex'),
      first,
      last,
      company,
      phone,
      purpose,
      host: host || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
    // Write-only by design: the public route never reads anything back.
    return json(201, { ok: true })
  }),
})

app.http('prereg-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'preregister',
  handler: guard(async (request, context) => {
    const date = request.query.get('date') || clinicToday()
    if (!isValidDate(date)) return json(400, { error: 'date query parameter must be YYYY-MM-DD' })
    const denied = await deskAccess(request, context, date)
    if (denied) return denied

    const client = await preregTable()
    const { odata } = require('@azure/data-tables')
    const out = []
    for await (const e of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${date}` } })) {
      out.push(fromEntity(e))
    }
    out.sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first))
    return json(200, { date, entries: out })
  }),
})

// Confirm arrival: convert the pre-registration into a normal Community
// Check-In row. The HIPAA acknowledgment is collected at the desk and a phone
// number is required — the same gate every walk-in visitor passes.
const MERGE_RETRIES = 5

app.http('prereg-confirm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'preregister/{id}/confirm',
  handler: guard(async (request, context) => {
    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid pre-registration id' })

    const body = await readJson(request)
    if (!body || !isValidDate(body.date)) return json(400, { error: 'Body must include the visit date' })
    const date = body.date
    const denied = await deskAccess(request, context, date)
    if (denied) return denied

    const client = await preregTable()
    let entity
    try {
      entity = await client.getEntity(date, id)
    } catch (err) {
      if (err && err.statusCode === 404) return json(404, { error: 'Pre-registration not found' })
      throw err
    }
    const entry = fromEntity(entity)
    if (entry.status === 'arrived') return json(409, { error: 'This visitor has already been checked in' })

    if (body.hipaa !== true) {
      return json(400, { error: 'The HIPAA confidentiality acknowledgment must be accepted to check in' })
    }
    let phone = entry.phone
    if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
      phone = cleanString(String(body.phone), 24)
    }
    const digits = String(phone || '').replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) {
      return json(400, { error: 'A phone number is required (7–15 digits)' })
    }

    const time = cleanString(body.in, 10) || new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.CLINIC_TIMEZONE || DEFAULT_TZ,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())

    const row = {
      id: 'v' + crypto.randomBytes(4).toString('hex'),
      first: entry.first,
      last: entry.last,
      phone,
      email: '',
      company: entry.company || 'Pre-registered visitor',
      visiting: entry.host || '',
      reason: entry.purpose,
      hipaa: true,
      in: time,
      out: null,
      status: 'On Site',
    }
    const fullName = (row.first + ' ' + row.last).toLowerCase()

    // Same name-merge + ETag retry as visitors-row so a concurrent kiosk
    // check-in never gets wiped.
    const vClient = await visitorsTable()
    let merged = false
    for (let attempt = 0; attempt < MERGE_RETRIES && !merged; attempt++) {
      let vEntity = null
      try {
        vEntity = await vClient.getEntity(date, 'log')
      } catch (err) {
        if (!err || err.statusCode !== 404) throw err
      }
      let rows = []
      if (vEntity) {
        try {
          const parsed = JSON.parse(vEntity.rows)
          if (Array.isArray(parsed)) rows = parsed
        } catch {
          rows = []
        }
      }
      const i = rows.findIndex((r) => r && ((r.first + ' ' + r.last).trim().toLowerCase() === fullName))
      if (i >= 0) rows[i] = { ...row, id: rows[i].id || row.id }
      else rows.push(row)
      try {
        if (vEntity) {
          await vClient.updateEntity(
            { partitionKey: date, rowKey: 'log', rows: JSON.stringify(rows) },
            'Replace',
            { etag: vEntity.etag }
          )
        } else {
          await vClient.createEntity({ partitionKey: date, rowKey: 'log', rows: JSON.stringify(rows) })
        }
        merged = true
      } catch (err) {
        if (err && (err.statusCode === 412 || err.statusCode === 409)) continue
        throw err
      }
    }
    if (!merged) return json(503, { error: 'Visitor log is being updated by another device — try again' })

    await client.updateEntity({ partitionKey: date, rowKey: id, status: 'arrived' }, 'Merge')
    return json(200, { ok: true, entry: { ...entry, status: 'arrived' } })
  }),
})

app.http('prereg-cancel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'preregister/{id}/cancel',
  handler: guard(async (request, context) => {
    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid pre-registration id' })
    const body = await readJson(request)
    if (!body || !isValidDate(body.date)) return json(400, { error: 'Body must include the visit date' })
    const denied = await deskAccess(request, context, body.date)
    if (denied) return denied

    const client = await preregTable()
    try {
      await client.updateEntity({ partitionKey: body.date, rowKey: id, status: 'cancelled' }, 'Merge')
    } catch (err) {
      if (err && err.statusCode === 404) return json(404, { error: 'Pre-registration not found' })
      throw err
    }
    return json(200, { ok: true })
  }),
})
