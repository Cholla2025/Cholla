import { useEffect, useState } from 'react'
import * as B from './lib/backend'

// "Add from Microsoft 365" — a dropdown of the tenant's people (from
// /api/directory, leader/admin only) that autofills name + email on the
// add-staff and add-facilitator forms. Manual entry always remains available;
// if the directory is not configured or unavailable this renders NOTHING and
// the form works exactly as before.

let cache = null // one fetch per page load is plenty (the API caches too)

export default function DirectoryPicker({ onPick }) {
  const [users, setUsers] = useState(cache ? cache.users : null)

  useEffect(() => {
    if (cache) return
    let alive = true
    ;(async () => {
      const out = await B.fetchDirectory()
      cache = out && Array.isArray(out.users) ? out : { users: [] }
      if (alive) setUsers(cache.users)
    })()
    return () => { alive = false }
  }, [])

  if (!users || !users.length) return null

  return (
    <label className="field">
      <span className="lab">Add from Microsoft 365</span>
      <select
        className="select"
        value=""
        onChange={(e) => {
          const u = users[Number(e.target.value)]
          if (u) onPick(u)
        }}>
        <option value="">Pick a person to autofill…</option>
        {users.map((u, i) => (
          <option key={u.email} value={i}>{u.name} — {u.email}</option>
        ))}
      </select>
    </label>
  )
}
