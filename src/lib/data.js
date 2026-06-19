import { supabase, supabaseEnabled } from './supabase'

// Data layer for live group rosters.
//
// When Supabase is configured, a group's roster is persisted as a single JSONB
// row in `group_rosters` keyed by (session, n, date). The app loads all of
// today's overrides on startup and writes back whenever a roster changes, so
// check-ins survive reloads and sync across devices. Groups with no stored row
// fall back to the deterministic sample roster generated client-side.
//
// When Supabase is NOT configured, every function is a no-op and the app keeps
// all state in memory — the demo still works fully, just without persistence.

export { supabaseEnabled }

export async function fetchOverrides(date) {
  if (!supabaseEnabled) return {}
  const { data, error } = await supabase
    .from('group_rosters')
    .select('session, n, rows')
    .eq('date', date)
  if (error) {
    console.warn('[cholla] could not load rosters from Supabase:', error.message)
    return {}
  }
  const map = {}
  for (const r of data || []) map[r.session + '-' + r.n] = r.rows
  return map
}

export async function saveRoster(session, n, date, rows) {
  if (!supabaseEnabled) return
  const { error } = await supabase
    .from('group_rosters')
    .upsert({ session, n, date, rows, updated_at: new Date().toISOString() }, { onConflict: 'session,n,date' })
  if (error) console.warn('[cholla] could not save roster to Supabase:', error.message)
}
