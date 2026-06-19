import { createClient } from '@supabase/supabase-js'

// Read PUBLIC connection values from the environment. These are safe to ship
// in the browser — the anon key is gated by Row Level Security on the server.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// The demo runs with zero config: if the anon key is missing we stay in
// "sample data" mode and never touch the network.
export const supabaseEnabled = Boolean(url && anonKey)

export const supabase = supabaseEnabled
  ? createClient(url, anonKey, { auth: { persistSession: false } })
  : null
