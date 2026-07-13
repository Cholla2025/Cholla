// Day-close evaluation of the personal alert subscriptions (functions/
// alerts.js). Called from the nightly daily-report run (functions/reports.js)
// so "day close" rides the same trigger as the reports — no separate timer.
//
// Two subscription types:
//   group  — the group closed the day with fewer check-ins than the
//            subscriber's threshold → renderGroupThresholdAlert
//   client — the subscribed client did not check in to their group today
//            → renderMissedClientAlert (client name + missed status ONLY,
//            by explicit owner decision; one email per subscriber covers all
//            of their missed clients)
//
// Failures are contained per subscriber: one bad address or transient mail
// error never blocks the daily report or other subscribers' alerts.

const { odata } = require('@azure/data-tables')
const { ATTENDED_STATUSES } = require('./metrics')
const { renderGroupThresholdAlert, renderMissedClientAlert } = require('./email-templates')
const { acsConfigured, sendEmail } = require('./mailer')
const { alertsTable, clientsTable, rostersTable, listOrgEntities } = require('./storage')

// All subscriptions, grouped per subscriber email.
async function loadSubscriptions() {
  const client = await alertsTable()
  const bySubscriber = new Map()
  for await (const e of client.listEntities()) {
    if (!bySubscriber.has(e.partitionKey)) bySubscriber.set(e.partitionKey, [])
    bySubscriber.get(e.partitionKey).push(e)
  }
  return bySubscriber
}

// The day's rosters: rowKey ('<session>-<n>') -> rows[].
async function loadRosters(date, context) {
  const client = await rostersTable()
  const byKey = new Map()
  const iter = client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${date}` } })
  for await (const e of iter) {
    try {
      const rows = JSON.parse(e.rows)
      if (Array.isArray(rows)) byKey.set(e.rowKey, rows)
    } catch {
      context.warn('[cholla-api] alert eval: skipping unreadable roster ' + date + '/' + e.rowKey)
    }
  }
  return byKey
}

async function loadClientsById() {
  const client = await clientsTable()
  const byId = new Map()
  const iter = client.listEntities({ queryOptions: { filter: odata`PartitionKey eq 'client'` } })
  for await (const e of iter) byId.set(e.rowKey, e)
  return byId
}

function checkedInCount(rows) {
  return (rows || []).filter((r) => r && ATTENDED_STATUSES.includes(r.status)).length
}

// Did this client check in today? Matched by roster row id first, then by
// case-insensitive name (roster rows created before the id linkage carry
// names only).
function clientAttended(rows, clientEntity) {
  const name = String(clientEntity.name || '').trim().toLowerCase()
  return (rows || []).some((r) => {
    if (!r || !ATTENDED_STATUSES.includes(r.status)) return false
    if (r.id && String(r.id) === clientEntity.rowKey) return true
    return typeof r.name === 'string' && r.name.trim().toLowerCase() === name
  })
}

// Evaluate every subscription for `date` and send the alert emails. Returns
// { subscribers, emails } counts (never names) for the caller's log line.
async function evaluateAlertSubscriptions(date, context) {
  const bySubscriber = await loadSubscriptions()
  if (!bySubscriber.size) return { subscribers: 0, emails: 0 }

  const rosters = await loadRosters(date, context)
  const clientsById = await loadClientsById()
  const { groups } = await listOrgEntities()
  const groupNames = new Map()
  for (const g of groups) groupNames.set(g.session + '-' + g.n, g.name)

  let emails = 0
  for (const [subscriber, subs] of bySubscriber) {
    const outbox = []
    const missedNames = []

    for (const sub of subs) {
      if (sub.type === 'group') {
        const key = sub.session + '-' + Number(sub.n)
        const count = checkedInCount(rosters.get(key))
        if (count < Number(sub.threshold)) {
          const label = (groupNames.get(key) || sub.session + ' IOP') + ' (' + sub.session + ' ' + Number(sub.n) + ')'
          outbox.push(renderGroupThresholdAlert({ groupLabel: label, checkedIn: count, threshold: Number(sub.threshold), date }))
        }
      } else if (sub.type === 'client') {
        const c = clientsById.get(sub.clientId)
        // Skip clients that were deleted, deactivated or unassigned since the
        // subscription was created — no alert, no error.
        if (!c || c.active === false || !c.session || c.n === '' || c.n === undefined || c.n === null) continue
        const rows = rosters.get(c.session + '-' + Number(c.n))
        if (!clientAttended(rows, c)) missedNames.push(c.name)
      }
    }

    if (missedNames.length) {
      missedNames.sort((a, b) => a.localeCompare(b))
      outbox.push(renderMissedClientAlert({ names: missedNames, date }))
    }
    if (!outbox.length) continue

    if (!acsConfigured()) {
      // Counted but not sent — the caller reports email as unconfigured.
      emails += outbox.length
      continue
    }
    for (const m of outbox) {
      try {
        await sendEmail({ to: [subscriber], subject: m.subject, text: m.text, html: m.html })
        emails++
      } catch {
        // Address or transient failure — counts only, never the content.
        context.warn('[cholla-api] alert email failed for one subscriber')
      }
    }
  }
  return { subscribers: bySubscriber.size, emails }
}

module.exports = { evaluateAlertSubscriptions }
