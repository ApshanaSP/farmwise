# District Collector Dashboard — Citizen Module

A Next.js (App Router + TypeScript) application for the Greater Chennai
Corporation's Public Grievance Redressal Portal. This delivery covers
**authentication, user profiles, and the full citizen module** (file a
complaint + track status). The codebase is structured so a Collector
dashboard (`/collector`) and a Department Officer dashboard (`/officer`)
can be built on top without refactoring anything here — placeholder pages
for both already exist and are role-protected.

## Tech Stack

- Next.js 14 (App Router), React, TypeScript
- MySQL via `mysql2` (parameterized queries only, no ORM)
- Tailwind CSS
- `bcryptjs` for password hashing, `jose` for JWT (httpOnly cookies), Next.js middleware for role-based route protection
- `nodemailer` for OTP emails
- `zod` for client + server validation
- OpenAI API for "Others" complaint classification (server-side only), with a keyword-based fallback classifier
- Leaflet.js + OpenStreetMap for the complaint-location map (no API key needed)

## 1. Prerequisites

- Node.js 18.18+ (Node 20 LTS recommended)
- MySQL 8.x running locally or reachable over the network
- (Optional) an SMTP account for real OTP emails — Gmail App Passwords work well for testing
- (Optional) an OpenAI API key for AI-based complaint classification

## 2. Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database and load the schema (creates the DB, all tables, and seed data)
mysql -u root -p < schema.sql

# 3. Configure environment variables
cp .env.example .env
# then edit .env with your DB credentials and JWT secret.
# SMTP is only needed for password reset and mobile OTP emails.

# 4. Apply migrations (idempotent; safe to re-run)
node scripts/migrate.js

# 5. Import + load the verified GCC reference data (see section 8)
node scripts/import-gcc-reference.js --streets
node scripts/import-ward-boundaries.js
node scripts/seed-gcc-reference.js

# 6. (Optional) Seed 3 sample accounts — one per role, password: Passw0rd!
node scripts/seed-users.js

