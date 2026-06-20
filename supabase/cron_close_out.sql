-- Cholla Check-In — nightly auto close-out
-- Run once in the Supabase SQL editor. Uses pg_cron (bundled with Supabase).
--
-- Every night at midnight America/Phoenix (Arizona — no DST) this:
--   1) Closes the groups out — any client still "Checked In" or "Late" on the
--      day that just ended is marked "Checked Out" so no one is left present
--      overnight (the day's record stays intact for reporting).
--   2) Starts the new day empty by default — rosters are keyed by date, so the
--      next day has no rows until clients check in fresh.

create extension if not exists pg_cron;

-- Close out a single day's open check-ins. Defaults to "yesterday" in Phoenix
-- time (the day that just ended when the job fires at midnight).
create or replace function public.close_out_groups(target_date date default null)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  d date := coalesce(target_date, (now() at time zone 'America/Phoenix')::date - 1);
  affected int;
begin
  update public.group_rosters gr
  set rows = (
        select jsonb_agg(
          case when (e->>'checkin') is not null and (e->>'checkout') is null
               then e || jsonb_build_object('checkout', '11:59 PM', 'status', 'Checked Out')
               else e end
        )
        from jsonb_array_elements(gr.rows) e
      ),
      updated_at = now()
  where gr.date = d
    and exists (
      select 1 from jsonb_array_elements(gr.rows) e
      where (e->>'checkin') is not null and (e->>'checkout') is null
    );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- (Re)schedule the nightly job. 07:00 UTC == 00:00 America/Phoenix (no DST).
select cron.unschedule('cholla-midnight-closeout')
where exists (select 1 from cron.job where jobname = 'cholla-midnight-closeout');

select cron.schedule('cholla-midnight-closeout', '0 7 * * *', $$select public.close_out_groups();$$);
