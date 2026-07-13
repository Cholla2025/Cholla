# Deployment Runbook — Cholla Check-In on Azure

> **First deployment?** Use [GO-LIVE.md](GO-LIVE.md) — the complete,
> checkbox-driven go-live walkthrough (including the email sign-in service
> and in-app staff onboarding). This file is the condensed reference.

This guide takes you from nothing to a live, HIPAA-conscious deployment on
Azure Static Web Apps. It assumes no prior Azure experience — every step is a
portal click-path or a single command. Budget about 45 minutes end to end.

**What gets deployed**

| Piece | Azure service | Purpose |
| --- | --- | --- |
| Frontend (this repo, built with Vite to `dist/`) | Static Web App | Kiosk + staff dashboards |
| API (`api/` folder) | Static Web App **linked functions** | All reads/writes, auth enforcement |
| Data | Storage Account → **Table Storage** | Two tables: `org` (groups/facilitators) and `rosters` (client check-ins) |
| Staff sign-in | Entra ID (Azure AD) | Built into Static Web Apps; roles assigned per person |

Client names only ever exist in the `rosters` table inside **your** Azure
tenant. The repository and its demo mode contain fictional data only.

---

## Prerequisites

- An Azure subscription you can create resources in.
- Admin access to this GitHub repository (to add a secret).
- Permission to create an **app registration** in your Entra ID tenant (your
  Microsoft 365 admin can do this step if you cannot).

Names below are suggestions — keep them consistent once you pick yours.

## Step 1 — Create a resource group

