import { useEffect, useState } from 'react'
import * as B from '../lib/backend'
import { Field, Empty } from '../ui'

// Reports — in-app preview of the daily/weekly/monthly/quarterly report
// emails, the day's volume alerts, the read-only recipient list, and (admins
// only) a send-now button. Rendered as the Leadership → Reports view and
// inside the Admin Portal. Reports contain group labels and counts only,
// never a client name.

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly']

export default function Reports({ store }) {
  const { state: st } = store
  const isAdmin = st.authRole === 'admin'
  const [period, setPeriod] = useState('daily')
  const [preview, setPreview] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [config, setConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out = await B.fetchReportConfig()
      if (alive) setConfig(out)
    })()
    return () => { alive = false }
  }, [])

  const loadPreview = async () => {
    setBusy(true); setErr(''); setMsg(''); setPreview(null); setAlerts(null)
    try {
      const out = await B.previewReport(period)
      if (out && out.html) {
        setPreview(out)
        if (Array.isArray(out.alerts)) setAlerts(out.alerts)
      } else {
        setErr(st.live ? 'No preview returned — is any data recorded yet?' : 'Demo mode: report previews need the live backend')
      }
    } catch (e) {
      setErr(e.message || 'Could not build the preview')
    }
    setBusy(false)
  }

  const sendNow = async () => {
    if (!window.confirm('Send the ' + period + ' report to the configured leadership recipients right now?')) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const out = await B.sendReportNow(period)
      const sent = (out && (out.sent || out.wouldSend)) || []
      setMsg(sent.length ? 'Sent: ' + sent.join(' · ') : 'Nothing to send')
    } catch (e) {
      setErr(e.message || 'Send failed')
    }
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <div className="admin-h">Reports &amp; volume alerts</div>
      <div className="card admin-form">
        <Field label="Report">
          <select className="select" value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); setAlerts(null); setMsg('') }}>
            {PERIODS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
        <button className="btn btn-ghost" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={loadPreview}>
          {busy ? 'Working…' : 'Preview'}
        </button>
        {isAdmin && (
          <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={sendNow}>Send now</button>
        )}
      </div>
      {msg && <div className="card" style={{ marginTop: 12, color: '#1F7A56', font: '600 13px Inter' }}>{msg}</div>}
      {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}

      {config && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="roster-name">Recipients (read-only)</div>
          <div className="roster-meta" style={{ marginTop: 4 }}>
            {config.recipients && config.recipients.length
              ? config.recipients.map((r) => <span key={r}>{r}</span>)
              : <span>No recipients configured yet (REPORT_EMAILS app setting)</span>}
          </div>
          <div className="section-sub" style={{ marginTop: 8, marginBottom: 0 }}>
            Scheduled reports and volume alerts go to these addresses
            (the <b>REPORT_EMAILS</b> app setting — change it in Azure, not here).
            Alert thresholds: warning above <b>{config.alertDropPct}%</b> drop,
            critical above <b>{config.alertCriticalPct}%</b>.
          </div>
        </div>
      )}

      {alerts !== null && period === 'daily' && (
        <div className="card" style={{ marginTop: 12, padding: alerts.length ? '4px 16px' : 16 }}>
          {alerts.length ? alerts.map((al) => (
            <div className="roster-row" key={al.groupId}>
              <div>
                <div className="roster-name">{al.name || al.session + ' IOP'} ({al.session} {al.n})</div>
                <div className="roster-meta">
                  <span>avg {al.prior2Avg} → {al.recent2Avg}</span>
                  <span style={{ color: al.severity === 'critical' ? '#B14233' : '#B5742A', fontWeight: 700 }}>
                    ▼ {al.dropPct}% · {al.severity}
                  </span>
                </div>
              </div>
            </div>
          )) : <Empty title="No volume alerts today">No group shows a steady decline over the last 4 clinic days</Empty>}
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="roster-name">How the automation works</div>
        <div className="section-sub" style={{ marginTop: 6, marginBottom: 0 }}>
          A scheduled job calls the reports API daily (plus weekly on Mondays,
          monthly on the 1st, quarterly each Jan/Apr/Jul/Oct). The daily run
          also checks every group for a steady two-day drop, sends any volume
          alerts, and evaluates everyone's personal alert subscriptions from
          the Analytics page. Reports contain counts and trends only — never
          client names.
        </div>
      </div>

      {preview && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E4E9F1', font: '600 13px Inter' }}>
            {preview.subject}
          </div>
          <iframe title="Report preview" srcDoc={preview.html} sandbox="" style={{ width: '100%', height: 640, border: 'none', background: '#F4F7FB' }} />
        </div>
      )}
    </div>
  )
}
