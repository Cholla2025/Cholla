// Microsoft 365 directory — the tenant's people, for autofill when adding
// staff accounts or facilitators.
//
//   GET /api/directory — leader/admin only. Returns { users: [{name, email}] }
//   sorted by name. Uses Microsoft Graph client credentials (User.Read.All,
//   admin-consented on the existing app registration) with the SAME
//   AZURE_CLIENT_ID / AZURE_CLIENT_SECRET app settings the sign-in uses.
//
// Excluded: disabled accounts, #EXT# guests, and service/admin/no-reply
// mailbox patterns. The token and the user list are cached in-memory (5 min)
// so the kiosk-adjacent admin screens don't hammer Graph. Directory contents
// are NEVER logged.

const { app } = require('@azure/functions')
const { json, guard } = require('../lib/util')
const { requireLeader } = require('../lib/auth')

// The clinic's tenant. Overridable only for local testing against a dev
// tenant; production uses this value with the existing app settings.
const TENANT_ID = process.env.AZURE_TENANT_ID || '83e66084-342d-470d-9551-04af0d97f850'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const LIST_TTL_MS = 5 * 60 * 1000

// Service-ish mailboxes that never belong in a people picker.
const EXCLUDE_RE = /^(admin|administrator|root|sync|svc[._-]?|service[._-]?|no[._-]?reply|noreply|donotreply|do[._-]?not[._-]?reply|postmaster|mailer|helpdesk|support|info|billing|alerts?|notifications?)@/i

let tokenCache = { token: null, exp: 0 }
let listCache = { users: null, exp: 0 }

async function graphToken() {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.exp - 60_000) return tokenCache.token
  const body = new URLSearchParams({
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch('https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error('graph token request failed: ' + res.status)
  const data = await res.json()
  tokenCache = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 }
  return tokenCache.token
}

function includeUser(u) {
  if (u.accountEnabled === false) return false
  const upn = u.userPrincipalName || ''
  if (upn.toUpperCase().includes('#EXT#')) return false
  const email = u.mail || upn
  if (!email || !email.includes('@')) return false
  if (EXCLUDE_RE.test(email)) return false
  if (!u.displayName) return false
  return true
}

async function listDirectory() {
  const now = Date.now()
  if (listCache.users && now < listCache.exp) return listCache.users
  const token = await graphToken()
  const users = []
  let url = GRAPH_BASE + '/users?$select=displayName,mail,userPrincipalName,accountEnabled&$top=999'
  let hops = 0
  while (url && hops < 20) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    if (!res.ok) throw new Error('graph users request failed: ' + res.status)
    const page = await res.json()
    for (const u of page.value || []) {
      if (includeUser(u)) users.push({ name: u.displayName, email: u.mail || u.userPrincipalName })
    }
    url = page['@odata.nextLink'] || null
    hops++
  }
  users.sort((a, b) => a.name.localeCompare(b.name))
  listCache = { users, exp: now + LIST_TTL_MS }
  return users
}

app.http('directory-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'directory',
  handler: guard(async (request, context) => {
    const who = await requireLeader(request)
    if (who.status) return who
    if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET) {
      return json(503, { error: 'The Microsoft 365 directory is not configured' })
    }
    try {
      return json(200, { users: await listDirectory() })
    } catch (err) {
      // Status codes only — directory contents and error bodies stay out of
      // the logs entirely.
      context.warn('[cholla-api] directory unavailable (' + (err && err.message ? err.message.replace(/[^\w :]/g, '').slice(0, 60) : 'error') + ')')
      return json(502, { error: 'The Microsoft 365 directory is unavailable right now' })
    }
  }),
})
