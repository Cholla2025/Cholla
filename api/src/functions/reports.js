// Reporting — daily/weekly/monthly/quarterly attendance summaries and
// declining-volume alerts, emailed to leadership.
//
//   GET  /api/reports/preview?period=daily|weekly|monthly|quarterly&date=…
//        — leader/admin only; renders the report WITHOUT sending (also how a
//          dashboard view can show reports later)
//   POST /api/reports/send { period, date? }
//        — leader/admin identity, OR the x-reports-secret header compared
//          timing-safe against the REPORTS_TRIGGER_SECRET app setting. The
//          header path is how the GitHub Actions cron fires reports, because
//          SWA-managed Functions only support HTTP triggers — no timers.
//
// PHI boundary: report emails NEVER contain a client or staff name — only
// group labels and counts (lib/email-templates.js renders nothing else).
// "Clinic days" are the dates that actually have roster or front-door data,
// so closed days never dilute averages or fake a volume decline.

const { app } = require('@azure/functions')
const { odata } = require('@azure/data-tables')
const { json, guard, readJson, isValidDate } = require('../lib/util')
const { isLeader, requireLeader, timingSafeEqual, isLocalDev } = require('../lib/auth')
const { rostersTable, frontdoorTable, listOrgEntities } = require('../lib/storage')
const { dailyMetrics, periodMetrics, trendPct, volumeAlerts } = require('../lib/metrics')
const { renderDailyReport, renderPeriodReport, renderVolumeAlert } = require('../lib/email-templates')
const { acsConfigured, sendEmail } = require('../lib/mailer')
const { evaluateAlertSubscriptions } = require('../lib/alert-eval')

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly']

// Same clinic-day rule as rosters/frontdoor.
const DEFAULT_TZ = 'America/Phoenix'

function clinicToday(offsetDays = 0) {
  const tz = process.env.CLINIC_TIMEZONE || DEFAULT_TZ
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ }).format(d)
  }
}

// ----- date arithmetic on YYYY-MM-DD strings (UTC math, no timezones) -----

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function monthRange(date) {
  const [y, m] = date.split('-').map(Number)
  return {
    from: date.slice(0, 8) + '01',
    to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  }
}

function quarterRange(date) {
  const [y, m] = date.split('-').map(Number)
  const qm = Math.floor((m - 1) / 3) * 3 + 1
  return {
    from: y + '-' + String(qm).padStart(2, '0') + '-01',
    to: new Date(Date.UTC(y, qm + 2, 0)).toISOString().slice(0, 10),
  }
}

// ----- stored entities -> plain shapes for lib/metrics -----

// Everything a report needs, in two range queries (dates sort
// lexicographically, so PartitionKey ge/le walks the calendar).
async function loadRange(from, to, context) {
  const filter = odata`PartitionKey ge ${from} and PartitionKey le ${to}`
  const rostersByDate = new Map() // date -> [{rowKey, rows}]
  const rc = await rostersTable()
  for await (const e of rc.listEntities({ queryOptions: { filter } })) {
    try {
      const rows = JSON.parse(e.rows)
      if (!Array.isArray(rows)) continue
      if (!rostersByDate.has(e.partitionKey)) rostersByDate.set(e.partitionKey, [])
      rostersByDate.get(e.partitionKey).push({ rowKey: e.rowKey, rows })
    } catch {
      context.warn('[cholla-api] skipping unreadable roster ' + e.partitionKey + '/' + e.rowKey)
    }
  }
  const doorByDate = new Map() // date -> rows[]
  const fc = await frontdoorTable()
  for await (const e of fc.listEntities({ queryOptions: { filter } })) {
    try {
      const rows = JSON.parse(e.rows)
      if (Array.isArray(rows)) doorByDate.set(e.partitionKey, rows)
    } catch {
      context.warn('[cholla-api] skipping unreadable front-door log ' + e.partitionKey)
    }
  }
  return { rostersByDate, doorByDate }
}

// Distinct data-bearing dates in the loaded range, ascending, up to endDate.
function clinicDates(data, endDate) {
  const dates = new Set([...data.rostersByDate.keys(), ...data.doorByDate.keys()])
  return [...dates].filter((d) => d <= endDate).sort()
}

function buildDaily(date, data, groupNames) {
  const rosters = []
  for (const { rowKey, rows } of data.rostersByDate.get(date) || []) {
    const dash = rowKey.lastIndexOf('-')
    const session = rowKey.slice(0, dash)
    const n = Number(rowKey.slice(dash + 1))
    rosters.push({ session, n, name: groupNames.get(rowKey) || session + ' ' + n, rows })
  }
  return dailyMetrics({ date, rosters, doorRows: data.doorByDate.get(date) || [] })
}

