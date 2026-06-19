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
