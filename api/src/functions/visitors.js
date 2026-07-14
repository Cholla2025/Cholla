// Visitor check-in log — non-client, non-staff people entering the facility.
// One record per clinic day: partitionKey = date, rowKey = 'log', `rows` =
// JSON string of the day's visitors ({id, first, last, phone, email, company,
// visiting, reason, hipaa, in, out, status}).
//
//   GET  /api/visitors?date=YYYY-MM-DD — staff auth, OR kiosk code (today ±1)
//   POST /api/visitors/row             — staff auth, OR kiosk code (today ±1);
//                                        same name-merge + ETag retry as the
//                                        front-door log
//   GET  /api/visitors/options         — staff or unlocked kiosk; autocomplete
//                                        data for the kiosk form: recent
//                                        visitor companies + staff/facilitator
//                                        names for "person you're visiting"
//
// PHI boundary: visitors are not clients, but the form is deliberately shaped
// so no client information can enter it — "Visiting a client" is a reason
// option with NO client-name field, and every check-in requires the HIPAA
// confidentiality acknowledgment (hipaa: true is enforced server-side).

const { app } = require('@azure/functions')
const { json, guard, readJson, isValidDate, cleanString } = require('../lib/util')
const { identityOf, hasValidKioskCode } = require('../lib/auth')
const { visitorsTable, listOrgEntities, listStaff } = require('../lib/storage')

const VISITOR_STATUSES = ['On Site', 'Departed']
// One entity holds the whole day as a JSON string (64KB property cap);
// visitor rows are bigger than door rows (~220 bytes), so cap lower.
const MAX_VISITOR_ROWS = 250
const LOG_ROW_KEY = 'log'
const NAME_RE = /^[\p{L}][\p{L} .'’-]*$/u

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

// Community Check-In data is a separate stream from anything client-related.
// LEADERSHIP ONLY on the staff side — facilitators have no community surface
// and get a hard 403. The kiosk keeps its code-gated current-day access so
// visitors can check themselves in at the desk.
async function visitorAccess(request, context, date) {
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
  return json(401, { error: 'Sign in as leadership or unlock the kiosk to access the Community Check-In log' })
}

// Validate + sanitize one visitor row. Check-ins (no `out` time) must carry
// the HIPAA acknowledgment; checkouts of an existing row keep the original.
function cleanVisitorRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'row must be an object' }

  const first = cleanString(r.first, 40)
  const last = cleanString(r.last, 40)
  if (!first || !NAME_RE.test(first)) return { error: 'First name is required (letters only)' }
  if (!last || !NAME_RE.test(last)) return { error: 'Last name is required (letters only)' }

  const phoneDigits = String(r.phone || '').replace(/\D/g, '')
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return { error: 'A phone number is required (7–15 digits)' }
  }
  const phone = cleanString(String(r.phone), 24)

  let email = ''
  if (r.email !== undefined && r.email !== null && r.email !== '') {
    email = cleanString(String(r.email), 120)
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: 'Email must be a valid address (or left blank)' }
    }
  }

  const company = cleanString(r.company, 80)
  if (!company) return { error: 'The company or organization you work with is required' }

  const visiting = cleanString(r.visiting, 80) || ''
  const reason = cleanString(r.reason, 80)
  if (!reason) return { error: 'A reason for the visit is required' }

  if (!VISITOR_STATUSES.includes(r.status)) {
    return { error: 'row.status must be one of: ' + VISITOR_STATUSES.join(', ') }
  }

  let tIn = null
  if (r.in !== undefined && r.in !== null) {
    tIn = cleanString(r.in, 10)
    if (!tIn) return { error: 'row.in must be a string or null' }
  }
  let tOut = null
  if (r.out !== undefined && r.out !== null) {
    tOut = cleanString(r.out, 10)
    if (!tOut) return { error: 'row.out must be a string or null' }
  }

  // The attestation is the gate for ENTERING the site: required whenever the
  // row represents someone on site (fresh check-in or still-present update).
  if (r.hipaa !== true && !tOut) {
    return { error: 'The HIPAA confidentiality acknowledgment must be accepted to check in' }
  }

  let id = null
  if (r.id !== undefined && r.id !== null) {
    id = cleanString(String(r.id), 12)
    if (!id) return { error: 'row.id must be a non-empty string when present' }
  }

  return {
    row: {
      id, first, last, phone, email, company, visiting, reason,
      hipaa: r.hipaa === true,
      in: tIn, out: tOut, status: r.status,
    },
  }
}

