# Cholla Check-In — Wrap-Up Release (v3, cumulative)

This release contains the full v2 scope (production hand-patch parity, Entra
fixes, review analytics, pre-registration) plus every v3 item. Deploy with the
usual SWA CLI command — GitHub is not in the deploy path.

```bash
npm ci && npm run build
npx @azure/static-web-apps-cli deploy ./dist --api-location ./api --env production --deployment-token <token>
```

New/changed app settings (Static Web App → Environment variables):
- `SITE_URL` (optional) — public site URL used in welcome emails.
- `AZURE_TENANT_ID` (optional) — directory tenant override; defaults to the
  Cholla tenant (83e66084-342d-470d-9551-04af0d97f850) baked into the API.
- `KIOSK_CODE` — now the **admin master/fallback**; facilitators manage
  personal codes in Settings.
- One-time Azure step for the people picker: on the existing app
  registration, add **Microsoft Graph → Application permission →
  User.Read.All** and click **Grant admin consent**. No new secrets.

## What's in it

1. **Naming** — "Front door" is retired: clients' daily door log is **Member
   Check-In**, non-client visitors are **Community Check-In**, everywhere in
   the UI, report emails and exports. Storage table names are unchanged
   (`frontdoor`, `visitors`) for data continuity.
2. **Mock-data purge** — demo mode is dev-only. Production builds contain no
   fictional data at all (the names are stripped from the shipped JS bundle by
   the build). An unreachable API in production shows honest error/empty
   states and a "Can't reach the server" badge; the facilitator tab shows real
   rosters or a real empty state, never mocked names.
3. **Navigation & roles** — top-level role-gated tabs. Facilitator:
   Facilitator Dashboard (auto-scoped to their own groups via account email →
   facilitator record) + Member Check-In + Settings; **no Community surface,
   and every community endpoint answers facilitators with 403 server-side**.
   Leadership/Admin: everything. The leadership KPI row is unchanged (total
   checked in, active in groups now, currently present, overall attendance).
4. **Analytics page** (leadership only) — group trends (per-group and
   clinic-wide, 7/30/90-day ranges), Member Check-In trends, Community
   visitor trends — three separate streams, never blended — plus visit
   durations, never-checked-out flags, still-in-facility count, peak hours,
   and visits-by-reason.
5. **Personal alert subscriptions** (on Analytics; facilitators get the same
   panel in Settings) — group-threshold alerts and per-client
   missed-check-in alerts (checkbox list from the client roster). Stored
   per-user server-side, evaluated at day close with the nightly daily-report
   run. Alert emails contain the client's **name + missed status only**.
   Facilitators can subscribe only to their own groups/clients (enforced
   server-side).
6. **Settings by role** — everyone edits their display name (with a note that
   sign-in is Microsoft, no password). Leadership: facilitators + group
   assignment (with the Microsoft 365 picker), facilitator kiosk codes,
   sign-in accounts. **Facilitators can add clients (single + bulk) into
   their own groups only.** Role selection at account creation and the
   automatic onboarding email are in.
7. **Per-facilitator kiosk codes** — 4-digit personal codes set/rotated in
   Settings, stored hashed (sha256 keyed with the session secret), verified
   timing-safe with the same brute-force throttle; each facilitator unlock is
   recorded (org table, `kioskunlock` rows) and the kiosk shows "unlocked by
   …". `KIOSK_CODE` remains the admin master/fallback during the transition.
   Guidance shown in-app: *Never share your code with clients; rotate it
   weekly.*
8. **Reports tab** — Leadership → Reports (and Admin Portal): in-app preview
   of daily/weekly/monthly/quarterly emails, the day's volume alerts,
   read-only recipient list + thresholds, and a send-now button (admin only).
9. **Data separation** — group rosters, Member Check-In, Community visitors,
   and the client registry live in separate tables; kiosk roster reads are
   now scoped to the one group the kiosk runs; facilitator client reads are
   scoped to their own groups; automated tests assert a facilitator session
   cannot retrieve community data and a group query cannot return another
   group's rows.
10. **Visitor pre-registration** — public, write-only `/preregister` page for
    NON-clients (rate-limited per IP + global, strict validation, length
    caps, per-day cap, future-dated ≤60 days). The front desk confirms
    arrivals — HIPAA acknowledgment + phone collected at the desk — from the
    Community kiosk or the Community dashboard; confirming converts the entry
    into a normal Community Check-In row.
