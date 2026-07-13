// Personal alert subscriptions — per staff user, managed from the Analytics
// page, evaluated server-side at day close (the nightly daily-report run).
//
//   GET    /api/alerts      — staff; the caller's OWN subscriptions
//   POST   /api/alerts      — staff; create one subscription:
//                               { type:'group', session, n, threshold }
//                               { type:'client', clientId }
//   DELETE /api/alerts/{id} — staff; delete one of the caller's subscriptions
//
// Scoping: leadership may subscribe to any group or client; facilitators only
// to their OWN groups and to clients assigned to those groups (enforced here,
// not in the UI).
//
// PHI rules: subscriptions store the opaque clientId — never a name. The {id}
// route param is the opaque subscription id. Responses include the client's
// name for display (body only). Alert emails carry client name + missed
// status ONLY (lib/email-templates.js renderMissedClientAlert).

const crypto = require('crypto')
const { app } = require('@azure/functions')
const { SESSIONS, GROUPS_PER_SESSION, json, noContent, guard, readJson, isValidId } = require('../lib/util')
const { requireStaff } = require('../lib/auth')
const { odata } = require('@azure/data-tables')
const {
  alertsTable,
  clientsTable,
  findGroupBySessionN,
  listGroupsForFacilitatorEmail,
} = require('../lib/storage')

const MAX_SUBS_PER_USER = 100

function newSubId() {
  return 's' + crypto.randomBytes(5).toString('hex')
}

function fromEntity(e) {
  const sub = { id: e.rowKey, type: e.type }
  if (e.type === 'group') {
    sub.session = e.session
    sub.n = Number(e.n)
    sub.threshold = Number(e.threshold)
  } else {
    sub.clientId = e.clientId
  }
  return sub
}

// The caller's subscriber key — their lowercase email. Entra identities are
// always email-shaped here; anything else can't subscribe.
function subscriberKey(who) {
  return typeof who.email === 'string' && who.email.includes('@') ? who.email.toLowerCase() : null
}

async function listSubs(email) {
  const client = await alertsTable()
  const out = []
  const iter = client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${email}` } })
  for await (const e of iter) out.push(e)
  return out
}

async function getClientById(id) {
  const client = await clientsTable()
  try {
    return await client.getEntity('client', id)
  } catch (err) {
    if (err && err.statusCode === 404) return null
    throw err
  }
}

app.http('alerts-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'alerts',
  handler: guard(async (request) => {
    const who = await requireStaff(request)
    if (who.status) return who
    const email = subscriberKey(who)
    if (!email) return json(400, { error: 'Your account has no email address to subscribe with' })

    const subs = (await listSubs(email)).map(fromEntity)
    // Join client names for display (response body only — never stored on the
    // subscription, never in a URL).
    const clientSubs = subs.filter((s) => s.type === 'client')
    if (clientSubs.length) {
      for (const s of clientSubs) {
        const c = await getClientById(s.clientId)
        s.clientName = c ? c.name : null
        if (c) {
          s.session = c.session || null
          s.n = c.n === '' || c.n === undefined || c.n === null ? null : Number(c.n)
        }
      }
    }
    return json(200, { subscriptions: subs })
  }),
})

app.http('alerts-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'alerts',
  handler: guard(async (request) => {
    const who = await requireStaff(request)
    if (who.status) return who
    const email = subscriberKey(who)
    if (!email) return json(400, { error: 'Your account has no email address to subscribe with' })

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    const isLeadership = ['leader', 'admin'].includes(who.role)
    const own = isLeadership ? null : await listGroupsForFacilitatorEmail(who.email)
    const inOwn = (session, n) => own === null || own.some((g) => g.session === session && g.n === n)

    const existing = await listSubs(email)
    if (existing.length >= MAX_SUBS_PER_USER) {
      return json(409, { error: 'You have reached the maximum of ' + MAX_SUBS_PER_USER + ' subscriptions' })
    }

    let entity
    if (body.type === 'group') {
      const { session } = body
      const n = Number(body.n)
      if (!SESSIONS.includes(session) || !Number.isInteger(n) || n < 1 || n > GROUPS_PER_SESSION) {
        return json(400, { error: 'A group subscription needs a valid session and group number' })
      }
      const threshold = Number(body.threshold)
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 200) {
        return json(400, { error: 'threshold must be a whole number between 1 and 200' })
      }
      if (!(await findGroupBySessionN(session, n))) {
        return json(400, { error: 'That group does not exist in the current schedule' })
      }
      if (!inOwn(session, n)) {
        return json(403, { error: 'Facilitators can only subscribe to their own assigned groups' })
      }
      const dup = existing.some((e) => e.type === 'group' && e.session === session && Number(e.n) === n)
      if (dup) return json(409, { error: 'You already have an alert for that group' })
      entity = { type: 'group', session, n, threshold }
    } else if (body.type === 'client') {
      if (!isValidId(body.clientId)) return json(400, { error: 'A client subscription needs a clientId' })
      const c = await getClientById(body.clientId)
      if (!c || c.active === false) return json(404, { error: 'Client not found' })
      const session = c.session || null
      const n = c.n === '' || c.n === undefined || c.n === null ? null : Number(c.n)
      if (!session || !Number.isInteger(n)) {
        return json(400, { error: 'That client is not assigned to a group yet — assign them first' })
      }
      if (!inOwn(session, n)) {
        return json(403, { error: 'Facilitators can only subscribe to clients in their own groups' })
      }
      const dup = existing.some((e) => e.type === 'client' && e.clientId === body.clientId)
      if (dup) return json(409, { error: 'You already have an alert for that client' })
      entity = { type: 'client', clientId: body.clientId }
    } else {
      return json(400, { error: "type must be 'group' or 'client'" })
    }

    const sub = { id: newSubId(), ...entity }
    const client = await alertsTable()
    await client.createEntity({
      partitionKey: email,
      rowKey: sub.id,
      type: sub.type,
      session: sub.session || '',
      n: sub.n === undefined ? '' : sub.n,
      threshold: sub.threshold === undefined ? '' : sub.threshold,
      clientId: sub.clientId || '',
      createdAt: new Date().toISOString(),
    })
    return json(201, { subscription: sub })
  }),
})

app.http('alerts-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'alerts/{id}',
  handler: guard(async (request) => {
    const who = await requireStaff(request)
    if (who.status) return who
    const email = subscriberKey(who)
    if (!email) return json(400, { error: 'Your account has no email address to subscribe with' })

    const id = request.params.id
    if (!isValidId(id)) return json(400, { error: 'Invalid subscription id' })

    const client = await alertsTable()
    try {
      // PartitionKey = the caller's own email, so nobody can delete another
      // person's subscription by guessing ids.
      await client.deleteEntity(email, id)
    } catch (err) {
      if (err && err.statusCode === 404) return json(404, { error: 'Subscription not found' })
      throw err
    }
    return noContent()
  }),
})