// Compute the requested report end to end: { report: {subject, html, text},
// metrics, alerts }. Alerts are only ever produced for the daily period.
async function buildReport(period, date, context) {
  const { groups } = await listOrgEntities()
  const groupNames = new Map()
  for (const g of groups) groupNames.set(g.session + '-' + g.n, g.name)

  if (period === 'daily') {
    // 14 calendar days is enough lookback to find yesterday's clinic day for
    // the trend arrow AND the 4 clinic days the volume alert needs.
    const data = await loadRange(addDays(date, -13), date, context)
    const metrics = buildDaily(date, data, groupNames)
    const before = clinicDates(data, addDays(date, -1))
    const prevMetrics = before.length ? buildDaily(before[before.length - 1], data, groupNames) : null
    const report = renderDailyReport(metrics, prevMetrics)

    let alerts = []
    const alertDates = clinicDates(data, date).slice(-4)
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
    return { report, metrics, alerts }
  }

  let from, to, currentDates, prevDates, data
  if (period === 'weekly') {
    // Last 7 clinic days ending `date`, compared against the 7 before them —
    // a 6-week lookback finds both even around holidays.
    data = await loadRange(addDays(date, -41), date, context)
    const dates = clinicDates(data, date)
    currentDates = dates.slice(-7)
    prevDates = dates.slice(-14, -7)
    from = currentDates[0] || addDays(date, -6)
    to = currentDates[currentDates.length - 1] || date
  } else {
    const range = period === 'monthly' ? monthRange(date) : quarterRange(date)
    const prev = period === 'monthly' ? monthRange(addDays(range.from, -1)) : quarterRange(addDays(range.from, -1))
    data = await loadRange(prev.from, range.to, context)
    from = range.from
    to = range.to
    currentDates = clinicDates(data, range.to).filter((d) => d >= range.from)
    prevDates = clinicDates(data, prev.to).filter((d) => d >= prev.from)
  }

  const days = currentDates.map((d) => buildDaily(d, data, groupNames))
  const metrics = periodMetrics({ label: period, days, from, to })
  if (prevDates.length) {
    const prevTotal = prevDates.reduce((sum, d) => sum + buildDaily(d, data, groupNames).groupTotal, 0)
    metrics.trendPct = trendPct(metrics.totalCheckins, prevTotal)
  }
  return { report: renderPeriodReport(metrics), metrics, alerts: [] }
}

// ----- endpoints -----

app.http('reports-preview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/preview',
  handler: guard(async (request, context) => {
    const who = await requireLeader(request)
    if (who.status) return who

    const period = request.query.get('period') || 'daily'
    if (!PERIODS.includes(period)) return json(400, { error: 'period must be one of: ' + PERIODS.join(', ') })
    const date = request.query.get('date') || clinicToday()
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })

    const { report, metrics, alerts } = await buildReport(period, date, context)
    return json(200, { subject: report.subject, html: report.html, text: report.text, metrics, alerts })
  }),
})

// Read-only reporting configuration for the Reports tab: who receives the
// scheduled reports and the volume-alert thresholds. Recipients are staff
// addresses (configuration, not PHI); leadership only.
app.http('reports-config', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/config',
  handler: guard(async (request) => {
    const who = await requireLeader(request)
    if (who.status) return who
    const recipients = (process.env.REPORT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const num = (name, fallback) => {
      const v = Number(process.env[name])
      return Number.isFinite(v) && v > 0 ? v : fallback
    }
    return json(200, {
      recipients,
      alertDropPct: num('ALERT_DROP_PCT', 5),
      alertCriticalPct: num('ALERT_CRITICAL_PCT', 10),
      emailConfigured: acsConfigured(),
    })
  }),
})

app.http('reports-send', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'reports/send',
  handler: guard(async (request, context) => {
    const body = await readJson(request)
    if (!body) return json(400, { error: 'Body must be a JSON object' })
    const { period } = body
    if (!PERIODS.includes(period)) return json(400, { error: 'period must be one of: ' + PERIODS.join(', ') })
    const date = body.date === undefined || body.date === null ? clinicToday() : body.date
    if (!isValidDate(date)) return json(400, { error: 'date must be YYYY-MM-DD' })

    // Leadership sends from the dashboard; the cron proves itself with the
    // trigger secret instead. FAIL-CLOSED: no configured secret in Azure
    // means the header path is simply off (503) — the 'dev-secret' fallback
    // exists only on a local dev machine.
    if (!(await isLeader(request))) {
      const sent = request.headers.get('x-reports-secret')
      if (!sent) return json(401, { error: 'Sign in as leadership or present the reports trigger secret' })
      const secret = process.env.REPORTS_TRIGGER_SECRET || (isLocalDev() ? 'dev-secret' : null)
      if (!secret) {
        return json(503, { error: 'Scheduled reports are not configured (REPORTS_TRIGGER_SECRET app setting missing)' })
      }
      if (!timingSafeEqual(sent, secret)) return json(401, { error: 'Invalid reports trigger secret' })
    }

    const recipients = (process.env.REPORT_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!recipients.length) return json(400, { error: 'REPORT_EMAILS is not configured' })

    const { report, alerts } = await buildReport(period, date, context)
    const outbox = [report]
    // The daily run doubles as the volume watchdog: any steadily declining
    // groups get one extra alert email covering all of them.
    if (period === 'daily' && alerts.length) outbox.push(renderVolumeAlert(alerts, date))

    if (!acsConfigured()) {
      if (isLocalDev()) {
        // Local dev with no email service: report what WOULD have gone out.
        return json(200, { ok: true, wouldSend: outbox.map((m) => m.subject) })
      }
      return json(503, { error: 'Email is not configured (ACS_CONNECTION_STRING / ACS_SENDER app settings missing)' })
    }

    for (const m of outbox) {
      await sendEmail({ to: recipients, subject: m.subject, text: m.text, html: m.html })
    }

    // The daily run is also "day close" for the personal alert subscriptions
    // (group thresholds + missed-client alerts). Contained: an evaluation
    // failure never fails the report send that already happened.
    let alertSummary = null
    if (period === 'daily') {
      try {
        alertSummary = await evaluateAlertSubscriptions(date, context)
      } catch (err) {
        context.warn('[cholla-api] alert subscription evaluation failed')
      }
    }
    return json(200, { ok: true, sent: outbox.map((m) => m.subject), personalAlerts: alertSummary })
  }),
})

// The AI assistant (functions/ai.js) reuses this data pipeline so its context
// is built from the SAME de-identified aggregates as the report emails.
module.exports = { clinicToday, addDays, loadRange, clinicDates, buildDaily }
