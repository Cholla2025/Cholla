// AI assistant — Claude-powered analytics Q&A for leadership.
//
//   POST /api/ai/ask { question, history? } — leader/admin only
//
// PHI boundary (the whole design): the model NEVER receives roster rows or
// client names. This endpoint builds its context exclusively from the same
// de-identified aggregates the report emails use (lib/metrics via
// functions/reports.js) — group labels, counts, percentages, trends — so
// there is nothing person-level for the model to see, remember, or leak.
// Facilitator names (workforce, not client data) are included so questions
// like "whose groups are declining?" can be answered.
//
// The Anthropic API key lives in the ANTHROPIC_API_KEY app setting and the
// call happens server-side only; the browser never talks to Anthropic.

const { app } = require('@azure/functions')
const { json, guard, readJson, cleanString } = require('../lib/util')
const { requireLeader } = require('../lib/auth')
const { listOrgEntities } = require('../lib/storage')
const { volumeAlerts } = require('../lib/metrics')
const { clinicToday, addDays, loadRange, clinicDates, buildDaily } = require('./reports')

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'
const LOOKBACK_DAYS = 30
const MAX_HISTORY_TURNS = 12

const SYSTEM_PROMPT = `You are the analytics assistant inside the Cholla Behavioral Health check-in dashboard, answering questions for clinic leadership.

You receive ONLY de-identified aggregate data: per-day, per-group attendance counts and percentages, front-door visit totals, group/facilitator assignments, and volume alerts. You never receive client names or any person-level records — if asked about a specific client or individual attendance, explain that you only see aggregate numbers and that client-level questions belong in the Facilitator or Leadership dashboards.

Answer in GitHub-flavored markdown. Use markdown tables whenever you present per-group, per-day, or comparative numbers. Bold the headline numbers. Be concise and lead with the answer; add a short "what this means" note when a trend is notable. Compute averages/trends from the data provided — never invent numbers, and say so plainly when the data can't answer the question. Dates are clinic days (${'America/Phoenix'} calendar); "today" is the last date in the data.`

// ----- context assembly (aggregates only — see PHI boundary above) -----

async function buildContext(context) {
  const today = clinicToday()
  const { groups, facilitators } = await listOrgEntities()
  const facNames = new Map()
  for (const f of facilitators) facNames.set(f.rowKey, f.name + (f.credential ? ', ' + f.credential : ''))

  const groupNames = new Map()
  const org = groups.map((g) => {
    groupNames.set(g.session + '-' + g.n, g.name)
    return {
      group: g.session + ' ' + g.n,
      name: g.name,
      facilitator: facNames.get(g.facilitatorId) || null,
    }
  })

  const data = await loadRange(addDays(today, -(LOOKBACK_DAYS - 1)), today, context)
  const dates = clinicDates(data, today)
  const days = dates.map((d) => buildDaily(d, data, groupNames))

  let alerts = []
  const alertDates = dates.slice(-4)
  if (alertDates.length === 4) {
    const history = alertDates.map((d) => {
      const counts = {}
      for (const g of buildDaily(d, data, groupNames).groups) counts[g.session + '-' + g.n] = g.checkedIn
      return { date: d, counts }
    })
    alerts = volumeAlerts({
      groups: groups.map((g) => ({ id: g.rowKey, session: g.session, n: Number(g.n), name: g.name })),
      history,
    })
  }

  return {
    today,
    lookbackDays: LOOKBACK_DAYS,
    organization: org,
    dailyMetrics: days,
    volumeAlerts: alerts,
  }
}

// Strictly sanitize prior turns: only role + plain text survive, bounded.
function cleanHistory(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const turn of raw.slice(-MAX_HISTORY_TURNS)) {
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue
    if (typeof turn.content !== 'string' || !turn.content.trim()) continue
    out.push({ role: turn.role, content: turn.content.slice(0, 6000) })
  }
  // The API requires the first message to be from the user.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

let anthropicClient = null

function getClient() {
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk')
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

app.http('ai-ask', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ai/ask',
  handler: guard(async (request, context) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })
    const question = cleanString(body.question, 2000)
    if (!question || question.length < 3) return json(400, { error: 'Ask a question (3–2000 characters)' })

    if (!process.env.ANTHROPIC_API_KEY) {
      return json(503, { error: 'The AI assistant is not configured yet (ANTHROPIC_API_KEY app setting missing)' })
    }

    const aggregates = await buildContext(context)
    const messages = [...cleanHistory(body.history), { role: 'user', content: question }]

    try {
      const response = await getClient().messages.create({
        model: MODEL(),
        max_tokens: 3000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system:
          SYSTEM_PROMPT +
          '\n\nDATA (de-identified aggregates, JSON):\n' +
          JSON.stringify(aggregates),
        messages,
      })
      if (response.stop_reason === 'refusal') {
        return json(200, { answer: 'I can’t help with that request — try asking about attendance, trends, or facility traffic.', model: response.model })
      }
      const answer = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (!answer) return json(502, { error: 'The AI returned an empty answer — try again' })
      return json(200, { answer, model: response.model })
    } catch (err) {
      // Typed SDK errors: rate limits get a friendly retry message; anything
      // else surfaces as a gateway error without leaking internals.
      const status = err && err.status
      context.error('[cholla-api] AI request failed: ' + (status || '') + ' ' + (err && err.name))
      if (status === 429) return json(429, { error: 'The AI is busy right now — wait a moment and try again' })
      if (status === 401 || status === 403) return json(503, { error: 'The AI API key is invalid or expired — check the ANTHROPIC_API_KEY app setting' })
      return json(502, { error: 'The AI request failed — try again' })
    }
  }),
})
