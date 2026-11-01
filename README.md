# Zaki Workspace

AI-powered collaborative work operating system: projects, Kanban boards, tasks,
teams, ideas, documents, Telegram integration, automation and an AI assistant.

Status: **Phase 1 (foundation) + first vertical slice implemented; Phase 0
(security hardening and cleanup) in progress** — see `docs/PHASE0-AUDIT.md` for the
verified state of every known gap. Rules for people and coding agents working in this
repository are in `AGENTS.md`. A code map — every route and the guard that opens it, every
service and who imports it, every table and what writes it — is generated into
`docs/CODEMAP.md` by `node scripts/codemap.mjs` (never edited by hand).

## Stack

| Layer    | Choice |
| -------- | ------ |
| Frontend | Next.js 14 (App Router), React 18, TypeScript strict, Tailwind CSS 3, TanStack Query, @dnd-kit, lucide-react |
| Backend  | Next.js route handlers, Zod-validated typed contracts, centralized error mapping |
| Database | PostgreSQL 16 + Prisma (migrations in `prisma/migrations`) |
| Worker   | Node service (`worker/index.ts`) — a heartbeat placeholder today, no jobs yet |
| Tests    | Vitest: `tests/` (no database) and `tests/db/` (real Postgres) |
| Deploy   | Docker image built by GitHub Actions, run on Coolify (`workspace.zakiai.io`); Compose for local and self-hosted runs |

## Layout

```
src/app/(app)/       authenticated app pages (dashboard, projects, boards, tasks)
src/app/api/         REST endpoints (auth, workspaces, projects, boards, tasks, health)
src/components/      UI shell, board, task detail, primitives
src/server/          db, env validation, session, rbac, task service, logging
prisma/              schema + migrations + seed
worker/              background worker (heartbeat placeholder)
scripts/             secret scanner, migration linter, operator scripts (re-encrypt secrets)
.github/workflows/   CI (ci.yml) and the image build (image.yml)
docker-compose.yml   app + worker + db + redis (not used yet) + migrate
```

## Local development

1. Start Postgres and create your `.env`:
   ```sh
   docker compose up db -d          # Postgres 16 on localhost:5433 (see the note below)
   cp .env.example .env
   ```
   In `.env` set `DATABASE_URL` (for the compose database:
   `postgresql://zaki:zaki_local@localhost:5433/zaki_workspace`) and `AUTH_SECRET`
   (a long random string: `openssl rand -hex 32`). `.env` is git-ignored — never commit it.
   ⚠️ A local `docker-compose.override.yml` may remap the port (on the owner's machine another
   app already holds 5433). 🔧 Read the port from `docker compose ps` and use that one in
   `DATABASE_URL`; never guess.
2. Install, apply the committed migrations, seed:
   ```sh
   npm install
   npm run db:deploy      # applies prisma/migrations to your database
   npm run db:seed        # demo organization + owner login (see below)
   ```
   `npm run db:migrate` (`prisma migrate dev`) is only for creating a NEW migration after
   changing `schema.prisma`. If it ever offers to **reset** the database, answer no.
3. Run:
   ```sh
   npm run dev        # app on :3000
   npm run worker     # optional: the heartbeat worker
   ```

The seed creates the demo owner with a **random password printed once** in your terminal
(it is not stored anywhere else). Set `SEED_OWNER_PASSWORD` to choose it, `SEED_OWNER_EMAIL`
to choose the address. The seed refuses to run when `NODE_ENV=production`, or when
`DATABASE_URL` points at another machine, unless `ALLOW_PROD_SEED=1` — never seed a real
database.

