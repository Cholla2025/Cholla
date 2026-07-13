# GO-LIVE Runbook — Cholla Check-In

**Zero to live in one sitting. Budget 60–75 minutes.**

This is the complete first-deployment walkthrough for the Cholla Behavioral
Health check-in app. Every step is a concrete Azure-portal click-path or a
single command. If a blade name in your portal differs slightly, type the
**bold** term into the portal's top search box — it will find the right place.
You can hand this whole file to an AI assistant and say "walk me through it."

> Already deployed once and just need a reference? [DEPLOYMENT.md](DEPLOYMENT.md)
> is the condensed runbook. This file is the full, first-time, checkbox-driven
> version.

## What you're deploying (in words)

```
Clients on a tablet ──► Kiosk (no sign-in; unlocked daily by a 4-digit code)
Staff on any device ──► Sign-in page ──► Microsoft button (Entra ID)
                                     └─► Email one-time code (6 digits, via
                                         Azure Communication Services)
        Both paths land on role-based dashboards:
        facilitator → facilitator dashboard + Settings (My Profile)
        leader      → + leadership dashboard + Team settings
        admin       → + Admin panel (create/deactivate staff accounts)

Everything runs on ONE Azure Static Web App (React frontend + linked
Node 20 Azure Functions API), reading/writing ONE Storage Account with two
tables that create themselves:
  org     = groups, facilitators, staff sign-in accounts, login codes
  rosters = client check-ins (the only place client names ever exist)
Plus ONE Azure Communication Services resource that sends the sign-in
code emails.
```

Five Azure resources total: a resource group, a Storage Account, a
Communication Services resource, an Email Communication Service resource,
and a Static Web App — plus one Entra ID app registration.

| Phase | What | Time |
| --- | --- | --- |
| 0 | Prerequisites & decisions | 5 min |
| 1 | Resource group + Storage Account | 10 min |
| 2 | Email service (ACS) | 10 min |
| 3 | Microsoft sign-in (Entra app registration) | 10 min |
| 4 | Static Web App + GitHub deploy | 10–15 min |
| 5 | App settings (all secrets) | 5 min |
| 6 | People & access | 10 min |
| 7 | Data check | 2 min |
| 8 | Kiosk tablets | 5 min per tablet |
| 9 | Smoke test | 10 min |

---

## Phase 0 — Before you start

Have all four of these before touching the portal:

