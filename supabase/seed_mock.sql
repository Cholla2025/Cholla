-- Cholla Check-In — mock data generator
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → Run).
--
-- Populates public.group_rosters for ALL 30 groups (Morning/Afternoon/Evening
-- × 1–10) on 2026-06-19, mirroring the app's built-in sample logic so the
-- Supabase-connected dashboards show the same realistic data as the demo.
-- Also seeds the facilitators reference table.
--
-- Safe to re-run: rosters are upserted; the special live "Afternoon · Group 3"
-- roster (seeded by seed.sql) is left untouched.

-- Helper: minutes-since-midnight -> "h:mm AM/PM"
create or replace function public._fmt_clock(m int)
returns text language sql immutable as $$
  select case when (floor(m / 60)::int % 24) % 12 = 0 then 12
              else (floor(m / 60)::int % 24) % 12 end::text
      || ':' || lpad((m % 60)::text, 2, '0')
      || ' ' || case when (floor(m / 60)::int % 24) >= 12 then 'PM' else 'AM' end
$$;

do $$
declare
  sessions text[] := array['Morning', 'Afternoon', 'Evening'];
  clients  text[] := array['Maria Alvarez','James Carter','Dana Whitfield','Robert Nguyen','Latoya Brooks',
                           'Kevin Park','Angela Ruiz','Marcus Webb','Priya Shah','Thomas Reed'];
  bases    int[]  := array[545, 782, 1023];  -- 9:05 / 1:02 / 5:03 start times
  slens    int[]  := array[7, 9, 7];         -- length('Morning'/'Afternoon'/'Evening')
  cur      int    := 1;                       -- current session index (Afternoon, 0-based)
  the_date date   := '2026-06-19';
  si int; sess text; gn int; cap int; ci int; present int;
  is_complete bool; is_progress bool; started bool;
  off int; i int; arr jsonb; nm text; id text; status text; ci_t text; co_t text;
begin
  for si in 0..2 loop
    sess := sessions[si + 1];
    is_complete := si < cur;
    is_progress := si = cur;
    started     := si <= cur;          -- not "Upcoming"
    for gn in 1..10 loop
      continue when sess = 'Afternoon' and gn = 3;   -- preserve the live kiosk roster
      cap := 9 + ((gn + si) % 4);
      if is_complete then
        ci := greatest(0, cap - (gn % 3)); present := 0;
      elsif is_progress then
        ci := greatest(0, cap - (gn % 3)); present := greatest(1, ci - 2 - (gn % 3));
      else
        ci := 0; present := 0;
      end if;
      off  := (slens[si + 1] + gn) % 10;
      arr := '[]'::jsonb;
      for i in 0..(cap - 1) loop
        nm := clients[((i + off) % 10) + 1];
        id := (2000 + si * 1000 + gn * 30 + i)::text;
        ci_t := null; co_t := null; status := 'Expected';
        if i < present then
          status := 'Checked In'; ci_t := public._fmt_clock(bases[si + 1] + i);
        elsif i < ci then
          status := 'Checked Out';
          ci_t := public._fmt_clock(bases[si + 1] + i);
          co_t := public._fmt_clock(bases[si + 1] + i + 95);
        elsif started and i = cap - 1 and ci < cap then
          status := 'Absent';
        end if;
        arr := arr || jsonb_build_object('id', id, 'name', nm, 'checkin', ci_t, 'checkout', co_t, 'status', status);
      end loop;
      insert into public.group_rosters (session, n, date, rows)
      values (sess, gn, the_date, arr)
      on conflict (session, n, date) do update set rows = excluded.rows, updated_at = now();
    end loop;
  end loop;
end $$;

-- Facilitators reference list (matches the names shown across the dashboards).
insert into public.facilitators (name, email, credential) values
  ('Ruth Okafor',   'r.okafor@chollabh.org',  'LPC'),
  ('Steven Tran',   's.tran@chollabh.org',    'LCSW'),
  ('Dana Alvarez',  'd.alvarez@chollabh.org', 'LISAC'),
  ('Marcus Greene', 'm.greene@chollabh.org',  'LPC'),
  ('Joy Whitman',   'j.whitman@chollabh.org', 'LCSW'),
  ('Ana Castillo',  'a.castillo@chollabh.org','LISAC'),
  ('Paul Bennett',  'p.bennett@chollabh.org', 'LMFT'),
  ('Kim Rios',      'k.rios@chollabh.org',    'LCSW'),
  ('Lena Foster',   'l.foster@chollabh.org',  'PMHNP'),
  ('Tom Nash',      't.nash@chollabh.org',    'LPC')
on conflict (email) do nothing;
