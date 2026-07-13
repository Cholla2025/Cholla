// GET /api/health — anonymous liveness probe. The frontend calls this once at
// startup to decide live vs demo mode, so it must never require auth.

const { app } = require('@azure/functions')
const { json, guard } = require('../lib/util')

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: guard(async () => json(200, { ok: true })),
})
