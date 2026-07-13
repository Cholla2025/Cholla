// Front-door check-in log — who is in the building right now. One record per
// clinic day: partitionKey = date, rowKey = 'door', `rows` = JSON string of
// the day's visits ({id, name, in, out, status}).
//
//   GET  /api/frontdoor?date=YYYY-MM-DD — staff auth, OR kiosk code (today ±1 only)
//   POST /api/frontdoor/row             — staff auth, OR kiosk code (today ±1 only);
//                                         merges ONE visit with the same
//                                         optimistic-concurrency retries as
//                                         rosters, so concurrent devices never
//                                         wipe each other's entries
//
// PHI boundary: identical to rosters — nothing here is readable anonymously,
// and the kiosk can only touch the current day, never historical logs.

const { app } = require('@azure/functions')
const { json, guard, readJson, isValidDate, cleanString } = require('../lib/util')
const { isStaff, hasValidKioskCode } = require('../lib/auth')
const { frontdoorTable } = require('../lib/storage')

const DOOR_STATUSES = ['In Facility', 'Departed']
// One entity holds the whole day as a JSON string, and Table Storage caps a
// string property at 64KB — 500 visits of ~90 bytes each stays well inside.
const MAX_DOOR_ROWS = 500
const DOOR_ROW_KEY = 'door'

// The clinic's calendar day — same rule as rosters: kiosk tablets are trusted
// only for "today", with one day of slack either side for drifting clocks and
// sessions that cross midnight.
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

// Resolve who is asking — cloned from rosters: staff get full access, a valid
// kiosk code gets current-day access only, everyone else is turned away.
async function doorAccess(request, context, date) {
  if (await isStaff(request)) return null
  if (await hasValidKioskCode(request, context)) {
    if (!kioskDateAllowed(date)) {
      return json(403, { error: 'The kiosk can only access the current day' })
    }
    return null
  }
  return json(401, { error: 'Sign in as staff or unlock the kiosk to access the front-door log' })
}

// Validate + sanitize a single front-door row. Returns { row } or { error }.
// Names are stricter than roster names (2–40 chars, letters/spaces/.'’- only)
// because visitors type their own — this is the anti-garbage filter.
function cleanDoorRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'row must be an object' }
  const name = cleanString(r.name, 40)
  if (!name || name.length < 2 || !/^[\p{L}][\p{L} .'’-]*$/u.test(name)) {
    return { error: "row.name must be 2–40 characters of letters, spaces, or . ' -" }
  }
  if (!DOOR_STATUSES.includes(r.status)) {
    return { error: 'row.status must be one of: ' + DOOR_STATUSES.join(', ') }
  }
  let id = null
  if (r.id !== undefined && r.id !== null) {
    id = cleanString(String(r.id), 12)
    if (!id) return { error: 'row.id must be a non-empty string when present' }
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
  return { row: { id, name, in: tIn, out: tOut, status: r.status } }
}

app.http('frontdoor-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'frontdoor',
  handler: guard(async (request, context) => {
    const date = request.query.get('date') || clinicToday()
    if (!isValidDate(date)) return json(400, { error: 'date query parameter must be YYYY-MM-DD' })
    const denied = await doorAccess(request, context, date)
    if (denied) return denied

    const client = await frontdoorTable()
    let entity = null
    try {
      entity = await client.getEntity(date, DOOR_ROW_KEY)
    } catch (err) {
      if (!err || err.statusCode !== 404) throw err
    }
    let rows = []
    if (entity) {
      try {
        const parsed = JSON.parse(entity.rows)
        if (Array.isArray(parsed)) rows = parsed
      } catch {
        context.warn('[cholla-api] skipping unreadable front-door log ' + date)
      }
    }
    return json(200, { date, rows })
  }),
})

// Merge a single visit into the day's log. Matching is by case-insensitive
// trimmed name; a match replaces that row, no match appends. Same read-merge-
// write retry loop as rosters-row, so a kiosk and a dashboard writing at the
// same moment both land.
const MERGE_RETRIES = 5

app.http('frontdoor-row', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'frontdoor/row',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const { date } = body
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })
    const denied = await doorAccess(request, context, date)
    if (denied) return denied

    const cleaned = cleanDoorRow(body.row)
    if (cleaned.error) return json(400, { error: cleaned.error })
    const row = cleaned.row

    const client = await frontdoorTable()
    const partitionKey = date
    const rowKey = DOOR_ROW_KEY

    for (let attempt = 0; attempt < MERGE_RETRIES; attempt++) {
      let entity = null
      try {
        entity = await client.getEntity(partitionKey, rowKey)
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
        (r) => r && typeof r.name === 'string' && r.name.trim().toLowerCase() === row.name.toLowerCase()
      )
      if (i >= 0) rows[i] = { ...row, id: row.id || rows[i].id || null }
      else {
        if (rows.length >= MAX_DOOR_ROWS) {
          return json(409, { error: 'Front-door log is full for today' })
        }
        rows.push(row)
      }

      try {
        if (entity) {
          await client.updateEntity(
            { partitionKey, rowKey, rows: JSON.stringify(rows) },
            'Replace',
            { etag: entity.etag }
          )
        } else {
          await client.createEntity({ partitionKey, rowKey, rows: JSON.stringify(rows) })
        }
        return json(200, { rows })
      } catch (err) {
        // 412 = someone else wrote between our read and write; 409 = the
        // document was created underneath us. Both mean: re-read and re-merge.
        if (err && (err.statusCode === 412 || err.statusCode === 409)) continue
        throw err
      }
    }
    return json(503, { error: 'Front-door log is being updated by another device — try again' })
  }),
})
