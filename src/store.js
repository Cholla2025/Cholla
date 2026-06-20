import { useState, useRef, useCallback, useEffect } from 'react'
import * as S from './seed'
import { fetchOverrides, saveRoster, supabaseEnabled } from './lib/data'
import { getCurrentUser, fetchProfile, sendToken, verifyToken, signOut, onAuthChange } from './lib/auth'

// Auth fields are kept separate from the demo state so "Reset demo" never logs
// anyone out.
function makeAuthState() {
  return {
    authReady: false, authUser: null, authRole: null, authName: '',
    authEmail: '', authToken: '', authStep: 'email', authBusy: false,
    authErr: '', authSent: false,
  }
}

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
    ...makeAuthState(),
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

  // ----- auth -----
  // Resolve a signed-in user into role + display name (or clear when signed out).
  const applyUser = useCallback(async (user) => {
    if (!user) { set({ authUser: null, authRole: null, authName: '', authReady: true }); return }
    const profile = await fetchProfile(user.id)
    const role = profile?.role || 'facilitator'
    const name = profile?.full_name || user.email || ''
    set((prev) => ({
      authUser: { id: user.id, email: user.email }, authRole: role, authName: name,
      authReady: true, authErr: '', authToken: '', authStep: 'email', authSent: false,
      staffName: name || prev.staffName, leaderName: name || prev.leaderName,
    }))
  }, [set])

  useEffect(() => {
    let unsub = () => {}
    if (!supabaseEnabled) {
      // No backend configured: run as a demo admin so the dashboards are usable.
      set({ authReady: true, authUser: { id: 'demo' }, authRole: 'admin', authName: 'Demo Admin' })
      return
    }
    getCurrentUser().then(applyUser)
    unsub = onAuthChange((user) => applyUser(user))
    return () => unsub()
  }, [applyUser, set])

  const setAuthEmail = (e) => set({ authEmail: e.target.value, authErr: '' })
  const setAuthToken = (e) => set({ authToken: e.target.value.replace(/\D/g, '').slice(0, 8), authErr: '' })
  const backToEmail = () => set({ authStep: 'email', authToken: '', authErr: '', authSent: false })
  const sendAuthToken = async () => {
    const email = ref.current.authEmail.trim()
    if (!email.includes('@')) { set({ authErr: 'Enter a valid work email' }); return }
    set({ authBusy: true, authErr: '' })
    const { error } = await sendToken(email)
    if (error) set({ authBusy: false, authErr: error.message || 'Could not send a code to that email' })
    else set({ authBusy: false, authSent: true, authStep: 'token' })
  }
  const verifyAuthToken = async () => {
    const { authEmail, authToken } = ref.current
    if (authToken.length < 6) { set({ authErr: 'Enter the code from your email' }); return }
    set({ authBusy: true, authErr: '' })
    const { user, error } = await verifyToken(authEmail, authToken)
    if (error || !user) set({ authBusy: false, authErr: error?.message || 'That code did not match' })
    else { set({ authBusy: false }); await applyUser(user) }
  }
  const signOutUser = async () => { await signOut(); set({ ...makeAuthState(), authReady: true, surface: 'kiosk' }) }

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

  // ----- navigation ----- (access is gated at the app shell by role)
  const goKiosk = () => set((s) => ({ surface: 'kiosk', screen: s.screen.startsWith('kiosk') ? s.screen : 'kiosk-start' }))
  const goStaff = () => set({ surface: 'staff', screen: 'staff-dashboard' })
  const goLeader = () => set((s) => ({ surface: 'leader', screen: s.leaderGroupN ? 'leader-detail' : 'leader-overview' }))
  const goAdmin = () => set({ surface: 'admin', screen: 'admin' })
  // Reset the demo roster state without disturbing the signed-in session.
  const resetDemo = () => {
    clearTimeout(timer.current)
    const { authReady, authUser, authRole, authName } = ref.current
    setState({ ...makeInitialState(), authReady, authUser, authRole, authName, surface: ref.current.surface, screen: ref.current.screen })
  }
  // Toggle a signed-in user between the Facilitator and Leadership dashboards.
  const switchDash = (which) => (which === 'Leadership' ? goLeader() : goStaff())

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
  // Demo sign-in unlocks BOTH dashboards: every account can reach Facilitator
  // and Leadership and toggle between them via the in-app switch.
  const staffVerify = () => { const s = ref.current; if (s.staffMfa.length === 6 && s.staffEmail.includes('@')) set({ staffAuthed: true, leaderAuthed: true, screen: 'staff-dashboard' }) }
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
  const leaderVerify = () => { const s = ref.current; if (s.leaderMfa.length === 6 && s.leaderEmail.includes('@')) set({ leaderAuthed: true, staffAuthed: true, screen: 'leader-overview' }) }
  const onLeaderMfa = (e) => set({ leaderMfa: e.target.value.replace(/\D/g, '').slice(0, 6) })
  const openGroup = (session, n) => set({ leaderGroupSession: session, leaderGroupN: n, screen: 'leader-detail', detailStatus: 'All', detailSearch: '' })
  const backToOverview = () => set({ leaderGroupN: null, screen: 'leader-overview' })

  useEffect(() => () => clearTimeout(timer.current), [])

  return {
    state, set, supabaseEnabled,
    getRoster, stats, groupClients,
    actions: {
      goKiosk, goStaff, goLeader, goAdmin, resetDemo, switchDash,
      setAuthEmail, setAuthToken, sendAuthToken, verifyAuthToken, backToEmail, signOutUser,
      padPressCode, padPressEntry, beginSession, beginSession2, setKMode, onMemberName, doCheck, nextMember, completeGroup,
      staffVerify, onStaffMfa, staffSetSession, onStaffGroup, toggleStaffView,
      checkInClient, checkOutClient, markAbsent, onNewName, onNewId, addClient, staffGroupObj,
      leaderVerify, onLeaderMfa, openGroup, backToOverview,
    },
  }
}
