# Cholla — Check-In System

Mobile-first group **check-in & attendance** app for Cholla Behavioral Health,
backed by Supabase. Rebuilt as a clean React + Vite app from the original design
prototype.

> All names, clients, facilitators, and groups in here are **sample/demo data**.

## Three surfaces

| Surface | Who | What |
| --- | --- | --- |
| **Client Kiosk** | Clients (on a shared device) | Facilitator unlocks with a code, clients check **in / out** by name. Privacy-first — no roster is shown, the confirm screen auto-resets. |
| **Staff** | Facilitators (authenticated) | Live session roster: check people in/out, mark absent, add walk-ins, filter & search. |
| **Leadership** | Clinical directors (authenticated) | Org-wide roll-up across Morning/Afternoon/Evening IOP groups, attendance %, drill into any group. |

Demo facilitator code: **`0000`** · Demo auth: **any email + any 6 digits**.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

The app runs with **zero config** — without Supabase keys it uses built-in
sample data (you'll see "○ Sample data (offline demo)" at the bottom).

## Connect Supabase (optional → makes it "live")

These two values are **public by design** and safe to ship in the browser; the
anon key is gated by Row Level Security. **Never** put the `service_role` key in
this repo or in client env vars.

1. Copy env and fill in the anon key:
   ```bash
   cp .env.example .env.local
   # set VITE_SUPABASE_ANON_KEY=...   (URL is already filled in)
   ```
2. Create the tables and seed data (Supabase SQL editor, or CLI — see below):
   ```sql
   -- supabase/schema.sql   then   supabase/seed.sql
   ```
3. Restart `npm run dev`. The footer flips to "● Live · Supabase connected" and
   check-ins now persist across reloads/devices.

### Using the Supabase CLI

```bash
npm i -g supabase
supabase login                                   # paste a Personal Access Token
supabase link --project-ref dnipgngvsdktdyqthurq # links this project
supabase db push                                 # or: run supabase/schema.sql + seed.sql
```

## Deploy (Vercel)

Import the repo in Vercel (framework auto-detected as Vite). Add the two
`VITE_SUPABASE_*` environment variables in **Project → Settings → Environment
Variables**. Every push to the branch gets a preview URL.

## Project layout

```
src/
  store.js          # app state + Supabase persistence (ported prototype logic)
  seed.js           # sample data + deterministic roster generation + helpers
  ui.jsx            # shared components (Pill, Badge, Kpi, Seg, Chips, ...)
  App.jsx           # shell: topbar, surface tabs, routing
  screens/
    Kiosk.jsx       # client check-in flow (start → member → confirm → closeout)
    Staff.jsx       # facilitator dashboard
    Leader.jsx      # leadership overview + group detail
  lib/
    supabase.js     # client (reads public env vars)
    data.js         # roster read/write data layer
supabase/
  schema.sql        # tables + RLS
  seed.sql          # sample live roster
```