1. Sign in to [portal.azure.com](https://portal.azure.com).
2. Search for **Resource groups** → **+ Create**.
3. Subscription: yours. Name: `rg-cholla-checkin`. Region: one close to the
   clinic (e.g. **West US 3** for Arizona).
4. **Review + create** → **Create**.

## Step 2 — Create the Storage Account (holds all client data)

1. Search **Storage accounts** → **+ Create**.
2. Resource group: `rg-cholla-checkin`. Name: `chollacheckindata` (must be
   globally unique, lowercase letters/numbers only — adjust if taken).
3. Region: same as step 1. Performance: **Standard**.
   Redundancy: **LRS** is fine to start; pick **ZRS/GRS** if you want
   region-failure durability.
4. On the **Advanced** tab leave **Require secure transfer** enabled (default).
5. **Review + create** → **Create**, then open the new account.
6. Left menu → **Security + networking → Access keys** → **Show keys** →
   copy the **Connection string** under *key1*. Save it somewhere private —
   you paste it into the Static Web App in step 5. Treat it like a password.

You do **not** need to create the tables — the API creates `org` and
`rosters` automatically on first use and seeds the standard 20-group schedule
(Morning/Afternoon × groups 1–10). It never seeds people.

## Step 3 — Register the sign-in app (Entra ID)

This locks staff sign-in to accounts in *your* Microsoft tenant.

1. Search **Microsoft Entra ID** → **App registrations** → **+ New registration**.
2. Name: `Cholla Check-In`. Supported account types: **Accounts in this
   organizational directory only** (single tenant).
3. Redirect URI: leave blank for now → **Register**.
4. On the app's **Overview** page copy two values:
   - **Application (client) ID** → this becomes app setting `AZURE_CLIENT_ID`.
   - **Directory (tenant) ID** → you paste this into `staticwebapp.config.json`.
5. **Certificates & secrets** → **+ New client secret** → description
   `cholla-swa`, expiry 12–24 months → **Add** → copy the secret **Value**
   immediately (it is shown once) → becomes app setting `AZURE_CLIENT_SECRET`.
   Put a calendar reminder before it expires.
6. In this repository, edit `staticwebapp.config.json` and replace
   `<YOUR-TENANT-ID>` in the `openIdIssuer` URL with the Directory (tenant)
   ID from step 4. Commit and push that change.
7. After step 4 below gives you the site URL (e.g.
   `https://happy-dune-0abc123.azurestaticapps.net`), come back to the app
   registration → **Authentication** → **+ Add a platform** → **Web** →
   Redirect URI: `https://<your-site>/.auth/login/aad/callback` → save.

## Step 4 — Create the Static Web App and connect GitHub

1. Search **Static Web Apps** → **+ Create**.
2. Resource group: `rg-cholla-checkin`. Name: `swa-cholla-checkin`.
3. Plan type: **Standard** — required for custom authentication (the
   tenant-locked Entra sign-in from step 3) and recommended for anything
   handling PHI.
4. Deployment source: **Other** (this repo already ships its own workflow at
   `.github/workflows/azure-static-web-apps.yml`; choosing GitHub here would
   commit a duplicate one).
5. **Review + create** → **Create**, then open the resource.
6. On **Overview**, click **Manage deployment token** and copy the token.
7. In GitHub: repo → **Settings → Secrets and variables → Actions →
   New repository secret**. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`.
   Value: the token. Save.
8. Push to `main` (or re-run the workflow under the repo's **Actions** tab).
   The workflow builds the Vite app to `dist/`, builds `api/`, and deploys
   both. First run takes a few minutes.
9. Note the site URL on the Static Web App **Overview** page, and finish
   step 3.7 (redirect URI) with it.

## Step 5 — Application settings (secrets live here, never in the repo)

Static Web App → **Settings → Environment variables** (older portals:
**Configuration**) → add for the **Production** environment:

| Name | Value |
| --- | --- |
| `STORAGE_CONNECTION_STRING` | The connection string from step 2.6 |
| `KIOSK_CODE` | The facilitator day code for the kiosk keypad — **exactly 4 digits** (the keypad accepts only 4). **Required**: until it is set, kiosk unlock is disabled entirely (the API fails closed; the `0000` fallback exists only on a local dev machine). |
| `AZURE_CLIENT_ID` | Application (client) ID from step 3.4 |
| `AZURE_CLIENT_SECRET` | Client secret value from step 3.5 |
| `SESSION_SECRET` | Long random string (32+ chars — e.g. `openssl rand -base64 48`) that signs email-code sessions. **Required for email one-time-code sign-in.** Treat like a password. |
| `ADMIN_EMAILS` | Comma-separated bootstrap admin email(s), owner first. These addresses can sign in as `admin` before any staff accounts exist — this is how the first admin gets in. **Required.** |
| `ACS_CONNECTION_STRING` | Azure Communication Services connection string (ACS resource → **Keys**). **Required for email sign-in.** Treat like a password. See [GO-LIVE.md](GO-LIVE.md) Phase 2 for creating the email service. |
| `ACS_SENDER` | Verified sender address from your provisioned email domain, e.g. `DoNotReply@<your-domain>.azurecomm.net`. **Required for email sign-in.** |
| `CLINIC_TIMEZONE` | Optional, defaults to `America/Phoenix`. Defines the clinic's calendar day — kiosks may only read/write rosters for the current day (±1) in this timezone. |
| `REPORT_EMAILS` | Comma-separated leadership recipients for scheduled metric reports and volume alerts (no client names ever appear in these emails). **Required for reports.** |
| `REPORTS_TRIGGER_SECRET` | Long random string presented by the report scheduler (also a GitHub repo secret — see GO-LIVE.md Phase 8.5). **Required for scheduled reports.** |
| `ALERT_DROP_PCT` | Optional, default 5 — steady 2-day attendance drop (%) that emails leadership a Volume Alert. |
| `ALERT_CRITICAL_PCT` | Optional, default 10 — drop (%) above which the alert is marked CRITICAL. |

Click **Apply**. Settings take effect within a minute; no redeploy needed.

To rotate the kiosk code (recommended weekly, and any time a device goes
missing): change `KIOSK_CODE` here → **Apply** → facilitators re-unlock
kiosks with the new code. Unlocked kiosks stop working on their next request.

Brute-force protection: failed unlock attempts are rate limited (10 per IP,
100 total, per 15 minutes) and the comparison is timing-safe. Weekly code
rotation keeps the small 4-digit space safe in practice.

## Step 6 — Onboard staff and assign roles

Access is deny-by-default: signing in grants nothing until a role resolves.
There are **two ways** to onboard staff — see [GO-LIVE.md](GO-LIVE.md)
Phase 6 for the full walkthrough of both:

**Primary — in-app (Settings → Admin):** sign in as a bootstrap admin (an
address in `ADMIN_EMAILS`), open **Settings → Admin**, and create a staff
account with email + display name + role. That person can immediately sign
in with an emailed one-time code, and the Microsoft button also works for
them if their work account's email matches. This is the day-to-day way.

**Alternative — SWA Role-management invitations** (Microsoft-sign-in-only
onboarding, managed from the Azure portal):

1. Static Web App → **Settings → Role management** → **Invite**.
2. Authorization provider: **Azure Active Directory**. Invitee: the staff
   member's work email. Domain: your site's domain. Role — type one of:
   - `facilitator` — staff dashboard (rosters, check-in/out, add clients)
   - `leader` — everything above plus the leadership dashboard and org
     management (add/remove groups and facilitators)
   - `admin` — same surfaces as leader
3. **Generate** → send the invitation link to that person. They open it,
   sign in with their work account, and are in. Links expire — regenerate
   if someone waits too long.
4. Repeat per person. To revoke access later, delete them from this list.

Roles resolve from **either** source (matching staff account *or*
invitation), so to fully offboard someone, remove them from both.

## Step 7 — Go-live smoke test

Run through this on the production URL before the first session:

1. `https://<your-site>/api/health` returns `{"ok":true}`.
2. Open the site in a private/incognito window: the kiosk keypad appears, the
   group picker shows Morning/Afternoon groups (proves `/api/org` + first-run
   seeding worked). Wrong code → rejected; real `KIOSK_CODE` → unlocks.
3. Check a fictional test person in on the kiosk, then sign in as a
   facilitator on another device and confirm the check-in appears.
4. Sign in as a leader: leadership dashboard loads; add a test group, assign
   a facilitator, remove the test group.
5. Sign in with a Microsoft account that has **no** role: confirm they see
   the access-pending screen and no client data.
6. Delete the fictional test check-in data before real use: open the
   Storage Account → **Storage browser → Tables → rosters** and delete the
   test day's row (or the whole test date partition). Checking the person
   out does NOT remove the name from the stored roster.

## Tablet (kiosk) setup

1. Open `https://<your-site>/?kiosk=1` in the tablet's browser — this pins
   the app to kiosk mode. Add it to the home screen (Safari: Share → Add to
   Home Screen; Chrome: ⋮ → Add to Home screen) so it launches full-screen.
2. Lock the tablet to that app:
   - **iPad**: Settings → Accessibility → **Guided Access** → on, set a
     passcode staff don't know. Launch the app, triple-click the side/home
     button, Start.
   - **Android**: Settings → Security → **App pinning** (name varies), then
     pin the browser/home-screen app.
3. Each morning a facilitator taps the keypad and enters the day code
   (`KIOSK_CODE`). The code is verified server-side and never stored in the
   page source.
4. Physical placement matters for privacy: angle the screen away from the
   waiting area; the kiosk intentionally shows only the current group's
   check-in flow, never full rosters.

## Local development

Two modes:

- **Demo mode (zero setup)** — `npm install && npm run dev`. The API probe
  fails, the app renders with fictional demo data, nothing persists. This is
  the default for UI work and is why no real data can leak from a laptop.
- **Live mode (full stack)** — run the real API locally with the Static Web
  Apps CLI and the Azurite storage emulator:

```bash
npm install                     # frontend deps
npm install --prefix api        # API deps
npm install -g @azure/static-web-apps-cli azurite

# terminal 1 — local Table Storage emulator
azurite --silent --location .azurite

# terminal 2 — frontend + API + fake auth, all behind one origin
npm run dev:swa
```

Create `api/local.settings.json` first (gitignored; template at
`api/local.settings.json.example`):

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "KIOSK_CODE": "0000",
    "SESSION_SECRET": "local-dev-secret-at-least-32-characters-long",
    "ADMIN_EMAILS": "you@example.com"
  }
}
```

Open the URL the SWA CLI prints (default `http://localhost:4280`). Hitting a
staff page triggers the CLI's **fake auth screen** — enter any name and add
`facilitator`, `leader`, or `admin` to the roles field to simulate that role.
The kiosk unlocks with the local `KIOSK_CODE` (`0000` above).

