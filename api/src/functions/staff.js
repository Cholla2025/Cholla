// Staff account management (the email sign-in accounts).
//
//   GET    /api/staff         — leader/admin
//   POST   /api/staff         — leader/admin (leaders: facilitator records only)
//   DELETE /api/staff/{email} — leader/admin (same matrix; never yourself)
//
// Accounts live in the org table (partitionKey 'staff', rowKey = lowercase
// email). Deactivating a record (active:false) blocks new sign-ins AND
// revokes outstanding session tokens, because lib/auth.js re-reads the record
// on every request.

const { app } = require('@azure/functions')
const { json, noContent, guard, readJson, cleanString, isValidEmail } = require('../lib/util')
const { STAFF_ROLES, LEADER_ROLES, requireLeader, adminEmails } = require('../lib/auth')
const {
  orgTable,
  getStaffByEmail,
  staffFromEntity,
  staffToEntity,
  listStaff,
} = require('../lib/storage')

// Leaders manage facilitators; only admins may touch leader/admin records.
const ADMIN_ONLY = 'Only admins can manage leader or admin accounts'

app.http('staff-list', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'staff',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const entities = await listStaff()
    return json(200, {
      staff: entities.map(staffFromEntity).sort((a, b) => a.name.localeCompare(b.name)),
      // Bootstrap admins from the ADMIN_EMAILS app setting, so the UI can
      // show who can always sign in even without a staff record.
      adminEmails: adminEmails(),
    })
  }),
})

app.http('staff-upsert', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'staff',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })

    if (!isValidEmail(body.email)) return json(400, { error: 'email must be a valid email address' })
    const email = body.email.trim()
    const name = cleanString(body.name, 80)
    if (!name) return json(400, { error: 'name is required' })
    if (!STAFF_ROLES.includes(body.role)) return json(400, { error: 'role must be one of: ' + STAFF_ROLES.join(', ') })
    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return json(400, { error: 'active must be a boolean' })
    }

    const existing = await getStaffByEmail(email)
    if (who.role !== 'admin') {
      // Leaders may only create/update facilitator records — and may not
      // touch an existing leader/admin record at all.
      if (body.role !== 'facilitator') return json(403, { error: ADMIN_ONLY })
      if (existing && LEADER_ROLES.includes(existing.role)) return json(403, { error: ADMIN_ONLY })
    }

    const staff = {
      email,
      name,
      role: body.role,
      active: body.active === undefined ? (existing ? existing.active !== false : true) : body.active,
    }
    const client = await orgTable()
    await client.upsertEntity(staffToEntity(staff), 'Replace')
    return json(200, { staff })
  }),
})

app.http('staff-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'staff/{email}',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who

    // The client sends encodeURIComponent(email); route params arrive decoded.
    const email = request.params.email
    if (!isValidEmail(email)) return json(400, { error: 'Invalid staff email' })
    const lower = email.toLowerCase()
    if (typeof who.email === 'string' && who.email.toLowerCase() === lower) {
      return json(400, { error: 'You cannot remove your own account' })
    }

    const existing = await getStaffByEmail(lower)
    if (!existing) return json(404, { error: 'Staff account not found' })
    if (who.role !== 'admin' && LEADER_ROLES.includes(existing.role)) {
      return json(403, { error: ADMIN_ONLY })
    }

    const client = await orgTable()
    await client.deleteEntity('staff', lower)
    return noContent()
  }),
})
