// Rosters — the only place client names exist. One record per
// (date, session, group): partitionKey = date, rowKey = '<session>-<n>',
// `rows` = JSON string of the day's roster.
//
//   GET  /api/rosters?date=YYYY-MM-DD — staff auth, OR kiosk code (today ±1 only)
//   POST /api/rosters/row             — staff auth, OR kiosk code (today ±1 only);
//                                       merges ONE row with optimistic-concurrency
//                                       retries so concurrent devices never wipe
//                                       each other's check-ins
//   PUT  /api/rosters                 — staff auth only; whole-document replace
//
// PHI boundary: nothing here is readable anonymously. The kiosk only gets in
// after the facilitator has unlocked it with the day code — and even then it
// can only touch the current day, never historical rosters.

const { app } = require('@azure/functions')
const { odata } = require('@azure/data-tables')
const {
  SESSIONS,
  json,
  noContent,
  guard,
  readJson,
  isValidSession,
  isValidN,
  isValidDate,
  cleanRosterRows,
} = require('../lib/util')
const { isStaff, hasValidKioskCode } = require('../lib/auth')
const { rostersTable } = require('../lib/storage')

// The clinic's calendar day. Kiosk tablets are trusted only for "today", with
// one day of slack either side so a device with a drifting clock (or one that
// crosses midnight mid-session) doesn't brick check-ins.
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

// Resolve who is asking. Staff (Entra session or email sign-in token) get
// full access; a valid kiosk code gets current-day access only; everyone else
// is turned away.
async function rosterAccess(request, context, date) {
  if (await isStaff(request)) return null
  if (hasValidKioskCode(request, context)) {
    if (!kioskDateAllowed(date)) {
      return json(403, { error: 'The kiosk can only access the current day' })
    }
    return null
  }
  return json(401, { error: 'Sign in as staff or unlock the kiosk to access rosters' })
}

app.http('rosters-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'rosters',
  handler: guard(async (request, context) => {
    const date = request.query.get('date')
    if (!isValidDate(date)) return json(400, { error: 'date query parameter must be YYYY-MM-DD' })
    const denied = await rosterAccess(request, context, date)
    if (denied) return denied

    const client = await rostersTable()
    const rosters = {}
    const iter = client.listEntities({
      queryOptions: { filter: odata`PartitionKey eq ${date}` },
    })
    for await (const e of iter) {
      try {
        const rows = JSON.parse(e.rows)
        if (Array.isArray(rows)) rosters[e.rowKey] = rows
      } catch (err) {
        context.warn('[cholla-api] skipping unreadable roster ' + date + '/' + e.rowKey)
      }
    }
    return json(200, { rosters })
  }),
})

// Merge a single roster row into the (session, n, date) document. Matching is
// by id first, then case-insensitive name; no match appends. The read-merge-
// write cycle retries on ETag conflicts, so a kiosk and a dashboard writing at
// the same moment both land — this is what prevents last-write-wins data loss.
const MERGE_RETRIES = 5

app.http('rosters-row', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'rosters/row',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const { session, n, date } = body
    if (!isValidSession(session)) return json(400, { error: 'session must be one of: ' + SESSIONS.join(', ') })
    if (!isValidN(n)) return json(400, { error: 'n must be an integer of at least 1' })
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })
    const denied = await rosterAccess(request, context, date)
    if (denied) return denied

    const cleaned = cleanRosterRows([body.row])
    if (cleaned.error) return json(400, { error: cleaned.error.replace('rows[0]', 'row') })
    const row = cleaned.rows[0]

    const client = await rostersTable()
    const partitionKey = date
    const rowKey = session + '-' + n

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

      const byId = row.id ? rows.findIndex((r) => r && String(r.id) === String(row.id)) : -1
      const byName = byId < 0
        ? rows.findIndex((r) => r && typeof r.name === 'string' && r.name.trim().toLowerCase() === row.name.toLowerCase())
        : -1
      const i = byId >= 0 ? byId : byName
      if (i >= 0) rows[i] = { ...rows[i], ...row, id: rows[i].id || row.id }
      else rows.push(row)

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
    return json(503, { error: 'Roster is being updated by another device — try again' })
  }),
})

// Whole-document replace. Staff only: destructive by design, so the kiosk day
// code is deliberately not enough here.
app.http('rosters-put', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'rosters',
  handler: guard(async (request, context) => {
    if (!(await isStaff(request))) {
      return json(401, { error: 'Sign in as staff to replace a roster' })
    }

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const { session, n, date } = body
    if (!isValidSession(session)) return json(400, { error: 'session must be one of: ' + SESSIONS.join(', ') })
    if (!isValidN(n)) return json(400, { error: 'n must be an integer of at least 1' })
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })

    const cleaned = cleanRosterRows(body.rows)
    if (cleaned.error) return json(400, { error: cleaned.error })

    const client = await rostersTable()
    await client.upsertEntity(
      {
        partitionKey: date,
        rowKey: session + '-' + n,
        rows: JSON.stringify(cleaned.rows),
      },
      'Replace'
    )
    return noContent()
  }),
})