To exercise the **email one-time-code sign-in** locally, set
`SESSION_SECRET` and `ADMIN_EMAILS` as above. With no ACS configured (no
`ACS_CONNECTION_STRING`/`ACS_SENDER`), no email is sent — locally the
request-code response includes a `devCode` field with the 6-digit code, so
you can complete the flow without a mail service. This only happens in
local development; in production the code is only ever delivered by email. Requires
Node 18+ and the Azure Functions Core Tools (the SWA CLI offers to install
them on first run).

## PHI / HIPAA notes

- **Where client data lives**: exclusively in the `rosters` table of the
  Storage Account in *your* tenant (step 2). The `org` table holds only
  group numbers/names and facilitator names/credentials/emails. Nothing is
  sent to any third party.
- **This repository contains no PHI** — all names in `src/seed.js` are
  fictional, and demo mode never talks to any server.
- **BAA**: Microsoft offers a Business Associate Agreement covering Azure
  Storage, Static Web Apps, Functions, and Entra ID through the Microsoft
  Product Terms / HIPAA BAA. Confirm with your compliance officer that your
  subscription's agreement covers it **before** entering real client names.
- **Access controls**: rosters are only readable with a staff role (assigned
  by you in step 6) or the kiosk day code; facilitator emails are hidden from
  the anonymous kiosk; leadership-only endpoints check roles server-side on
  every request. Roles come from the platform-verified identity header — the
  client cannot forge them.