## Environment variables

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session cookies (16+ characters; use `openssl rand -hex 32`) |
| `APP_URL` | yes in production | The public URL of the app, a full `https://` address (`https://workspace.zakiai.io`). Every link, redirect and the Google OAuth redirect URI is built from it, not from the request. Blank falls back to `http://localhost:3000` and the container logs a `boot.app_url_missing` warning |
| `ENCRYPTION_KEY` | no | Key for secrets stored in the database (Telegram, n8n, Google). Empty = derived from `AUTH_SECRET`, the old behaviour (production logs a `boot.encryption_key_missing` warning). Set a separate random value (`openssl rand -hex 32`) so rotating `AUTH_SECRET` does not break the stored secrets, then run `scripts/reencrypt-secrets.ts` once. ⚠️ It is also the ONLY key of the encrypted database backups (`dbBackup`, «الأتمتة»): they refuse to run without it (a key derived from `AUTH_SECRET` would rotate with the sessions) and cannot be opened without it. 🔧 Keep a copy outside the server; restoring is `scripts/decrypt-backup.mjs` then `psql` into a NEW database |
| `TRUSTED_PROXY_HOPS` | no | How many reverse proxies sit in front of the app: a whole number from 1 to 5, default **1** (Traefik / Coolify alone). It decides which `X-Forwarded-For` entry the sign-in limiter counts as the caller's address: the app counts that many entries from the **right**, so a visitor cannot choose it by sending the header. **If a CDN (Cloudflare, ...) sits in front of Traefik, set it to 2** - otherwise every user shares the proxy's address and the whole company shares one sign-in budget. Never set it higher than the real number of proxies: the extra step lands on an entry the visitor wrote, and the limit can be dodged |
| `UPLOAD_DIR` | no | Folder where uploaded files are written. Default `.data/uploads` in the working directory; the Docker image sets `/app/storage/uploads`, which must be a persistent volume |
| `SESSION_TTL_HOURS` | no | Session lifetime, default 168 (one week) |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google Drive: the library stores its files in the owner's Drive (scope `drive.file`, the app's own files only); without them the library stays on the server |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | no | The Web Push key pair that rings a closed site (`src/server/calls/push.ts`). Unset, it is derived from `ENCRYPTION_KEY` (else `AUTH_SECRET`), the same on every start; set both only to pin other keys. Changing the secret changes the keys and the browsers subscribe again by themselves |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | no, for calls | The self-hosted calls server (LiveKit on Coolify, service `zaki-calls`; see `docs/CALLS-SERVER.md`). `LIVEKIT_URL` is the `wss://` address browsers connect to; the key and the secret are the ones Coolify generated for that service. Without them the app runs and the call button answers that the calls server is not set up |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | yes, to open new companies | Outgoing mail (SMTP, nodemailer). Opening a company mails a one-time confirmation link (`src/server/services/registration.ts`); without `SMTP_HOST` and `MAIL_FROM` a production server answers registration with 503. `SMTP_PORT` defaults to 587 (STARTTLS); 465 means TLS from the first byte. `MAIL_FROM` looks like `Zaki Workspace <no-reply@your-domain.com>` |
| `REGISTER_GLOBAL_PER_HOUR`, `REGISTER_GLOBAL_PER_DAY` | no | Server-wide cap on requests to open a company, on top of 10 an hour per address. Defaults **30** an hour and **100** a day |
| `TEST_DATABASE_ADMIN_URL` | tests only | A Postgres server for `npm run test:db`, with a role that may `CREATE DATABASE` (see Testing). Falls back to `DATABASE_URL` |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `ALLOW_PROD_SEED` | seed only | See Local development |

Never put real values in `.env.example`, the README or any tracked file; production values
live in Coolify's environment.

## Testing

