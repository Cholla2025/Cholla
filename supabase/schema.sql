-- Cholla Check-In — database schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
--
-- The live app persists each group's roster for a given day as one JSONB row.
-- Groups without a stored row fall back to the deterministic sample roster
-- generated client-side, so the demo works before any rows exist.

create table if not exists public.group_rosters (
  id          uuid primary key default gen_random_uuid(),
  session     text not null check (session in ('Morning', 'Afternoon', 'Evening')),
  n           int  not null check (n between 1 and 50),
  date        date not null,
  rows        jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (session, n, date)
);

-- Optional reference tables (handy once you move off generated sample data).
create table if not exists public.facilitators (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  email     text unique,
  credential text
);

create table if not exists public.clients (
  id          text primary key,            -- the human-facing member ID (e.g. '1042')
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------
-- DEMO POLICY: the anon key may read and write group_rosters so the
-- kiosk/staff flows work without auth. Tighten this before production
-- (e.g. require auth.role() = 'authenticated' for writes).
alter table public.group_rosters enable row level security;

drop policy if exists "demo read rosters"  on public.group_rosters;
drop policy if exists "demo write rosters" on public.group_rosters;

create policy "demo read rosters"  on public.group_rosters
  for select using (true);
create policy "demo write rosters" on public.group_rosters
  for all using (true) with check (true);

alter table public.facilitators enable row level security;
alter table public.clients enable row level security;
drop policy if exists "demo read facilitators" on public.facilitators;
drop policy if exists "demo read clients" on public.clients;
create policy "demo read facilitators" on public.facilitators for select using (true);
create policy "demo read clients" on public.clients for select using (true);

-- ------------------------------------------------------------------
-- User accounts & roles (for email magic-link / OTP sign-in)
-- ------------------------------------------------------------------
-- Staff and leadership authenticate via Supabase Auth (email OTP). The kiosk
-- needs no account. `profiles` extends auth.users with a display name and a
-- role that decides which surface a signed-in user can reach.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  credential  text,
  role        text not null default 'facilitator' check (role in ('facilitator', 'leader')),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- New auth users automatically get a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- Production hardening (uncomment once real auth is in place)
-- ------------------------------------------------------------------
-- Replace the open "demo write rosters" policy above with authenticated-only:
--
--   drop policy if exists "demo write rosters" on public.group_rosters;
--   create policy "staff write rosters" on public.group_rosters
--     for all to authenticated using (true) with check (true);
--
-- The kiosk can keep an anon read/insert path scoped to today's date, or move
-- check-ins behind a Supabase Edge Function that uses the service_role key.