# 7. Run the dev server
npm run dev
```

`node scripts/migrate.js --status` lists applied and pending migrations;
`--dry-run` prints the SQL without executing it. Migrations are additive — none
of them drops a column or table holding complaint data.

The app will be available at http://localhost:3000. Visiting `/` redirects
to `/login` if you're not signed in, or to your role's home page if you are.

### Sample accounts (after running `scripts/seed-users.js`)

| Role | Email | Password |
|---|---|---|
| Collector | collector@chennai.gov.in | Passw0rd! |
| Department Officer (Electrical) | officer.electrical@chennai.gov.in | Passw0rd! |
| Citizen | citizen@example.com | Passw0rd! |

You can also just register fresh accounts via `/register`.

### Dev-mode OTPs

With `NEXT_PUBLIC_DEV_SHOW_OTP=true` **and** `NODE_ENV` set to something
other than `production`, OTP-sending endpoints also return the plaintext code
in the API response — handy for testing without a mail gateway.

Both conditions are required. Every route that can echo a code goes through
`devOtpForResponse()` in `src/lib/otp.ts`, which returns `undefined` whenever
`NODE_ENV === "production"`, so leaving the flag set to `true` by mistake in a
production deployment still cannot leak a code through an API response or the
UI.

## 3. Project Structure

```
district-collector-dashboard/
├── schema.sql                     # Full DB schema + seed data
├── scripts/seed-users.js          # Optional: seeds 3 sample accounts
├── middleware.ts                  # Role-based route protection (Edge-safe JWT verify via `jose`)
├── src/
│   ├── app/
│   │   ├── login/, register/, forgot-password/      # Auth pages
│   │   ├── profile/                                  # Profile page (all roles)
│   │   ├── citizen/                                   # Citizen landing, file-complaint, track-complaints
│   │   ├── officer/, collector/                       # Placeholder role dashboards
│   │   └── api/                                        # All API route handlers (see below)
│   ├── components/                # Header, Footer, MapPicker, StatusTracker, StatusBadge, PasswordStrengthMeter
│   ├── lib/                       # db, auth, jwt, otp, mailer, ai-classifier, validators, rate-limit, crypto, complaint-code, constants
│   └── types/                     # Shared TypeScript types
└── public/uploads/                # profile/ and complaints/ file uploads
```

## 4. Database

`schema.sql` creates:

- `zones`, `localities`, `streets` — the 15 GCC zones with real ward ranges, localities per zone, and generic placeholder streets per locality (documented in the file as needing a real GIS street master eventually)
- `departments` — exactly the 16 GCC departments
- `complaint_types` — the seeded complaint types, each mapped to a department, including "Others"
- `users`, `user_profiles`, `password_resets` (also used for the mobile-OTP and complaint-OTP flows), `complaints`, `complaint_status_history`

Complaint creation and its first status-history row are written inside a
single DB transaction (`withTransaction` in `src/lib/db.ts`).

## 5. Security Notes

- Every API route re-checks the session from the httpOnly JWT cookie server-side; a citizen can only ever read/write their own complaints and profile (enforced by `WHERE user_id = ?` / ownership checks, never by trusting client-supplied IDs).
- All SQL uses parameterized queries via `mysql2`.
- Passwords are hashed with bcrypt (cost factor 10); OTPs are hashed the same way before storage and expire after 10 minutes with a 5-attempt cap and 60-second resend cooldown.
- JWTs are signed with `jose` (HS256) and stored in an httpOnly, sameSite=lax cookie (secure in production).
- Aadhaar numbers are AES-256-GCM encrypted at rest and only ever displayed masked (`XXXX-XXXX-1234`).
- Login/register/forgot-password endpoints are rate-limited per IP and per email (in-memory — swap for Redis if you run multiple server instances).

## 6. API Endpoints

All endpoints are under `/api`. Authenticated endpoints read the session
from the `dcd_session` httpOnly cookie — no bearer tokens needed from the
client.

### Auth

| Method | Endpoint | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password, confirmPassword, role, departmentId? }` | `departmentId` required only when `role = "department_officer"` |
| POST | `/api/auth/login` | `{ email, password }` | Sets the session cookie; response includes `redirectTo` based on role |
| POST | `/api/auth/logout` | — | Clears the session cookie |
| GET | `/api/auth/me` | — | Returns the logged-in user's basic info |
| POST | `/api/auth/forgot-password/request-otp` | `{ email }` | Always returns a generic message (doesn't reveal if the email exists) |
| POST | `/api/auth/forgot-password/verify-otp` | `{ email, otp }` | |
| POST | `/api/auth/forgot-password/reset-password` | `{ email, otp, newPassword, confirmPassword }` | |

**Example — login**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"citizen@example.com","password":"Passw0rd!"}'
```
```json
{ "message": "Login successful", "redirectTo": "/citizen", "role": "citizen" }
```

### Profile

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/profile` | Returns account info, profile fields, and a computed `completeness` percentage |
| PUT | `/api/profile` | Updates editable profile fields (name, gender, DOB, address, zone/ward, Aadhaar). Login email/role are never editable here. |
| POST | `/api/profile/mobile-otp/request` | `{ mobileNumber }` — starts re-verification of a new mobile number |
| POST | `/api/profile/mobile-otp/verify` | `{ mobileNumber, otp }` — verifies + saves the new number |
| POST | `/api/profile/change-password` | `{ currentPassword, newPassword, confirmPassword }` |
| POST | `/api/profile/photo` | `multipart/form-data`, field `photo` (jpg/png, ≤2MB) |

### Email verification

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/verify-email` | Confirm a registration code (consumes it atomically) |
| POST | `/api/auth/verify-email/resend` | Issue a new code, subject to the 60s cooldown |

### Reference data (used by both the profile and complaint forms)

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/departments` | All 16 departments |
| GET | `/api/complaint-types` | All complaint types, grouped by department |
| GET | `/api/locations/zones` | All 15 zones with ward ranges |
| GET | `/api/locations/localities?zoneId=9` | Localities in a zone |
| GET | `/api/locations/streets?localityId=17` | Streets in a locality |

### Complaints

| Method | Endpoint | Notes |
|---|---|---|
| POST | `/api/complaints/otp/request` | `{ mobileNumber }` — the OTP gate on the file-complaint form |
| POST | `/api/complaints/otp/verify` | `{ mobileNumber, otp }` |
| POST | `/api/complaints/media` | `multipart/form-data`, field `media` (jpg/png/mp4, ≤10MB) — returns `mediaPath` to include in the submit call |
| POST | `/api/complaints` | Submits the complaint (see body shape below) |
| GET | `/api/complaints?code=&status=` | Lists the **logged-in citizen's own** complaints, optionally filtered |
| GET | `/api/complaints/:code` | Full detail + status history for one complaint (ownership-checked) |

**Example — submit a complaint**

