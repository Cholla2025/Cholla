import { useMemo, useState } from 'react'
import * as S from '../seed'
import { Chips, Field, ActionButton, Empty, noAutofill } from '../ui'

// Client list management — Leadership → Clients. Leaders and admins manage
// the clinic's master roster: bulk paste with a confirmation preview,
// case-insensitive dedupe (duplicates are flagged, never double-added),
// search/filter, per-client group assignment, rename, and soft-delete
// deactivation. Facilitators see assigned clients through their own group
// rosters (pre-populated as "Expected"), not this screen.

const STATUS_FILTERS = ['All', 'Assigned', 'Unassigned', 'Inactive']

// Parse a pasted list: one name per line, tolerating "First Last",
// "Last, First", stray whitespace, and blank lines.
export function parseNames(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (line.includes(',')) {
      const [last, first] = line.split(',', 2).map((p) => p.trim())
      if (first && last) line = first + ' ' + last
    }
    out.push(S.titleCase(line))
  }
  return out
}

const NAME_OK = /^[\p{L}][\p{L} .'’-]*$/u

export default function Clients({ store }) {
  const { state: st, actions: a, groupsFor } = store
  const [bulk, setBulk] = useState('')
  const [preview, setPreview] = useState(null) // [{name, status: 'new'|'duplicate'|'invalid'}]
  const [result, setResult] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const existing = useMemo(() => new Set(st.clients.map((c) => c.name.toLowerCase())), [st.clients])

  const buildPreview = () => {
    const names = parseNames(bulk)
    if (!names.length) return
    const seen = new Set()
    setResult('')
    setPreview(names.map((name) => {
      const key = name.toLowerCase()
      let status = 'new'
      if (!NAME_OK.test(name) || name.length < 2 || name.length > 60) status = 'invalid'
      else if (existing.has(key) || seen.has(key)) status = 'duplicate'
      if (status === 'new') seen.add(key)
      return { name, status }
    }))
  }

  const confirmAdd = async () => {
    const entries = preview.filter((p) => p.status === 'new').map((p) => ({ name: p.name }))
    if (!entries.length) { setPreview(null); return }
    const out = await a.addClientsBulk(entries)
    if (out) {
      const dupes = preview.filter((p) => p.status === 'duplicate').length + (out.duplicates ? out.duplicates.length : 0)
      const invalid = preview.filter((p) => p.status === 'invalid').length + (out.invalid || 0)
      setResult('Added ' + (out.added ? out.added.length : 0) + ' client(s)'
        + (dupes ? ' · ' + dupes + ' duplicate(s) skipped' : '')
        + (invalid ? ' · ' + invalid + ' unreadable line(s) skipped' : ''))
      setBulk(''); setPreview(null)
    }
  }

  const saveRename = async (c) => {
    const nm = editName.trim()
    if (nm.length >= 2 && nm.toLowerCase() !== c.name.toLowerCase()) {
      await a.updateClientRec(c.id, { name: nm })
    } else if (nm.length >= 2) {
      await a.updateClientRec(c.id, { name: nm }) // case-only fix is fine
    }
    setEditingId(null)
  }

  const assign = (c, session, n) => {
    if (!session || !n) return a.updateClientRec(c.id, { session: null, n: null })
    return a.updateClientRec(c.id, { session, n: Number(n) })
  }

  let list = st.clients
  if (filter === 'Assigned') list = list.filter((c) => c.active && c.session)
  if (filter === 'Unassigned') list = list.filter((c) => c.active && !c.session)
  if (filter === 'Inactive') list = list.filter((c) => !c.active)
  if (filter === 'All') list = list.filter((c) => c.active)
  if (search.trim()) list = list.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))

  const activeCount = st.clients.filter((c) => c.active).length
  const assignedCount = st.clients.filter((c) => c.active && c.session).length

  const previewCounts = preview && {
    new: preview.filter((p) => p.status === 'new').length,
    duplicate: preview.filter((p) => p.status === 'duplicate').length,
    invalid: preview.filter((p) => p.status === 'invalid').length,
  }

  return (
    <>
      {st.clientsErr && <div className="signin-err" style={{ marginTop: 14 }}>{st.clientsErr}</div>}

      <div className="admin-section">
        <div className="admin-h">Add clients</div>
        <div className="section-sub" style={{ marginTop: -4, marginBottom: 10 }}>
          Paste names one per line — "First Last" or "Last, First" both work.
          You'll confirm a preview before anything is saved, and duplicates are
          flagged, never added twice. {activeCount} active client(s), {assignedCount} assigned.
        </div>
        {!preview ? (
          <div className="card">
            <textarea
              className="input bulk-paste" {...noAutofill()}
              value={bulk}
              onChange={(e) => { setBulk(e.target.value); setResult('') }}
              placeholder={'First Last\nLast, First\n…one name per line'}
              rows={5}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" style={{ width: 'auto' }} disabled={st.clientsBusy || !parseNames(bulk).length} onClick={buildPreview}>
                Preview {parseNames(bulk).length || ''} name(s)
              </button>
            </div>
            {result && <div style={{ color: '#1F7A56', font: '600 12.5px Inter', marginTop: 10 }}>{result}</div>}
          </div>
        ) : (
          <div className="card">
            <div className="roster-name">
              Confirm: {previewCounts.new} new
              {previewCounts.duplicate ? ' · ' + previewCounts.duplicate + ' duplicate(s) will be skipped' : ''}
              {previewCounts.invalid ? ' · ' + previewCounts.invalid + ' unreadable line(s) will be skipped' : ''}
            </div>
            <div className="preview-list cholla-scroll">
              {preview.map((p, i) => (
                <div key={i} className={'preview-row preview-' + p.status}>
                  <span>{p.name}</span>
                  <span className="preview-tag">{p.status === 'new' ? 'will add' : p.status}</span>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" disabled={st.clientsBusy} onClick={() => setPreview(null)}>Back to edit</button>
              <button className="btn" disabled={st.clientsBusy || !previewCounts.new} onClick={confirmAdd}>
                {st.clientsBusy ? 'Saving…' : 'Add ' + previewCounts.new + ' client(s)'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="admin-section">
        <div className="admin-h">Client list</div>
        <div style={{ overflowX: 'auto' }} className="cholla-scroll">
          <Chips options={STATUS_FILTERS} value={filter} onChange={setFilter} />
        </div>
        <input className="input" style={{ marginTop: 12 }} {...noAutofill()} value={search}
          onChange={(e) => setSearch(e.target.value)} placeholder="Search client name" />

        <div className="card" style={{ marginTop: 14, padding: list.length ? '4px 16px' : 16 }}>
          {list.length ? list.map((c) => {
            const sessionGroups = c.session ? groupsFor(c.session) : []
            return (
              <div className="roster-row" key={c.id}>
                <div style={{ minWidth: 0 }}>
                  {editingId === c.id ? (
                    <div className="row" style={{ alignItems: 'center' }}>
                      <input className="input" style={{ margin: 0, maxWidth: 260 }} {...noAutofill()} value={editName}
                        onChange={(e) => setEditName(e.target.value.replace(/[^A-Za-z .,'-]/g, '').slice(0, 60))}
                        onKeyDown={(e) => e.key === 'Enter' && saveRename(c)} autoFocus />
                      <ActionButton label="Save" color="#1F7A56" border="#BBE3D0" onClick={() => saveRename(c)} />
                      <ActionButton label="Cancel" color="#5A6B85" border="#DCE3EE" onClick={() => setEditingId(null)} />
                    </div>
                  ) : (
                    <div className="roster-name" style={{ opacity: c.active ? 1 : 0.5 }}>{c.name}</div>
                  )}
                  <div className="roster-meta">
                    <span>{c.session ? c.session + ' · Group ' + c.n : 'Unassigned'}</span>
                    {!c.active && <span style={{ color: '#B14233' }}>inactive</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <select className="select" style={{ width: 'auto', padding: '8px 10px' }} disabled={st.clientsBusy || !c.active}
                    value={c.session || ''}
                    onChange={(e) => {
                      const sv = e.target.value
                      if (!sv) return assign(c, null, null)
                      const first = groupsFor(sv)[0]
                      return assign(c, sv, first ? first.n : null)
                    }}>
                    <option value="">Unassigned</option>
                    {S.SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {c.session && (
                    <select className="select" style={{ width: 'auto', padding: '8px 10px' }} disabled={st.clientsBusy || !c.active}
                      value={c.n || ''}
                      onChange={(e) => assign(c, c.session, e.target.value)}>
                      {sessionGroups.map((g) => <option key={g.n} value={g.n}>Group {g.n}</option>)}
                    </select>
                  )}
                  {editingId !== c.id && c.active && (
                    <ActionButton label="Rename" color="#2C5C94" border="#C7D9F0" onClick={() => { setEditingId(c.id); setEditName(c.name) }} />
                  )}
                  <ActionButton
                    label={c.active ? 'Deactivate' : 'Reactivate'}
                    color={c.active ? '#B14233' : '#1F7A56'}
                    border={c.active ? '#E6BCB5' : '#BBE3D0'}
                    onClick={() => !st.clientsBusy && a.updateClientRec(c.id, { active: !c.active })}
                  />
                </div>
              </div>
            )
          }) : (
            <Empty title={search.trim() ? 'No clients match' : filter === 'Inactive' ? 'No inactive clients' : 'No clients yet'}>
              {search.trim() ? 'Try a different search' : filter === 'Inactive' ? 'Deactivated clients appear here and can be reactivated' : 'Paste the roster above to get started'}
            </Empty>
          )}
        </div>
      </div>
    </>
  )
}
