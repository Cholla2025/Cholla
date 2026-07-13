import logoUrl from '../../Blue Agave Logo.png'
import { loginUrl } from '../lib/backend'

// Staff sign-in — Microsoft (Entra ID) ONLY, via the Static Web Apps built-in
// provider. There are no passwords and no emailed codes: everyone signs in
// with their Cholla Microsoft work account, and roles resolve server-side
// (platform role, staff record, or ADMIN_EMAILS bootstrap).
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

export default function SignIn({ store, compact }) {
  const { state: st } = store

  const card = (
    <div className="signin-card">
      {!compact && <img src={logoUrl} alt="Cholla" className="signin-logo" />}
      <div className="signin-title">Staff &amp; Leadership sign-in</div>
      <div className="signin-sub">
        Open the facilitator and leadership dashboards with your Cholla
        Microsoft account. The check-in kiosk never requires sign-in.
      </div>

      <button className="ms-btn" onClick={() => { window.location.href = loginUrl() }}>
        <MicrosoftLogo />
        Sign in with Microsoft
      </button>

      <div className="signin-sub" style={{ marginTop: 14, marginBottom: 0 }}>
        No separate password — sign-in is handled by Microsoft. If your account
        isn't recognized, ask leadership to add you in Settings.
      </div>

      {!st.live && (
        <div className="signin-sub" style={{ marginTop: 14 }}>
          Preview build: no backend is connected, so the dashboards open automatically.
        </div>
      )}
    </div>
  )

  if (compact) return <div style={{ marginTop: 12 }}>{card}</div>
  return <div className="signin-wrap">{card}</div>
}