```sh
npm run typecheck
npm run lint
npm test                         # unit tests, no database needed
node scripts/lint-migrations.mjs # migration rules (also part of `npm test`)
npm run test:db                  # tests against a real Postgres (below)
npm run scan:secrets             # fails on anything that looks like a committed secret
npm run build                    # production build gate
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request, plus a fresh
`prisma migrate deploy` on an empty database and `prisma migrate diff` against
`schema.prisma`. A red or conflicting pull request is never merged.

**Database tests (`npm run test:db`).** Each run creates its own throw-away database on a
Postgres server, applies the real migrations to it, and drops it afterwards, so it can never
touch development or production data. Point it at the compose database:

```sh
docker compose up db -d
export TEST_DATABASE_ADMIN_URL="postgresql://zaki:zaki_local@localhost:5433/postgres"   # or put it in .env
npm run test:db
```

The role needs `CREATEDB`. Hosts other than localhost are refused unless
`ALLOW_REMOTE_TEST_DB=1` (use that only for a disposable server). Set `KEEP_TEST_DB=1` to
keep the database after the run when you need to inspect it.

## Production deployment

Production is the Docker image of this repository, run by **Coolify** at
`workspace.zakiai.io`. The image is built by GitHub Actions
(`.github/workflows/image.yml`) and pushed to `ghcr.io/<owner>/zaki-workspace`, so the
production server never compiles anything. Nothing is deployed until Coolify is pointed at
that image or its webhook is enabled (see the comments in `image.yml`).

⚠️ Merging this repository does not by itself change what production runs. Until Coolify's
Git Source says otherwise, production builds from the branch it was configured with.
🔧 Check Coolify → the application → Git Source before saying a change is live.

- The container applies the migrations (`prisma migrate deploy`) when it starts, then serves
  on port 3000. Put your reverse proxy (Traefik, Caddy, Coolify) in front of it.
- Migrations are additive only and a migration folder that was ever applied is never renamed
  (`prisma/migrations/RELEASED.txt`, `docs/DEPLOYMENT-INCIDENT-2026-10-19.md`).
- Required environment: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`; optional `ENCRYPTION_KEY` and
  `TRUSTED_PROXY_HOPS` (set it to 2 if a CDN sits in front of the proxy - see the table above).
  An invalid value stops the container at boot with the name of the variable, never its value.
- **Uploads:** mount a persistent volume at `/app/storage/uploads` (the image sets
  `UPLOAD_DIR` to that path and creates it for the runtime user). Without a volume, uploaded
  files disappear on every redeploy. If you mount a host folder instead of a named volume,
  it must be writable by the container user `zaki`.
- Back up the database **and** the uploads volume together.

Self-hosting with Compose (also what a developer can use to try the whole stack):

```sh
cp .env.example .env         # set AUTH_SECRET and POSTGRES_PASSWORD (optionally ENCRYPTION_KEY)
docker compose up -d migrate # apply migrations
docker compose up -d app worker
```

- Database persists in `db_data`; uploads in the `uploads` volume.
- `db` and `redis` are published on `127.0.0.1` only (ports 5433 and 6380); the app is on 3000.
- The `redis` service is not used by the application yet.
- The app refuses to start without `AUTH_SECRET` (16+ characters); compose does not demand it
  just to start the database.
- Back up: `docker compose exec db pg_dump -U zaki zaki_workspace > backup.sql`
- Restore: `docker compose exec -T db psql -U zaki zaki_workspace < backup.sql`
- ⚠️ `db` falls back to a well-known default password when `POSTGRES_PASSWORD` is unset.
  🔧 Fine on a laptop (the port is loopback-only); on a server set `POSTGRES_PASSWORD` in `.env`.

## Security notes

- Passwords are hashed with bcrypt (cost 12); sessions are signed JWTs in httpOnly cookies.
- Every API route validates input with Zod and resolves the caller server-side. A few rules
  are known to be too loose and wait for Phase 1 (`requireWorkspace` lets any organisation
  member through when there is no workspace row, sessions cannot be revoked, registration is
  still open) — they are listed with their status in `docs/PHASE0-AUDIT.md`. Earlier audit
  documents in `docs/` carry a warning banner where they claim more than the code does.
- Signing in is rate limited and answers 429 with `Retry-After`: per account **and** address
  (8 failed attempts in 10 minutes), a larger cap per account across all addresses, a cap per
  address, a short-burst cap per address, and at most three password checks at the same time.
  Attempts are counted before the check, so a burst of guesses cannot all slip through. The
  state lives in the app process (one container). Which address counts depends on
  `TRUSTED_PROXY_HOPS` (above). API writes whose `Origin` is not this app are refused by the
  middleware (machine endpoints with their own signature are exempt).
- Secrets live in the environment only. The health endpoint reports component status without
  details. The repository is public: `npm run scan:secrets` runs in CI and fails the build on
  anything that looks like a credential.

## Roadmap

See `docs/ROADMAP.md` for the phased plan (Telegram, automation, AI, analytics).
