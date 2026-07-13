// POST /api/kiosk/verify — anonymous. The kiosk tablet submits the day code
// typed on the keypad; the server compares it (timing-safe) against the
// KIOSK_CODE app setting and answers { ok } without ever revealing the code.

const { app } = require('@azure/functions')
const { json, guard, readJson } = require('../lib/util')
const { timingSafeEqual, configuredKioskCode } = require('../lib/auth')

app.http('kiosk-verify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'kiosk/verify',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body || typeof body.code !== 'string') {
      return json(400, { error: 'Body must be JSON with a string "code"' })
    }
    // Bound the input so a huge payload cannot make hashing expensive.
    if (body.code.length > 64) return json(200, { ok: false })
    const ok = timingSafeEqual(body.code, configuredKioskCode(context))
    if (!ok) context.warn('[cholla-api] kiosk verify failed (wrong code)')
    return json(200, { ok })
  }),
})
