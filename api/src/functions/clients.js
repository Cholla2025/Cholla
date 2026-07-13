// Client roster management — the clinic's master client list.
//
//   GET  /api/clients                 — staff: the full list. Kiosk code: MUST
//                                       scope with ?session&n and receives only
//                                       that group's ACTIVE clients (id + name),
//                                       mirroring its roster access.
//   POST /api/clients                 — leader/admin: bulk or single add with
//                                       case-insensitive dedupe (duplicates are
//                                       reported, never silently double-added)
//   POST /api/clients/{id}            — leader/admin: rename, (re/un)assign to
//                                       a session+group, activate/deactivate
//                                       (soft delete — client rows are PHI and
//                                       are never hard-deleted from the UI)
//
// PHI rules: client names travel ONLY in POST bodies and response bodies over
// the staff/kiosk-authenticated API — never in URLs (the {id} route param is
// an opaque server-generated id) and never echoed inside error messages.

const crypto = require('crypto')
const { app } = require('@azure/functions')
const {
  SESSIONS,
  GROUPS_PER_SESSION,
  json,
  guard,
  readJson,
  cleanString,
  isValidId,
} = require('../lib/util')
const { isStaff, requireLeader, hasValidKioskCode } = require('../lib/auth')
const { clientsTable, findGroupBySessionN } = require('../lib/storage')

const PK = 'client'
const MAX_BULK = 500
const MAX_CLIENTS = 2000
const NAME_RE = /^[\p{L}][\p{L} .,'’-]*$/u

// Short opaque id — fits every row-id limit in the system (rosters cap at 40).
function newClientId() {
  return 'c' + crypto.randomBytes(5).toString('hex') // c + 10 hex chars
}

function fromEntity(e) {
  return {
    id: e.rowKey,
    name: e.name,
    session: e.session || null,
    n: e.n === '' || e.n === undefined || e.n === null ? null : Number(e.n),
    active: e.active !== false,
  }
}

function toEntity(c) {
  return {
    partitionKey: PK,
    rowKey: c.id,
    name: c.name,
    session: c.session || '',
    n: c.n === null || c.n === undefined ? '' : c.n,
    active: c.active !== false,
    createdAt: c.createdAt || new Date().toISOString(),
  }
}

async function listClients() {
  const client = await clientsTable()
  const out = []
  const { odata } = require('@azure/data-tables')
  for await (const e of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${PK}` } })) {
    out.push(fromEntity(e))
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Validate a client name without ever echoing the submitted value back.
function cleanName(raw) {
  const name = cleanString(raw, 60)
  if (!name || name.length < 2 || !NAME_RE.test(name)) return null
  return name
}

// Validate an assignment. Returns { session, n } (nulls = unassigned) or
// { error }. Group must actually exist in the org schedule.
async function cleanAssignment(session, n) {
  if (!session && (n === null || n === undefined || n === '')) return { session: null, n: null }
  if (!SESSIONS.includes(session)) return { error: 'session must be one of: ' + SESSIONS.join(', ') + ' (or empty to unassign)' }
  const num = Number(n)
  if (!Number.isInteger(num) || num < 1 || num > GROUPS_PER_SESSION) {
    return { error: 'n must be a group number between 1 and ' + GROUPS_PER_SESSION }
  }
  const group = await findGroupBySessionN(session, num)
  if (!group) return { error: 'That group does not exist in the current schedule' }
  return { session, n: num }
}

app.http('clients-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'clients',
  handler: guard(async (request, context) => {
    if (await isStaff(request)) {
      return json(200, { clients: await listClients() })
    }
    // Kiosk: only the active clients of ONE group, so the tablet can match
    // and pre-fill names for the group it is running — same visibility it
    // already has through that group's roster.
    if (hasValidKioskCode(request, context)) {
      const session = request.query.get('session')
      const n = Number(request.query.get('n'))
      if (!SESSIONS.includes(session) || !Number.isInteger(n) || n < 1 || n > GROUPS_PER_SESSION) {
        return json(400, { error: 'The kiosk must request one group: ?session=Morning&n=1' })
      }
      const clients = (await listClients()).filter(
        (c) => c.active && c.session === session && c.n === n
      )
      return json(200, { clients: clients.map((c) => ({ id: c.id, name: c.name })) })
    }
    return json(401, { error: 'Sign in as staff or unlock the kiosk to read the client list' })
  }),
})

app.http('clients-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'clients',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const body = await readJson(request)
    if (!body || !Array.isArray(body.entries)) {
      return json(400, { error: 'Body must include entries: [{ name, session?, n? }]' })
    }
    if (body.entries.length < 1) return json(400, { error: 'entries is empty' })
    if (body.entries.length > MAX_BULK) {
      return json(400, { error: 'entries exceeds the maximum of ' + MAX_BULK + ' per request' })
    }

    const existing = await listClients()
    if (existing.length + body.entries.length > MAX_CLIENTS) {
      return json(409, { error: 'The client list is limited to ' + MAX_CLIENTS + ' entries' })
    }
    const seen = new Set(existing.map((c) => c.name.toLowerCase()))

    const added = []
    const duplicates = []
    let invalid = 0
    const client = await clientsTable()

    for (const entry of body.entries) {
      const name = cleanName(entry && entry.name)
      if (!name) { invalid++; continue }
      const key = name.toLowerCase()
      if (seen.has(key)) { duplicates.push(name); continue }

      let assignment = { session: null, n: null }
      if (entry.session || entry.n) {
        const a = await cleanAssignment(entry.session, entry.n)
        if (a.error) return json(400, { error: a.error })
        assignment = a
      }

      const record = { id: newClientId(), name, ...assignment, active: true }
      await client.createEntity(toEntity(record))
      seen.add(key)
      added.push(record)
    }

    return json(added.length ? 201 : 200, { added, duplicates, invalid })
  }),
})

app.http('clients-update', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'clients/{id}',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid client id' })

    const client = await clientsTable()
    let entity
    try {
      entity = await client.getEntity(PK, id)
    } catch (err) {
      if (err && err.statusCode === 404) return json(404, { error: 'Client not found' })
      throw err
    }
    const current = fromEntity(entity)

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const next = { ...current }

    if (body.name !== undefined) {
      const name = cleanName(body.name)
      if (!name) return json(400, { error: 'name must be 2–60 letters, spaces, or . , \' -' })
      // Renaming onto another client's name would create a silent duplicate.
      if (name.toLowerCase() !== current.name.toLowerCase()) {
        const clash = (await listClients()).some(
          (c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase()
        )
        if (clash) return json(409, { error: 'Another client already has that name' })
      }
      next.name = name
    }

    if (body.session !== undefined || body.n !== undefined) {
      const a = await cleanAssignment(
        body.session === undefined ? current.session : body.session,
        body.n === undefined ? current.n : body.n
      )
      if (a.error) return json(400, { error: a.error })
      next.session = a.session
      next.n = a.n
    }

    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') return json(400, { error: 'active must be true or false' })
      next.active = body.active
    }

    await client.updateEntity(toEntity({ ...next, createdAt: entity.createdAt }), 'Replace')
    return json(200, { client: next })
  }),
})