```bash
curl -X POST http://localhost:3000/api/complaints \
  -H "Content-Type: application/json" \
  --cookie "dcd_session=<your session cookie>" \
  -d '{
    "firstName": "Ravi", "gender": "Male",
    "streetAddress": "12 Main Road", "pincode": "600018",
    "mobileNumber": "9876543210",
    "zoneId": 9, "wardNumber": 100, "localityId": 14, "streetId": 60,
    "specificLocation": "Near bus stop",
    "latitude": 13.0569, "longitude": 80.2425,
    "complaintTypeId": 1,
    "title": "Street light not working",
    "description": "The street light near the bus stop has been off for a week.",
    "isAnonymous": false
  }'
```
```json
{
  "message": "Your complaint has been registered in the Public Grievance Redressal Portal of GCC. You can check the current status of your complaint using your Complaint Number.",
  "complaintCode": "2026-618SGP",
  "department": "Electrical Department",
  "complaintType": "Street Light Not Functioning"
}
```

## 7. Map Provider

`src/components/MapPicker.tsx` supports two providers behind one contract and
chooses at runtime:

| | With `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Without it |
|---|---|---|
| Map, click-to-place, drag pin | Google Maps | Leaflet + OpenStreetMap |
| Address search / autocomplete | yes | no |
| Reverse geocoding (address fill) | yes | no — citizen types the address |
| "Use my location" | yes | yes |
| Ward + serviceability check | yes | yes (uses this app's own polygons) |

When no key is set, the form says so rather than silently offering less.

Google Maps needs the **Maps JavaScript API**, **Places API** and **Geocoding
API** enabled, plus an active billing account. The monthly free allowance is
real but limited and Google has changed its shape — check
<https://mapsplatform.google.com/pricing/> before deploying, and do not assume
it is free. Budget alerts only notify; to actually cap spend, set per-API quota
limits under *APIs & Services → Quotas*. Restrict the browser key by HTTP
referrer and to those three APIs. If you later add server-side Google calls,
use a separate IP-restricted key in a non-`NEXT_PUBLIC_` variable.

### Design notes

* The **pin is the complaint location**. A reverse-geocode result contributes
  address text only, never coordinates — geocoders answer with the centre of a
  road or postcode, which would move the complaint off the marked spot.
* Every async lookup carries the sequence number of the selection that started
  it; a stale response is discarded, so a slow reply for an old pin cannot
  overwrite a newer one.
* Geocoding runs on `dragend` / click / search commit, never on intermediate
  positions while the marker is moving.
* Map autofill only ever touches the **complaint location** fields. The
  complainant's own address and PIN code are never overwritten from the map,
  and are no longer prefilled into the location step from their profile.

## 8. Reference data and its provenance

All reference data is imported by script, stored in `data/`, and recorded in the
`reference_data_sources` table with its source URL and fetch date. Nothing in
this section is hand-authored.

### Complaint types — verified

`node scripts/import-gcc-reference.js` reads the category and subcomplaint
`<select>` elements from the GCC grievance portal:

> <https://erp.chennaicorporation.gov.in/pgr/citizen/BeforeReg.do>

Imported: **17 categories, 327 subcomplaints, 5 "frequently filed" entries**,
preserving GCC's own grouping, wording and ordering. `scripts/seed-gcc-reference.js`
loads them into `complaint_categories` / `complaint_subtypes`, keyed on GCC's
own stable option ids.

**Department routing is only partly known.** GCC does not publish its internal
routing on the citizen page, so the seeder maps only the 8 categories with an
unambiguous counterpart in this app's `departments` table. The remaining 9
(Public Toilet, Voter ID, General, Road and Footpath, Air Quality, Flood, and
the three MEGA STREETS phases — **239 of 327 subcomplaints**) are stored with
`mapping_status = 'unmapped'` and `department_id = NULL`. Complaints of those
types are routed to the fallback department **and flagged
`needs_manual_review`**, and both the form and the confirmation screen tell the
citizen an officer will route it. Add verified routings to
`CATEGORY_DEPARTMENT` in `scripts/seed-gcc-reference.js` and re-run the seeder.

### Areas, localities, streets — verified

The same script walks GCC's own `loadComboAjax.jsp` boundary endpoint:
**250 areas → 4,883 localities → 53,800 streets**. These replace the previous
placeholder tables (32 localities with exactly 6 streets each), which are kept
so existing complaints still resolve.

A citizen can always choose **"Enter street manually"** and supply a street name
plus an optional street type; the two are stored separately in
`manual_street_name` and `street_type`.

### Wards — from boundary polygons, NOT an official GCC feed

`node scripts/import-ward-boundaries.js` downloads GCC ward polygons and writes
`data/boundaries/gcc-wards.geojson` plus a `.meta.json` recording provenance.

* Default source: the **DataMeet** `Municipal_Spatial_Data` community dataset.
  All 200 wards and 15 zones are present, but **it is not an official Greater
  Chennai Corporation publication** and carries no accuracy guarantee. The app
  says so wherever a ward is shown as map-derived.
* GCC's own ArcGIS server (`gis.chennaicorporation.gov.in`) was **not** used:
  its TLS certificate had expired at import time, and fetching it would have
  meant disabling certificate verification. To swap in an official layer:
  `node scripts/import-ward-boundaries.js --source ./official-wards.geojson`.
* Ward is resolved **by point-in-polygon** on the pin coordinates. It is never
  derived from a PIN code, the nearest ward centroid, or geocoded address text —
  all of which produce confident-looking wrong answers near a ward edge.
* The union of the 200 polygons **is** the municipal boundary, so the same test
  answers service eligibility. A rectangular map viewport is never used for this.
* If the boundary file is missing, `/api/locations/resolve-ward` returns
  `unavailable` and the form asks the citizen to pick the ward instead of
  guessing.

**This import corrected existing data.** The `zones` table shipped with ward
ranges that disagreed with the boundary polygons for **124 of 200 wards** (it
placed T. Nagar in Teynampet rather than Kodambakkam, and so on). `zone_wards`
now holds the authoritative per-ward mapping and `zones.ward_start/ward_end` are
refreshed from it. Note that Adyar (170–182) and Perungudi (168–191) have
**overlapping ward spans** in the source data, which a plain start/end range
cannot represent — validation therefore uses `zone_wards`, and the discrepancy
is recorded in `data/boundaries/gcc-wards.meta.json`.

### Area → ward mapping — DERIVED, not authoritative

The ward dropdown narrows to the wards of the selected area. GCC publishes no
such mapping, so `scripts/derive-area-wards.js` approximates one:

1. each GCC area name is geocoded against OpenStreetMap (Nominatim);
2. every ward polygon intersecting the returned bounding box becomes a
   candidate, and the ward containing the point is marked primary.

```bash
node scripts/derive-area-wards.js
```

Rows land in `area_wards` with `confidence = 'derived'`. This cuts a 200-item
dropdown to roughly a dozen and is explicitly **not** good enough to decide
which ward a complaint belongs to:

* the form labels the list as approximate and says it is estimated from map
  data, not published by the Corporation;
* areas that fail to geocode fall back to the full 200-ward list;
* a ward resolved by point-in-polygon from a real map pin always overrides it,
  and the submit endpoint re-checks the pin server-side.

`locality_wards` from migration 004 remains and is still empty; the form now
asks for area + street rather than area + locality + street, so `area_wards` is
the table in use.

## 9. Accounts and sign-in

Registration creates an account that can sign in immediately. There is no email
verification step.

Accounts created this way are stored with `email_verified_at = NULL` and
`email_verification_exempt = 1`: the address was never confirmed, and the flag
records why the account is nonetheless allowed to sign in. Those two columns and
the `email_verify` OTP purpose remain in the schema so verification can be
switched back on without a migration — see the git history for the previous
implementation.

OTP flows are still used for **password reset** and **mobile number
verification**, which is why `src/lib/otp.ts` and the SMTP settings remain.

## 10. Deployment

The app needs a Node server, MySQL, and a persistent disk for uploads.
See **[DEPLOYMENT.md](DEPLOYMENT.md)** for step-by-step Railway instructions.

Connection settings accept either `DATABASE_URL` / `MYSQL_URL` or the discrete
`DB_*` variables, so the same build runs locally and against a managed database.

```bash
# Point at a fresh managed database and load everything
DATABASE_URL='mysql://user:pass@host:port/dbname' npm run db:setup
```

`db:setup` = `bootstrap-db.js` (loads schema.sql; refuses if tables already
exist) → `migrate.js` → `seed-gcc-reference.js`. For an existing database, run
`npm run migrate` instead.

## 11. What's Next

The Collector console (`/collector`) and the Department Officer consoles
(`/officer`, see section 13) are built on the district intelligence store.
Status updates to the portal's own `complaints` / `complaint_status_history`
tables reuse the `ComplaintStatus` enum already defined in `src/types/index.ts`.

**When they are built, call `appendStatusChangeToDataset(code)` from
`src/lib/dataset/append.ts` after every status update** so the grievance
dataset records the change (see section 12).

## 12. Grievance dataset (for the Officer / Collector dashboards)

`data/datasets/` holds a CSV dataset of every complaint and status change,
pre-filled with 90 days of synthetic history. The data dictionary, the assumed
lifecycle and the synthetic-data rules are in
**[data/datasets/README.md](data/datasets/README.md)**.

```bash
npm run migrate            # applies 010 (complaints.is_synthetic)
npm run dataset:generate   # insert 90 days of synthetic complaints, export, validate
npm run dataset:export     # rebuild both CSVs from MySQL (atomic)
npm run dataset:validate   # 13 checks; exit code 1 on any failure
npm run dataset:unseed     # delete is_synthetic = 1 rows only, then re-export
```

New complaints are appended automatically after `POST /api/complaints`
commits. The folder is git-ignored (except its README) because it contains
personal data from real complaints.

## 13. Department Officer consoles (`/officer`)

One template serves every department that owns work in the district intelligence
store (25 today: GCC departments, Police, PWD, Government Hospitals, Metrowater,
TANGEDCO, TNPCB, District Revenue, Disaster Management). It uses the Collector
console's shell, theme, map and components, and reads **the same store**: the
data is only what the `district_intel` pipeline collects in its daily 6:00 AM run.
The console never fetches, generates or reloads data itself.

**Workflow (the task pipeline to the Collector):** New → *Approve* → In action →
*Complete & send* (remarks and at least one site photo) → Sent to Collector →
*Verify* by the Collector. If the Collector sends it back, it returns to *In action*,
marked **Returned** with the Collector's note, and the officer sends it again.

**Link to the Collector console** (the only changes outside the officer folders):
- `src/lib/collector/intel.ts`: reports sent from the officer console always go to
  the Collector's *My Tasks* (first, marked "Department sent a completion report",
  with the officer's remarks) and to the "Awaiting your verification" list and CSV,
  until the Collector verifies or sends back. The incident pop-up shows the
  completion report with its photos. Without the officer tables this is inert.
- `src/components/collector/app/Detail.tsx`: the completion-report block.
- `src/components/collector/app/SatMap.tsx`: optional `pinColor` prop.
- The two consoles are signed into separately: `/officer` is for department officers only
  (`middleware.ts`, `officerSession()`), and neither console links to the other. The Collector
  verifies or sends back officers' reports from *My Tasks* on the Collector console.

**Accounts.** One account per department, `officer.<code>@chennai.gov.in`, each with its
own password (`npm run seed:officers`; the usernames and passwords are written to the
git-ignored `officer-accounts.local.csv`). The top bar shows the name the officer signed
in with. An officer sees only their own department and has no way to open another; the
department comes from the database, never the URL.

**Screens.** Laid out like the Collector console with the department selected: it fits the
window (no page scroll), with the period, zone and taluk filters (the department is fixed) and
four pages:
1. *Overview*: the Collector console's own overview filtered to the department (`overview()`
   in intel.ts, so the officer and the Collector see the same figures): Severe events, Open
   incidents, Waiting for your approval, Resolved; the map; the department snapshot (head of
   department, severe or high, past deadline, due in 24 hours, most open work); By severity;
   **My Work** (to approve / in action, with Approve and Complete & send); Today's Briefing.
2. *Grievances*: the grievance board (New / In action / Sent to Collector / Verified),
   **What needs you now** and the Collector's feedback.
3. *Department data*: one card per store source that concerns the department (headline
   figures, the main finding, one chart; *Details* opens every chart and table):

| Department | Insight cards |
|---|---|
| Police (POL-GCP) | Police records: cases by type, violent crime, road accidents with deaths/injuries, response time, cases by hour, by channel, by zone |
| Government Hospitals (HLT-DMS), GCC Health, Family Welfare | Hospital MIS: bed occupancy, free beds, outpatients, emergencies, health alerts, medicine stock, ambulances, cases by disease (GCC Health also gets air quality) |
| PWD Water Resources | Lakes (storage, near full, releasing), IMD warnings and rain, CFM-DSS inflow, works register (delays, spend, overruns), PWD field records |
| PWD Buildings | Building works register, field records |
| Storm Water Drain, Disaster Management | IMD warnings and rain, reservoir inflow, lakes |
| Roads (GCC Engineering), Electrical, Parks, TANGEDCO | IMD warnings and rain (rain drives potholes, waterlogging, streetlight faults, fallen trees, power cuts) |
| Solid Waste Management | IMD warnings and rain, air quality |
| Bridges | IMD warnings and rain, lakes (subways flood) |
| Metrowater | Lakes and reservoirs |
| TNPCB | Air quality (CPCB/TNPCB stations) and air-pollution complaints |
| District Revenue | Food prices in the Chennai Uzhavar Sandhais (AGMARKNET), weekly change |
| Every department | Complaint patterns: complaint types rising or falling on the previous period, the wards that report the most, how many reached the news |
| Every department | Work record: grievances vs. the previous period, closed and closed on time, open past deadline by zone, time to close by type, places that keep coming back (hotspots), the Collector's verified / returned counts |

4. *Trends*: grievances across the period, by type, by area.

Periods follow the Collector console (Daily = today from midnight; Weekly, Monthly,
Quarterly = the last 7, 30, 90 days). "Last updated" is the pipeline's collection
status (`collectionStatus()`), the same as the Collector's top-bar chip.
**Ask District IQ** (section 14) sits on the officer console too, answering for the
officer's department only.

**Setup**
```bash
npm run migrate          # 011: users.dept_code (links Police, PWD, ... officers)
npm run setup:officer    # district_intel_ops.officer_steps, officer_reports (never drops data)
npm run seed:officers    # officer.<code>@chennai.gov.in, each department with its own password (officer-accounts.local.csv, git-ignored);
                         # --reset-passwords gives every existing officer.<code> account a new one
