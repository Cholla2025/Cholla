import { supabase, supabaseEnabled } from './supabase'

// Admin data layer: facilitators, groups, and the staff (profiles) list.
// Writes are gated server-side by the is_admin() RLS policies. Isolated here so
// the backend can later be swapped without changing the Admin UI.

export { supabaseEnabled }

// ---- Facilitators ----
export async function listFacilitators() {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase
    .from('facilitators')
    .select('id, name, email, credential, active')
    .order('name')
  if (error) { console.warn('[cholla] listFacilitators:', error.message); return [] }
  return data || []
}

export async function addFacilitator({ name, email, credential }) {
  if (!supabaseEnabled) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase
    .from('facilitators')
    .insert({ name, email: email || null, credential: credential || null })
  return { error }
}

export async function removeFacilitator(id) {
  if (!supabaseEnabled) return { error: null }
  // Soft-delete so historical group assignments stay intact.
  const { error } = await supabase.from('facilitators').update({ active: false }).eq('id', id)
  return { error }
}

// ---- Groups ----
export async function listGroups() {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase
    .from('groups')
    .select('id, session, n, name, active, facilitator_id, facilitators(name, credential)')
    .order('session')
    .order('n')
  if (error) { console.warn('[cholla] listGroups:', error.message); return [] }
  return data || []
}

export async function addGroup({ session, n, name, facilitator_id }) {
  if (!supabaseEnabled) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase
    .from('groups')
    .insert({ session, n: Number(n), name: name || 'IOP', facilitator_id: facilitator_id || null })
  return { error }
}

export async function assignFacilitator(groupId, facilitatorId) {
  if (!supabaseEnabled) return { error: null }
  const { error } = await supabase
    .from('groups')
    .update({ facilitator_id: facilitatorId || null })
    .eq('id', groupId)
  return { error }
}

export async function removeGroup(id) {
  if (!supabaseEnabled) return { error: null }
  const { error } = await supabase.from('groups').update({ active: false }).eq('id', id)
  return { error }
}

// ---- Staff (profiles) ----
export async function listStaff() {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .order('full_name')
  if (error) { console.warn('[cholla] listStaff:', error.message); return [] }
  return data || []
}