app.http('visitors-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'visitors',
  handler: guard(async (request, context) => {
    const date = request.query.get('date') || clinicToday()
    if (!isValidDate(date)) return json(400, { error: 'date query parameter must be YYYY-MM-DD' })
    const denied = await visitorAccess(request, context, date)
    if (denied) return denied

    const client = await visitorsTable()
    let entity = null
    try {
      entity = await client.getEntity(date, LOG_ROW_KEY)
    } catch (err) {
      if (!err || err.statusCode !== 404) throw err
    }
    let rows = []
    if (entity) {
      try {
        const parsed = JSON.parse(entity.rows)
        if (Array.isArray(parsed)) rows = parsed
      } catch {
        context.warn('[cholla-api] skipping unreadable visitor log ' + date)
      }
    }
    return json(200, { date, rows })
  }),
})

const MERGE_RETRIES = 5

app.http('visitors-row', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'visitors/row',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const { date } = body
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })
    const denied = await visitorAccess(request, context, date)
    if (denied) return denied

    const cleaned = cleanVisitorRow(body.row)
    if (cleaned.error) return json(400, { error: cleaned.error })
    const row = cleaned.row
    const fullName = (row.first + ' ' + row.last).toLowerCase()

    const client = await visitorsTable()
    for (let attempt = 0; attempt < MERGE_RETRIES; attempt++) {
      let entity = null
      try {
        entity = await client.getEntity(date, LOG_ROW_KEY)
      } catch (err) {
        if (!err || err.statusCode !== 404) throw err
      }

      let rows = []
      if (entity) {
        try {
          const parsed = JSON.parse(entity.rows)
          if (Array.isArray(parsed)) rows = parsed
        } catch {
          rows = []
        }
      }

      const i = rows.findIndex(
        (r) => r && ((r.first + ' ' + r.last).trim().toLowerCase() === fullName)
      )
      if (i >= 0) rows[i] = { ...row, id: row.id || rows[i].id || null, hipaa: row.hipaa || rows[i].hipaa === true }
      else {
        if (rows.length >= MAX_VISITOR_ROWS) {
          return json(409, { error: 'Visitor log is full for today' })
        }
        rows.push(row)
      }

      try {
        if (entity) {
          await client.updateEntity(
            { partitionKey: date, rowKey: LOG_ROW_KEY, rows: JSON.stringify(rows) },
            'Replace',
            { etag: entity.etag }
          )
        } else {
          await client.createEntity({ partitionKey: date, rowKey: LOG_ROW_KEY, rows: JSON.stringify(rows) })
        }
        return json(200, { rows })
      } catch (err) {
        if (err && (err.statusCode === 412 || err.statusCode === 409)) continue
        throw err
      }
    }
    return json(503, { error: 'Visitor log is being updated by another device — try again' })
  }),
})

// Autocomplete data for the kiosk form. Companies come from the last 60 days
// of visitor logs (most recent first, de-duped); people are the active
// facilitators and staff sign-in accounts — the Microsoft-backed directory.
const OPTIONS_LOOKBACK_DAYS = 60
const MAX_COMPANIES = 50

app.http('visitors-options', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'visitors/options',
  handler: guard(async (request, context) => {
    const denied = await visitorAccess(request, context, null)
    if (denied) return denied

    const from = clinicToday(-OPTIONS_LOOKBACK_DAYS)
    const companies = []
    const seen = new Set()
    const client = await visitorsTable()
    const { odata } = require('@azure/data-tables')
    const filter = odata`PartitionKey ge ${from}`
    const entities = []
    for await (const e of client.listEntities({ queryOptions: { filter } })) entities.push(e)
    entities.sort((a, b) => (a.partitionKey < b.partitionKey ? 1 : -1))
    for (const e of entities) {
      try {
        for (const r of JSON.parse(e.rows)) {
          const c = r && cleanString(r.company, 80)
          if (c && !seen.has(c.toLowerCase())) {
            seen.add(c.toLowerCase())
            companies.push(c)
            if (companies.length >= MAX_COMPANIES) break
          }
        }
      } catch { /* unreadable day — skip */ }
      if (companies.length >= MAX_COMPANIES) break
    }

    const people = new Set()
    const { facilitators } = await listOrgEntities()
    for (const f of facilitators) {
      if (f.active !== false && f.name) people.add(f.name)
    }
    try {
      for (const s of await listStaff()) {
        if (s.active !== false && s.name) people.add(s.name)
      }
    } catch (err) {
      context.warn('[cholla-api] visitor options: staff list unavailable')
    }

    return json(200, { companies, people: [...people].sort() })
  }),
})