```

**Access.** The officer's department is read from the database on every request,
never from the URL or the token; another department's grievance returns 404.
Completion photos are stored outside `public/` (`OFFICER_UPLOAD_DIR`, default
`uploads/officer-reports`) and served only to the Collector and the sending department.

## 14. Ask District IQ (assistant on the Collector and department officer consoles)

A pop-up over the console (the launcher at bottom right, or Ctrl+K) that answers questions about the district's
data in English, Tamil or Tanglish, with charts, maps and tables. It never invents a number: every figure comes from
the console's own functions or a checked, read-only query on the same store (`district_intel` / `district_intel_ops`),
and a verifier rejects any number that is not in the data. It fetches nothing itself.

**Who can ask what.** The Collector asks about the whole district (the console's filters narrow it). A department
officer asks from their own console and every answer is for their department only (`src/lib/assistant/access.ts`,
`lockDept` in `pipeline.ts`): tools run with the department as their filter, rankings of all departments become the
department's own figures, incidents of other departments are not opened, and "Insights for today" are the department's.

**Setup**
1. `npm install`, then `npm run setup:ops` (creates the assistant's tables in `district_intel_ops`; additive, safe to re-run).
2. In `.env`, the AI provider: Amazon Bedrock by default (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`,
   `AWS_REGION`), or `AI_PROVIDER=groq` with `GROQ_API_KEY` (`OPENAI_API_KEY` as a fallback). Without a key it still answers the
   common questions by rules, marked "Without AI".
