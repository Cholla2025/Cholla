// POST /api/kiosk/verify — anonymous. The kiosk tablet submits the code typed
// on the keypad; the server matches it (timing-safe) against each active
// facilitator's personal code (stored hashed on the facilitator record) and
// against the KIOSK_CODE app setting, which remains as the admin master/
// fallback code. The response says WHO unlocked ({ facilitator }) without
// ever revealing any code, and each facilitator unlock is recorded in the org
// table so leadership can audit whose code opened the kiosk.
// Failed attempts are rate limited per IP and globally (see lib/auth.js) so
// the 4-digit space cannot be walked online.

const crypto = require('crypto')
const { app } = require('@azure/functions')
const { json, guard, readJson } = require('../lib/util')
const { matchKioskCode, kioskThrottled, registerKioskFailure } = require('../lib/auth')
const { orgTable } = require('../lib/storage')

// Best-effort audit trail: partitionKey 'kioskunlock', one row per unlock.
// Configuration-grade data only (facilitator id + timestamp) — never a code,
// never a client name.
async function recordUnlock(match, context) {
  try {
    const client = await orgTable()
    await client.createEntity({
      partitionKey: 'kioskunlock',
      rowKey: new Date().toISOString() + '-' + crypto.randomBytes(3).toString('hex'),
      via: match.via,
      facilitatorId: match.facilitatorId || '',
    })
  } catch {
    context.warn('[cholla-api] kiosk unlock audit write failed')
  }
}

app.http('kiosk-verify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'kiosk/verify',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body || typeof body.code !== 'string') {
      return json(400, { error: 'Body must be JSON with a string "code"' })
    }
    if (kioskThrottled(request)) {
      context.warn('[cholla-api] kiosk verify throttled')
      return json(429, { error: 'Too many attempts — wait a few minutes and try again' })
    }
    // Bound the input so a huge payload cannot make hashing expensive.
    if (body.code.length > 64) {
      registerKioskFailure(request)
      return json(200, { ok: false })
    }
    const match = await matchKioskCode(body.code, context)
    if (!match) {
      registerKioskFailure(request)
      context.warn('[cholla-api] kiosk verify failed (wrong or unconfigured code)')
      return json(200, { ok: false })
    }
    if (match.via === 'facilitator') {
      await recordUnlock(match, context)
      return json(200, {
        ok: true,
        facilitator: { id: match.facilitatorId, name: match.facilitatorName },
      })
    }
    return json(200, { ok: true })
  }),
})
