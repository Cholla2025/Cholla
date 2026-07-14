import { useState, useRef, useCallback, useEffect } from 'react'
import * as S from './seed'
import * as B from './lib/backend'

// Auth fields are kept separate from the preview-data state so resetting it
// never logs anyone out.
function makeAuthState() {
  return { authReady: false, authUser: null, authRole: null, authName: '' }
}

// Demo data (fictional names) exists ONLY in dev builds — a production build
// starts from genuinely empty state and everything comes from the API.
const DEMO = B.DEMO_ALLOWED

function makeInitialState() {
  const today = S.todayISO()
  return {
    live: false,
    apiDown: false,
    surface: 'kiosk', screen: 'kiosk-start',
    today, todayLabel: S.todayLabel(),
    demoMin: 13 * 60 + 47,
    org: DEMO ? S.defaultOrg() : { groups: [], facilitators: [] }, orgBusy: false, orgErr: '',
    rosterErr: '',
    kSession: S.currentSession(), kGroup: null, kCode: '', kCodeErr: '', kBusy: false,
    kUnlocked: false, kUnlockedBy: null, kSaving: false, kErr: '', kClients: [],
    clients: DEMO ? S.defaultClients() : [], clientsBusy: false, clientsErr: '',
    kMode: 'in', kEntry: '', confirm: null,
    staffName: DEMO ? 'Dana Alvarez, LISAC' : '',
    staffGroup: 1, staffSession: S.currentSession(), staffFrom: today, staffTo: today,
    staffStatus: 'All', staffSearch: '', staffView: 'live',
    leaderName: DEMO ? 'Ruth Okafor, Clinical Director' : '',
    leaderSessionF: 'All', leaderFac: 'All', leaderStatusF: 'All', leaderFrom: today, leaderTo: today,
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

  // ----- org helpers -----
  const groupsFor = (session) => ref.current.org.groups.filter((g) => g.session === session).sort((a, b) => a.n - b.n)
  // The groups the signed-in user runs. Facilitators are auto-scoped to the
  // groups whose facilitator record carries their account email; leadership
  // and admins see every group.
  const myGroups = () => {
    const s = ref.current
    if (s.authRole !== 'facilitator') return s.org.groups
    const email = (s.authUser?.email || '').toLowerCase()
    if (!email) return []
    const ids = new Set(
      s.org.facilitators
        .filter((f) => f.active !== false && String(f.email || '').toLowerCase() === email)
        .map((f) => f.id)
    )
    return s.org.groups.filter((g) => g.facilitatorId && ids.has(g.facilitatorId))
  }
  const myGroupsFor = (session) => myGroups().filter((g) => g.session === session).sort((a, b) => a.n - b.n)
  const getGroup = (session, n) => ref.current.org.groups.find((g) => g.session === session && g.n === Number(n))
  const facById = (id) => ref.current.org.facilitators.find((f) => f.id === id)
  const facLabelFor = (g) => S.facLabel(g && facById(g.facilitatorId))

  // Keep the staff dashboard's selected group pointing at a group that still
  // exists in the (possibly just-loaded, possibly just-edited) org.
  const reconcileStaffGroup = (org, session, current) => {
    const inSession = org.groups.filter((g) => g.session === session).sort((a, b) => a.n - b.n)
    if (inSession.some((g) => g.n === Number(current))) return current
    return inSession[0] ? inSession[0].n : null
  }

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
        rosters = await B.fetchRosters(S.todayISO())
      }
      const user = await B.getUser()
      // Staff sessions load the client list for roster pre-population.
      const clients = live && user ? await B.fetchClients() : null
      if (!alive) return
      const d = new Date()
      set((prev) => {
        // LIVE MODE NEVER SHOWS DEMO DATA: if the org fetch failed, render an
        // empty org with an error rather than inheriting the fictional
        // preview org a fresh device starts with.
        const nextOrg = org && Array.isArray(org.groups)
          ? { groups: sortGroups(org.groups), facilitators: org.facilitators || [] }
          : live
            ? { groups: [], facilitators: [] }
            : prev.org
        return {
          live,
          apiDown: B.backendDown(),
          org: nextOrg,
          orgErr: live && !org ? 'Could not load the schedule — check the connection and reload' : prev.orgErr,
          clients: live ? (clients || []) : prev.clients,
          rosters: { ...prev.rosters, ...rosters },
          demoMin: live ? d.getHours() * 60 + d.getMinutes() : prev.demoMin,
          staffGroup: reconcileStaffGroup(nextOrg, prev.staffSession, prev.staffGroup),
          authReady: true,
          authUser: user ? { id: user.id, email: user.email, provider: user.provider } : null,
          authRole: user ? user.role : null,
          authName: user ? user.name : '',
          // Live mode never shows the fictional preview staff names.
          staffName: user?.name || (live ? user?.email || '' : prev.staffName),
          leaderName: user?.name || (live ? user?.email || '' : prev.leaderName),
        }
      })
    })()
    return () => { alive = false }
  }, [set])

  // ----- keep long-lived pages honest -----
  // A kiosk tablet stays open for days. Every minute (and whenever the tab
  // regains focus) in live mode: re-pull today's rosters so other devices'
  // check-ins appear, and roll the app over when the date changes so
  // check-ins never land on yesterday's roster.
  useEffect(() => {
    const refresh = async () => {
      const s = ref.current
      const today = S.todayISO()
      if (today !== s.today) {
        set((prev) => ({
          today,
          todayLabel: S.todayLabel(),
          rosters: {},
          staffFrom: prev.staffFrom === prev.today ? today : prev.staffFrom,
          staffTo: prev.staffTo === prev.today ? today : prev.staffTo,
          leaderFrom: prev.leaderFrom === prev.today ? today : prev.leaderFrom,
          leaderTo: prev.leaderTo === prev.today ? today : prev.leaderTo,
        }))
      }
      if (!s.live) return
      if (s.authUser) {
        const rosters = await B.fetchRosters(today)
        set((prev) => ({ rosters: { ...prev.rosters, ...rosters } }))
      } else if (s.kUnlocked && s.kGroup) {
        // Kiosk devices are scoped to the ONE group they're running.
        const rosters = await B.fetchRosters(today, { session: s.kSession, n: s.kGroup })
        set((prev) => ({ rosters: { ...prev.rosters, ...rosters } }))
      }
    }
    const iv = setInterval(refresh, 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible) }
  }, [set])

  const signOutUser = () => {
    if (ref.current.live) B.signOut(ref.current.authUser?.provider)
    // Demo mode has no real session to end.
  }

  // Called by the sign-in screen after a successful email-code exchange: the
  // token is already stored, so adopt the identity and pull live data the
  // same way startup does.
  const adoptSession = async (user) => {
    const org = await B.fetchOrg().catch(() => null)
    const rosters = await B.fetchRosters(S.todayISO())
    const clients = await B.fetchClients()
    set({ clients: clients || [] })
    set((prev) => {
      const nextOrg = org && Array.isArray(org.groups)
        ? { groups: sortGroups(org.groups), facilitators: org.facilitators || [] }
        : prev.org
      return {
        org: nextOrg,
        rosters: { ...prev.rosters, ...rosters },
        staffGroup: reconcileStaffGroup(nextOrg, prev.staffSession, prev.staffGroup),
        authUser: { id: user.email, email: user.email, provider: 'email' },
        authRole: user.role || null,
        authName: user.name || '',
        staffName: user.name || prev.staffName,
        leaderName: user.name || prev.leaderName,
      }
    })
  }

  // Settings → My profile. Persists the display name to the caller's own
  // staff record and updates every place the name shows.
  const saveProfile = async (name) => {
    try {
      if (ref.current.live) await B.updateProfile(name)
      set({ authName: name, staffName: name, leaderName: name })
      return true
    } catch {
      return false
    }
  }

  // ----- client list management (Leadership → Clients) -----
  const clientsRun = async (fn) => {
    set({ clientsBusy: true, clientsErr: '' })
    try {
      const out = await fn()
      set({ clientsBusy: false })
      return out
    } catch (err) {
      set({ clientsBusy: false, clientsErr: err.message || 'Action failed' })
      return null
    }
  }

  const sortClients = (list) => list.slice().sort((a, b) => a.name.localeCompare(b.name))

  // Bulk/single add. Returns { added, duplicates, invalid } or null on error.
  const addClientsBulk = (entries) => clientsRun(async () => {
    const out = await B.addClients(entries)
    if (out && out.added && out.added.length) {
      set((prev) => ({ clients: sortClients([...prev.clients, ...out.added]) }))
    }
    return out
  })

  const updateClientRec = (id, patch) => clientsRun(async () => {
    const out = await B.updateClient(id, patch)
    const rec = out && out.client
    set((prev) => ({
      clients: sortClients(prev.clients.map((c) => (c.id === id ? { ...c, ...(rec || patch) } : c))),
    }))
    return rec || true
  })

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
    set((prev) => {
      const org = { ...prev.org, groups: prev.org.groups.filter((g) => g.id !== id) }
      return { org, staffGroup: reconcileStaffGroup(org, prev.staffSession, prev.staffGroup) }
    })
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
      // A filter pointing at a deleted facilitator would silently match nothing.
      leaderFac: prev.leaderFac === id ? 'All' : prev.leaderFac,
    }))
  })

  // ----- roster helpers -----
  // Live mode never invents people — but it DOES pre-populate each group's
  // roster with the clinic's ASSIGNED clients (from the managed client list)
  // as "Expected" rows, so facilitators see who should be in the room and
  // attendance is measured against a real denominator. Kiosk devices carry no
  // client list (clients loads only for signed-in staff), so this merge is a
  // no-op there.
  const curRoster = (g, rosters) => {
    const k = S.rosterKey(g)
    if (!ref.current.live) return rosters[k] || S.defaultRoster(g)
    const rows = (rosters[k] || []).slice()
    const haveIds = new Set(rows.map((r) => String(r.id)))
    const haveNames = new Set(rows.map((r) => r.name.toLowerCase()))
    for (const c of ref.current.clients) {
      if (!c.active || c.session !== g.session || c.n !== g.n) continue
      if (haveIds.has(String(c.id)) || haveNames.has(c.name.toLowerCase())) continue
      rows.push({ id: c.id, name: c.name, checkin: null, checkout: null, status: 'Expected' })
    }
    return rows
  }
  const getRoster = (g) => (g ? curRoster(g, ref.current.rosters) : [])
  const stats = (g) => S.statsOf(getRoster(g))
  const groupClients = (g) => getRoster(g).map((r) => r.name.toLowerCase())

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

  const writeLocalRoster = (g, rows, extra = {}) => {
    const k = S.rosterKey(g)
    set((prev) => ({ rosters: { ...prev.rosters, [k]: rows }, ...extra }))
  }

  // Persist ONE row through the server's merge endpoint, then adopt the
  // server's copy (which may contain other devices' check-ins). On failure:
  // surface the error and re-pull so the local view matches reality — never
  // pretend an unsaved change was saved.
  const syncRow = async (g, row) => {
    if (!ref.current.live) return true
    try {
      const rows = await B.saveRosterRow(g.session, g.n, S.todayISO(), row)
      if (rows) writeLocalRoster(g, rows)
      return true
    } catch (err) {
      const rosters = await B.fetchRosters(S.todayISO())
      set((prev) => ({
        rosterErr: 'Could not save — ' + (err.message || 'check the connection and try again'),
        rosters: { ...prev.rosters, ...rosters },
      }))
      return false
    }
  }

  const mutateGroup = (g, matchFn, fn) => {
    if (!g) return
    const { t, demoMin } = tick()
    const cur = curRoster(g, ref.current.rosters)
    let changed = null
    const next = cur.map((r) => {
      if (!matchFn(r)) return r
      changed = fn(r, t)
      return changed
    })
    writeLocalRoster(g, next, { demoMin, rosterErr: '' })
    if (changed) syncRow(g, changed)
  }

  // ----- navigation ----- (access is gated at the app shell by role)
  const goKiosk = () => set((s) => ({ surface: 'kiosk', screen: s.screen.startsWith('kiosk') ? s.screen : 'kiosk-start' }))
  const goStaff = () => set({ surface: 'staff', screen: 'staff-dashboard' })
  const goMember = () => set({ surface: 'member', screen: 'member' })
  const goCommunity = () => set({ surface: 'community', screen: 'community' })
  const goLeader = () => set((s) => ({ surface: 'leader', screen: s.leaderGroupN ? 'leader-detail' : 'leader-overview' }))
  const goAnalytics = () => set({ surface: 'analytics', screen: 'analytics' })
  const goSettings = () => set({ surface: 'settings', screen: 'settings' })
  const goAdmin = () => set({ surface: 'adminportal', screen: 'adminportal' })
  const goAi = () => set({ surface: 'ai', screen: 'ai' })
  // Mobile "Home": relock the kiosk and return all the way to the
  // device-selection screen.
  const resetKioskHome = () => {
    clearTimeout(timer.current)
    B.setKioskCode(null)
    set({
      surface: 'kiosk', screen: 'kiosk-start',
      kCode: '', kCodeErr: '', kEntry: '', kErr: '',
      kUnlocked: false, kUnlockedBy: null, kBusy: false, kSaving: false, confirm: null,
    })
  }
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
    const out = await B.verifyKioskCode(s.kCode)
    if (!out || !out.ok) {
      set({
        kBusy: false, kCode: '',
        kCodeErr: s.live ? 'That code didn’t match — check with the front office' : 'Enter facilitator code 0000 to begin',
      })
      return
    }
    B.setKioskCode(s.kCode)
    let kClients = []
    if (s.live) {
      // The kiosk is anonymous until unlocked; now it can read today's roster
      // and assigned client names for THIS group only (server-scoped).
      const rosters = await B.fetchRosters(S.todayISO(), { session: s.kSession, n: s.kGroup })
      kClients = (await B.fetchGroupClients(s.kSession, s.kGroup)) || []
      set((prev) => ({ rosters: { ...prev.rosters, ...rosters } }))
    } else {
      kClients = S.defaultClients().filter((c) => c.active && c.session === s.kSession && c.n === s.kGroup)
    }
    set({
      kBusy: false, kUnlocked: true,
      kUnlockedBy: out.facilitator ? out.facilitator.name : null,
      kClients, screen: 'kiosk-member', kEntry: '', kErr: '', kMode: 'in',
    })
  }
  const beginSession2 = () => {
    // Lock the kiosk again between sessions — the code must be re-entered.
    B.setKioskCode(null)
    set({ screen: 'kiosk-start', kCode: '', kCodeErr: '', kEntry: '', kErr: '', kUnlocked: false, kUnlockedBy: null, confirm: null })
  }
  const setKMode = (m) => set({ kMode: m === 'Check in' ? 'in' : 'out', kEntry: '', kErr: '' })
  const onMemberName = (e) => set({ kEntry: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40), kErr: '' })

  const doCheck = async () => {
    const s = ref.current
    const q = s.kEntry.trim()
    if (q.length < 2 || s.kSaving) return
    const g = getGroup(s.kSession, s.kGroup)
    if (!g) return
    const { t, demoMin } = tick(s.live ? 0 : Math.floor(Math.random() * 2))
    const cur = curRoster(g, s.rosters)
    const i = cur.findIndex((r) => r.name.toLowerCase() === q.toLowerCase())
    let row
    if (i >= 0) {
      row = s.kMode === 'in'
        ? { ...cur[i], checkin: t, checkout: null, status: 'Checked In' }
        : { ...cur[i], checkout: t, status: 'Checked Out' }
    } else {
      // A first-time check-in that matches an assigned client keeps the
      // client's opaque id, so the roster row and the client record tie up.
      const assigned = s.kClients.find((c) => c.name.toLowerCase() === q.toLowerCase())
      const id = assigned ? String(assigned.id) : String(1800 + cur.length)
      row = s.kMode === 'in'
        ? { id, name: assigned ? assigned.name : S.titleCase(q), checkin: t, checkout: null, status: 'Checked In' }
        : { id, name: assigned ? assigned.name : S.titleCase(q), checkin: null, checkout: t, status: 'Checked Out' }
    }
    const conf = { mode: s.kMode, name: S.titleCase(q), group: S.groupLabel(s.kSession, s.kGroup), time: t }

    // Live mode: the confirmation screen is a promise to the client that their
    // attendance was recorded — so it only shows after the server says yes.
    if (s.live) {
      set({ kSaving: true, kErr: '' })
      const saved = await syncRow(g, row)
      if (!saved) {
        set({ kSaving: false, kErr: 'That didn’t save — please try again, or flag your facilitator', rosterErr: '' })
        return
      }
      set({ kSaving: false, demoMin, confirm: conf, screen: 'kiosk-confirm', kEntry: '' })
    } else {
      const next = i >= 0 ? cur.map((r, idx) => (idx === i ? row : r)) : [...cur, row]
      writeLocalRoster(g, next, { demoMin, confirm: conf, screen: 'kiosk-confirm', kEntry: '' })
    }
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
    // Facilitators only ever land on their own groups.
    const pool = ref.current.authRole === 'facilitator' ? myGroupsFor(sv) : groupsFor(sv)
    const first = pool[0]
    set({ staffSession: sv, staffGroup: first ? first.n : null, staffView: 'live', staffStatus: 'All', staffSearch: '' })
  }
  const onStaffGroup = (e) => set({ staffGroup: parseInt(e.target.value, 10), staffView: 'live', staffStatus: 'All', staffSearch: '' })
  const toggleStaffView = () => set((s) => ({ staffView: s.staffView === 'live' ? 'empty' : 'live' }))

  const checkInClient = (id) => mutateGroup(staffGroupObj(), (r) => r.id === id, (r, t) => ({ ...r, checkin: t, checkout: null, status: 'Checked In' }))
  const checkOutClient = (id) => mutateGroup(staffGroupObj(), (r) => r.id === id, (r, t) => ({ ...r, checkout: t, status: 'Checked Out' }))
  const markAbsent = (id) => mutateGroup(staffGroupObj(), (r) => r.id === id, (r) => ({ ...r, checkin: null, checkout: null, status: 'Absent' }))

  const onNewName = (e) => set({ newName: e.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 40), rosterErr: '' })
  const onNewId = (e) => set({ newId: e.target.value.replace(/\D/g, '').slice(0, 6), rosterErr: '' })
  const addClient = (checkIn) => {
    const nm = S.titleCase(ref.current.newName)
    if (nm.length < 2) return
    const g = staffGroupObj()
    if (!g) return
    const { t, demoMin } = tick()
    const cur = curRoster(g, ref.current.rosters)
    let id = ref.current.newId
    if (id && cur.some((r) => r.id === id)) {
      set({ rosterErr: 'ID ' + id + ' is already on this roster — pick another or leave it blank' })
      return
    }
    if (!id) {
      // Generate an id that cannot collide with anything already on the list.
      let candidate = 1700 + cur.length
      while (cur.some((r) => String(r.id) === String(candidate))) candidate++
      id = String(candidate)
    }
    const row = checkIn
      ? { id, name: nm, checkin: t, checkout: null, status: 'Checked In' }
      : { id, name: nm, checkin: null, checkout: null, status: 'Expected' }
    writeLocalRoster(g, [...cur, row], { demoMin, newName: '', newId: '', staffView: 'live', rosterErr: '' })
    syncRow(g, row)
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
    myGroups, myGroupsFor,
    actions: {
      goKiosk, goStaff, goMember, goCommunity, goLeader, goAnalytics, goSettings, goAdmin, goAi,
      resetKioskHome, resetDemo, signOutUser, adoptSession, saveProfile,
      addGroup, removeGroup, assignFacilitator, addFacilitator, removeFacilitator,
      addClientsBulk, updateClientRec,
      padPressCode, setKSession, beginSession, beginSession2, setKMode, onMemberName, doCheck, nextMember, completeGroup,
      staffSetSession, onStaffGroup, toggleStaffView,
      checkInClient, checkOutClient, markAbsent, onNewName, onNewId, addClient, staffGroupObj,
      openGroup, backToOverview, setLeaderView,
    },
  }
}