3. Optional: run `scripts/create-assistant-ro-user.sql` as a MySQL admin and set `ASSISTANT_RO_DB_USER` / `_PASSWORD`, so ad-hoc
   queries use a SELECT-only account (otherwise they run in a read-only transaction).

**How it works** (`src/lib/assistant/`, `src/lib/ai/`, UI in `src/components/collector/app/assistant/`)
- `pipeline.ts`: guard (code checks: personal data, data changes, pasted instructions) → router (fast model, or rules) → console
  tools (`tools.ts`) or, for groupings no tool offers, the query planner + compiler (`compile.ts`; catalog-only, bound
  parameters, 5 s limit, row caps) → facts → composer → number verifier (`verify.ts`) → chart checker (`chartspec.ts`).
- Follow-ups ("only Zone 13", "make it a pie", "show on map") edit the previous answer. Pins re-run on fresh data.
  "Insights for today" (`insightcards.ts`) come from the console's own `insights()`.
- Limits (`limits.ts`): 20 questions a minute and 300 a day per user, one in flight, 20 records shown, top 10 + "Others",
  CSV export capped at 1,000 rows (10 a day).

**Routes** (`src/app/api/collector/assistant/`): `chat` (SSE), `status`, `insights`, `pins`, `feedback`, `sessions`, `export`
(Collector or department officer); `briefing` (save as workspace) and `tools` (development only) are the Collector's.

**Tests**: `npm test` (Vitest: compiler, verifier, chart checker, guards, edits, typos). Golden questions: `eval/`.