- **Encryption**: Azure Storage encrypts at rest by default; all traffic is
  HTTPS end to end (secure transfer required is on by default).
- **Auditing**: enable diagnostic logging on the Storage Account (Monitoring
  → Diagnostic settings → Table) if you need an access audit trail.
- **Retention**: rosters are stored one row per group per day, forever, until
  you delete them. If your policy requires purging, delete old partitions
  (partition key = date) with Azure Storage Explorer or a scheduled job.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Site loads but shows **demo data** and a demo banner | `/api/health` is failing. Check GitHub Actions ran green, and that the workflow's `api_location` deployed (Static Web App → **Functions** should list `health`, `org-get`, `rosters-get`, …). |
| `/api/org` returns 500 | Missing/typo'd `STORAGE_CONNECTION_STRING`. Check step 5, then Static Web App → **Functions → (any function) → Monitor** or Application Insights for the error. |
| Kiosk code always rejected | `KIOSK_CODE` not set (kiosk unlock is disabled until it is) or set with stray whitespace or more/fewer than 4 digits. Fix the app setting, **Apply**, retry — no redeploy needed. |
| Staff sign-in loops or errors (`AADSTS…`) | Redirect URI missing/wrong (step 3.7 — must end in `/.auth/login/aad/callback`), `<YOUR-TENANT-ID>` not replaced in `staticwebapp.config.json`, or `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` missing/expired. |
| Signed in but stuck on "access pending" | The account has no role yet — add a matching staff account in **Settings → Admin** in the app, or invite it in **Role management** (step 6), and make sure any invite link was accepted. |
| Microsoft sign-in works but "access pending" | The Microsoft account's email has no matching **active** staff account (Settings → Admin) **and** no SWA invitation. Add one; the staff-account email must match the Microsoft account's email. |
| Sign-in code email never arrives | Check spam (sender `DoNotReply@...azurecomm.net`); the address must be an **active** staff account or in `ADMIN_EMAILS` (others are silently ignored); `ACS_SENDER` must exactly match the provisioned domain's MailFrom address; the domain must be **connected** to the ACS resource (ACS → **Email → Domains**); `ACS_CONNECTION_STRING` present. See GO-LIVE.md troubleshooting. |
| Email sign-in returns 503 "not configured" | `SESSION_SECRET`, `ACS_CONNECTION_STRING`, or `ACS_SENDER` missing from app settings. Add, **Apply**, retry. |
| "Account deactivated" at sign-in | The staff account was deactivated in **Settings → Admin**; an admin can reactivate it there. |
| Bootstrap admin can't get in | `ADMIN_EMAILS` typo, casing, or stray-whitespace mismatch with the address typed at sign-in. Fix the app setting (comma-separated, no spaces), **Apply**, request a fresh code. |
| Leader actions fail with 403 | The account has `facilitator` only. Org changes need `leader` or `admin`. |
| Rosters return 401 on the kiosk | Kiosk was unlocked with an old code after a `KIOSK_CODE` rotation — re-enter the current code. |
| GitHub Action fails at deploy step | `AZURE_STATIC_WEB_APPS_API_TOKEN` secret missing/stale. Regenerate: Static Web App → **Manage deployment token**, update the repo secret, re-run. |
| Two workflow runs per push, one failing | The portal added its own workflow (GitHub deployment source). Delete the auto-generated `.github/workflows/azure-static-web-apps-<random>.yml`, keep this repo's `azure-static-web-apps.yml`. |
| Groups list is empty / wrong after go-live | The `org` table seeds only when it has **no** groups. Manage groups from the leadership dashboard; direct table edits are possible with Azure Storage Explorer but the dashboard is safer. |
| Need to start data over | Delete the `org` and/or `rosters` tables in the Storage Account (Storage browser → Tables). The API recreates and reseeds groups on the next request. This permanently deletes client data — export first if required. |
