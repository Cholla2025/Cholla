// Azure Table Storage access, shared by all handlers.
//
// Two tables, auto-created on first use:
//   org     — partitionKey 'group' | 'facilitator', rowKey = id
//   rosters — partitionKey = date (YYYY-MM-DD), rowKey = '<session>-<n>',
//             property `rows` = JSON string of the day's roster
//
// Connection comes from the STORAGE_CONNECTION_STRING app setting, falling
// back to AzureWebJobsStorage (already present on every Functions app).

const { TableClient, odata } = require('@azure/data-tables')

const ORG_TABLE = 'org'
const ROSTERS_TABLE = 'rosters'

const clients = {}
const ensured = {}

function connectionString() {
  const conn = process.env.STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage
  if (!conn) {
    throw new Error('No storage connection string configured — set STORAGE_CONNECTION_STRING (or AzureWebJobsStorage)')
  }
  return conn
}

// A TableClient for the named table, creating the table on first use.
// allowInsecureConnection permits the http:// endpoints Azurite uses in local
// dev (UseDevelopmentStorage=true); real Azure endpoints are always https.
async function table(name) {
  if (!clients[name]) {
    clients[name] = TableClient.fromConnectionString(connectionString(), name, {
      allowInsecureConnection: true,
    })
  }
  if (!ensured[name]) {
    try {
      await clients[name].createTable()
    } catch (err) {
      if (!err || err.statusCode !== 409) throw err
    }
    ensured[name] = true
  }
  return clients[name]
}

function orgTable() {
  return table(ORG_TABLE)
}

function rostersTable() {
  return table(ROSTERS_TABLE)
}

// ----- entity <-> API shape mapping -----

function groupFromEntity(e) {
  const g = {
    id: e.rowKey,
    session: e.session,
    n: Number(e.n),
    name: e.name,
    facilitatorId: e.facilitatorId || null,
  }
  if (e.cap !== undefined && e.cap !== null && e.cap !== '') g.cap = Number(e.cap)
  return g
}

function groupToEntity(g) {
  const e = {
    partitionKey: 'group',
    rowKey: g.id,
    session: g.session,
    n: g.n,
    name: g.name,
    facilitatorId: g.facilitatorId || '',
  }
  if (g.cap !== undefined && g.cap !== null) e.cap = g.cap
  return e
}

// `includeEmail` gates PHI-adjacent contact info: only authenticated staff
// ever see facilitator emails (the anonymous kiosk gets names only).
function facilitatorFromEntity(e, includeEmail) {
  const f = {
    id: e.rowKey,
    name: e.name,
    credential: e.credential || '',
    active: e.active !== false,
  }
  if (includeEmail) f.email = e.email || ''
  return f
}

function facilitatorToEntity(f) {
  return {
    partitionKey: 'facilitator',
    rowKey: f.id,
    name: f.name,
    credential: f.credential || '',
    email: f.email || '',
    active: f.active !== false,
  }
}

// ----- queries -----

async function listOrgEntities() {
  const client = await orgTable()
  const groups = []
  const facilitators = []
  for await (const e of client.listEntities()) {
    if (e.partitionKey === 'group') groups.push(e)
    else if (e.partitionKey === 'facilitator') facilitators.push(e)
  }
  return { groups, facilitators }
}

async function findGroupBySessionN(session, n) {
  const client = await orgTable()
  const iter = client.listEntities({
    queryOptions: { filter: odata`PartitionKey eq 'group' and session eq ${session} and n eq ${n}` },
  })
  for await (const e of iter) return e
  return null
}

async function getEntity(partitionKey, rowKey) {
  const client = await orgTable()
  try {
    return await client.getEntity(partitionKey, rowKey)
  } catch (err) {
    if (err && err.statusCode === 404) return null
    throw err
  }
}

async function listGroupsByFacilitator(facilitatorId) {
  const client = await orgTable()
  const out = []
  const iter = client.listEntities({
    queryOptions: { filter: odata`PartitionKey eq 'group' and facilitatorId eq ${facilitatorId}` },
  })
  for await (const e of iter) out.push(e)
  return out
}

module.exports = {
  ORG_TABLE,
  ROSTERS_TABLE,
  orgTable,
  rostersTable,
  groupFromEntity,
  groupToEntity,
  facilitatorFromEntity,
  facilitatorToEntity,
  listOrgEntities,
  findGroupBySessionN,
  getEntity,
  listGroupsByFacilitator,
}
