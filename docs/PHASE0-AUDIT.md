# Phase 0 audit — the verified state (التدقيق: الحالة المتحقَّق منها)

Date: 2026-10-22 · Baseline: `main` at `a988409` (before Phase 0 started).

This document replaces, as the source of truth, the earlier audit documents
(`ENGINEERING_PROGRESS.md`, `SECURITY_AUDIT.md`, `DATABASE_AUDIT.md`, `PHASE1-REPORT.md`,
`PROJECT-FULL-REPORT.md`). Those were written before this audit and each carries a warning
banner: **some of what they say does not match the code** (section 3). Nothing below is taken
from them; every row was checked against the code, and the infrastructure rows were checked by
running the images.

**How to read the status column**

- **Fixed** — the change and a test that failed before it are in the repository; the commit is
  named when there is one. "Fixed in the tree" means it is in the working tree of the Phase 0
  branch and waits for a commit, the pull request and CI.
- **Planned Phase 1** — needs the account status, rank and permission-copy design of Phase 1,
  because it must not lock anyone out on deploy day.
- **Owner action** — only the owner can do it (production access, a decision).
- **Open** — known, not fixed, and the reason is written next to it.

## 1. Security findings

| # | Finding | Where in the code (baseline) | Status |
|---|---|---|---|
| S1 | **Open self-registration.** Anyone can create an organisation (and become its OWNER) or join one with its join code. | `src/app/api/auth/register/route.ts` (`registerOrganization`, `joinByCode`); `/register` is a public path in `src/middleware.ts` | **Fixed in Phase 1, reopened with guards on 2026-10-23** — team accounts are created by the owner (or whoever holds `users.manage`) from the People screen, and joining by code answers 410. Opening a NEW company is open to anyone again (owner's decision, after `cb2b09d` had opened it with no guard): `src/server/services/registration.ts` creates it only when the e-mailed one-time link is confirmed (24 h, only the token's SHA-256 is stored), answers every address the same 202 (no enumeration; a known address gets a "somebody tried" mail), and caps requests for the whole server (`REGISTER_GLOBAL_PER_HOUR` / `_PER_DAY`) on top of 10 an hour per address. ⚠️ Every new company is an OWNER account on the same server, so tenant isolation must hold (see `tests/db/chat-org-isolation.test.ts`). Tests: `tests/db/auth-register.test.ts`, `tests/db/accounts-create.test.ts`. |
| S2 | **Sessions cannot be revoked, and removed members keep access.** | `src/server/session.ts`: the token holds only `userId` and an expiry; `currentUser()` never looks at membership or status. `requireWorkspace` returns as soon as a `WorkspaceMember` row exists, even when the organisation membership is gone. | **Fixed in Phase 1** — members are ACTIVE / SUSPENDED / OFFBOARDED; the cookie carries `tv` (`User.tokenVersion`), checked against the database on every request, and suspending, offboarding, resetting or changing a password and "log out everywhere" bump it; offboarding removes every space row and hands the open work over. A revocation that lands while a request is in flight can no longer be undone by that request's own cookie refresh. Everyone signs in once more after the release (`docs/PHASE1-ROLLOUT.md`). Tests: `tests/db/accounts-status.test.ts`, `tests/db/review-a-session-race.test.ts`. |
| S3 | **`requireWorkspace` is too permissive.** With no `WorkspaceMember` row it lets any non-GUEST organisation member through, and it ignores its `roles` argument in that case. | `src/server/auth.ts` `requireWorkspace` | **Fixed in Phase 1** — `requireWorkspace` needs an ACTIVE organization membership AND a `WorkspaceMember` row (only the OWNER needs no row); an ADMIN inherits nothing; an org GUEST is a guest in every space (`src/server/workspace-role.ts`). The migration `20261023092000_membership_backfill` copied today's access into explicit rows first so nobody is locked out. Tests: `tests/db/spaces-*.test.ts`, `tests/db/scoping-*.test.ts`. |
| S4 | **Lists, search, My Work, calendar and analytics were not scoped** to the workspaces the caller can open; analytics counted every organisation in the database. | `src/server/services/views.ts`, `src/app/api/search/route.ts`, analytics and My Work pages | **Fixed** — `f36a82c` (`tests/db/scoping-*.test.ts`). The DM lookup is organisation-bound and refuses a guest peer; idea→task and assignee changes check the target workspace. |
| S5 | **An ADMIN could reset the OWNER's password** (the rank check covered role changes only). | `src/server/services/org-members.ts` `updateOrgMember` | **Fixed** — `8f79867` (`tests/db/org-members.test.ts`). |
| S6 | **No login rate limit and no Origin / CSRF check.** `SameSite=Lax` treats every `*.zakiai.io` site as same-site. | `src/app/api/auth/login/route.ts`; `src/middleware.ts` | **Fixed** — `a36cde0`, hardened in `cdc8b8c`. The middleware refuses API writes whose Origin is not this app (machine endpoints exempt). Sign-in is limited **per account and address, plus a larger account-wide cap, a burst limit per address and a concurrency cap** (`LOGIN_LIMITS` in `src/server/rate-limit.ts`; at `cdc8b8c`: 8 attempts / 10 min for the pair, 30 / 10 min per account, 30 / 10 min and 6 / 10 s per address, 3 password checks at once). Attempts are counted *before* the check, so concurrent guesses cannot all slip through, and the hard lock follows the (account, address) pair, so a stranger cannot keep the owner locked out from the owner's own address. Which address counts depends on `TRUSTED_PROXY_HOPS` (README). |
| S7 | **n8n outbound sent the organisation's secret** in an `x-zaki-token` header with every delivery, and the signature covered the body only (no timestamp, so a captured request replays). The same secret opens the inbound webhook that creates tasks. | `src/server/services/integrations.ts` `emitOutbound`; `src/server/services/n8n.ts` | **Fixed** — `0be23f3`: outbound deliveries follow the ecosystem contract (`X-Zaki-Event` / `Delivery` / `Timestamp` / `Signature` over `timestamp.body`, 5-minute window) and never carry the secret; new secrets come from `crypto.randomBytes` (they came from `Math.random`). Residual risks: R1–R5 below. |
| S8 | **SSRF on the n8n URL:** any `http://` or `https://` address was accepted, internal ones included. | `src/app/api/integrations/n8n/route.ts` | **Fixed** — `0be23f3`: the URL must be public https and is checked again before every send, with redirects off (`src/server/net-guard.ts`). Residual: R4. |
| S9 | **`AUTH_SECRET` doubled as the key for secrets stored in the database**, so rotating it breaks the stored Telegram, n8n and Google secrets. | `src/server/crypto.ts` `key()` | **Fixed in code** — `0be23f3`: an optional `ENCRYPTION_KEY` gives new secrets a key independent of `AUTH_SECRET` (blank = the old behaviour; old values still decrypt) and `scripts/reencrypt-secrets.ts` migrates the stored ones. 🔧 **Owner action** to finish it: set `ENCRYPTION_KEY` in Coolify, then run the script once (section 4). Until then secrets still depend on `AUTH_SECRET` (production logs `boot.encryption_key_missing`). |
| S10 | **The GUEST (external partner) role could** read CRM values (prices) and delete customers, write tickets and campaigns, use Google Drive and read the staff directory. | CRM, tickets, campaigns and Google routes without a role check; `src/app/api/chat/directory/route.ts` | **Fixed** — `d166125`: a GUEST gets 403 on CRM, departments, Google Drive and the chat directory, cannot create, edit or comment on tickets, campaigns or production routines, and sees names only in member lists; ticket editing is limited to the creator, the assignee, department members and admins; the Google callback requires the signed state to belong to the signed-in manager. |
| S11 | **The demo owner login was published** in a public repository (`lg.json`, `README.md`, `prisma/seed.ts`). | those three files | **Fixed** — `693e197`: `lg.json` deleted, README cleaned, the seed prints a random password once and refuses production (`ALLOW_PROD_SEED=1` to override); `tests/repo-hygiene.test.ts` and `npm run scan:secrets` (CI) keep it out. ⚠️ The old password stays in the public git history for ever. 🔧 **Owner action:** section 4, check 5. |
| S12 | **A GUEST could also read the Telegram conversations** (customer names and phone numbers), **the n8n webhook URL and event filter** (the URL's path can act as a secret), **the whole file library** (list, details, bytes, versions, upload, delete) **and every chat handler** (a member demoted to guest kept their old DMs). Found by the independent review of `d166125`. | `src/app/api/integrations/telegram/**`, `src/app/api/integrations/n8n/route.ts`, `src/app/api/files/**` and the chat routes had no role check | **Fixed** — `671dfcf`: `assertNotGuest(ctx)` (`src/server/services/guest-guard.ts`) on every Telegram route, every file route and every chat handler, and on the n8n status route (a plain member also stops receiving the URL and the filter; only OWNER/ADMIN do); `/telegram` and `/files` show a notice instead of handing data to the client; tests `tests/db/guest-files.test.ts`, `guest-integrations.test.ts`, `guest-chat.test.ts`, `guest-workspaces.test.ts`, `guest-pages.test.ts`. |

### Residual risks left on purpose

These were found by the review of the fixes above. Each is a known gap with a reason, not a
forgotten one.

| # | Residual risk | Why it is still there | Who / when |
|---|---|---|---|
| R1 | **The inbound n8n webhook still accepts the legacy `x-zaki-token` header** (the shared secret itself, compared in constant time). | Existing n8n workflows send it; removing it would silently stop them. The signed form (`X-Zaki-Timestamp` + `X-Zaki-Signature`) is accepted and preferred. | Remove in **Phase 7**, once every workflow signs. Owner: move the workflows to the signed form before then. |
| R2 | **A signed inbound request is not de-duplicated by `X-Zaki-Delivery` inside the 5-minute window**: replaying the very same request within those five minutes creates the task twice. | Closing it needs a stored delivery id, which is a schema change (additive migration). `IdempotencyRecord` cannot hold it: its `tokenId` is required and points at an API token, and a signed delivery has none. | **Half closed (I1.1a):** the table `InboundDelivery` exists (migration `20261120100200`, unique on company + source + delivery id, no body, no customer data) and `claimInboundDelivery` (`src/server/integrations/oms-events.ts`) takes a delivery once; the orders system's receiver uses it and a database test proves a replay changes nothing. ⚠️ The **n8n inbound webhook does not call it yet**, so for n8n R2 stays OPEN. 🔧 One small change in `src/server/services/n8n.ts` (`handleInbound`: `claimInboundDelivery(db, { orgId, source: "n8n", deliveryId })` after the signature is verified, a repeat answered 200 and ignored) closes it; it was outside that package. Outside the window a replay is refused. |
| R3 | **Organisations that connected n8n before the fix keep the old secret**, generated with `Math.random`, until the admin presses **"rotate secret" (تدوير السّر) in Automation**. | Rotating changes the secret every workflow uses, so it cannot be done for them. | 🔧 **Owner action**, section 4. |
| R4 | **DNS rebinding.** The SSRF guard resolves the name and checks every address, then `fetch` resolves it again; a DNS server that answers differently the second time can slip through that gap. | Closing it needs a connection-level hook (an undici dispatcher that pins the resolved address), not available without a new dependency. Everything else is refused: http, credentials in the URL, private / loopback / link-local / metadata addresses, redirects. | **Open.** Noted in `src/server/net-guard.ts`. |
| R5 | **Outbound receivers that checked the old body-only signature stop verifying** (and any receiver that read `x-zaki-token`). | The delivery format changed to the ecosystem contract: the signature is now over `timestamp.body`, with `X-Zaki-Timestamp`; the secret is no longer sent. | 🔧 **Owner action**: update the n8n workflows that verify the signature (section 4). |
| R6 | **The sign-in limiter lives in the app process.** A restart clears it, and two containers would each count separately. | One container today; a shared store comes with the realtime layer. `TRUSTED_PROXY_HOPS` must equal the real number of proxies or the counted address is wrong. | Revisit when more than one instance runs. |
| R7 | **`requireWorkspace` stays lenient** (S3). | Needed the Phase 1 account and rank model. | **Closed in Phase 1.** |
| R8 | ~~**Two readers of the file table do not use the service and do not skip rows still being written** (`path = 'pending'`): the dashboard's file count and the anchor / head lookups of the new-version route.~~ **Closed.** The new-version route (`src/app/api/files/[id]/versions/route.ts`) now carries `path: { not: PENDING_PATH }` on both its anchor and head lookups, and the dashboard no longer counts files at all — nothing outside the files service reads the table for a count. | — | Nothing left to do. |
| R9 | **One company per person, in practice.** `requireActor` uses the person's oldest ACTIVE membership, the session version is per person (offboarding someone from one company signs them out of all of them), and `users.manage` in company B can reset a person who also belongs to company A. | The product is single-company today; two-company data is legacy. | Revisit before a second company is ever onboarded. |
| R10 | **External partners still read some staff names organisation-wide**: assignee names in the production routines, department tickets and campaigns by id. ⚠️ Phase 2 first offered them the Goals and Ideas tabs as well, and `/api/goals` and `/api/ideas` answered them: a partner could read the company's internal goals (titles, descriptions, departments, who set them) and every idea with its author's name. | A Phase 0 decision (guests keep read access there); only job titles were closed in Phase 1. | 🔧 Goals and ideas are **staff-only now, decided on the server** (WP-ACCESS): both tabs require staff in `src/lib/nav/places.ts`, the `/goals` and `/ideas` pages show a guest the guest notice, every `/api/goals` and `/api/ideas` handler (edit, delete, vote and convert included) answers 403 `guest.no_access` before reading anything, and `listGoals` / `listIdeas` refuse a guest too; `/analytics` (the workload names the staff) and `/settings` refuse a guest as well. Proven by `tests/db/guest-internal-pages.test.ts`. The rest (production routines, tickets, campaigns): decide per area when those screens are reworked. |
| R11 | **Signing out clears the browser's cookie only.** A copied cookie keeps working until it expires (`SESSION_TTL_HOURS`, 168 h) or the person's password changes, the owner presses "log out everywhere", or the person is suspended. | A per-session id with a server-side block list needs a table; bumping the version on every sign-out would end the person's other devices. | 🔧 Phase 5 (sessions list with "end this device"). Until then: shorten `SESSION_TTL_HOURS` if it worries you. |
| R12 | **Five capability switches are in the catalogue but wired to nothing yet** (`prices.view`, `cash.view`, `penalties.view`, `announce.send`, `escalation.configure`), so the people screen does not offer them. CRM opportunity values stay visible to everybody who holds `crm.view`. | They belong to later phases (announcements, escalation) and the OMS phase, which is postponed. | Each switch appears on the screen in the phase that wires it. **Update (Q1.5):** `escalation.configure` is now CHECKED — by the door of the kinds, rules and working hours of «المشاكل تصير تذاكر» (`/api/tickets/problem-settings`); the people screen still does not offer it until A1 shows it again. |
| R13 | **People managed by a suspended manager keep that manager.** | Escalation does not exist yet. | Phase 4: escalation must skip managers who are not active. |
| R14 | **A password reset by the owner does not clear the in-memory sign-in lock** of that person (a locked-out person waits for the window, 10 minutes). | The lock lives in the login route's memory. | Low; moves with the limiter when it gets a shared store (R6). |
| R15 | **`/register` is reachable from the internet.** | Since 2026-10-23 it is how ANY new company is opened (see S1). | Guarded by the e-mail check, the server-wide cap and the per-address limit; needs SMTP (`SMTP_*`, `MAIL_FROM`), otherwise it answers 503. |

## 2. Infrastructure and delivery findings

| # | Finding | Evidence | Status |
|---|---|---|---|
| I1 | **Uploaded files did not reach the volume.** The code wrote to `<cwd>/.data/uploads`, which the non-root container user cannot create (`Permission denied`, reproduced in the pre-Phase-0 image), while compose mounted the volume at `/app/storage/uploads`. | `src/server/services/files.ts`; Dockerfile; `docker-compose.yml` | **Fixed** — `693e197`: `UPLOAD_DIR` (default unchanged), set to `/app/storage/uploads` in the image, created and owned by the runtime user, mounted at the same path for `app` and `worker`. Verified in the built image: an upload lands on the volume and is still served after the container is replaced. ⚠️ Files uploaded before this fix may be missing: section 4, check 3. |
| I2 | **The worker was not in the image.** `npm run worker` failed with `ERR_MODULE_NOT_FOUND /app/worker/index.ts` (reproduced), so the compose `worker` service could never run. | Dockerfile (`worker/` not copied) | **Fixed** — `693e197`: the image copies `worker/` (`tsx` was already there: dev dependencies are never pruned). It is still a heartbeat placeholder (a task count every 60 s): there are no background jobs yet, and they are planned to run inside the app process. |
| I3 | **`next.config.mjs` was not copied into the runtime image.** `next start` read no config, so the boot-time environment check (`src/instrumentation.ts`) never ran (no `boot.env_ok` line in the log) and `X-Powered-By: Next.js` was sent. | Dockerfile; `node_modules/next/dist/server/next-server.js` (`instrumentationHook`) | **Fixed** — `693e197` (verified before and after on the real images). ⚠️ From now on an invalid environment (e.g. `AUTH_SECRET` under 16 characters) stops the container at boot instead of failing on the first login. 🔧 That is the intended behaviour; it is one `COPY` line if you want it reverted. |
| I4 | **`/api/health` was prerendered at build time.** The image answered with the result of the build — `{"status":"degraded","checks":{"database":"fail"}}` and the build's timestamp — for ever, with HTTP 200, so the Docker `HEALTHCHECK` could never fail on the database. | `src/app/api/health/route.ts` had no `dynamic = "force-dynamic"`; response header `x-nextjs-cache: HIT` | **Fixed** — `693e197` (`export const dynamic = "force-dynamic"`) and `cdc8b8c` (it now answers **503** when the database is down). `image.yml` asks the running container for `"database":"ok"`. |
| I5 | **Node 20 (end of life since April 2026) in the image**, while CI runs the tests on Node 22. | Dockerfile | **Fixed** — `693e197`: Node 22; builds, migrates and serves. |
| I6 | **No CI and no image build on GitHub;** production built on the same server that serves the live apps. | no `.github/` | **Fixed** — `693e197`: `ci.yml` (typecheck → lint → unit tests → migration lint → fresh `migrate deploy` → `migrate diff` → `test:db` → secret scan → build) and `image.yml` (build, prove, publish to `ghcr.io/<owner>/zaki-workspace`; the Coolify webhook step is off until its two secrets exist). Each command was run locally against `pgvector/pgvector:pg16`; the workflows themselves run for the first time on the first pull request. |
| I7 | **`docker-compose.yml` published Postgres (5433) and Redis (6380) on every interface**, and the database password defaults to a well-known value. | `docker-compose.yml` | **Fixed** — `693e197`: both are published on `127.0.0.1` only. ⚠️ The database password still falls back to `zaki_local` when `POSTGRES_PASSWORD` is unset. 🔧 Fine on a laptop (loopback); set it on any server that runs compose. Production is described as built from the Dockerfile, which does not use this file — confirm which build pack Coolify uses. |
| I8 | **Dead files:** `src/app/api/files/[id]/route.delete.ts` (not a route file; it duplicated `DELETE`), `prisma/_d2.sql` and `prisma/_d3.sql`. | byte comparison: both SQL files are identical to `20261017090000_integrations` and `20261017100000_event_optional_link`; the real `DELETE` is in `route.ts` | **Fixed** — `693e197`: deleted. |
| I9 | **Migration rules were remembered, not enforced** (the 2026-10-19 incident came from a renamed folder and a dependency on a later migration), and the first linter was a short blacklist. | `docs/DEPLOYMENT-INCIDENT-2026-10-19.md` | **Fixed** — `693e197`: `scripts/lint-migrations.mjs` and `prisma/migrations/RELEASED.txt`, run in `npm test` and CI; a fresh deploy and a drift check run in CI. **Hardened in the tree:** `RELEASED.txt` now pins the sha256 of each released `migration.sql` (CRLF read as LF), so editing or truncating a released file fails; a *new* migration is also reviewed for what an empty CI database cannot see — drops of constraints / indexes / triggers / functions / views / extensions, a column dropped without the `COLUMN` keyword, renames, `ADD COLUMN … NOT NULL` without a `DEFAULT`, `SET NOT NULL`, `UPDATE` without `WHERE`, a unique index or constraint on an existing table, `CREATE EXTENSION` — with `ALLOWED_DESTRUCTIVE.txt` as the owner's way out. Released folders are frozen by their pin, not re-judged. |
| I10 | **The `redis` service is not used** by any code. | grep: no Redis client in `src/` or `worker/` | Marked in `docker-compose.yml`, not removed. |
| I11 | **The compose `worker` showed as `unhealthy` for ever** once it could actually start: it runs the web image, so it inherits the image's `HEALTHCHECK` (an HTTP probe on port 3000) and it serves nothing. | reproduced with a throw-away copy of the stack: `docker ps` reported `(unhealthy)` | **Fixed** — `693e197`: the worker service disables the inherited check (`tests/repo-hygiene.test.ts` pins it). |
| I12 | **An upload that could not be written left a ghost.** `ingest` creates the database row first (it needs the id for the file name) and writes the bytes second; when the write failed — a root-owned Coolify bind mount makes *every* upload fail — the row stayed with `path = 'pending'`: `GET /api/files` listed a file that answered 404, and a ghost version could be taken for the head of a real file. Reproduced by the review. | `src/server/services/files.ts` `ingest` | **Fixed in the tree** — the write and the row's promotion run in a `try`; on any failure the file and the row are removed, and the new head takes over from the old one in a single transaction. Rows still `pending` (left by the old behaviour) are skipped by `listFiles`, the version counts, `getFileMeta`, `readStored` and `softDelete`. `tests/db/files-upload-failure.test.ts` (8 tests; 7 fail on the old code) uses an unwritable `UPLOAD_DIR`. Residual: R8. 🔧 Owner: section 4, check 3 and the optional cleanup. |
| I13 | **The secret scanner missed shapes it should know**: a JWT, `Authorization: Bearer / Basic …`, a Coolify token (`1\|` + 40 characters — the Sanctum shape) in a Markdown file, a login and password written as prose (`login: a@b / …` — how the demo password reached the README), the names `pass`, `pwd`, `secretKey`, and connection-string passwords shorter than six characters. | `scripts/scan-secrets.mjs` | **Fixed in the tree** — rules for each (documents get the prose rule and the unquoted `NAME=value` rule); obviously fake values, templates (`${…}`, `$VAR`, `<…>`) and `.env.example` still pass; 63 tests in `tests/scan-secrets.test.ts`; the repository scans clean. |
| I14 | **Environment variables were read by the code but not documented** (`TRUSTED_PROXY_HOPS`: the sign-in limiter's view of the client address depends on it). | README, `.env.example` | **Fixed in the tree** — README table and `.env.example` document it (default 1; set 2 behind a CDN; never higher than the real number of proxies), and `tests/repo-hygiene.test.ts` fails when the code reads a variable that either file does not list. |

## 3. Claims in the earlier documents that the code does not support

| Document | Claim | What the code shows |
|---|---|---|
| `ENGINEERING_PROGRESS.md` #4 | "CSRF — origin validation added globally (`origin-host-must-match-host`)" | Nothing of the kind existed: `src/middleware.ts` only checked that a session cookie was present. Added later by `a36cde0`, with a different design. |
| `ENGINEERING_PROGRESS.md` #6 | "login attempts limited to 5 per minute per IP … 6th attempt returns 429" | The login route had no limit at all. Added later by `a36cde0` (per account and address), hardened by `cdc8b8c`. |
| `ENGINEERING_PROGRESS.md` #2, #13, #15; `SECURITY_AUDIT.md` Q1 | Chat file download/preview routes, "attachments resolve through conversation membership" | There are no chat attachments: `ChatMessage` has no file field and no chat route serves files. `PHASE1-REPORT.md` itself says "No task/chat attachments yet". |
| `ENGINEERING_PROGRESS.md` #10 | "`createTaskDependency` blocks linking tasks from different orgs" | No such function existed, and nothing in `src/` wrote or read the table. **Built 2026-10-30**: `src/server/services/task-links.ts` + `GET\|POST /api/tasks/[id]/links` (see `docs/REVIEW-E-FIXES.md` §2b). |
| `ENGINEERING_PROGRESS.md` #15 | "`requireAuth()` … `requireOrgAccess()`" | Neither exists. The real guards are `requireUser`, `requireOrgMember`, `requireOrgRole`, `requireWorkspace` and `activeOrgCtx`. |
| `ENGINEERING_PROGRESS.md` #16, #18 | "Integration tests run against local DB", "vitest 68/68 (+ integration tests)" | The suite was logic-only (`tests/security-contracts.test.ts` says "no DB integration harness"). A real-database suite (`npm run test:db`) exists only since `382499f`. |
| `ENGINEERING_PROGRESS.md` #7 | "API resolves workspace from authenticated membership, not client-supplied id" | The workspace id is client-supplied and checked by `requireWorkspace`, which is too permissive (S3); lists were not scoped (S4). |
| `ENGINEERING_PROGRESS.md` #18; `DATABASE_AUDIT.md` | "43 models" | `prisma/schema.prisma` has **42** models (the incident report's 42 tables agrees). |
| `DATABASE_AUDIT.md` §3 | "`StoredFile` uses local disk — production needs a persistent volume" listed as a P3 note | It was a live defect (I1): uploads did not reach the volume. |
| `SECURITY_AUDIT.md` Q1 | "`createDm` / `createGroup` enforce org membership … and reject GUESTS"; "GUEST cannot enumerate or message others" | `createDm` accepted a guest peer and its "existing conversation" lookup was not bound to the organisation; `GET /api/chat/directory` had no role check. Fixed in `f36a82c` (DM) and `d166125` (directory, S10). |
| `PHASE1-REPORT.md` | "ar/fr/en dictionaries", "~150 new keys ar/fr/en" | Only `src/lib/i18n/ar.json` exists. |
| `PROJECT-FULL-REPORT.md` | "uploads persist on Coolify volumes"; "docker-compose complete (app + worker + db + migrate) ✅" | Uploads did not reach the volume (I1) and the worker could not start from the image (I2). |

## 4. What only the owner can do

**Read-only production checks** — run from the PostgreSQL service's terminal in Coolify
(`psql`). Every statement is a `SELECT`; none changes anything. Send the output.

```sql
-- 1. Which migrations ran, and did any fail? (12 rows, all finished = t, rolled_back_at empty)
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at
FROM _prisma_migrations ORDER BY started_at;

-- 2. Who is in which workspace, and who is in the organisation?
SELECT o.name AS organisation, w.name AS workspace, u.email, wm.role
FROM "WorkspaceMember" wm
JOIN "Workspace" w ON w.id = wm."workspaceId"
JOIN "Organization" o ON o.id = w."organizationId"
JOIN "User" u ON u.id = wm."userId"
ORDER BY o.name, w.name, u.email;

SELECT o.name AS organisation, u.email, om.role
FROM "OrganizationMember" om
JOIN "Organization" o ON o.id = om."organizationId"
JOIN "User" u ON u.id = om."userId"
ORDER BY o.name, om.role, u.email;

-- 3. Uploaded files: never_written = true are uploads that failed (see I1, I12)
SELECT (path = 'pending') AS never_written, count(*) AS files, coalesce(sum(size), 0) AS bytes
FROM "StoredFile" WHERE "deletedAt" IS NULL GROUP BY 1;

-- 4. Is pgvector available? (no row = not available; Phase 8 needs it before its migration)
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';

-- 5. Does the published demo account exist? (see S11)
SELECT id, email, "createdAt" FROM "User" WHERE email = 'owner@zaki.local';
```

- **Check 5 returns a row → change that account's password from the app (or delete the
  account) before anything else.** Treat the published password as working until proven otherwise.
- **Uploads:** in Coolify give the application a *persistent storage* mounted at
  `/app/storage/uploads`. Without it every redeploy empties the uploads. The old location
  (`/app/.data/uploads`) could not be created by the container user, so check 3 shows how many
  uploads never reached disk. Those rows (`never_written = true`) are invisible since I12. Once
  you have seen the count, they can be deleted — **this one writes**, run it only after check 3:
  `DELETE FROM "StoredFile" WHERE path = 'pending';`
  If you mount a **host folder** instead of a named volume, it must be writable by the container
  user `zaki` (a root-owned folder makes every upload fail — now with a clean error, not a ghost).
- **n8n (R3, R5):** every organisation that connected n8n before `0be23f3` should press **"rotate
  secret" (تدوير السّر) in Automation** and put the new secret into its workflows — the old one
  was generated with `Math.random`. While you are there, update workflows that verify our
  outbound requests: the signature is now `HMAC-SHA256(secret, "<X-Zaki-Timestamp>.<body>")` and
  the secret is no longer sent as `x-zaki-token`. Workflows that call our inbound webhook should
  switch to the signed form (`X-Zaki-Timestamp` + `X-Zaki-Signature`); the legacy header goes in Phase 7.
- **`TRUSTED_PROXY_HOPS` (S6, R6):** leave it at 1 when Traefik is the only proxy. If a CDN sits in
  front of Traefik, set it to **2** — otherwise every user is counted as one address and the whole
  company shares one sign-in budget. Never set it above the real number of proxies.
- **Recommended (finishes S9):** set `ENCRYPTION_KEY` in Coolify to a separate random value
  (`openssl rand -hex 32`), redeploy, then run the re-encryption once from the app container's
  terminal: first `npx tsx scripts/reencrypt-secrets.ts` (a dry run that only counts), then
  `npx tsx scripts/reencrypt-secrets.ts --apply`. It prints counts only, and is safe to repeat.
- **Before the first new migration:** send the output of check 1 — the production state after
  the 2026-10-19 incident was never recorded here. After the migration is deployed, add its line
  to `prisma/migrations/RELEASED.txt` with `node scripts/lint-migrations.mjs --hash <folder>`.

## 5. How this was verified

- Security rows: the findings come from the audit that produced the Phase 0 plan; the infrastructure
  batch re-read the code behind S1, S2, S3, S7, S8, S9 and S12 (the guards in the routes), and the
  Google and staff-directory routes of S10 (the CRM, ticket and campaign parts of S10 were not re-read
  here). S4, S5 and S6 are also proven by the database tests that shipped with their fixes (`tests/db/`).
  The residual risks R1, R2 and R4 are written in the code (`inbound/route.ts`, `net-guard.ts`) or
  were read there; R8 is closed (the version route skips rows still being written and the dashboard no
  longer counts files); R3 and R5 follow from `configureN8n` keeping an existing secret and `emitOutbound`
  signing `timestamp.body`.
- Infrastructure rows: the Dockerfile was built twice — once as it was at `HEAD` and once as it is
  now — and both images were started against a throw-away `pgvector/pgvector:pg16` database. Compared:
  Node version, whether the boot check logs, response headers, whether `UPLOAD_DIR` is writable by
  the runtime user (also on a fresh named volume), `npm run worker`, and the seed (refuses production,
  random password, idempotent). An upload was sent through the API and read back after the container
  was replaced. The image was built again from `0be23f3` (after the other Phase 0 commits): it boots
  with the empty `ENCRYPTION_KEY` that compose passes, and `npx tsx scripts/reencrypt-secrets.ts`
  runs inside it. A throw-away copy of the whole Compose stack was started (other project name, other
  ports): `app` and `worker` mount the same volume at the same path and see the same uploaded file.
  The CI database steps (`migrate deploy`, `migrate status`, `migrate diff --exit-code` — which exits
  2 on drift — and `npm run test:db`) were run against the same kind of server, and the image
  workflow's own step scripts were extracted and run against the image.
- I12, I9, I13, I14: each has tests written first and run against the old code to see them fail —
  I12 against the old `ingest` on a real database (7 of 8 fail), I9 and I13 against the previous
  linter and scanner (24 of the 63 scanner tests and 139 of the 169 linter tests fail on the old code).
  The 12 released migrations were pinned from the working tree (CRLF) and cross-checked against the
  committed LF blobs: all 12 hashes agree. Run over the 12 released migrations as if they were new, the
  review rules flag only `20261017080000_accounts_ideas_profiles` (a `SET NOT NULL` after its own
  backfill, and a unique index on `Organization.joinCode`) — which is why released folders are frozen
  by their pin instead of being re-judged.
- Not verified, because it cannot be done from here: the GitHub workflows themselves (first run on the
  first pull request), the production database, and Coolify's configuration.