11. **v2 parity items** — `/api/directory` (Microsoft Graph
    client-credentials, leader/admin only, excludes disabled/#EXT#/service
    accounts, 5-minute cache, never logged) with "Add from Microsoft 365"
    pickers; `renderOnboarding` welcome email on new active accounts
    (`welcomed` flag in the response); `domain_hint=chollabehavioralhealth.com`
    login parameter and the real tenant id in `staticwebapp.config.json`;
    **Entra bootstrap fix** (ADMIN_EMAILS addresses resolve to admin over
    Microsoft sign-in, record or not); **super-admin rules** (only
    ADMIN_EMAILS admins manage admin accounts; nobody can modify a super
    admin's record in-app).
12. **Mobile** — launcher logo 35% bigger; a bottom **⌂ Home** button inside
    every kiosk area that relocks and returns to device selection; a fourth
    launcher button ("Staff & Leadership") opening trimmed phone dashboards —
    leadership is read-only; a facilitator can check members in to their own
    group and add a walk-in.

## The broken add-staff / SSO flow — what was wrong, what to tell your Microsoft helper

Two server-side defects made "add someone who signs in with Microsoft" fail:

1. `staticwebapp.config.json` in the repo carried the `<YOUR-TENANT-ID>`
   placeholder, so any deploy from the repo silently broke the Microsoft
   button until hand-patched. The real tenant id is now committed, plus the
   `domain_hint` so staff skip the account picker.
2. The ADMIN_EMAILS bootstrap only applied to the email-code path — an owner
   signing in with the Microsoft button could land with **no role**. Fixed:
   Entra sign-ins for ADMIN_EMAILS addresses always resolve to admin, and
   added staff resolve their role from their staff record over Entra as
   before.

For the person handling the Microsoft side, the checklist is:
- App registration redirect URI:
  `https://<site>/.auth/login/aad/callback` (unchanged).
- `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` app settings present (unchanged).
- **New**: Microsoft Graph **User.Read.All (Application)** permission +
  **Grant admin consent**, for the directory picker. If skipped, everything
  else still works — the picker just doesn't render.
- Staff must exist either as SWA portal role invitations OR as accounts added
  under Settings → Sign-in accounts (the normal path now); their work email
  must match the Microsoft account they sign in with.

## Judgment calls (flagging for confirmation)

- **⚠️ Facilitators adding clients** — implemented as specified after the
  back-and-forth: facilitators can ADD (single/bulk) and assign **only into
  their own groups**; they cannot rename, reassign, deactivate, or see other
  groups' clients. Leadership keeps the full master list. Say the word and
  this can be tightened back to leadership-only in one place.
- **⚠️ "Remove the code login"** — interpreted as removing the **email
  one-time-code option from the staff sign-in page** (sign-in is now
  Microsoft-only). The kiosk day-code keypad remains — v3 item 7 explicitly
  keeps kiosk codes (now per-facilitator). The email-code API endpoints still
  exist server-side (unused) so this is trivially reversible.
- **Member Check-In reads for facilitators** — v2 said all front-door reads
  should be leadership-only, but v3 gives facilitators a Member Check-In tab;
  v3 wins. Facilitators can view/operate the member door log; all *analytics*
  and all *community* data stay leadership-only.
- **Facilitator alert subscriptions** — the Analytics page is
  leadership-only per spec, but facilitators may subscribe to their own
  clients per the same spec; so facilitators get the "My alerts" panel inside
  Settings.
- **Facilitator client reads** are scoped to their own groups' clients (not
  the clinic-wide list) to match the auto-scoping/data-separation intent.
- **Pre-registration phone** is optional on the public form (less friction,
  less data at rest) and required at desk confirmation, matching the walk-in
  rule.
- **Kiosk unlock audit** rows store the facilitator id + timestamp only.

## PHI proof (grep-verified)

- No names in URLs anywhere — new endpoints use opaque ids
  (`alerts/{id}`, `preregister/{id}`, `clients/{id}`); names travel in POST
  bodies only, including community visitor names and pre-registrations.
- Alert subscriptions store `clientId`, never a name; alert emails carry name
  + missed status only; group-threshold emails carry group labels + counts
  only.
- No names in server logs (dates, row keys, counts, sanitized status text
  only), none in browser console output, none in localStorage.
- Directory contents are never logged; kiosk codes are stored as hashes and
  never echoed.
- Production JS bundle verified to contain zero fictional demo names.
