// Report email rendering. Each render* returns { subject, html, text }.
//
// PHI-FREE BY DESIGN: nothing rendered here may ever include a client or
// staff name. Inputs are the aggregate shapes from lib/metrics.js — group
// labels, counts and percentages only — and the tests assert that roster
// names never survive into the output.
//
// Email-client constraints drive the markup: a 600px table layout, ALL
// styles inline (mail clients strip <style> blocks), and every template
// ships a plain-text alternative.

const { trendPct } = require('./metrics')

// Brand palette.
const NAVY = '#21314F'
const TERRACOTTA = '#BE6A45'
const LIGHT = '#F4F7FB'
const GREEN = '#1F7A56'
const RED = '#B14233'
const MUTED = '#6B7688'
const RULE = '#E3E9F2'

const FOOTER = 'Cholla Behavioral Health · automated report — do not reply'

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ----- date formatting -----
// Dates arrive as YYYY-MM-DD strings; formatting is done in UTC so the label
// always matches the clinic date, whatever the server's zone.

function fmt(date, options) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))
}

function fmtDay(date) {
  return fmt(date, { weekday: 'short', month: 'short', day: 'numeric' }) // 'Fri, Jul 12'
}

function fmtShort(date) {
  return fmt(date, { month: 'short', day: 'numeric' }) // 'Jul 12'
}

// 'Jul 6–12' within a month, 'Jun 30 – Jul 6' across months.
function fmtRange(from, to) {
  if (!from) return ''
  if (!to || to === from) return fmtShort(from)
  if (from.slice(0, 7) === to.slice(0, 7)) return fmtShort(from) + '–' + fmt(to, { day: 'numeric' })
  return fmtShort(from) + ' – ' + fmtShort(to)
}

function pctText(p) {
  return p === null || p === undefined ? '—' : p + '%'
}

// ----- shared building blocks -----

function trendHtml(pct, comparedTo) {
  if (pct === null || pct === undefined) {
    return '<span style="color:' + MUTED + ';font-size:13px">no comparison available</span>'
  }
  const color = pct >= 0 ? GREEN : RED
  const arrow = pct >= 0 ? '▲' : '▼'
  return '<span style="color:' + color + ';font-size:13px;font-weight:bold">' + arrow + ' ' + Math.abs(pct) + '% vs ' + esc(comparedTo) + '</span>'
}

function trendText(pct, comparedTo) {
  if (pct === null || pct === undefined) return 'no comparison available'
  return (pct >= 0 ? 'up ' : 'down ') + Math.abs(pct) + '% vs ' + comparedTo
}

// The 600px table-based frame every report shares: header bar, white card,
// footer. `headerBg` lets the volume alert turn the bar terracotta/red.
function layout(headerHtml, bodyHtml, headerBg) {
  return (
    '<div style="margin:0;padding:24px 8px;background:' + LIGHT + ";font-family:'Segoe UI',Arial,Helvetica,sans-serif\">" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="600" style="width:600px;max-width:100%;margin:0 auto;border-collapse:collapse">' +
    '<tr><td style="background:' + (headerBg || NAVY) + ';color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold;border-radius:8px 8px 0 0">' + headerHtml + '</td></tr>' +
    '<tr><td style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px;color:' + NAVY + '">' + bodyHtml + '</td></tr>' +
    '<tr><td style="padding:16px 24px;color:' + MUTED + ';font-size:12px;text-align:center">' + FOOTER + '</td></tr>' +
    '</table>' +
    '</div>'
  )
}

function stat(label, value, subHtml) {
  return (
    '<td align="center" style="padding:12px 8px;vertical-align:top">' +
    '<div style="font-size:28px;font-weight:bold;color:' + NAVY + '">' + value + '</div>' +
    '<div style="font-size:11px;color:' + MUTED + ';text-transform:uppercase;letter-spacing:1px;margin-top:2px">' + esc(label) + '</div>' +
    (subHtml ? '<div style="margin-top:4px">' + subHtml + '</div>' : '') +
    '</td>'
  )
}

function statRow(cells) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:4px 0 8px"><tr>' +
    cells.join('') +
    '</tr></table>'
  )
}

function heading(text) {
  return (
    '<h3 style="margin:20px 0 4px;font-size:13px;color:' + NAVY + ';text-transform:uppercase;letter-spacing:1px;border-left:3px solid ' + TERRACOTTA + ';padding-left:8px">' +
    esc(text) +
    '</h3>'
  )
}

