import { useState, useRef, useCallback, useEffect } from 'react'
import * as S from './seed'
import * as B from './lib/backend'

// Auth fields are kept separate from the demo state so "Reset demo" never logs
// anyone out.
function makeAuthState() {
  return { authReady: false, authUser: null, authRole: null, authName: '' }
}

function makeInitialState() {
  return {
    live: false,
    surface: 'kiosk', screen: 'kiosk-start',
    demoMin: 13 * 60 + 47,
    org: S.defaultOrg(), orgBusy: false, orgErr: '',
    kSession: S.CURRENT, kGroup: null, kCode: '', kCodeErr: '', kBusy: false,
    kMode: 'in', kEntry: '', confirm: null,
    staffName: 'Dana Alvarez, LISAC',
    staffGroup: 1, staffSession: S.CURRENT, staffFrom: S.TODAY, staffTo: S.TODAY,
    staffStatus: 'All', staffSearch: '', staffView: 'live',
    leaderName: 'Ruth Okafor, Clinical Director',
    leaderSessionF: 'All', leaderFac: 'All', leaderStatusF: 'All', leaderFrom: S.TODAY, leaderTo: S.TODAY,
    leaderSearch: '', leaderGroupSession: null, leaderGroupN: null, leaderView: 'overview',
    detailStatus: 'All', detailSearch: '',
    newName: '', newId: '',
    rosters: {},
    ...makeAuthState(),
  }
}

