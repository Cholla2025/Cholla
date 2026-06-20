import { supabase, supabaseEnabled } from './supabase'

// Authentication layer. Staff/leadership/admin sign in with a one-time email
// token (no passwords — "reset" just means request a fresh token). The kiosk is
// open and never touches this. Everything Supabase-specific lives here so the
// backend can be swapped (e.g. to Microsoft) without touching the UI.

export { supabaseEnabled }

// Map a profile role to the surfaces it can reach.
export const ACCESS = {
  facilitator: ['staff'],
  leader: ['staff', 'leader'],
  admin: ['staff', 'leader', 'admin'],
}
export function canAccess(role, surface) {
  return (ACCESS[role] || []).includes(surface)
}

// Send a 6-digit sign-in token to an existing account's email.
export async function sendToken(email) {
  if (!supabaseEnabled) return { error: null }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  })
  return { error }
}

// Verify the emailed token and establish a session.
export async function verifyToken(email, token) {
  if (!supabaseEnabled) return { user: null, error: null }
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  })
  return { user: data?.user ?? null, error }
}

export async function getCurrentUser() {
  if (!supabaseEnabled) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.user ?? null
}

export async function fetchProfile(userId) {
  if (!supabaseEnabled || !userId) return null
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', userId)
    .single()
  return data
}

export async function signOut() {
  if (!supabaseEnabled) return
  await supabase.auth.signOut()
}

// Subscribe to auth changes; returns an unsubscribe function.
export function onAuthChange(cb) {
  if (!supabaseEnabled) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null)
  })
  return () => data.subscription.unsubscribe()
}
