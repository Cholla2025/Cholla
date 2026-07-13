// Staff account management (the sign-in accounts).
//
//   GET    /api/staff         — leader/admin
//   POST   /api/staff         — leader/admin (leaders: facilitator records only;
//                               ONLY super admins may create/promote/demote/
//                               deactivate admin accounts)
//   DELETE /api/staff/{email} — leader/admin (same matrix; never yourself;
//                               admin records: super admins only)
//
// Super admins are the ADMIN_EMAILS addresses (lib/auth.js). Nobody — super
// admin or not — may modify or deactivate a super admin's record here; those
// accounts are governed by the app setting itself.
//
// Accounts live in the org table (partitionKey 'staff', rowKey = lowercase
// email). Deactivating a record (active:false) blocks new sign-ins AND
// revokes outstanding session tokens, because lib/auth.js re-reads the record
// on every request.
//
// Creating a NEW active account also sends the person a welcome/onboarding
// email (fire-and-forget — account creation never fails because email did).
// The response reports it as { welcomed: true|false }.

const { app } = require('@azure/functions')
const { json, noContent, guard, readJson, cleanString, isValidEmail } = require('../lib/util')
const { STAFF_ROLES, LEADER_ROLES, requireLeader, adminEmails, isAdminEmail, isSuperAdmin } = require('../lib/auth')
const {
  orgTable,
  getStaffByEmail,
  staffFromEntity,
  staffToEntity,
  listStaff,
} = require('../lib/storage')
const { renderOnboarding } = require('../lib/email-templates')
const { acsConfigured, sendEmail } = require('../lib/mailer')

// Leaders manage facilitators; only admins may touch leader/admin records.
const ADMIN_ONLY = 'Only admins can manage leader or admin accounts'
const SUPER_ADMIN_ONLY = 'Only a super admin (ADMIN_EMAILS) can manage admin accounts'
const SUPER_ADMIN_LOCKED = 'Super admin accounts are managed through the ADMIN_EMAILS app setting and cannot be changed here'

// Where the welcome email should point people. The SPA calls this API from
// the site itself, so the Origin header is the canonical address; SITE_URL
// overrides it for scripted callers.
function siteUrlFor(request) {
  const configured = process.env.SITE_URL
  if (configured) return configured
  const origin = request.headers.get('origin') || ''
  return /^https:\/\/[\w.-]+$/i.test(origin) ? origin : ''
}

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
  handler: guard(async (request, context) => {
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

    // Super admin records are off limits to everyone.
    if (isAdminEmail(email)) return json(403, { error: SUPER_ADMIN_LOCKED })

    const existing = await getStaffByEmail(email)
    if (who.role !== 'admin') {
      // Leaders may only create/update facilitator records — and may not
      // touch an existing leader/admin record at all.
      if (body.role !== 'facilitator') return json(403, { error: ADMIN_ONLY })
      if (existing && LEADER_ROLES.includes(existing.role)) return json(403, { error: ADMIN_ONLY })
    }
    // Anything that creates an admin, promotes to admin, or touches an
    // existing admin record (demote/deactivate/rename) is super-admin-only.
    if ((body.role === 'admin' || (existing && existing.role === 'admin')) && !isSuperAdmin(who)) {
      return json(403, { error: SUPER_ADMIN_ONLY })
    }

    const staff = {
      email,
      name,
      role: body.role,
      active: body.active === undefined ? (existing ? existing.active !== false : true) : body.active,
    }
    const client = await orgTable()
    await client.upsertEntity(staffToEntity(staff), 'Replace')

    // Welcome email — new ACTIVE accounts only, and only when email is
    // configured. Fire-and-forget: a mail failure never fails the create.
    let welcomed = false
    if (!existing && staff.active && acsConfigured()) {
      const message = renderOnboarding({ name: staff.name, role: staff.role, siteUrl: siteUrlFor(request) })
      sendEmail({ to: [staff.email], subject: message.subject, text: message.text, html: message.html })
        .catch(() => context.warn('[cholla-api] onboarding email failed to send'))
      welcomed = true
    }
    return json(200, { staff, welcomed })
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
    if (isAdminEmail(lower)) return json(403, { error: SUPER_ADMIN_LOCKED })

    const existing = await getStaffByEmail(lower)
    if (!existing) return json(404, { error: 'Staff account not found' })
    if (who.role !== 'admin' && LEADER_ROLES.includes(existing.role)) {
      return json(403, { error: ADMIN_ONLY })
    }
    if (existing.role === 'admin' && !isSuperAdmin(who)) {
      return json(403, { error: SUPER_ADMIN_ONLY })
    }

    const client = await orgTable()
    await client.deleteEntity('staff', lower)
    return noContent()
  }),
})
