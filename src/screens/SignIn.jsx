import { useEffect, useRef, useState } from 'react'
import logoUrl from '../../Blue Agave Logo.png'
import { loginUrl, requestLoginCode, verifyLoginCode } from '../lib/backend'

// Staff have two ways in, both resolving to the same server-side roles:
//   1. Microsoft (Entra ID) — the Static Web Apps built-in provider, for
//      anyone with a Cholla Microsoft account.
//   2. Email one-time code — the server emails a 6-digit code to any address
//      leadership has added as a staff account; no password ever exists.
// The check-in kiosk never uses this screen.

const MS_TILES = ['#F25022', '#7FBA00', '#00A4EF', '#FFB900']

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="0" y="0" width="10" height="10" fill={MS_TILES[0]} />
      <rect x="11" y="0" width="10" height="10" fill={MS_TILES[1]} />
      <rect x="0" y="11" width="10" height="10" fill={MS_TILES[2]} />
      <rect x="11" y="11" width="10" height="10" fill={MS_TILES[3]} />
    </svg>
  )
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignIn({ store }) {
  const { state: st, actions: a } = store
  const [step, setStep] = useState('start') // 'start' | 'code'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [devCode, setDevCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef(null)

  // Resend cooldown ticker.
  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const sendCode = async () => {
    if (busy || !EMAIL_OK.test(email.trim())) return
    setBusy(true); setErr(''); setDevCode('')
    try {
      const out = await requestLoginCode(email.trim())
      setStep('code'); setCode(''); setCooldown(30)
      if (out && out.devCode) setDevCode(out.devCode)
      setTimeout(() => codeRef.current && codeRef.current.focus(), 50)
    } catch (e) {
      setErr(e.message || 'Could not send the code — try again')
    }
    setBusy(false)
  }

  const verify = async () => {
    if (busy || code.length !== 6) return
    setBusy(true); setErr('')
    try {
      const user = await verifyLoginCode(email.trim(), code)
      if (user) await a.adoptSession(user)
      else setErr('Sign-in failed — request a new code')
    } catch (e) {
      setErr(e.message || 'That code didn’t work — try again')
      setCode('')
    }
    setBusy(false)
  }

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <img src={logoUrl} alt="Cholla" className="signin-logo" />
        <div className="signin-title">Staff &amp; Leadership sign-in</div>
        <div className="signin-sub">
          Open the facilitator and leadership dashboards. The check-in kiosk
          never requires sign-in.
        </div>

        <button className="ms-btn" onClick={() => { window.location.href = loginUrl() }}>
          <MicrosoftLogo />
          Sign in with Microsoft
        </button>

        <div className="signin-divider"><span>or use your work email</span></div>

        {step === 'start' && (
          <>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErr('') }}
              onKeyDown={(e) => e.key === 'Enter' && sendCode()}
              placeholder="name@chollabh.org"
              autoComplete="email"
            />
            <button
              className="btn"
              style={{ marginTop: 10, background: '#BE6A45', boxShadow: '0 10px 22px -8px rgba(190,106,69,.6)' }}
              disabled={busy || !EMAIL_OK.test(email.trim())}
              onClick={sendCode}
            >
              {busy ? 'Sending…' : 'Email me a sign-in code'}
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <div className="signin-sub" style={{ margin: '0 0 10px' }}>
              We sent a 6-digit code to <b>{email.trim()}</b>. It expires in 10 minutes.
            </div>
            <input
              ref={codeRef}
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }}
              onKeyDown={(e) => e.key === 'Enter' && verify()}
              placeholder="••••••"
            />
            <button
              className="btn"
              style={{ marginTop: 10, background: '#BE6A45', boxShadow: '0 10px 22px -8px rgba(190,106,69,.6)' }}
              disabled={busy || code.length !== 6}
              onClick={verify}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            {devCode && (
              <div className="signin-sub" style={{ marginTop: 10 }}>
                Local dev (no email service): your code is <b>{devCode}</b>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <button className="signin-link" onClick={() => { setStep('start'); setErr(''); setDevCode('') }}>
                ← Different email
              </button>
              <button className="signin-link" disabled={cooldown > 0 || busy} onClick={sendCode}>
                {cooldown > 0 ? 'Resend in ' + cooldown + 's' : 'Resend code'}
              </button>
            </div>
          </>
        )}

        {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}

        {!st.live && (
          <div className="signin-sub" style={{ marginTop: 14 }}>
            Demo build: no backend is connected, so the dashboards open automatically.
          </div>
        )}
      </div>
    </div>
  )
}
