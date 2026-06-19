import logoUrl from '../Blue Agave Logo.png'
import { useCheckIn } from './store'
import Kiosk from './screens/Kiosk'
import Staff from './screens/Staff'
import Leader from './screens/Leader'

const HINTS = {
  kiosk: 'One device per group · privacy-first',
  staff: 'Authenticated · live session roster',
  leader: 'Authenticated · organization roll-up',
}

const TABS = [
  { key: 'kiosk', label: 'Client Kiosk', sub: 'Check in', go: 'goKiosk' },
  { key: 'staff', label: 'Staff', sub: 'Roster', go: 'goStaff' },
  { key: 'leader', label: 'Leadership', sub: 'Dashboard', go: 'goLeader' },
]

export default function App() {
  const store = useCheckIn()
  const { state: st, actions: a, supabaseEnabled } = store

  return (
    <div className="app">
      <div className="topbar">
        <img src={logoUrl} alt="Cholla" />
        <div style={{ flex: 1 }}>
          <div className="wm">Cholla</div>
          <div className="hint">{HINTS[st.surface]}</div>
        </div>
        <button onClick={a.resetDemo}
          style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: 'none', borderRadius: 10, padding: '7px 11px', font: '600 12px Inter' }}>
          Reset demo
        </button>
      </div>

      {st.surface === 'kiosk' && <Kiosk store={store} />}
      {st.surface === 'staff' && <Staff store={store} />}
      {st.surface === 'leader' && <Leader store={store} />}

      <div style={{ textAlign: 'center', font: '500 10.5px Inter', color: supabaseEnabled ? '#2E9E73' : '#9AA8BD', padding: '4px 0' }}>
        {supabaseEnabled ? '● Live · Supabase connected' : '○ Sample data (offline demo)'}
      </div>

      <div className="tabbar">
        {TABS.map((t) => {
          const active = st.surface === t.key
          return (
            <button key={t.key} className="tab" onClick={a[t.go]}
              style={{ background: active ? '#21314F' : 'transparent', color: active ? '#fff' : '#5A6B85' }}>
              {t.label}
              <small style={{ color: active ? '#AEBED6' : '#9AA8BD' }}>{t.sub}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
