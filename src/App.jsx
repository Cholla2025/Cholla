import { useState, useEffect } from 'react'
import logoUrl from '../Blue Agave Logo.png'
import { useCheckIn } from './store'
import { canAccess } from './lib/auth'
import Kiosk from './screens/Kiosk'
import Staff from './screens/Staff'
import Leader from './screens/Leader'
import Admin from './screens/Admin'
import SignIn from './screens/SignIn'

// Client check-in is phone-only; the dashboards are desktop-only. We switch the
// entire shell on this breakpoint so neither surface leaks onto the wrong device.
const DESKTOP_QUERY = '(min-width: 900px)'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

const ALL_TABS = [
  { key: 'staff', label: 'Staff Dashboard', go: 'goStaff' },
  { key: 'leader', label: 'Leadership', go: 'goLeader' },
  { key: 'admin', label: 'Admin', go: 'goAdmin' },
]
const DESK_HINTS = {
  staff: 'Authenticated · live session roster',
  leader: 'Authenticated · organization roll-up',
  admin: 'Administrator · manage groups & staff',
}

function Footer() {
  return (
    <div className="footer-credit">
      Built by{' '}
      <a href="https://www.phxcw.com" target="_blank" rel="noopener noreferrer">
        Phoenix Creative Works
      </a>
    </div>
  )
}

export default function App() {
  const store = useCheckIn()
  const { state: st, actions: a } = store
  const isDesktop = useIsDesktop()

  // Keep the active surface valid for the current device.
  useEffect(() => {
    if (isDesktop && st.surface === 'kiosk') a.goStaff()
    else if (!isDesktop && st.surface !== 'kiosk') a.goKiosk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop])

  // ---- MOBILE: client kiosk only (open, no sign-in) ----
  if (!isDesktop) {
    return (
      <div className="app app--mobile">
        <div className="topbar">
          <img src={logoUrl} alt="Cholla" />
          <div style={{ flex: 1 }}>
            <div className="wm">Cholla</div>
            <div className="hint">Client check-in</div>
          </div>
        </div>
        <Kiosk store={store} />
        <Footer />
      </div>
    )
  }

  // ---- DESKTOP: dashboards, behind sign-in ----
  if (!st.authReady) {
    return <div className="app app--desktop"><div className="signin-wrap">Loading…</div></div>
  }
  if (!st.authUser) {
    return <div className="app app--desktop"><SignIn store={store} /><Footer /></div>
  }

  const role = st.authRole
  const tabs = ALL_TABS.filter((t) => canAccess(role, t.key))
  let surface = st.surface === 'kiosk' ? 'staff' : st.surface
  if (!canAccess(role, surface)) surface = tabs[0]?.key || 'staff'

  return (
    <div className="app app--desktop">
      <header className="desk-nav">
        <img src={logoUrl} alt="Cholla" className="desk-logo" />
        <nav className="desk-tabs">
          {tabs.map((t) => (
            <button key={t.key} onClick={a[t.go]} className={surface === t.key ? 'active' : ''}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="desk-right">
          <span className="desk-hint">{DESK_HINTS[surface]}</span>
          <button className="desk-reset" onClick={a.resetDemo}>Reset demo</button>
          <button className="desk-reset" onClick={a.signOutUser}>Sign out</button>
        </div>
      </header>

      <main className="desk-main cholla-scroll">
        <div className="desk-inner">
          {surface === 'staff' && <Staff store={store} />}
          {surface === 'leader' && <Leader store={store} />}
          {surface === 'admin' && <Admin store={store} />}
        </div>
        <Footer />
      </main>
    </div>
  )
}
