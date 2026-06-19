import { useState, useRef, useCallback, useEffect } from 'react'
import * as S from './seed'
import { fetchOverrides, saveRoster, supabaseEnabled } from './lib/data'

function makeInitialState() {
  return {
    surface: 'kiosk', screen: 'kiosk-start',
    staffAuthed: false, leaderAuthed: false,
    demoMin: 13 * 60 + 47,
    kSession: 'Afternoon', kGroup: 3, kCode: '', kCodeErr: '',
    kMode: 'in', kEntry: '', confirm: null,
    staffEmail: 'd.alvarez@chollabh.org', staffMfa: '', staffName: 'Dana Alvarez, LISAC',
    staffGroup: 3, staffSession: 'Afternoon', staffFrom: S.TODAY, staffTo: S.TODAY,
    staffStatus: 'All', staffSearch: '', staffView: 'live',
    leaderEmail: 'r.okafor@chollabh.org', leaderMfa: '', leaderName: 'Ruth Okafor, Clinical Director',
    leaderSessionF: 'All', leaderFac: 'All', leaderStatusF: 'All', leaderFrom: S.TODAY, leaderTo: S.TODAY,
    leaderSearch: '', leaderGroupSession: null, leaderGroupN: null,
    detailStatus: 'All', detailSearch: '',
    newName: '', newId: '',
    rosters: { 'Afternoon-3': S.initialRoster() },
  }
}

