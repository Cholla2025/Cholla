import * as S from '../seed'
import { Seg } from '../ui'

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫']

export default function Kiosk({ store }) {
  const { state: st, set, actions: a, stats, getRoster } = store
  const { screen } = st

  if (screen === 'kiosk-confirm') return <Confirm st={st} a={a} />
  if (screen === 'kiosk-closeout') return <Closeout st={st} a={a} stats={stats} />
  if (screen === 'kiosk-member') return <Member st={st} a={a} stats={stats} getRoster={getRoster} />
  return <Start st={st} set={set} a={a} />
}

function Start({ st, set, a }) {
  const groups = S.GROUPS.filter((g) => g.session === st.kSession)
  const kGroupLabel = st.kGroup ? S.groupLabel(st.kSession, st.kGroup) : 'Select a group above'
  const begin = st.kCode.length === 4
  return (
    <div className="scroll fade cholla-scroll">
      <div className="kiosk-title">Facilitator setup</div>

      <div className="kiosk-block">
        <span className="lab">Session time</span>
        <Seg options={S.SESSIONS} value={st.kSession} onChange={(o) => set({ kSession: o })}
          activeBg="#4C84C4" />

        <div className="lab" style={{ marginTop: 16 }}>Select group</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {groups.map((g) => {
            const sel = g.n === st.kGroup
            return (
              <button key={g.n} onClick={() => set({ kGroup: g.n })}
                style={{ border: '1.5px solid ' + (sel ? '#4C84C4' : '#DCE3EE'), background: sel ? '#4C84C4' : '#fff', color: sel ? '#fff' : '#21314F', borderRadius: 12, padding: '12px 0', font: '600 15px Inter' }}>
                {g.n}
              </button>
            )
          })}
        </div>
        <div style={{ font: '600 13px Inter', color: st.kGroup ? '#21314F' : '#9AA8BD', marginTop: 12, textAlign: 'center' }}>{kGroupLabel}</div>
      </div>

      <div className="kiosk-block">
        <span className="lab">Facilitator code</span>
        <div className="codedots">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="codedot"
              style={{ borderColor: st.kCode.length === i ? '#4C84C4' : '#DCE3EE', background: st.kCode.length === i ? '#F2F7FD' : '#fff' }}>
              {st.kCode[i] ? '•' : ''}
            </div>
          ))}
        </div>
        {st.kCodeErr && <div style={{ color: '#B14233', font: '600 12.5px Inter', marginTop: 10, textAlign: 'center' }}>{st.kCodeErr}</div>}
        <div className="pad" style={{ marginTop: 14 }}>
          {PAD.map((l) => (
            <button key={l} onClick={() => a.padPressCode(l)}
              style={{ background: l === 'Clear' || l === '⌫' ? '#F4F7FB' : '#fff', fontSize: l === 'Clear' ? 15 : 22 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <button className="btn" style={{ marginTop: 16, background: begin ? '#BE6A45' : '#D8C3B8', boxShadow: begin ? '0 12px 24px -10px rgba(190,106,69,.65)' : 'none' }}
        disabled={!begin} onClick={a.beginSession}>
        Begin session
      </button>
      <div className="muted" style={{ textAlign: 'center', font: '500 12px Inter', marginTop: 12 }}>Demo facilitator code: 0 0 0 0</div>
    </div>
  )
}

function Member({ st, a, stats, getRoster }) {
  const g = S.group(st.kSession, st.kGroup)
  const present = g ? stats(g).present : 0
  const q = st.kEntry.trim().toLowerCase()
  const matched = q.length >= 2 && getRoster(g).some((r) => r.name.toLowerCase() === q)
  const word = st.kMode === 'in' ? 'in' : 'out'
  const label = st.kMode === 'in' ? 'Check in' : 'Check out'
  const enabled = st.kEntry.trim().length >= 2
  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">{st.kSession} session</div>
      <div className="section-sub">{S.groupLabel(st.kSession, st.kGroup)} · {present} present now</div>

      <div style={{ marginTop: 16 }}>
        <Seg options={['Check in', 'Check out']} value={st.kMode === 'in' ? 'Check in' : 'Check out'} onChange={a.setKMode} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <span className="lab">Enter your name to check {word}</span>
        <input className="input" value={st.kEntry} onChange={a.onMemberName} placeholder="First and last name" autoFocus />
        {matched && <div style={{ color: '#1F7A56', font: '600 12.5px Inter', marginTop: 10 }}>✓ We found your name</div>}
        <button className="btn" style={{ marginTop: 16, background: enabled ? '#BE6A45' : '#D8C3B8', boxShadow: enabled ? '0 12px 24px -10px rgba(190,106,69,.65)' : 'none' }}
          disabled={!enabled} onClick={a.doCheck}>
          {label}
        </button>
      </div>

      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={a.completeGroup}>Complete group &amp; close out</button>
    </div>
  )
}

function Confirm({ st, a }) {
  const conf = st.confirm || {}
  const isIn = conf.mode === 'in'
  return (
    <div className="scroll fade cholla-scroll" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
      <div className="pop" style={{ width: 92, height: 92, borderRadius: 999, margin: '0 auto', background: isIn ? '#EAF6F0' : '#EEF4FB', border: '3px solid ' + (isIn ? '#2E9E73' : '#4C84C4'), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 18px 36px -16px ' + (isIn ? 'rgba(46,158,115,.55)' : 'rgba(76,132,196,.55)') }}>
        <span style={{ font: '700 44px Inter', color: isIn ? '#1F7A56' : '#2C5C94' }}>✓</span>
      </div>
      <div style={{ font: '700 24px Inter', marginTop: 20, color: isIn ? '#1F7A56' : '#2C5C94' }}>
        {isIn ? 'You’re checked in' : 'You’re checked out'}
      </div>
      <div style={{ font: '600 15px Inter', color: '#21314F', marginTop: 6 }}>{conf.group}</div>
      <div className="card" style={{ marginTop: 18, background: isIn ? '#EAF6F0' : '#EEF4FB', border: 'none' }}>
        <div className="muted" style={{ font: '600 12px Inter' }}>{isIn ? 'Check-in time' : 'Check-out time'}</div>
        <div style={{ font: '700 26px Inter', marginTop: 4, color: isIn ? '#1F7A56' : '#2C5C94' }}>{conf.time}</div>
      </div>
      <div className="muted" style={{ font: '500 11.5px Inter', marginTop: 18, lineHeight: 1.5 }}>
        For your privacy, names are never shown here · this screen resets automatically
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={a.nextMember}>Next member</button>
    </div>
  )
}

function Closeout({ st, a, stats }) {
  const g = S.group(st.kSession, st.kGroup)
  const s = g ? stats(g) : { ci: 0, present: 0 }
  const range = '1:00 PM – ' + S.fmtClock(st.demoMin)
  return (
    <div className="scroll fade cholla-scroll" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="section-title" style={{ textAlign: 'center' }}>Session closed</div>
      <div className="section-sub" style={{ textAlign: 'center' }}>{S.groupLabel(st.kSession, st.kGroup)}</div>
      <div className="muted" style={{ textAlign: 'center', font: '500 12.5px Inter', marginTop: 4 }}>{st.kSession} session · {range}</div>

      <div className="kpi-grid" style={{ marginTop: 20 }}>
        <div className="kpi"><div className="v" style={{ color: '#1F7A56' }}>{s.ci}</div><div className="l">Checked in</div></div>
        <div className="kpi"><div className="v" style={{ color: '#4C84C4' }}>{s.present}</div><div className="l">Currently present</div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted" style={{ font: '600 12px Inter' }}>Time range</div>
        <div style={{ font: '700 18px Inter', marginTop: 4 }}>{range}</div>
      </div>

      <button className="btn" style={{ marginTop: 20 }} onClick={a.beginSession2}>Start new session</button>
    </div>
  )
}