function tableHtml(headers, rows) {
  const th = headers
    .map((h) => '<th align="left" style="padding:8px 10px;background:' + LIGHT + ';color:' + NAVY + ';font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ' + TERRACOTTA + '">' + esc(h) + '</th>')
    .join('')
  const trs = rows
    .map((cells) => '<tr>' + cells.map((c) => '<td style="padding:8px 10px;border-bottom:1px solid ' + RULE + ';font-size:14px;color:' + NAVY + '">' + c + '</td>').join('') + '</tr>')
    .join('')
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:8px 0 4px">' +
    '<tr>' + th + '</tr>' + trs +
    '</table>'
  )
}

function groupLabel(g) {
  return g.name ? g.name : g.session + ' ' + g.n
}

// ----- templates -----

// Daily summary: headline numbers with a trend arrow vs yesterday, then the
// per-session and per-group breakdowns and the front-door line.
function renderDailyReport(metrics, prevMetrics) {
  const subject = 'Cholla daily report — ' + fmtDay(metrics.date)
  const t = trendPct(metrics.groupTotal, prevMetrics ? prevMetrics.groupTotal : null)
  const totalExpected = metrics.groups.reduce((s, g) => s + g.expected, 0)
  const overallPct = totalExpected ? Math.round((metrics.groupTotal / totalExpected) * 100) : null

  const sessionRows = Object.entries(metrics.perSession).map(([session, s]) => [
    esc(session),
    String(s.checkedIn),
    String(s.expected),
    pctText(s.attendancePct),
  ])
  const groupRows = metrics.groups.map((g) => [
    esc(groupLabel(g)),
    esc(g.session + ' ' + g.n),
    g.checkedIn + ' / ' + g.expected,
    pctText(g.attendancePct),
  ])

  const html = layout(
    'Cholla daily report',
    '<p style="margin:0 0 12px;font-size:15px;color:' + MUTED + '">' + esc(fmtDay(metrics.date)) + '</p>' +
      statRow([
        stat('Group check-ins', String(metrics.groupTotal), trendHtml(t, 'yesterday')),
        stat('Front door', String(metrics.door.total)),
        stat('Attendance', pctText(overallPct)),
      ]) +
      heading('By session') +
      tableHtml(['Session', 'Checked in', 'Expected', 'Attendance'], sessionRows) +
      heading('By group') +
      tableHtml(['Group', 'Session', 'Checked in / expected', 'Attendance'], groupRows) +
      '<p style="margin:16px 0 0;font-size:14px">Front door: <strong>' + metrics.door.total + '</strong> visit(s) · <strong>' + metrics.door.stillIn + '</strong> still in facility</p>'
  )

  const text = [
    subject,
    '',
    'Group check-ins: ' + metrics.groupTotal + ' (' + trendText(t, 'yesterday') + ')',
    'Front door: ' + metrics.door.total + ' visit(s), ' + metrics.door.stillIn + ' still in facility',
    'Attendance: ' + pctText(overallPct),
    '',
    'By session:',
    ...Object.entries(metrics.perSession).map(
      ([session, s]) => '  ' + session + ': ' + s.checkedIn + '/' + s.expected + ' (' + pctText(s.attendancePct) + ')'
    ),
    '',
    'By group:',
    ...metrics.groups.map(
      (g) => '  ' + groupLabel(g) + ' (' + g.session + ' ' + g.n + '): ' + g.checkedIn + '/' + g.expected + ' (' + pctText(g.attendancePct) + ')'
    ),
    '',
    FOOTER,
  ].join('\n')

  return { subject, html, text }
}

