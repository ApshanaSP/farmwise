# Deploying to Railway

The app needs three things a typical serverless host does not give you together:
a **Node server**, a **MySQL database**, and a **persistent disk** for uploaded
photos. Railway provides all three in one project, which is why these
instructions target it.

Everything below is done in the Railway dashboard — no CLI required.

---

## 1. Create the project

1. Sign in at <https://railway.com> with your GitHub account.
2. **New Project → Deploy from GitHub repo → `Arjuncodx/grievance-portal`**.
3. When asked for a branch, pick the one you want to deploy
   (`feat/email-verification-gcc-reference-data`, or `main` after merging).

The first build will fail or the app will crash-loop until the database and
environment variables exist. That is expected — finish the steps below, then
redeploy.

## 2. Add the database

In the same project: **New → Database → Add MySQL**.

Railway creates a MySQL service with an empty database (named `railway`) and
exposes variables such as `MYSQL_URL`, `MYSQLHOST`, `MYSQLUSER`.

## 3. Add a volume for uploads

Complaint photos and profile pictures are written to disk. Without a volume
they vanish on every redeploy, and on a read-only filesystem the upload fails
outright.

On the **app service**: **Settings → Volumes → Add Volume**, mount path:

```
/app/public/uploads
```

Next.js serves `public/` from disk at runtime, so files written there by
[`api/complaints/media`](src/app/api/complaints/media/route.ts) and
[`api/profile/photo`](src/app/api/profile/photo/route.ts) are served back
without any code change.

## 4. Set environment variables

On the **app service → Variables**. Use Railway's reference syntax so the
database credentials stay in sync automatically:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` |
| `JWT_SECRET` | a long random string — generate with `openssl rand -base64 48` |
| `AADHAAR_ENCRYPTION_KEY` | a second, different random string |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_DEV_SHOW_OTP` | `false` |
| `SMTP_HOST` | e.g. `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your SMTP username |
| `SMTP_PASS` | your SMTP password / API key |
| `SMTP_FROM` | `"District Collectorate - Chennai" <no-reply@your-domain>` |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | optional — omit to use the OpenStreetMap fallback |

`src/lib/db.ts` and `scripts/db-config.js` accept either `DATABASE_URL` /
`MYSQL_URL` **or** the discrete `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/
`DB_NAME` variables, so either style works. TLS is enabled automatically for
URL-based connections, which managed MySQL requires.

### SMTP is optional

There is no email verification at registration, so people can sign up without
it. SMTP is only used for password-reset codes and mobile-number verification;
leave it unset and those two flows will report that mail could not be sent.

## 5. Load the database

The database starts empty. From your own machine, pointing at the Railway
database:

```bash
# Copy MYSQL_URL from the Railway MySQL service -> Variables -> Connect
DATABASE_URL='mysql://user:pass@host:port/railway' npm run db:setup
```

`db:setup` runs three steps in order:

1. `bootstrap-db.js` — loads `schema.sql` (stripping its `CREATE DATABASE` /
   `USE`, since Railway already gave you a database). **It refuses to run if
   the database already has tables**, because `schema.sql` drops tables and
   would destroy existing complaints. Use `npm run migrate` to update an
   existing database instead.
2. `migrate.js` — applies every pending migration.
3. `seed-gcc-reference.js` — loads the GCC reference data from `data/`.

Then derive the area → ward mapping that narrows the ward dropdown (about five
minutes; it geocodes area names against OpenStreetMap at one request per
second):

```bash
DATABASE_URL='mysql://...' npm run derive:area-wards
```

Skipping it is safe — the ward dropdown simply lists all 200 wards.

The reference JSON is committed to the repo, so this does **not** re-fetch
anything from the GCC servers. To refresh it later, run `npm run import:gcc`
and `npm run import:wards`, then `npm run seed:gcc`.

Optionally seed the demo accounts:

```bash
DATABASE_URL='mysql://...' node scripts/seed-users.js
```

## 6. Generate the public URL

App service → **Settings → Networking → Generate Domain**. You get a
`*.up.railway.app` HTTPS URL. Share that.

Session cookies are `secure` in production, so the site must be served over
HTTPS — Railway's generated domain is, so this works out of the box.

---

## Cost

Railway's trial credit covers initial usage; after that expect roughly $5/month
for a small app plus MySQL plus a volume. Check current pricing at
<https://railway.com/pricing> — this is not a free tier and the figure above is
an estimate, not a quote.

## Troubleshooting

**Every ward lookup says "unavailable"** — `data/boundaries/gcc-wards.geojson`
is missing from the deployment. It is committed to the repo and read at runtime
by [`src/lib/wards.ts`](src/lib/wards.ts); confirm `data/` was not excluded by a
`.dockerignore` or build filter.

**Uploads fail or disappear after redeploy** — the volume is missing or mounted
at the wrong path. It must be exactly `/app/public/uploads`.

**Login succeeds but immediately bounces back** — `JWT_SECRET` changed between
deploys, invalidating issued cookies, or the app is being served over plain
HTTP so the `secure` cookie is dropped.

**Complaint types / areas are empty** — step 5 was not run, or it ran against a
different database than the app uses.
