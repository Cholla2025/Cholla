import { useState, useEffect } from 'react'
import logoUrl from '../Blue Agave Logo.png'
import { useCheckIn } from './store'
import { canAccess, setKioskCode } from './lib/backend'
import Kiosk from './screens/Kiosk'
import DoorKiosk from './screens/DoorKiosk'
import VisitorKiosk from './screens/VisitorKiosk'
import Staff from './screens/Staff'
import MemberCheckIn from './screens/MemberCheckIn'
import Community from './screens/Community'
import Leader from './screens/Leader'
import Analytics from './screens/Analytics'
import Settings from './screens/Settings'
import AdminPortal from './screens/AdminPortal'
import Assistant from './screens/Assistant'
import SignIn from './screens/SignIn'
import PreRegister from './screens/PreRegister'
import MobileDash from './screens/MobileDash'

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
// Member Check-In door (a door device is always a kiosk device too).
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

// Top-level, role-gated tabs (filtered per role through canAccess). The three
// data streams each have their own surface: group rosters (Facilitator
// Dashboard / Leadership), Member Check-In (clients at the door), and
// Community Check-In (non-client visitors, leadership only).
const ALL_TABS = [
  { key: 'staff', label: 'Facilitator Dashboard', go: 'goStaff' },
  { key: 'member', label: 'Member Check-In', go: 'goMember' },
  { key: 'community', label: 'Community Check-In', go: 'goCommunity' },
  { key: 'leader', label: 'Leadership', go: 'goLeader' },
  { key: 'analytics', label: 'Analytics', go: 'goAnalytics' },
  { key: 'settings', label: 'Settings', go: 'goSettings' },
  { key: 'adminportal', label: 'Admin', go: 'goAdmin' },
  // Set apart from the management tabs with a visual gap (detached: true).
  { key: 'ai', label: 'AI', go: 'goAi', detached: true },
]
const DESK_HINTS = {
  staff: 'Authenticated · live session roster',
  member: 'Authenticated · members at the facility',
  community: 'Leadership · non-client visitors',
  leader: 'Authenticated · roll-up & day-of settings',
  analytics: 'Leadership · trends & personal alerts',
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
  door: 'Member Check-In',
  visitor: 'Community Check-In',
  dash: 'Staff Dashboards',
}

// The kiosk device shell: front page with the three check-in areas (plus the
// staff dashboard entry), then the selected flow. Leaving a flow relocks the
// kiosk (the code must be re-entered), which is what makes area-switching
// code-protected — and the Home button at the bottom always leads back to
// this device-selection screen.
function KioskShell({ store, initialArea }) {
  const { state: st, actions: a } = store
  const [area, setArea] = useState(initialArea)

  const exitArea = () => {
    setKioskCode(null) // relock — the next area asks for the code again
    setArea(null)
  }
  const goHome = () => {
    a.resetKioskHome() // relock + reset every kiosk screen
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
      {area === 'dash' && <MobileDash store={store} />}
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
            <span className="launch-title">Member Check-In</span>
            <span className="launch-sub">Members · arriving at or leaving the facility</span>
          </button>
          <button className="launch-btn" onClick={() => setArea('visitor')}>
            <span className="launch-title">Community Check-In</span>
            <span className="launch-sub">Guests, vendors &amp; family · sign in and out</span>
          </button>
          <button className="launch-btn launch-btn--ghost" onClick={() => setArea('dash')}>
            <span className="launch-title">Staff &amp; Leadership</span>
            <span className="launch-sub">Sign in with Microsoft · dashboards on this device</span>
          </button>
        </div>
      )}
      {area && <button className="kiosk-home" onClick={goHome}>⌂ Home</button>}
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

  // Public visitor pre-registration page — no auth, no kiosk, its own route.
  const isPreregister = typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/preregister'

  // Back-button hardening: after sign-out the browser may restore this page
  // from the back/forward cache with authenticated data still rendered.
  // Reloading on any bfcache restore re-runs the auth check from scratch.
  useEffect(() => {
    const onPageShow = (e) => { if (e.persisted) window.location.reload() }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // Keep the active surface valid for the current device.
  useEffect(() => {
    if (isPreregister) return
    if (!kioskDevice && st.surface === 'kiosk') a.goStaff()
    else if (kioskDevice && st.surface !== 'kiosk') a.goKiosk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kioskDevice])

  if (isPreregister) {
    return <PreRegister />
  }

  // ---- KIOSK DEVICE: check-in only (open, no sign-in) ----
  // A front page offers the three check-in areas; every area is unlocked with
  // a facilitator's kiosk code, and switching areas relocks the device — so
  // the code IS the gate for changing modes. The Staff & Leadership entry is
  // the one signed-in surface (trimmed, mostly read-only dashboards).
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
          {!st.live && <span className="preview-badge">Preview data · no backend</span>}
          {st.apiDown && <span className="preview-badge">Can't reach the server</span>}
          <span className="desk-hint">{DESK_HINTS[surface]}</span>
          {st.live && <button className="desk-reset" onClick={a.signOutUser}>Sign out</button>}
        </div>
      </header>

      <main className="desk-main cholla-scroll">
        <div className="desk-inner">
          {surface === 'staff' && <Staff store={store} />}
          {surface === 'member' && <MemberCheckIn store={store} />}
          {surface === 'community' && <Community store={store} />}
          {surface === 'leader' && <Leader store={store} />}
          {surface === 'analytics' && <Analytics store={store} />}
          {surface === 'settings' && <Settings store={store} />}
          {surface === 'adminportal' && <AdminPortal store={store} />}
          {surface === 'ai' && <Assistant store={store} />}
        </div>
        <Footer />
      </main>
    </div>
  )
}
