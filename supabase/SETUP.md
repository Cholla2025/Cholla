# Supabase setup runbook

Steps I'll run once `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are set as
environment secrets (and `VITE_SUPABASE_ANON_KEY` for the front-end).

Project ref: **`dnipgngvsdktdyqthurq`**

## 1. Link & push schema

```bash
npm i -g supabase
supabase login                                   # uses $SUPABASE_ACCESS_TOKEN
supabase link --project-ref dnipgngvsdktdyqthurq # uses $SUPABASE_DB_PASSWORD

# Apply schema + seed
supabase db push                                 # or: psql < schema.sql
#   then run supabase/seed.sql
```

This creates: `group_rosters`, `facilitators`, `clients`, `profiles` (+ the
`auth.users → profiles` trigger and RLS policies).

## 2. Create staff & leadership accounts (email OTP / magic-link)

Sign-in is passwordless: a user enters their work email, Supabase emails a
6-digit code (matching the existing UI), they enter it, done. The `profiles`
trigger creates their row automatically; we just set the role.

```bash
# Example — create users and tag roles (run per person)
# Facilitators
supabase auth admin create-user --email d.alvarez@chollabh.org \
  --user-metadata '{"full_name":"Dana Alvarez, LISAC"}'
# Leadership
supabase auth admin create-user --email r.okafor@chollabh.org \
  --user-metadata '{"full_name":"Ruth Okafor, Clinical Director"}'

# Then set roles:
#   update public.profiles set role='leader'      where email='r.okafor@chollabh.org';
#   update public.profiles set role='facilitator' where email='d.alvarez@chollabh.org';
```

> I need from you: the **list of staff/leader emails + names + role** to seed.
> Until then I'll seed the two demo accounts shown above.

## 3. Front-end auth wiring (email OTP)

In the app, when Supabase is configured the Staff/Leader sign-in screens call:

```js
// send the code
await supabase.auth.signInWithOtp({ email })
// verify the 6-digit code
await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
```

On success we read `profiles.role` to route the user to the Staff or Leadership
surface. Without Supabase configured, the demo gate (any email + any 6 digits)
stays in place.
