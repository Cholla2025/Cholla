// POST /api/kiosk/verify — anonymous. The kiosk tablet submits the day code
// typed on the keypad; the server compares it (timing-safe) against the
// KIOSK_CODE app setting and answers { ok } without ever revealing the code.
// Failed attempts are rate limited per IP and globally (see lib/auth.js) so
// the 4-digit space cannot be walked online.

const { app } = require('@azure/functions')
const { json, guard, readJson } = require('../lib/util')
const {
  timingSafeEqual,
  configuredKioskCode,
  kioskThrottled,
  registerKioskFailure,
} = require('../lib/auth')

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
    const code = configuredKioskCode(context)
    const ok = Boolean(code) && timingSafeEqual(body.code, code)
    if (!ok) {
      registerKioskFailure(request)
      context.warn('[cholla-api] kiosk verify failed (wrong or unconfigured code)')
    }
    return json(200, { ok })
  }),
})
