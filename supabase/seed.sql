-- Cholla Check-In — sample seed data
-- Seeds the live "Afternoon · Group 3" roster for 2026-06-19 so the kiosk
-- shows a populated room on first load. All other groups derive client-side.

insert into public.group_rosters (session, n, date, rows)
values (
  'Afternoon', 3, '2026-06-19',
  '[
    {"id":"1042","name":"Maria Alvarez","checkin":"1:02 PM","checkout":null,"status":"Checked In"},
    {"id":"1108","name":"James Carter","checkin":"1:05 PM","checkout":"2:48 PM","status":"Checked Out"},
    {"id":"1190","name":"Dana Whitfield","checkin":"1:08 PM","checkout":null,"status":"Checked In"},
    {"id":"1234","name":"Robert Nguyen","checkin":"1:21 PM","checkout":null,"status":"Late"},
    {"id":"1356","name":"Latoya Brooks","checkin":"1:03 PM","checkout":null,"status":"Checked In"},
    {"id":"1401","name":"Kevin Park","checkin":null,"checkout":null,"status":"Expected"},
    {"id":"1478","name":"Angela Ruiz","checkin":"1:10 PM","checkout":null,"status":"Checked In"},
    {"id":"1502","name":"Marcus Webb","checkin":null,"checkout":null,"status":"Absent"},
    {"id":"1560","name":"Priya Shah","checkin":"1:00 PM","checkout":"2:50 PM","status":"Checked Out"},
    {"id":"1633","name":"Thomas Reed","checkin":"1:15 PM","checkout":null,"status":"Checked In"}
  ]'::jsonb
)
on conflict (session, n, date) do nothing;
