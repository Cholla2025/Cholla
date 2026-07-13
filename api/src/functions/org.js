// Org structure — groups and facilitators.
//
//   GET    /api/org                        — anonymous (kiosk needs group
//                                            names before unlock); facilitator
//                                            emails only for staff
//   POST   /api/org/groups                 — leader/admin
//   DELETE /api/org/groups/{id}            — leader/admin
//   POST   /api/org/groups/{id}/assign     — leader/admin
//   POST   /api/org/facilitators           — leader/admin
//   DELETE /api/org/facilitators/{id}      — leader/admin
//
// Only configuration lives here (group numbers, names, staff assignments) —
// never client data. Rosters are a separate table with stricter access.

const crypto = require('crypto')
const { app } = require('@azure/functions')
const {
  SESSIONS,
  GROUPS_PER_SESSION,
  json,
  noContent,
  guard,
  readJson,
  cleanString,
  isValidSession,
  isValidN,
  isValidId,
} = require('../lib/util')
const { isStaff, requireLeader, requireStaff, hashKioskCode, clearFacilitatorCodeCache, sessionSecret } = require('../lib/auth')
const {
  orgTable,
  groupFromEntity,
  groupToEntity,
  facilitatorFromEntity,
  facilitatorToEntity,
  listOrgEntities,
  findGroupBySessionN,
  getEntity,
  listGroupsByFacilitator,
} = require('../lib/storage')

function sortGroups(groups) {
  return groups.sort((a, b) => {
    const s = SESSIONS.indexOf(a.session) - SESSIONS.indexOf(b.session)
    return s !== 0 ? s : a.n - b.n
  })
}

// First run: seed the standard 20-group schedule (Morning/Afternoon × 1–10).
// Configuration only — facilitators are never seeded; people are added by
// leadership through the dashboard.
async function seedGroups(context) {
  const client = await orgTable()
  const entities = []
  for (const session of SESSIONS) {
    for (let n = 1; n <= GROUPS_PER_SESSION; n++) {
      entities.push({
        partitionKey: 'group',
        rowKey: session.toLowerCase() + '-' + n,
        session,
        n,
        name: session + ' IOP',
        facilitatorId: '',
      })
    }
  }
  try {
    await client.submitTransaction(entities.map((e) => ['create', e]))
    context.log('[cholla-api] seeded ' + entities.length + ' default groups')
    return entities
  } catch (err) {
    // A concurrent first request already seeded (the transaction is atomic, so
    // the loser's whole batch fails with a conflict). Re-read instead of 500ing.
    if (err && (err.statusCode === 409 || err.statusCode === 412)) {
      context.log('[cholla-api] groups were seeded by a concurrent request — re-reading')
      const { groups } = await listOrgEntities()
      return groups
    }
    throw err
  }
}

app.http('org-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'org',
  handler: guard(async (request, context) => {
    const staff = await isStaff(request)
    let { groups, facilitators } = await listOrgEntities()
    if (groups.length === 0) {
      groups = await seedGroups(context)
    }
    return json(200, {
      groups: sortGroups(groups.map(groupFromEntity)),
      facilitators: facilitators
        .map((e) => facilitatorFromEntity(e, staff))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  }),
})

app.http('org-groups-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'org/groups',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const { session } = body
    const n = body.n
    if (!isValidSession(session)) return json(400, { error: 'session must be one of: ' + SESSIONS.join(', ') })
    if (!isValidN(n)) return json(400, { error: 'n must be an integer of at least 1' })

    const name = cleanString(body.name, 80) || session + ' IOP'

    let id = session.toLowerCase() + '-' + n
    if (body.id !== undefined && body.id !== null && body.id !== '') {
      if (!isValidId(body.id)) return json(400, { error: 'id may only contain letters, digits, ".", "_" and "-"' })
      id = body.id
    }

    let facilitatorId = null
    if (body.facilitatorId !== undefined && body.facilitatorId !== null && body.facilitatorId !== '') {
      if (!isValidId(body.facilitatorId)) return json(400, { error: 'facilitatorId is not a valid id' })
      const fac = await getEntity('facilitator', body.facilitatorId)
      if (!fac) return json(400, { error: 'facilitatorId does not match a facilitator' })
      facilitatorId = body.facilitatorId
    }

    let cap
    if (body.cap !== undefined && body.cap !== null) {
      if (!Number.isInteger(body.cap) || body.cap < 1 || body.cap > 200) {
        return json(400, { error: 'cap must be an integer between 1 and 200' })
      }
      cap = body.cap
    }

    const dup = await findGroupBySessionN(session, n)
    if (dup) return json(409, { error: 'Group ' + n + ' already exists in the ' + session + ' session' })

    const group = { id, session, n, name, facilitatorId }
    if (cap !== undefined) group.cap = cap
    const client = await orgTable()
    try {
      await client.createEntity(groupToEntity(group))
    } catch (err) {
      if (err && err.statusCode === 409) return json(409, { error: 'A group with id "' + id + '" already exists' })
      throw err
    }
    return json(201, { group })
  }),
})

