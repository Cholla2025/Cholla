import { useEffect, useState, useCallback } from 'react'
import * as A from '../lib/admin'
import { Field, ActionButton, Empty } from '../ui'

const SESSIONS = ['Morning', 'Afternoon', 'Evening']
const ROLE_LABEL = { admin: 'Admin', leader: 'Leadership', facilitator: 'Facilitator' }

export default function Admin({ store }) {
  const name = store.state.authName
  const [facs, setFacs] = useState([])
  const [groups, setGroups] = useState([])
  const [staff, setStaff] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [nf, setNf] = useState({ name: '', credential: '', email: '' })
  const [ng, setNg] = useState({ session: 'Morning', n: '', name: 'IOP', facilitator_id: '' })

  const reload = useCallback(async () => {
    const [f, g, s] = await Promise.all([A.listFacilitators(), A.listGroups(), A.listStaff()])
    setFacs(f); setGroups(g); setStaff(s)
  }, [])
  useEffect(() => { reload() }, [reload])

  const run = async (fn) => {
    setBusy(true); setErr('')
    const { error } = (await fn()) || {}
    setBusy(false)
    if (error) setErr(error.message || 'Action failed')
    else await reload()
  }

  const addFac = () => {
    if (nf.name.trim().length < 2) { setErr('Facilitator name is required'); return }
    run(() => A.addFacilitator(nf)).then(() => setNf({ name: '', credential: '', email: '' }))
  }
  const addGroup = () => {
    if (!ng.n) { setErr('Group number is required'); return }
    run(() => A.addGroup(ng)).then(() => setNg({ session: 'Morning', n: '', name: 'IOP', facilitator_id: '' }))
  }

  const notConnected = !A.supabaseEnabled

  return (
    <div className="scroll fade cholla-scroll">
      <div className="section-title">Admin</div>
      <div className="section-sub">{name} · Manage facilitators, groups &amp; staff access</div>

      {notConnected && (
        <div className="card" style={{ marginTop: 14, color: '#B5742A' }}>
          Supabase isn’t configured in this build, so admin changes can’t be saved here.
          Set the env vars and reload to manage live data.
        </div>
      )}
      {err && <div className="signin-err" style={{ marginTop: 12 }}>{err}</div>}

      {/* Facilitators */}
      <div className="admin-section">
        <div className="admin-h">Facilitators</div>
        <div className="card admin-form">
          <Field label="Name"><input className="input" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Credential"><input className="input" value={nf.credential} onChange={(e) => setNf({ ...nf, credential: e.target.value })} placeholder="LPC, LCSW…" /></Field>
          <Field label="Email"><input className="input" type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="name@chollabehavioralhealth.com" /></Field>
          <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={addFac}>Add facilitator</button>
        </div>
        <div className="card" style={{ marginTop: 12, padding: facs.length ? '4px 16px' : 16 }}>
          {facs.length ? facs.filter((f) => f.active !== false).map((f) => (
            <div className="roster-row" key={f.id}>
              <div>
                <div className="roster-name">{f.name}{f.credential ? `, ${f.credential}` : ''}</div>
                <div className="roster-meta"><span>{f.email || 'no email'}</span></div>
              </div>
              <ActionButton label="Remove" color="#B14233" border="#E6BCB5" onClick={() => run(() => A.removeFacilitator(f.id))} />
            </div>
          )) : <Empty>No facilitators yet</Empty>}
        </div>
      </div>

      {/* Groups */}
      <div className="admin-section">
        <div className="admin-h">Groups</div>
        <div className="card admin-form">
          <Field label="Session">
            <select className="select" value={ng.session} onChange={(e) => setNg({ ...ng, session: e.target.value })}>
              {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Group #"><input className="input" inputMode="numeric" value={ng.n} onChange={(e) => setNg({ ...ng, n: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="11" /></Field>
          <Field label="Name"><input className="input" value={ng.name} onChange={(e) => setNg({ ...ng, name: e.target.value })} placeholder="IOP" /></Field>
          <Field label="Facilitator">
            <select className="select" value={ng.facilitator_id} onChange={(e) => setNg({ ...ng, facilitator_id: e.target.value })}>
              <option value="">Unassigned</option>
              {facs.filter((f) => f.active !== false).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <button className="btn" style={{ width: 'auto', alignSelf: 'end' }} disabled={busy} onClick={addGroup}>Add group</button>
        </div>
        <div className="card" style={{ marginTop: 12, padding: groups.length ? '4px 16px' : 16 }}>
          {groups.length ? groups.filter((g) => g.active !== false).map((g) => (
            <div className="roster-row" key={g.id}>
              <div>
                <div className="roster-name">{g.session} · Group {g.n} · {g.name}</div>
                <div className="roster-meta"><span>{g.facilitators?.name ? `${g.facilitators.name}${g.facilitators.credential ? ', ' + g.facilitators.credential : ''}` : 'Unassigned'}</span></div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="select" style={{ width: 'auto', padding: '8px 10px' }} value={g.facilitator_id || ''} onChange={(e) => run(() => A.assignFacilitator(g.id, e.target.value))}>
                  <option value="">Unassigned</option>
                  {facs.filter((f) => f.active !== false).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <ActionButton label="Remove" color="#B14233" border="#E6BCB5" onClick={() => run(() => A.removeGroup(g.id))} />
              </div>
            </div>
          )) : <Empty>No groups yet</Empty>}
        </div>
      </div>

      {/* Staff access */}
      <div className="admin-section">
        <div className="admin-h">Staff &amp; access</div>
        <div className="card" style={{ padding: staff.length ? '4px 16px' : 16 }}>
          {staff.length ? staff.map((s) => (
            <div className="roster-row" key={s.id}>
              <div>
                <div className="roster-name">{s.full_name || s.email}</div>
                <div className="roster-meta"><span>{s.email}</span></div>
              </div>
              <span className="pill" style={{ background: '#E8ECF3', color: '#3A4A66' }}>{ROLE_LABEL[s.role] || s.role}</span>
            </div>
          )) : <Empty>No staff accounts yet</Empty>}
        </div>
      </div>
    </div>
  )
}