function sortGroups(groups) {
  return groups.slice().sort((a, b) =>
    a.session === b.session ? a.n - b.n : S.SESSIONS.indexOf(a.session) - S.SESSIONS.indexOf(b.session))
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

  // ----- startup: probe the Azure backend, then load identity + org + today's
  // rosters. With no backend reachable everything stays on demo defaults.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const live = await B.initBackend()
      let org = null
      let rosters = {}
      if (live) {
        org = await B.fetchOrg().catch(() => null)
        rosters = await B.fetchRosters(S.TODAY)
      }
      const user = await B.getUser()
      if (!alive) return
      const d = new Date()
      set((prev) => ({
        live,
        org: org && Array.isArray(org.groups)
          ? { groups: sortGroups(org.groups), facilitators: org.facilitators || [] }
          : prev.org,
        rosters: { ...prev.rosters, ...rosters },
        demoMin: live ? d.getHours() * 60 + d.getMinutes() : prev.demoMin,
        authReady: true,
        authUser: user ? { id: user.id, email: user.email } : null,
        authRole: user ? user.role : null,
        authName: user ? user.name : '',
        staffName: user?.name || prev.staffName,
        leaderName: user?.name || prev.leaderName,
      }))
    })()
    return () => { alive = false }
  }, [set])

  const signOutUser = () => {
    if (ref.current.live) window.location.href = B.logoutUrl()
    // Demo mode has no real session to end.
  }

  // ----- org helpers -----
  const groupsFor = (session) => ref.current.org.groups.filter((g) => g.session === session).sort((a, b) => a.n - b.n)
  const getGroup = (session, n) => ref.current.org.groups.find((g) => g.session === session && g.n === Number(n))
  const facById = (id) => ref.current.org.facilitators.find((f) => f.id === id)
  const facLabelFor = (g) => S.facLabel(g && facById(g.facilitatorId))

  // ----- org management (Leadership → Day-of settings) -----
  const orgRun = async (fn) => {
    set({ orgBusy: true, orgErr: '' })
    try {
      await fn()
      set({ orgBusy: false })
      return true
    } catch (err) {
      set({ orgBusy: false, orgErr: err.message || 'Action failed' })
      return false
    }
  }

  const addGroup = ({ session, n, name, facilitatorId }) => orgRun(async () => {
    const num = parseInt(n, 10)
    if (!S.SESSIONS.includes(session)) throw new Error('Pick a session')
    if (!num || num < 1) throw new Error('Group number is required')
    if (ref.current.org.groups.some((g) => g.session === session && g.n === num)) {
      throw new Error(session + ' Group ' + num + ' already exists')
    }
    const draft = {
      id: session.toLowerCase() + '-' + num,
      session, n: num,
      name: (name || '').trim() || session + ' IOP',
      facilitatorId: facilitatorId || null,
    }
    const out = await B.addGroup(draft)
    const grp = (out && out.group) || draft
    set((prev) => ({ org: { ...prev.org, groups: sortGroups([...prev.org.groups, grp]) } }))
  })

  const removeGroup = (id) => orgRun(async () => {
    await B.removeGroup(id)
    set((prev) => ({ org: { ...prev.org, groups: prev.org.groups.filter((g) => g.id !== id) } }))
  })

  const assignFacilitator = (groupId, facilitatorId) => orgRun(async () => {
    await B.assignFacilitator(groupId, facilitatorId || null)
    set((prev) => ({
      org: {
        ...prev.org,
        groups: prev.org.groups.map((g) => (g.id === groupId ? { ...g, facilitatorId: facilitatorId || null } : g)),
      },
    }))
  })

  const addFacilitator = ({ name, credential, email }) => orgRun(async () => {
    const nm = (name || '').trim()
    if (nm.length < 2) throw new Error('Facilitator name is required')
    const draft = { name: nm, credential: (credential || '').trim(), email: (email || '').trim(), active: true }
    const out = await B.addFacilitator(draft)
    const fac = (out && out.facilitator) || { ...draft, id: 'f-' + nm.toLowerCase().replace(/\W+/g, '-') }
    set((prev) => ({ org: { ...prev.org, facilitators: [...prev.org.facilitators, fac] } }))
  })

  const removeFacilitator = (id) => orgRun(async () => {
    await B.removeFacilitator(id)
    set((prev) => ({
      org: {
        facilitators: prev.org.facilitators.filter((f) => f.id !== id),
        groups: prev.org.groups.map((g) => (g.facilitatorId === id ? { ...g, facilitatorId: null } : g)),
      },
    }))
  })

  // ----- roster helpers -----
  // Live mode never invents clients: a group with no stored roster is empty.
  const curRoster = (g, rosters) => {
    const k = S.rosterKey(g)
    if (rosters[k]) return rosters[k]
    return ref.current.live ? [] : S.defaultRoster(g)
  }
  const getRoster = (g) => (g ? curRoster(g, ref.current.rosters) : [])
  const stats = (g) => S.statsOf(getRoster(g))
  const groupClients = (g) => getRoster(g).map((r) => r.name.toLowerCase())

  const persist = (g, rows) => B.saveRoster(g.session, g.n, S.TODAY, rows)

  const writeRoster = (g, rows, extra = {}) => {
    const k = S.rosterKey(g)
    set((prev) => ({ rosters: { ...prev.rosters, [k]: rows }, ...extra }))
    persist(g, rows)
  }

  // Current wall-clock in live mode; the advancing demo clock otherwise.
  const tick = (jitter = 0) => {
    const s = ref.current
    if (s.live) {
      const d = new Date()
      return { t: S.fmtClock(d.getHours() * 60 + d.getMinutes()), demoMin: d.getHours() * 60 + d.getMinutes() }
    }
    const m = s.demoMin + 1 + jitter
    return { t: S.fmtClock(m), demoMin: m }
  }

  const mutateGroup = (g, matchFn, fn) => {
    if (!g) return
    const { t, demoMin } = tick()
    const cur = curRoster(g, ref.current.rosters)
    const next = cur.map((r) => (matchFn(r) ? fn(r, t) : r))
    writeRoster(g, next, { demoMin })
  }

  // ----- navigation ----- (access is gated at the app shell by role)
  const goKiosk = () => set((s) => ({ surface: 'kiosk', screen: s.screen.startsWith('kiosk') ? s.screen : 'kiosk-start' }))
  const goStaff = () => set({ surface: 'staff', screen: 'staff-dashboard' })
  const goLeader = () => set((s) => ({ surface: 'leader', screen: s.leaderGroupN ? 'leader-detail' : 'leader-overview' }))
  // Reset the demo roster state without disturbing sign-in, org, or live data.
  const resetDemo = () => {
    clearTimeout(timer.current)
    const { authReady, authUser, authRole, authName, live, org, surface, screen } = ref.current
    setState({ ...makeInitialState(), authReady, authUser, authRole, authName, live, org, surface, screen })
  }

  // ----- kiosk -----
  const padPressCode = (d) => set((s) => {
    let c = s.kCode
    if (d === 'Clear') c = ''
    else if (d === '⌫') c = c.slice(0, -1)
    else if (c.length < 4) c = c + d
    return { kCode: c, kCodeErr: '' }
  })
  const setKSession = (o) => set((s) => {
    const stays = ref.current.org.groups.some((g) => g.session === o && g.n === s.kGroup)
    return { kSession: o, kGroup: stays ? s.kGroup : null }
  })
  const beginSession = async () => {
    const s = ref.current
    if (!s.kGroup || !getGroup(s.kSession, s.kGroup)) { set({ kCodeErr: 'Select a group above to begin' }); return }
    if (s.kCode.length !== 4 || s.kBusy) return
    set({ kBusy: true, kCodeErr: '' })
    const ok = await B.verifyKioskCode(s.kCode)
    if (!ok) {
      set({
        kBusy: false, kCode: '',
        kCodeErr: s.live ? 'That code didn’t match — check with the front office' : 'Enter facilitator code 0000 to begin',
      })
      return
    }
    B.setKioskCode(s.kCode)
    if (s.live) {
      // The kiosk is anonymous until unlocked; now it can read today's rosters.
      const rosters = await B.fetchRosters(S.TODAY)
      set((prev) => ({ rosters: { ...prev.rosters, ...rosters } }))
    }
    set({ kBusy: false, screen: 'kiosk-member', kEntry: '', kMode: 'in' })
  }
  const beginSession2 = () => set({ screen: 'kiosk-start', kCode: '', kCodeErr: '', kEntry: '', confirm: null })
  const setKMode = (m) => set({ kMode: m === 'Check in' ? 'in' : 'out', kEntry: '' })
  const onMemberName = (e) => set({ kEntry: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40) })

  const doCheck = () => {
    const { kEntry, kMode, kSession, kGroup, live } = ref.current
    const q = kEntry.trim()
    if (q.length < 2) return
    const g = getGroup(kSession, kGroup)
    if (!g) return
    const { t, demoMin } = tick(live ? 0 : Math.floor(Math.random() * 2))
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
    writeRoster(g, next, { demoMin, confirm: conf, screen: 'kiosk-confirm', kEntry: '' })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (ref.current.screen === 'kiosk-confirm') set({ screen: 'kiosk-member', confirm: null })
    }, 4800)
  }
  const nextMember = () => { clearTimeout(timer.current); set({ screen: 'kiosk-member', confirm: null }) }
  const completeGroup = () => { clearTimeout(timer.current); set({ screen: 'kiosk-closeout' }) }

  // ----- staff (facilitator dashboard) -----
  const staffGroupObj = () => getGroup(ref.current.staffSession, ref.current.staffGroup)
  const staffSetSession = (sv) => {
    const first = groupsFor(sv)[0]
    set({ staffSession: sv, staffGroup: first ? first.n : null, staffView: 'live', staffStatus: 'All', staffSearch: '' })
  }
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
    if (!g) return
    const { t, demoMin } = tick()
    const cur = curRoster(g, ref.current.rosters)
    const id = ref.current.newId || String(1700 + cur.length)
    const row = checkIn
      ? { id, name: nm, checkin: t, checkout: null, status: 'Checked In' }
      : { id, name: nm, checkin: null, checkout: null, status: 'Expected' }
    writeRoster(g, [...cur, row], { demoMin, newName: '', newId: '', staffView: 'live' })
  }

  // ----- leader -----
  const openGroup = (session, n) => set({ leaderGroupSession: session, leaderGroupN: n, screen: 'leader-detail', detailStatus: 'All', detailSearch: '' })
  const backToOverview = () => set({ leaderGroupN: null, screen: 'leader-overview' })
  const setLeaderView = (v) => set({ leaderView: v, leaderGroupN: null, screen: 'leader-overview', orgErr: '' })

  useEffect(() => () => clearTimeout(timer.current), [])

  return {
    state, set,
    getRoster, stats, groupClients,
    groupsFor, getGroup, facById, facLabelFor,
    actions: {
      goKiosk, goStaff, goLeader, resetDemo, signOutUser,
      addGroup, removeGroup, assignFacilitator, addFacilitator, removeFacilitator,
      padPressCode, setKSession, beginSession, beginSession2, setKMode, onMemberName, doCheck, nextMember, completeGroup,
      staffSetSession, onStaffGroup, toggleStaffView,
      checkInClient, checkOutClient, markAbsent, onNewName, onNewId, addClient, staffGroupObj,
      openGroup, backToOverview, setLeaderView,
    },
  }
}