1. [ ] **An Azure subscription** you can create resources in. Check: sign in
   at [portal.azure.com](https://portal.azure.com), search **Subscriptions**
   — you should see at least one you're an Owner or Contributor on.
2. [ ] **Microsoft 365 / Entra ID admin access** (or a friendly admin on
   standby). You need permission to create an **app registration** in the
   tenant your staff's work emails live in. Many orgs allow all users to
   register apps; if yours doesn't, your M365 admin does Phase 3 for you.
3. [ ] **Admin access to this GitHub repository** — you'll add one repository
   secret and push one small config change.
4. [ ] **Decisions written down**:
   - Your **kiosk day code**: exactly 4 digits (e.g. `4827`). You'll rotate
     it weekly, so don't agonize.
   - Your **bootstrap admin email(s)**: the email address(es) that must be
     able to sign in before any staff accounts exist. Put the owner's email
     first (e.g. `brian@manageai.io`). These go into the `ADMIN_EMAILS` app
     setting in Phase 5.

**The HIPAA/BAA gate — read this before any real client name is entered.**
Attendance rosters are PHI. Microsoft covers Azure Storage, Static Web Apps,
Azure Functions, Entra ID, and Azure Communication Services under its
standard Business Associate Agreement, which is part of the Microsoft Product
Terms attached to most commercial subscriptions — but *you* must confirm your
specific subscription's agreement includes it. Ask whoever manages your
Microsoft agreement (your Microsoft reseller/CSP, licensing contact, or your
compliance officer) the one question: "Does our Azure subscription's
agreement include the Microsoft HIPAA BAA?" You can build and smoke-test the
whole system with fictional names today regardless — just don't enter real
client names until the answer is yes.

---

## Phase 1 — Azure foundation

Names below are suggestions — pick yours and stay consistent.

### 1.1 Resource group (a folder for everything)

1. [ ] Sign in to [portal.azure.com](https://portal.azure.com).
2. [ ] Top search box → **Resource groups** → **+ Create**.
3. [ ] Subscription: yours. Name: `rg-cholla-checkin`. Region: one close to
   the clinic (e.g. **West US 3** for Arizona).
4. [ ] **Review + create** → **Create**.

### 1.2 Storage Account (holds all client data)

1. [ ] Search **Storage accounts** → **+ Create**.
2. [ ] Resource group: `rg-cholla-checkin`. Name: `chollacheckindata` (must
   be globally unique, lowercase letters/numbers only — adjust if taken).
3. [ ] Region: same as 1.1. Performance: **Standard**. Redundancy: **LRS**
   is fine to start; pick **ZRS/GRS** later if you want region-failure
   durability.
4. [ ] On the **Advanced** tab leave **Require secure transfer** enabled
   (it's the default).
5. [ ] **Review + create** → **Create**, then **Go to resource**.
6. [ ] Left menu → **Security + networking → Access keys** → **Show keys**
   → copy the **Connection string** under *key1* (starts with
   `DefaultEndpointsProtocol=https;AccountName=...`). Paste it into a
   private note — it becomes app setting `STORAGE_CONNECTION_STRING` in
   Phase 5. **Treat it like a password**: it grants full access to all
   client data.

You do **not** create any tables. The API creates `org` and `rosters`
automatically on first use and seeds the standard 20-group schedule
(Morning/Afternoon × groups 1–10). It never seeds people.

---

## Phase 2 — Email service (sends the sign-in codes)

This is Azure Communication Services (ACS). Two small resources, one free
email domain, one connection. ~10 minutes, no DNS work.

### 2.1 Create the Communication Services resource

1. [ ] Top search box → **Communication Services** → **+ Create**.
   (If search shows several similar entries, you want the one described as
   "Communication Services" under *Marketplace* / *Services* — not "Email
   Communication Services" yet; that's next.)
2. [ ] Subscription: yours. Resource group: `rg-cholla-checkin`.
   Resource name: `acs-cholla-checkin`. Data location: **United States**.
3. [ ] **Review + create** → **Create** → **Go to resource**.

### 2.2 Create the Email Communication Service resource

1. [ ] Top search box → **Email Communication Services** → **+ Create**.
2. [ ] Resource group: `rg-cholla-checkin`. Name: `email-cholla-checkin`.
   Data location: **United States** (must match 2.1).
3. [ ] **Review + create** → **Create** → **Go to resource**.

### 2.3 Add the free Azure-managed sender domain (instant, no DNS)

1. [ ] In the Email Communication Service resource, left menu →
   **Provision domains** → **+ Add domain** → **Azure domain**
   (some portal versions show this as a **1-click add** button).
2. [ ] Azure provisions a domain like `x1x2y3z4-....azurecomm.net` in about
   a minute. It comes pre-verified — no DNS records to add.
3. [ ] Click into the new domain and note the **MailFrom** sender address —
   it looks like `DoNotReply@<something>.azurecomm.net`. Copy it exactly
   into your private note — it becomes app setting `ACS_SENDER` in Phase 5.

Azure-managed domains have modest daily send limits (on the order of a few
hundred emails per day). That is far more than enough for staff sign-in
codes at a single clinic. If you later want codes to come from your own
clinic domain (e.g. `signin@yourclinic.com`), that's an optional upgrade:
**Provision domains → + Add domain → Custom domain**, then add the TXT/SPF/
DKIM DNS records Azure shows you at your domain registrar. Not needed today.

### 2.4 Connect the domain to the Communication Services resource

1. [ ] Go back to the **Communication Services** resource from 2.1
   (`acs-cholla-checkin`).
2. [ ] Left menu → **Email** → **Domains** → **Connect domain**.
3. [ ] Pick your subscription, resource group, the Email service from 2.2,
   and the Azure-managed domain from 2.3 → **Connect**.

### 2.5 Copy the ACS connection string

1. [ ] Still in the Communication Services resource → left menu →
   **Settings → Keys** → copy the **Connection string** (Primary key). It
   starts with `endpoint=https://...;accesskey=...`. Into the private note
   — it becomes app setting `ACS_CONNECTION_STRING`. **Treat it like a
   password.**

Phase 2 done: you have `ACS_CONNECTION_STRING` and `ACS_SENDER` saved.

---

## Phase 3 — Microsoft sign-in (Entra app registration)

This locks the Microsoft sign-in button to accounts in *your* tenant. If you
can't create app registrations, hand exactly this section to your M365 admin.

1. [ ] Search **Microsoft Entra ID** → left menu **App registrations** →
   **+ New registration**.
2. [ ] Name: `Cholla Check-In`. Supported account types: **Accounts in this
   organizational directory only** (single tenant).
3. [ ] Redirect URI: leave blank for now → **Register**.
4. [ ] On the app's **Overview** page copy two values into your note:
   - **Application (client) ID** → becomes app setting `AZURE_CLIENT_ID`.
   - **Directory (tenant) ID** → goes into `staticwebapp.config.json` next.
5. [ ] **Certificates & secrets** → **+ New client secret** → description
   `cholla-swa`, expiry 12–24 months → **Add** → copy the secret **Value**
   immediately (shown only once) → becomes app setting
   `AZURE_CLIENT_SECRET`. **Treat it like a password**, and put a calendar
   reminder a month before it expires.
6. [ ] In this repository, edit `staticwebapp.config.json`: replace
   `<YOUR-TENANT-ID>` in the `openIdIssuer` URL with the Directory (tenant)
   ID from step 4. Commit and push to `main` (a tenant ID is not a secret —
   it's safe in the repo).
7. [ ] One step stays open: after Phase 4 gives you the site URL, come back
   to this app registration → **Authentication** → **+ Add a platform** →
   **Web** → Redirect URI:
   `https://<your-site>/.auth/login/aad/callback` → **Configure**.
   (Phase 4 step 9 reminds you.)

---

## Phase 4 — Static Web App + GitHub deploy

1. [ ] Search **Static Web Apps** → **+ Create**.
2. [ ] Resource group: `rg-cholla-checkin`. Name: `swa-cholla-checkin`.
3. [ ] Plan type: **Standard** — required for the tenant-locked custom
   authentication from Phase 3, and the right choice for anything handling
   PHI. Do not pick Free.
4. [ ] Deployment source: **Other**. (This repo already ships its own
   workflow at `.github/workflows/azure-static-web-apps.yml`; choosing
   GitHub here would commit a duplicate one.)
5. [ ] **Review + create** → **Create** → **Go to resource**.
6. [ ] On **Overview**, click **Manage deployment token** → copy the token.
   **Treat it like a password** — it lets anyone deploy to your site.
7. [ ] In GitHub: repo → **Settings → Secrets and variables → Actions →
   New repository secret**. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`.
   Value: the token → **Add secret**.
8. [ ] Trigger a deploy: push to `main` (the Phase 3.6 commit works), or in
   GitHub go to **Actions → Azure Static Web Apps CI/CD → Run workflow**,
   or re-run the latest run. Wait for green — first run takes a few
   minutes. The workflow builds the Vite frontend to `dist/`, builds
   `api/`, and deploys both.
9. [ ] Back on the Static Web App **Overview** page, copy the site **URL**
   (e.g. `https://happy-dune-0abc123.azurestaticapps.net`). Now finish
   Phase 3.7: app registration → **Authentication** → **+ Add a platform**
   → **Web** → `https://<your-site>/.auth/login/aad/callback` →
   **Configure**.

---

## Phase 5 — App settings (all secrets live here, never in the repo)

Static Web App → **Settings → Environment variables** (older portals call it
**Configuration**) → make sure the **Production** environment is selected →
**+ Add** each row → **Apply** when done. Settings take effect within about
a minute; no redeploy needed.

First, generate your session-signing secret. In any terminal (macOS/Linux/
WSL/Git Bash, or Azure Cloud Shell — the `>_` icon in the portal's top bar):

```bash
openssl rand -base64 48
```

Copy the output — that's your `SESSION_SECRET`.

| Name | Value | Required? |
| --- | --- | --- |
| `STORAGE_CONNECTION_STRING` | Storage Account connection string from Phase 1.2.6 | **Required** |
| `KIOSK_CODE` | Your 4-digit kiosk day code from Phase 0 — **exactly 4 digits**. Until set, kiosk unlock is disabled entirely (fails closed). | **Required** for the kiosk |
| `AZURE_CLIENT_ID` | Application (client) ID from Phase 3.4 | **Required** for Microsoft sign-in |
| `AZURE_CLIENT_SECRET` | Client secret value from Phase 3.5 | **Required** for Microsoft sign-in |
| `SESSION_SECRET` | The `openssl rand -base64 48` output above (any random string of 32+ chars works). Signs email-code sessions. | **Required** for email sign-in |
| `ADMIN_EMAILS` | Comma-separated bootstrap admin emails, owner first — e.g. `brian@manageai.io`. This is how the FIRST admin gets in before any staff accounts exist. Matching is case-insensitive; just avoid typos and stray spaces. | **Required** |
| `ACS_CONNECTION_STRING` | Communication Services connection string from Phase 2.5 | **Required** for email sign-in |
| `ACS_SENDER` | The verified sender address from Phase 2.3, e.g. `DoNotReply@<your-domain>.azurecomm.net` — copy it exactly | **Required** for email sign-in |
| `CLINIC_TIMEZONE` | Optional; defaults to `America/Phoenix`. Defines the clinic's calendar day for kiosk roster access. | Optional |

- [ ] All eight required settings added, values pasted with no stray
  spaces or quotes, **Apply** clicked.

Every value in this table except `CLINIC_TIMEZONE` and `KIOSK_CODE` is a
secret or near-secret: keep them in a password manager, never in email,
chat, or the repo.

---

## Phase 6 — People & access

How sign-in works, in one paragraph: a staff member can sign in **two ways**
— the **Microsoft button** (their work Microsoft account, tenant-locked) or
the **email one-time code** (they type their email, receive a 6-digit code,
enter it, and get a 12-hour session). Either way, what they can *do* is
decided by their role, which resolves from **either** (a) a staff account
you created in the app's **Settings → Admin** panel whose email matches, or
(b) a Static Web Apps **Role management** invitation. Codes are only ever
emailed to addresses that exist as active staff accounts (or are listed in
`ADMIN_EMAILS`); codes expire in 10 minutes, allow 5 attempts, are
rate-limited, and are stored hashed. Access is deny-by-default: no matching
account, no invitation, no `ADMIN_EMAILS` entry → "access pending" screen
and zero client data.

### 6a — First sign-in as the bootstrap admin

1. [ ] Open `https://<your-site>` on a desktop-width browser. You'll see
   the sign-in page with the Microsoft button and the email-code field.
2. [ ] Easiest path: enter the email you put in `ADMIN_EMAILS` → **Send
   code** → check that inbox (and spam — the sender is
   `DoNotReply@...azurecomm.net`) → enter the 6-digit code. You're in as
   admin. (The Microsoft button also works if that same address is a work
   Microsoft account in your tenant.)
3. [ ] Confirm you can see all three staff surfaces: facilitator dashboard,
   leadership dashboard, and **Settings** with the **Admin** panel.

If the code email never arrives, jump to [Troubleshooting](#troubleshooting).

### 6b — Add every staff member (the primary way)

In the app: **Settings → Admin** → add an account per person:

1. [ ] **Email** — their work email, spelled exactly.
2. [ ] **Display name** — what colleagues see.
3. [ ] **Role** — `facilitator`, `leader`, or `admin` (table below).
4. [ ] Save. That's it — **they can sign in by email code immediately**,
   and the **Microsoft button also works for them** if their work
   Microsoft account's email matches the account you created. No
   invitation link, no waiting.

### 6c — Alternative: SWA Role-management invitations

The Azure-portal route still works and is a fine belt-and-braces option:

1. Static Web App → **Settings → Role management** → **Invite**.
2. Authorization provider: **Azure Active Directory**. Invitee: their work
   email. Domain: your site's domain. Role: `facilitator`, `leader`, or
   `admin` → **Generate** → send them the link. Links expire — regenerate
   if someone waits too long.

**When to prefer which:** use **Settings → Admin** (6b) for day-to-day
onboarding — it's instant, self-service, and enables both sign-in paths.
Use an **SWA invitation** when you want someone to have Microsoft-button
access managed purely from the Azure portal (e.g. an IT contractor you
never want in the staff-account list), or as a fallback if the email
service is ever down. A person can have both; roles resolve from either.

### 6d — Roles, changes, and removal

| Role | Sees |
| --- | --- |
| `facilitator` | Facilitator dashboard, Settings → My Profile |
| `leader` | All of the above + leadership dashboard + Settings → Team |
| `admin` | All of the above + Settings → Admin panel |

- **Change a role**: Settings → Admin → edit the account's role. Takes
  effect on their next request.
- **Deactivate** (person on leave, or offboarding today): Settings → Admin
  → deactivate. They immediately stop receiving codes and their account no
  longer grants a role. Reactivate later without retyping anything.
- **Delete**: Settings → Admin → delete, for people who are never coming
  back.
- **Fully offboarding someone**: deactivate/delete their staff account
  **and** check Static Web App → **Role management** for an old invitation
  to delete — remember roles resolve from *either* list.

### 6e — Facilitators vs. staff sign-in accounts (two different lists)

These are separate on purpose:

- **Facilitators** (Settings → **Team**, or the leadership Day-of settings
  — same powers, same list) are the *schedulable people* who appear in
  group assignments and on rosters. Adding one does **not** create a login.
- **Staff sign-in accounts** (Settings → **Admin**) are *logins*. Creating
  one does **not** put the person on the schedule.

For a facilitator who also signs in to the app (the usual case), add them
to **both**: Team (so they can be assigned to groups) and Admin (so they
can sign in). For a front-desk person who signs in but never runs groups,
Admin only. For a per-diem facilitator who never touches the app, Team only.

---

## Phase 7 — Tables & data (nothing to build)

There is nothing to create by hand. On the very first API request, the app
creates the `org` and `rosters` tables and seeds the standard 20-group
schedule (Morning/Afternoon × groups 1–10). It never seeds people.

**To see the data**: Storage Account → **Storage browser** → **Tables** →
`org` (groups, facilitators, staff accounts, login-code records) or
`rosters` (one row per group per day — the only place client names exist).

**To wipe test data before real use**: in **Storage browser → Tables →
rosters**, delete the test rows (partition key = date, so you can clear a
whole test day). To start completely over, delete the `org` and `rosters`
tables entirely — the API recreates them and reseeds the 20 groups on the
next request. That permanently deletes everything, including staff accounts
you created in 6b, so do full wipes only before go-live.

---

## Phase 8 — Kiosk tablets

Per tablet, about 5 minutes:

1. [ ] Open `https://<your-site>/?kiosk=1` in the tablet's browser. This
   pins the device to kiosk mode (persists in localStorage across reloads
   and restarts; `?kiosk=0` unpins).
2. [ ] Add it to the home screen so it launches full-screen — Safari:
   Share → **Add to Home Screen**; Chrome: ⋮ → **Add to Home screen**.
3. [ ] Lock the tablet to the app:
   - **iPad**: Settings → Accessibility → **Guided Access** → on; set a
     passcode staff don't share with clients. Launch the app, triple-click
     the side/home button, **Start**.
   - **Android**: Settings → Security → **App pinning** (name varies by
     vendor), then pin the browser/home-screen app.
4. [ ] **Morning ritual**: each day a facilitator taps the keypad and
   enters the 4-digit day code (`KIOSK_CODE`). It's verified server-side,
   never stored in the page, and failed attempts are rate-limited (the
   kiosk fails closed if the setting is missing).
5. [ ] **Rotation**: change `KIOSK_CODE` weekly — Static Web App →
   **Environment variables** → edit → **Apply**. Unlocked kiosks stop
   working on their next request and need the new code. Rotate immediately
   if a device goes missing.
6. [ ] Angle the screen away from the waiting area. The kiosk deliberately
   shows only the current check-in flow, never full rosters.

---

## Phase 9 — Go-live smoke test

Run the whole list on the production URL before the first real session.
Use only fictional names.

1. [ ] `https://<your-site>/api/health` returns `{"ok":true}`.
2. [ ] Private/incognito window: the kiosk keypad appears and the group
   picker shows Morning/Afternoon groups (proves storage + first-run
   seeding). A **wrong** code is rejected; the real `KIOSK_CODE` unlocks.
3. [ ] **Email-code sign-in end-to-end**: on the sign-in page, request a
   code for your `ADMIN_EMAILS` address, receive a real email, enter the
   code, land signed in with a 12-hour session.
4. [ ] **Microsoft sign-in**: the Microsoft-logo button signs you in with a
   work account from your tenant, no `AADSTS` errors.
5. [ ] **No-role account**: sign in with a Microsoft account from your
   tenant that has no staff account and no invitation → sees the **access
   pending** screen and no client data. (The email-code path can't reach
   this state — addresses with no staff account never receive a code.)
6. [ ] **Facilitator** account: sees the facilitator dashboard and Settings
   → My Profile — and does **not** see leadership, Team, or Admin.
7. [ ] **Leader** account: additionally sees the leadership dashboard and
   Settings → Team; can add a test group, assign a facilitator, remove the
   test group. Does **not** see the Admin panel.
8. [ ] **Admin** account: additionally sees Settings → Admin; can create
   and deactivate a test staff account (a deactivated account stops
   receiving codes).
9. [ ] **Cross-device**: check a fictional person in on the kiosk; on
   another device the facilitator dashboard shows the check-in.
10. [ ] **Profile edit persists**: Settings → My Profile → change display
    name → sign out → sign back in → the new name stuck.
11. [ ] **Delete all test data**: Storage browser → Tables → `rosters` →
    delete the test rows (checking someone out does NOT remove the name
    from the stored roster — you must delete the rows).

---

## THE GO-LIVE CHECKLIST

The consolidated, printable version. Done in order, you are live.

- [ ] Azure subscription confirmed (Owner/Contributor)
- [ ] Entra ID app-registration permission confirmed (or admin on standby)
- [ ] GitHub repo admin access confirmed
- [ ] 4-digit kiosk code chosen
- [ ] Bootstrap admin email(s) chosen (owner first)
- [ ] BAA question asked; no real client names until answered yes
- [ ] Resource group `rg-cholla-checkin` created
- [ ] Storage Account created (Standard/LRS, secure transfer on)
- [ ] Storage **connection string** copied to a private note
- [ ] Communication Services resource created
- [ ] Email Communication Service resource created
- [ ] Free **Azure-managed domain** provisioned (Provision domains → Add domain → Azure domain)
- [ ] Sender address `DoNotReply@...azurecomm.net` noted
- [ ] Domain **connected** to the ACS resource (ACS → Email → Domains → Connect domain)
- [ ] ACS **connection string** copied (ACS → Keys)
- [ ] Entra app registration created, **single tenant**
- [ ] Application (client) ID + Directory (tenant) ID copied
- [ ] Client secret created and **Value** copied; expiry reminder on calendar
- [ ] `<YOUR-TENANT-ID>` replaced in `staticwebapp.config.json`, committed, pushed
- [ ] Static Web App created — plan **Standard**, deployment source **Other**
- [ ] Deployment token → GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN`
- [ ] GitHub Actions workflow ran green; site URL noted
- [ ] Redirect URI `https://<site>/.auth/login/aad/callback` added to the app registration
- [ ] `SESSION_SECRET` generated (`openssl rand -base64 48`)
- [ ] All app settings added and applied: `STORAGE_CONNECTION_STRING`, `KIOSK_CODE`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_EMAILS`, `ACS_CONNECTION_STRING`, `ACS_SENDER` (+ optional `CLINIC_TIMEZONE`)
- [ ] `/api/health` returns `{"ok":true}`
- [ ] Signed in as bootstrap admin via email code (real email received)
- [ ] Microsoft-button sign-in works
- [ ] Every staff member added in Settings → Admin (email + name + role)
- [ ] Every scheduled facilitator added in Settings → Team and assigned to groups
- [ ] Kiosk unlock: wrong code rejected, right code unlocks
- [ ] No-role Microsoft account sees access pending
- [ ] Facilitator / leader / admin accounts each see exactly their surfaces
- [ ] Cross-device check-in verified
- [ ] Profile display-name edit persists
- [ ] All fictional test rows deleted from `rosters`
- [ ] Tablets pinned (`?kiosk=1` + Guided Access / App pinning)
- [ ] Day code shared with facilitators; weekly rotation reminder set
- [ ] Client-secret expiry reminder set
- [ ] Secrets stored in a password manager; scratch notes destroyed

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Site shows **demo data** and a demo banner | `/api/health` failing. Check GitHub Actions ran green and the Static Web App → **Functions** blade lists the API functions. |
| `/api/org` returns 500 | Missing/typo'd `STORAGE_CONNECTION_STRING`. Fix in **Environment variables**, **Apply**, retry. |
| **Sign-in code email never arrives** | Work down this list: (1) check spam/junk — sender is `DoNotReply@...azurecomm.net`; (2) the email must exist as an **active** staff account or be in `ADMIN_EMAILS` — non-matching addresses are silently ignored by design; (3) `ACS_SENDER` must exactly match the MailFrom address of the provisioned domain; (4) the domain must be **connected** to the ACS resource (ACS → Email → Domains — is it listed?); (5) `ACS_CONNECTION_STRING` present and unexpired; (6) rate limit — wait a few minutes and request once. |
| Email sign-in returns **503 "email sign-in not configured"** | `SESSION_SECRET`, `ACS_CONNECTION_STRING`, or `ACS_SENDER` missing from app settings. Add, **Apply**, retry. |
| "**Account deactivated**" at sign-in | The staff account was deactivated in Settings → Admin. An admin can reactivate it there. |
| **Admin can't get in** (bootstrap) | `ADMIN_EMAILS` typo or whitespace mismatch with the address being typed at sign-in (matching ignores upper/lower case). Fix the app setting (comma-separated, no stray spaces), **Apply**, request a fresh code. |
| Code rejected | Codes expire in 10 minutes and allow 5 attempts — request a fresh one. Repeated requests are rate-limited; wait briefly. |
| **Microsoft sign-in works but "access pending"** | The Microsoft account's email has no matching **active staff account** (Settings → Admin) AND no SWA Role-management invitation. Add one or the other — the email on the staff account must match the Microsoft account's email. |
| Microsoft sign-in loops or `AADSTS…` errors | Redirect URI missing/wrong (must end `/.auth/login/aad/callback`), `<YOUR-TENANT-ID>` not replaced in `staticwebapp.config.json`, or `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` missing/expired. |
| Kiosk code always rejected | `KIOSK_CODE` unset (kiosk fails closed) or not exactly 4 digits / stray whitespace. Fix, **Apply**, retry. |
| Kiosk returns 401 mid-day | Code was rotated after unlock — re-enter the current code. |
| Leader/admin actions fail with 403 | The account's role is `facilitator`. Raise it in Settings → Admin (or the SWA invitation). |
| GitHub Action fails at deploy | `AZURE_STATIC_WEB_APPS_API_TOKEN` secret missing/stale. **Manage deployment token** → regenerate → update the GitHub secret → re-run. |
| Two workflow runs per push, one failing | The portal added its own workflow (GitHub deployment source was chosen). Delete the auto-generated `.github/workflows/azure-static-web-apps-<random>.yml`; keep `azure-static-web-apps.yml`. |
| Need to start data over | Delete the `org` and/or `rosters` tables (Storage browser → Tables). They recreate and groups reseed on the next request. Deleting `org` also deletes staff accounts and Team lists — you'll re-bootstrap via `ADMIN_EMAILS`. |

---

## Ongoing operations

- **Weekly kiosk-code rotation** (and immediately if a device goes
  missing): Static Web App → **Environment variables** → edit `KIOSK_CODE`
  → **Apply**. Tell facilitators the new code out-of-band. Rate limiting
  plus weekly rotation keeps the 4-digit space safe in practice.
- **Client-secret expiry**: the Entra client secret from Phase 3.5 expires
  (12–24 months). When it does, the Microsoft button breaks (email-code
  sign-in keeps working). Renew: app registration → **Certificates &
  secrets** → new secret → update `AZURE_CLIENT_SECRET` → **Apply**. Keep
  a calendar reminder one month ahead.
- **Adding staff**: Settings → Admin (login) and, if they run groups,
  Settings → Team (schedule). Thirty seconds, no Azure portal needed.
- **Offboarding staff**: deactivate (or delete) in Settings → Admin the
  same day; also delete any old SWA Role-management invitation; remove
  from Settings → Team if scheduled. If they knew the kiosk code, rotate it.
- **Data retention / purge**: `rosters` keeps one row per group per day
  forever until you delete it. If policy requires purging, delete old date
  partitions in **Storage browser** (partition key = date) or with Azure
  Storage Explorer on a schedule. Export first if your policy requires it.
- **Backups**: Table Storage has no one-click backup. Minimum viable:
  periodically export `org` and `rosters` with Azure Storage Explorer (or
  AzCopy) to a secure location covered by the same BAA posture. Upgrading
  the Storage Account redundancy (ZRS/GRS) protects against hardware/region
  failure but not against accidental deletion — exports cover that.
- **Keep an eye on**: GitHub Actions (each push to `main` deploys), and the
  Storage Account's **Diagnostic settings** (Monitoring → Diagnostic
  settings → Table) if you need an access audit trail for compliance.
