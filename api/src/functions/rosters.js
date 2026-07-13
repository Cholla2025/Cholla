// Rosters — the only place client names exist. One record per
// (date, session, group): partitionKey = date, rowKey = '<session>-<n>',
// `rows` = JSON string of the day's roster.
//
//   GET /api/rosters?date=YYYY-MM-DD — staff auth OR valid kiosk code
//   PUT /api/rosters                 — staff auth OR valid kiosk code
//
// PHI boundary: nothing here is readable anonymously. The kiosk only gets in
// after the facilitator has unlocked it with the day code, and staff only via
// an Entra ID session with an assigned role.

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
const { isStaffOrKiosk } = require('../lib/auth')
const { rostersTable } = require('../lib/storage')

function requireStaffOrKiosk(request, context) {
  if (!isStaffOrKiosk(request, context)) {
    return json(401, { error: 'Sign in as staff or unlock the kiosk to access rosters' })
  }
  return null
}

app.http('rosters-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'rosters',
  handler: guard(async (request, context) => {
    const denied = requireStaffOrKiosk(request, context)
    if (denied) return denied

    const date = request.query.get('date')
    if (!isValidDate(date)) return json(400, { error: 'date query parameter must be YYYY-MM-DD' })

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

app.http('rosters-put', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'rosters',
  handler: guard(async (request, context) => {
    const denied = requireStaffOrKiosk(request, context)
    if (denied) return denied

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
