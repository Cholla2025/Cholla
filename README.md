# Cholla — Group Check-In System

Group **check-in & attendance** for Cholla Behavioral Health: a mobile/tablet
**client kiosk**, a **facilitator dashboard**, and a **leadership dashboard**
with day-of settings. Two daily IOP sessions (**Morning** and **Afternoon**),
up to **10 groups per session**, with facilitators assigned to groups by
leadership.

> Every client, facilitator, and group name in this repository is **fictional
> demo data** (see [`src/seed.js`](src/seed.js)). See
> [PHI & demo mode](#phi--demo-mode) below.

## Three surfaces

| Surface | Who | What |
| --- | --- | --- |
| **Client Kiosk** | Clients (shared phone/tablet) | Facilitator unlocks the device with a server-verified day code, then clients check **in / out** by name. Privacy-first — no roster is shown, and the confirm screen auto-resets between clients. |
| **Facilitator Dashboard** | Facilitators (signed in) | Live session roster: check people in/out, mark absent, add walk-ins, filter & search. |
| **Leadership Dashboard** | Clinical directors (signed in) | Org-wide roll-up across Morning/Afternoon groups, attendance %, drill into any group, plus **day-of settings**: add/remove groups, add/remove facilitators, and assign facilitators to groups. |

Phones and tablets get the kiosk; the dashboards are desktop-only. A wide
tablet can be pinned to kiosk mode — see
[Tablet kiosk setup](#tablet-kiosk-setup).

## Architecture

- **Frontend** — React 18 + Vite, plain JavaScript/JSX. No frontend
  environment variables: the app probes `/api/health` at startup and flips
  between live and demo mode on its own.
- **Hosting** — Azure **Static Web Apps** serves the built frontend and links
  the API.
- **API** — Azure **Functions** (Node) under [`api/`](api/), exposed at
  `/api/*`: org structure, rosters, kiosk-code verification, health probe.
- **Data** — Azure **Table Storage**: an `org` table (groups + facilitators)
  and a `rosters` table (one record per session/group/date). Roster records
  are the only place client names exist, and they live in the customer's
  Azure tenant — never in this repo.
- **Staff auth** — Static Web Apps built-in **Entra ID (Microsoft) sign-in**.
  Staff are invited from the Azure portal with a role of `facilitator`,
  `leader`, or `admin` (Static Web App → Role management). A signed-in user
  with no role sees an "access pending" screen. Facilitators get the
  facilitator dashboard; leaders/admins get both dashboards.
- **Kiosk auth** — the kiosk is deliberately **unauthenticated** (clients
  never sign in). A facilitator unlocks it with a **day code** that the API
  verifies server-side (timing-safe) against the `KIOSK_CODE` app setting.
  The code never ships in this repository.

## PHI & demo mode

When no API is reachable (plain `npm run dev`, or any static preview) the app
runs entirely on **deterministic fictional sample data** generated client-side
from [`src/seed.js`](src/seed.js) — nothing is persisted and nothing is sent
anywhere. That is why this repository contains **zero client information**:
real client data only ever exists inside the customer's Azure tenant, behind
Entra ID and the server-verified kiosk code.

Attendance rosters are PHI. Deploy only into an Azure subscription covered by
a **Business Associate Agreement (BAA)** with Microsoft (available through the
standard Microsoft Product Terms / HIPAA BAA), and keep role invitations
limited to staff who need them.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173 — demo mode, fictional data, zero config
```

For the **full stack** (real API + storage) use the SWA CLI, which serves the
frontend and the Functions API together:

```bash
npm run dev:swa
```

This needs:

- **Azure Functions Core Tools** (v4) and the **SWA CLI** (`npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4`)
- `cd api && npm install`
- **Azurite** running locally (`npm i -g azurite && azurite`) **or** a real
  storage connection string
- `api/local.settings.json` — copy
  [`api/local.settings.json.example`](api/local.settings.json.example)
  (gitignored; `UseDevelopmentStorage=true` targets Azurite, or paste a real
  connection string; `KIOSK_CODE` sets the local day code)

Demo-mode conveniences: kiosk day code **`0000`**, and the dashboards open as
a demo admin so every flow can be exercised without signing in.

## Tablet kiosk setup

A phone-width device is a kiosk automatically. To pin a **landscape tablet**
(wider than the dashboard breakpoint) to kiosk mode:

1. Open the site with **`?kiosk=1`** appended to the URL. The pin persists in
   `localStorage`, so the device stays a kiosk across reloads and restarts.
2. To unpin, open the site with **`?kiosk=0`**.

For a group-room door tablet, also lock the browser itself: **Guided Access**
on iPadOS (Settings → Accessibility) or a kiosk-mode browser / managed
single-app mode on Android, so clients can't navigate away.

## Deploy

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full walkthrough: creating the
Static Web App, linking the Functions API, storage setup, Entra ID role
invitations, and setting the `KIOSK_CODE` app setting.

## Project layout

```
src/
  store.js          # useCheckIn() — app state + backend persistence
  seed.js           # fictional demo data, roster generation, display helpers
  ui.jsx            # shared components (Pill, Badge, Kpi, Seg, Chips, ...)
  App.jsx           # shell: device detection, kiosk pin, tabs, auth gating
  screens/
    Kiosk.jsx       # client check-in flow (unlock → member → confirm → closeout)
    Staff.jsx       # facilitator dashboard
    Leader.jsx      # leadership overview + group detail + day-of settings
    SignIn.jsx      # Microsoft sign-in screen
  lib/
    backend.js      # Azure backend client + demo-mode fallback
api/
  src/functions/    # health, kiosk verify, org, rosters (Azure Functions)
  src/lib/          # auth (Entra principal + kiosk code), Table Storage
```

---

Built by [Phoenix Creative Works](https://www.phxcw.com).
