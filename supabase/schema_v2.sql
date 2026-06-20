-- Cholla Check-In — schema v2: admin role, groups, RLS hardening
-- Run in the Supabase SQL editor after schema.sql (and after the 5 staff
-- accounts exist, so the role promotion below matches real profile rows).

-- 1) Allow the 'admin' role (both dashboards + the admin panel).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('facilitator', 'leader', 'admin'));

-- 2) Promote the leadership/admin accounts.
update public.profiles set role = 'admin'
where email in (
  'carlee.smith@chollabehavioralhealth.com',
  'wgiles@chollabehavioralhealth.com',
  'emily.obrien@chollabehavioralhealth.com',
  'jc@chollabehavioralhealth.com',
  'breinhart@chollabehavioralhealth.com'
);

-- 3) Facilitators: add lifecycle columns (table created in schema.sql).
alter table public.facilitators add column if not exists active boolean not null default true;
alter table public.facilitators add column if not exists created_at timestamptz not null default now();

-- 4) Groups managed by admins (create / assign facilitator / remove).
create table if not exists public.groups (
  id             uuid primary key default gen_random_uuid(),
  session        text not null check (session in ('Morning', 'Afternoon', 'Evening')),
  n              int  not null check (n between 1 and 50),
  name           text not null default 'IOP',
  facilitator_id uuid references public.facilitators (id) on delete set null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (session, n)
);

-- 5) Row Level Security.
-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

alter table public.groups enable row level security;
drop policy if exists "read groups" on public.groups;
create policy "read groups" on public.groups for select to authenticated using (true);
drop policy if exists "admin write groups" on public.groups;
create policy "admin write groups" on public.groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Facilitators: authenticated read, admin write (replaces the demo anon read).
drop policy if exists "demo read facilitators" on public.facilitators;
drop policy if exists "read facilitators" on public.facilitators;
create policy "read facilitators" on public.facilitators for select to authenticated using (true);
drop policy if exists "admin write facilitators" on public.facilitators;
create policy "admin write facilitators" on public.facilitators for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Profiles: admins can read all (for the staff list); everyone reads their own.
drop policy if exists "admin read profiles" on public.profiles;
create policy "admin read profiles" on public.profiles for select to authenticated
  using (public.is_admin() or auth.uid() = id);

-- 6) Seed the current group structure (10 per session) if the table is empty.
insert into public.groups (session, n, name)
select s, g, 'IOP'
from unnest(array['Morning', 'Afternoon', 'Evening']) s, generate_series(1, 10) g
on conflict (session, n) do nothing;

-- NOTE: group_rosters keeps its open demo policy so the anonymous kiosk can
-- still write check-ins. Tighten that when the kiosk moves behind real auth.
