import { useState, useEffect } from 'react'
import logoUrl from '../Blue Agave Logo.png'
import { useCheckIn } from './store'
import Kiosk from './screens/Kiosk'
import Staff from './screens/Staff'
import Leader from './screens/Leader'

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

const DESK_NAV = [
  { key: 'staff', label: 'Staff Dashboard', go: 'goStaff' },
  { key: 'leader', label: 'Leadership', go: 'goLeader' },
]
const DESK_HINTS = {
  staff: 'Authenticated · live session roster',
  leader: 'Authenticated · organization roll-up',
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

  // Keep the active surface valid for the current device: phones land on the
  // kiosk, desktops land on a dashboard. Never show the other device's surface.
  useEffect(() => {
    if (isDesktop && st.surface === 'kiosk') a.goStaff()
    else if (!isDesktop && st.surface !== 'kiosk') a.goKiosk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop])

  // ---- MOBILE: client kiosk only ----
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

  // ---- DESKTOP: dashboards only, full screen ----
  const surface = st.surface === 'kiosk' ? 'staff' : st.surface
  return (
    <div className="app app--desktop">
      <header className="desk-nav">
        <img src={logoUrl} alt="Cholla" className="desk-logo" />
        <nav className="desk-tabs">
          {DESK_NAV.map((t) => (
            <button key={t.key} onClick={a[t.go]} className={surface === t.key ? 'active' : ''}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="desk-right">
          <span className="desk-hint">{DESK_HINTS[surface]}</span>
          <button className="desk-reset" onClick={a.resetDemo}>Reset demo</button>
        </div>
      </header>

      <main className="desk-main cholla-scroll">
        <div className="desk-inner">
          {surface === 'staff' && <Staff store={store} />}
          {surface === 'leader' && <Leader store={store} />}
        </div>
        <Footer />
      </main>
    </div>
  )
}