// Weekly/monthly/quarterly rollup — `period` is a periodMetrics result with
// trendPct already filled in by the caller (vs the previous period).
function renderPeriodReport(period) {
  const range = fmtRange(period.from, period.to)
  const subject = 'Cholla ' + period.label + ' report — ' + range
  const comparedTo = 'previous ' + (period.label === 'daily' ? 'day' : period.label.replace(/ly$/, '')) // weekly -> week

  const best = period.bestGroup
  const lowest = period.lowestGroup
  const perDayRows = period.perDay.map((d) => [esc(fmtDay(d.date)), String(d.groupTotal), String(d.doorTotal)])

  const html = layout(
    'Cholla ' + esc(period.label) + ' report',
    '<p style="margin:0 0 12px;font-size:15px;color:' + MUTED + '">' + esc(range) + ' · ' + period.daysCount + ' clinic day(s)</p>' +
      statRow([
        stat('Total check-ins', String(period.totalCheckins), trendHtml(period.trendPct, comparedTo)),
        stat('Avg / day', String(period.avgPerDay)),
        stat('Front door', String(period.doorTotal)),
      ]) +
      heading('Groups') +
      '<p style="margin:8px 0;font-size:14px">' +
      (best
        ? 'Best group: <strong>' + esc(groupLabel(best)) + '</strong> (' + esc(best.session + ' ' + best.n) + ') — ' + best.checkedIn + ' check-ins (' + pctText(best.attendancePct) + ')'
        : 'No group activity recorded.') +
      (lowest
        ? '<br>Lowest group: <strong>' + esc(groupLabel(lowest)) + '</strong> (' + esc(lowest.session + ' ' + lowest.n) + ') — ' + lowest.checkedIn + ' check-ins (' + pctText(lowest.attendancePct) + ')'
        : '') +
      '</p>' +
      heading('Per day') +
      tableHtml(['Date', 'Group check-ins', 'Front door'], perDayRows)
  )

  const text = [
    subject,
    '',
    'Total check-ins: ' + period.totalCheckins + ' (' + trendText(period.trendPct, comparedTo) + ')',
    'Average per day: ' + period.avgPerDay + ' across ' + period.daysCount + ' clinic day(s)',
    'Front door: ' + period.doorTotal,
    best ? 'Best group: ' + groupLabel(best) + ' (' + best.session + ' ' + best.n + ') — ' + best.checkedIn + ' check-ins' : 'No group activity recorded.',
    lowest ? 'Lowest group: ' + groupLabel(lowest) + ' (' + lowest.session + ' ' + lowest.n + ') — ' + lowest.checkedIn + ' check-ins' : '',
    '',
    'Per day:',
    ...period.perDay.map((d) => '  ' + fmtDay(d.date) + ': ' + d.groupTotal + ' check-ins, ' + d.doorTotal + ' front door'),
    '',
    FOOTER,
  ].filter((line) => line !== '').join('\n')

  return { subject, html, text }
}

// One email covering every alerting group. Any critical alert escalates the
// banner and prefixes the subject.
function renderVolumeAlert(alerts, date) {
  const critical = alerts.some((a) => a.severity === 'critical')
  const subject = (critical ? 'CRITICAL: ' : '') + 'Volume alert — ' + alerts.length + ' group(s) declining'
  const bannerText = critical ? '🚨 CRITICAL volume alert' : 'Volume Alert'
  const bannerBg = critical ? RED : TERRACOTTA

  const rows = alerts.map((a) => [
    esc(groupLabel(a)),
    esc(a.session + ' ' + a.n),
    String(a.prior2Avg),
    String(a.recent2Avg),
    '▼ ' + a.dropPct + '%',
    '<span style="color:' + (a.severity === 'critical' ? RED : TERRACOTTA) + ';font-weight:bold;text-transform:uppercase;font-size:12px">' + esc(a.severity) + '</span>',
  ])

  const html = layout(
    bannerText,
    '<p style="margin:0 0 12px;font-size:14px">Group attendance has been declining steadily over the last 4 clinic days (as of ' + esc(fmtDay(date)) + ').</p>' +
      tableHtml(['Group', 'Session', 'Prior 2-day avg', 'Recent 2-day avg', 'Drop', 'Severity'], rows) +
      '<p style="margin:16px 0 0;font-size:13px;color:' + MUTED + '">Averages compare the last 2 clinic days against the 2 before them.</p>',
    bannerBg
  )

  const text = [
    subject,
    '',
    'Group attendance has been declining steadily over the last 4 clinic days (as of ' + fmtDay(date) + ').',
    '',
    ...alerts.map(
      (a) => '  ' + groupLabel(a) + ' (' + a.session + ' ' + a.n + '): prior avg ' + a.prior2Avg + ' -> recent avg ' + a.recent2Avg + ', down ' + a.dropPct + '% [' + a.severity + ']'
    ),
    '',
    'Averages compare the last 2 clinic days against the 2 before them.',
    '',
    FOOTER,
  ].join('\n')

  return { subject, html, text }
}

module.exports = {
  renderDailyReport,
  renderPeriodReport,
  renderVolumeAlert,
}
