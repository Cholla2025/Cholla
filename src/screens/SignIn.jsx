import logoUrl from '../../Blue Agave Logo.png'
import { loginUrl } from '../lib/backend'

// Staff sign in with their Microsoft work account (Entra ID) via the Static
// Web Apps built-in provider. Roles (facilitator / leader) are assigned by
// invitation in the Azure portal, so there are no passwords or codes to manage
// here. This screen only appears in live mode — the demo signs itself in.
export default function SignIn({ store }) {
  const { state: st } = store

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <img src={logoUrl} alt="Cholla" className="signin-logo" />
        <div className="signin-title">Staff &amp; Leadership sign-in</div>
        <div className="signin-sub">
          Sign in with your Cholla Microsoft account to open the facilitator and
          leadership dashboards. The check-in kiosk never requires sign-in.
        </div>

        <button
          className="btn"
          style={{ background: '#BE6A45', boxShadow: '0 10px 22px -8px rgba(190,106,69,.6)' }}
          onClick={() => { window.location.href = loginUrl() }}
        >
          Sign in with Microsoft
        </button>

        {!st.live && (
          <div className="signin-sub" style={{ marginTop: 14 }}>
            Demo build: no backend is connected, so the dashboards open automatically.
          </div>
        )}
      </div>
    </div>
  )
}