export function useCheckIn() {
  const [state, setState] = useState(makeInitialState)
  const ref = useRef(state)
  ref.current = state
  const timer = useRef(null)

  const set = useCallback((patch) => {
    setState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : patch
      const merged = { ...prev, ...next }
      ref.current = merged
      return merged
    })
  }, [])

  // Load any persisted rosters for today from Supabase (if configured).
  useEffect(() => {
    if (!supabaseEnabled) return
    let alive = true
    fetchOverrides(S.TODAY).then((overrides) => {
      if (alive && overrides && Object.keys(overrides).length) {
        set((prev) => ({ rosters: { ...prev.rosters, ...overrides } }))
      }
    })
    return () => { alive = false }
  }, [set])

  // ----- roster helpers -----
  const curRoster = (g, rosters) => {
    const k = S.rosterKey(g)
    return rosters[k] ? rosters[k] : S.defaultRoster(g)
  }
  const getRoster = (g) => (g ? curRoster(g, ref.current.rosters) : [])
  const stats = (g) => S.statsOf(getRoster(g))
  const groupClients = (g) => getRoster(g).map((r) => r.name.toLowerCase())

  const persist = (g, rows) => saveRoster(g.session, g.n, S.TODAY, rows)

  const writeRoster = (g, rows, extra = {}) => {
    const k = S.rosterKey(g)
    set((prev) => ({ rosters: { ...prev.rosters, [k]: rows }, ...extra }))
    persist(g, rows)
  }

  const mutateGroup = (g, matchFn, fn) => {
    if (!g) return
    const s = ref.current
    const cur = curRoster(g, s.rosters)
    const t = S.fmtClock(s.demoMin + 1)
    const next = cur.map((r) => (matchFn(r) ? fn(r, t) : r))
    writeRoster(g, next, { demoMin: s.demoMin + 1 })
  }

  // ----- navigation -----
  const goKiosk = () => set((s) => ({ surface: 'kiosk', screen: s.screen.startsWith('kiosk') ? s.screen : 'kiosk-start' }))
  const goStaff = () => set((s) => ({ surface: 'staff', screen: s.staffAuthed ? 'staff-dashboard' : 'staff-auth' }))
  const goLeader = () => set((s) => ({ surface: 'leader', screen: s.leaderAuthed ? (s.leaderGroupN ? 'leader-detail' : 'leader-overview') : 'leader-auth' }))
  const resetDemo = () => { clearTimeout(timer.current); setState(makeInitialState()) }

  // ----- kiosk -----
  const padPressCode = (d) => set((s) => {
    let c = s.kCode
    if (d === 'Clear') c = ''
    else if (d === '⌫') c = c.slice(0, -1)
    else if (c.length < 4) c = c + d
    return { kCode: c, kCodeErr: '' }
  })
  const padPressEntry = (d) => set((s) => {
    let c = s.kEntry
    if (d === 'Clear') c = ''
    else if (d === '⌫') c = c.slice(0, -1)
    else if (c.length < 4) c = c + d
    return { kEntry: c }
  })
  const beginSession = () => {
    if (ref.current.kCode !== S.FACILITATOR_CODE) { set({ kCodeErr: 'Enter facilitator code 0000 to begin' }); return }
    set({ screen: 'kiosk-member', kEntry: '', kMode: 'in' })
  }
  const beginSession2 = () => set({ screen: 'kiosk-start', kCode: '', kCodeErr: '', kEntry: '', confirm: null })
  const setKMode = (m) => set({ kMode: m === 'Check in' ? 'in' : 'out', kEntry: '' })
  const onMemberName = (e) => set({ kEntry: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40) })

  const doCheck = () => {
    const { kEntry, kMode, kSession, kGroup, demoMin } = ref.current
    const q = kEntry.trim()
    if (q.length < 2) return
    const g = S.group(kSession, kGroup)
    const nm = demoMin + 1 + Math.floor(Math.random() * 2)
    const t = S.fmtClock(nm)
    const cur = curRoster(g, ref.current.rosters)
    const i = cur.findIndex((r) => r.name.toLowerCase() === q.toLowerCase())
    let next
    if (i >= 0) {
      next = cur.slice()
      next[i] = kMode === 'in'
        ? { ...cur[i], checkin: t, checkout: null, status: 'Checked In' }
        : { ...cur[i], checkout: t, status: 'Checked Out' }
    } else {
      const id = String(1800 + cur.length)
      next = [...cur, kMode === 'in'
        ? { id, name: S.titleCase(q), checkin: t, checkout: null, status: 'Checked In' }
        : { id, name: S.titleCase(q), checkin: null, checkout: t, status: 'Checked Out' }]
    }
    const conf = { mode: kMode, name: S.titleCase(q), group: S.groupLabel(kSession, kGroup), time: t }
    writeRoster(g, next, { demoMin: nm, confirm: conf, screen: 'kiosk-confirm', kEntry: '' })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (ref.current.screen === 'kiosk-confirm') set({ screen: 'kiosk-member', confirm: null })
    }, 4800)
  }
  const nextMember = () => { clearTimeout(timer.current); set({ screen: 'kiosk-member', confirm: null }) }
  const completeGroup = () => { clearTimeout(timer.current); set({ screen: 'kiosk-closeout' }) }

  // ----- staff -----
  const staffGroupObj = () => S.group(ref.current.staffSession, ref.current.staffGroup)
  const staffVerify = () => { const s = ref.current; if (s.staffMfa.length === 6 && s.staffEmail.includes('@')) set({ staffAuthed: true, screen: 'staff-dashboard' }) }
  const onStaffMfa = (e) => set({ staffMfa: e.target.value.replace(/\D/g, '').slice(0, 6) })
  const staffSetSession = (sv) => { const first = S.GROUPS.find((g) => g.session === sv); set({ staffSession: sv, staffGroup: first ? first.n : ref.current.staffGroup, staffView: 'live', staffStatus: 'All', staffSearch: '' }) }
  const onStaffGroup = (e) => set({ staffGroup: parseInt(e.target.value, 10), staffView: 'live', staffStatus: 'All', staffSearch: '' })
  const toggleStaffView = () => set((s) => ({ staffView: s.staffView === 'live' ? 'empty' : 'live' }))

  const checkInClient = (id) => mutateGroup(staffGroupObj(), (r) => r.id === id, (r, t) => ({ ...r, checkin: t, checkout: null, status: 'Checked In' }))
  const checkOutClient = (id) => mutateGroup(staffGroupObj(), (r) => r.id === id, (r, t) => ({ ...r, checkout: t, status: 'Checked Out' }))
  const markAbsent = (id) => mutateGroup(staffGroupObj(), (r) => r.id === id, (r) => ({ ...r, checkin: null, checkout: null, status: 'Absent' }))

  const onNewName = (e) => set({ newName: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40) })
  const onNewId = (e) => set({ newId: e.target.value.replace(/\D/g, '').slice(0, 6) })
  const addClient = (checkIn) => {
    const nm = S.titleCase(ref.current.newName)
    if (nm.length < 2) return
    const g = staffGroupObj()
    const s = ref.current
    const cur = curRoster(g, s.rosters)
    const t = S.fmtClock(s.demoMin + 1)
    const id = s.newId || String(1700 + cur.length)
    const row = checkIn
      ? { id, name: nm, checkin: t, checkout: null, status: 'Checked In' }
      : { id, name: nm, checkin: null, checkout: null, status: 'Expected' }
    writeRoster(g, [...cur, row], { demoMin: s.demoMin + 1, newName: '', newId: '', staffView: 'live' })
  }

  // ----- leader -----
  const leaderVerify = () => { const s = ref.current; if (s.leaderMfa.length === 6 && s.leaderEmail.includes('@')) set({ leaderAuthed: true, screen: 'leader-overview' }) }
  const onLeaderMfa = (e) => set({ leaderMfa: e.target.value.replace(/\D/g, '').slice(0, 6) })
  const openGroup = (session, n) => set({ leaderGroupSession: session, leaderGroupN: n, screen: 'leader-detail', detailStatus: 'All', detailSearch: '' })
  const backToOverview = () => set({ leaderGroupN: null, screen: 'leader-overview' })

  useEffect(() => () => clearTimeout(timer.current), [])

  return {
    state, set, supabaseEnabled,
    getRoster, stats, groupClients,
    actions: {
      goKiosk, goStaff, goLeader, resetDemo,
      padPressCode, padPressEntry, beginSession, beginSession2, setKMode, onMemberName, doCheck, nextMember, completeGroup,
      staffVerify, onStaffMfa, staffSetSession, onStaffGroup, toggleStaffView,
      checkInClient, checkOutClient, markAbsent, onNewName, onNewId, addClient, staffGroupObj,
      leaderVerify, onLeaderMfa, openGroup, backToOverview,
    },
  }
}