app.http('org-groups-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'org/groups/{id}',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid group id' })

    const client = await orgTable()
    try {
      await client.deleteEntity('group', id)
    } catch (err) {
      if (err && err.statusCode === 404) return json(404, { error: 'Group not found' })
      throw err
    }
    return noContent()
  }),
})

app.http('org-groups-assign', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'org/groups/{id}/assign',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid group id' })

    const body = await readJson(request)
    if (!body || !('facilitatorId' in body)) return json(400, { error: 'Body must include facilitatorId (an id or null)' })

    let facilitatorId = null
    if (body.facilitatorId !== null && body.facilitatorId !== '') {
      if (!isValidId(body.facilitatorId)) return json(400, { error: 'facilitatorId is not a valid id' })
      const fac = await getEntity('facilitator', body.facilitatorId)
      if (!fac) return json(400, { error: 'facilitatorId does not match a facilitator' })
      facilitatorId = body.facilitatorId
    }

    const entity = await getEntity('group', id)
    if (!entity) return json(404, { error: 'Group not found' })

    const client = await orgTable()
    await client.updateEntity(
      { partitionKey: 'group', rowKey: id, facilitatorId: facilitatorId || '' },
      'Merge'
    )
    return json(200, { group: groupFromEntity({ ...entity, facilitatorId: facilitatorId || '' }) })
  }),
})

app.http('org-facilitators-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'org/facilitators',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const name = cleanString(body.name, 80)
    if (!name) return json(400, { error: 'name is required' })

    let credential = ''
    if (body.credential !== undefined && body.credential !== null && body.credential !== '') {
      credential = cleanString(body.credential, 40)
      if (!credential) return json(400, { error: 'credential must be a string' })
    }

    let email = ''
    if (body.email !== undefined && body.email !== null && body.email !== '') {
      email = cleanString(body.email, 120)
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(400, { error: 'email must be a valid email address' })
      }
    }

    const facilitator = {
      id: 'f-' + crypto.randomUUID(),
      name,
      credential,
      email,
      active: true,
    }
    const client = await orgTable()
    await client.createEntity(facilitatorToEntity(facilitator))
    return json(201, { facilitator })
  }),
})

// Set, rotate or clear a facilitator's personal 4-digit kiosk code.
// Leadership can manage any facilitator's code; a facilitator may set their
// OWN (matched by the email on their facilitator record). The code is stored
// only as a hash and is never logged or echoed back.
app.http('org-facilitators-code', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'org/facilitators/{id}/code',
  handler: guard(async (request) => {
    const who = await requireStaff(request)
    if (who.status) return who

    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid facilitator id' })
    const entity = await getEntity('facilitator', id)
    if (!entity) return json(404, { error: 'Facilitator not found' })

    const isLeadership = ['leader', 'admin'].includes(who.role)
    const ownRecord =
      typeof who.email === 'string' &&
      who.email &&
      String(entity.email || '').toLowerCase() === who.email.toLowerCase()
    if (!isLeadership && !ownRecord) {
      return json(403, { error: 'You can only manage your own kiosk code' })
    }

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const client = await orgTable()
    if (body.code === null || body.code === '') {
      await client.updateEntity(
        { partitionKey: 'facilitator', rowKey: id, codeHash: '', codeSetAt: '' },
        'Merge'
      )
      clearFacilitatorCodeCache()
      return json(200, { ok: true, hasCode: false })
    }

    if (typeof body.code !== 'string' || !/^\d{4}$/.test(body.code)) {
      return json(400, { error: 'code must be exactly 4 digits' })
    }
    if (!sessionSecret()) {
      return json(503, { error: 'Kiosk codes are not configured (SESSION_SECRET app setting missing)' })
    }
    if (entity.active === false) {
      return json(400, { error: 'Reactivate this facilitator before setting a kiosk code' })
    }

    await client.updateEntity(
      {
        partitionKey: 'facilitator',
        rowKey: id,
        codeHash: hashKioskCode(id, body.code),
        codeSetAt: new Date().toISOString(),
      },
      'Merge'
    )
    clearFacilitatorCodeCache()
    return json(200, { ok: true, hasCode: true })
  }),
})

app.http('org-facilitators-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'org/facilitators/{id}',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid facilitator id' })

    const client = await orgTable()
    try {
      await client.deleteEntity('facilitator', id)
    } catch (err) {
      if (err && err.statusCode === 404) return json(404, { error: 'Facilitator not found' })
      throw err
    }

    // Unassign the deleted facilitator from any groups still pointing at it
    // so the dashboards never show a dangling reference.
    const assigned = await listGroupsByFacilitator(id)
    for (const g of assigned) {
      await client.updateEntity(
        { partitionKey: 'group', rowKey: g.rowKey, facilitatorId: '' },
        'Merge'
      )
    }
    return noContent()
  }),
})
