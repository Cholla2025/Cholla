import logoUrl from '../../Blue Agave Logo.png'
import { Field } from '../ui'

// Passwordless sign-in: enter work email → receive a one-time code → verify.
// There is no password to reset — requesting a new code is the reset.
export default function SignIn({ store }) {
  const { state: st, actions: a } = store
  const onToken = st.authStep === 'token'
  const busy = st.authBusy

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <img src={logoUrl} alt="Cholla" className="signin-logo" />
        <div className="signin-title">Staff &amp; Leadership sign-in</div>
        <div className="signin-sub">
          {onToken
            ? `Enter the code we emailed to ${st.authEmail}`
            : 'Enter your work email and we’ll send you a one-time sign-in code'}
        </div>

        {!onToken && (
          <>
            <Field label="Work email">
              <input className="input" type="email" autoFocus value={st.authEmail}
                onChange={a.setAuthEmail}
                onKeyDown={(e) => e.key === 'Enter' && a.sendAuthToken()}
                placeholder="you@chollabehavioralhealth.com" />
            </Field>
            <button className="btn" disabled={busy} onClick={a.sendAuthToken}
              style={{ background: busy ? '#D8C3B8' : '#BE6A45' }}>
              {busy ? 'Sending…' : 'Send sign-in code'}
            </button>
          </>
        )}

        {onToken && (
          <>
            <Field label="One-time code">
              <input className="input" inputMode="numeric" autoFocus value={st.authToken}
                onChange={a.setAuthToken}
                onKeyDown={(e) => e.key === 'Enter' && a.verifyAuthToken()}
                placeholder="••••••" />
            </Field>
            <button className="btn" disabled={busy} onClick={a.verifyAuthToken}
              style={{ background: busy ? '#D8C3B8' : '#BE6A45' }}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <div className="signin-row">
              <button className="signin-link" onClick={a.backToEmail}>← Use a different email</button>
              <button className="signin-link" onClick={a.sendAuthToken} disabled={busy}>Resend code</button>
            </div>
          </>
        )}

        {st.authErr && <div className="signin-err">{st.authErr}</div>}
      </div>
    </div>
  )
}
