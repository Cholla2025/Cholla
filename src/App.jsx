import { useState, useEffect } from 'react'
import logoUrl from '../Blue Agave Logo.png'
import { useCheckIn } from './store'
import { canAccess, setKioskCode } from './lib/backend'
import Kiosk from './screens/Kiosk'
import DoorKiosk from './screens/DoorKiosk'
import VisitorKiosk from './screens/VisitorKiosk'
import Staff from './screens/Staff'
import Leader from './screens/Leader'
import Settings from './screens/Settings'
import AdminPortal from './screens/AdminPortal'
import Assistant from './screens/Assistant'
import SignIn from './screens/SignIn'

// Client check-in is for phones/tablets; the dashboards are desktop-only. We
// switch the entire shell on this breakpoint so neither surface leaks onto the
// wrong device. A device can also be pinned to kiosk mode with ?kiosk=1 (and
// unpinned with ?kiosk=0) — that's how a landscape tablet at the group room
// door stays a kiosk even though it's wider than the breakpoint.
const DESKTOP_QUERY = '(min-width: 900px)'
const KIOSK_PIN_KEY = 'cholla-kiosk-pin'
const DOOR_PIN_KEY = 'cholla-door-pin'

function readPin(key, param) {
  try {
    const q = new URLSearchParams(window.location.search).get(param)
    if (q === '1' || q === 'true') localStorage.setItem(key, '1')
    else if (q === '0' || q === 'false') localStorage.removeItem(key)
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

// ?kiosk=1 pins a device to the group check-in kiosk; ?door=1 pins it to the
// front-door check-in (a door device is always a kiosk device too).
function readKioskPin() { return readPin(KIOSK_PIN_KEY, 'kiosk') }
function readDoorPin() { return readPin(DOOR_PIN_KEY, 'door') }

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
  { key: 'staff', label: 'Facilitator Dashboard', go: 'goStaff' },
  { key: 'leader', label: 'Leadership', go: 'goLeader' },
  { key: 'settings', label: 'Settings', go: 'goSettings' },
  { key: 'adminportal', label: 'Admin', go: 'goAdmin' },
  // Set apart from the management tabs with a visual gap (detached: true).
  { key: 'ai', label: 'AI', go: 'goAi', detached: true },
]
const DESK_HINTS = {
  staff: 'Authenticated · live session roster',
  leader: 'Authenticated · roll-up & day-of settings',
  settings: 'Authenticated · profile, team & access',
  adminportal: 'Administrator · global controls',
  ai: 'Claude · aggregate data only',
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

const AREA_EYEBROWS = {
  group: 'Group Check-In',
  door: 'Member Site Check-In',
  visitor: 'Visitor Check-In',
}

// The kiosk device shell: front page with the three check-in areas, then the
// selected flow. Leaving a flow relocks the kiosk (the day code must be
// re-entered), which is what makes area-switching code-protected.
function KioskShell({ store, initialArea }) {
  const { state: st } = store
  const [area, setArea] = useState(initialArea)

  const exitArea = () => {
    setKioskCode(null) // relock — the next area asks for the code again
    setArea(null)
  }

  return (
    <div className="app app--mobile">
      <div className={'kiosk-header' + (area ? '' : ' kiosk-header--home')}>
        <img src={logoUrl} alt="Cholla Behavioral Health" />
        <div className="kiosk-eyebrow">{AREA_EYEBROWS[area] || 'Check-In'}</div>
      </div>
      {area === 'group' && <Kiosk store={store} onExit={exitArea} />}
      {area === 'door' && <DoorKiosk live={st.live} onExit={exitArea} />}
      {area === 'visitor' && <VisitorKiosk live={st.live} onExit={exitArea} />}
      {!area && (
        <div className="scroll fade cholla-scroll" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="section-title" style={{ textAlign: 'center' }}>Welcome</div>
          <div className="section-sub" style={{ textAlign: 'center', marginBottom: 18 }}>
            Choose a check-in below to begin
          </div>
          <button className="launch-btn" onClick={() => setArea('group')}>
            <span className="launch-title">Group Check-In</span>
            <span className="launch-sub">Members · check in and out of your group session</span>
          </button>
          <button className="launch-btn" onClick={() => setArea('door')}>
            <span className="launch-title">Site Check-In — Member</span>
            <span className="launch-sub">Members · arriving at or leaving the facility</span>
          </button>
          <button className="launch-btn" onClick={() => setArea('visitor')}>
            <span className="launch-title">Visitor Check-In</span>
            <span className="launch-sub">Guests, vendors &amp; family · sign in and out</span>
          </button>
        </div>
      )}
      <Footer />
    </div>
  )
}

function AccessPending({ store }) {
  const { state: st, actions: a } = store
  return (
    <div className="signin-wrap">
      <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <img src={logoUrl} alt="Cholla Behavioral Health" style={{ height: 64, margin: '0 auto 14px' }} />
        <div className="section-title">Access pending</div>
        <div className="section-sub" style={{ marginTop: 8 }}>
          You're signed in as {st.authName || 'this account'}, but no dashboard role has been
          assigned yet. Ask leadership to invite you as a facilitator or leader, then sign in again.
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={a.signOutUser}>Sign out</button>
      </div>
    </div>
  )
}

export default function App() {
  const store = useCheckIn()
  const { state: st, actions: a } = store
  const isDesktop = useIsDesktop()
  const [kioskPinned] = useState(readKioskPin)
  const [doorPinned] = useState(readDoorPin)
  const kioskDevice = !isDesktop || kioskPinned || doorPinned

  // Keep the active surface valid for the current device.
  useEffect(() => {
    if (!kioskDevice && st.surface === 'kiosk') a.goStaff()
    else if (kioskDevice && st.surface !== 'kiosk') a.goKiosk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kioskDevice])

  // ---- KIOSK DEVICE: check-in only (open, no sign-in) ----
  // A front page offers the three check-in areas; every area is unlocked with
  // the facilitator day code, and switching areas relocks the device — so the
  // code IS the gate for changing modes.
  if (kioskDevice) {
    return (
      <KioskShell
        store={store}
        initialArea={doorPinned ? 'door' : null}
      />
    )
  }

  // ---- DESKTOP: dashboards, behind sign-in ----
  if (!st.authReady) {
    return <div className="app app--desktop"><div className="signin-wrap">Loading…</div></div>
  }
  if (!st.authUser) {
    return <div className="app app--desktop"><SignIn store={store} /><Footer /></div>
  }
  if (!st.authRole) {
    return <div className="app app--desktop"><AccessPending store={store} /><Footer /></div>
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
            <button key={t.key} onClick={a[t.go]}
              className={(surface === t.key ? 'active' : '') + (t.detached ? ' tab-detached' : '')}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="desk-right">
          <span className="desk-hint">{DESK_HINTS[surface]}</span>
          {st.live && <button className="desk-reset" onClick={a.signOutUser}>Sign out</button>}
        </div>
      </header>

      <main className="desk-main cholla-scroll">
        <div className="desk-inner">
          {surface === 'staff' && <Staff store={store} />}
          {surface === 'leader' && <Leader store={store} />}
          {surface === 'settings' && <Settings store={store} />}
          {surface === 'adminportal' && <AdminPortal store={store} />}
          {surface === 'ai' && <Assistant store={store} />}
        </div>
        <Footer />
      </main>
    </div>
  )
}
