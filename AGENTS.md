# Zaki Workspace — rules for agents and people

> The one rules file. Codex, GLM and opencode read it directly; Claude Code reads it
> through `CLAUDE.md` (`@AGENTS.md`). A new rule is written HERE and nowhere else.

Zaki Workspace is an Arabic, right-to-left work operating system for a team: spaces,
projects, boards, tasks, chat, files, CRM, tickets. Next.js 14 (App Router) · React 18 ·
TypeScript strict · Prisma 5 · PostgreSQL 16 · zod · Vitest. It is one system of the Zaki
ecosystem (table below). **The repository is public** and production is the Docker image of
`main`, run by Coolify at `workspace.zakiai.io`.

What is verified about the current code — and what is known to be wrong — is in
`docs/PHASE0-AUDIT.md`. Older audit documents in `docs/` carry a warning banner where they
claim more than the code does: do not rely on them.

## The owner's rules (mandatory in every session)

- **Answer the owner in Levantine Arabic** (Jordanian as he writes it) — the result, directly,
  without walking through internal steps, and with **no English word at all** in the answer. He
  is not a programmer. (Code, commits and this file stay in English.)
- **A risk, or anything automated, is shown as ⚠️ with the fix under it as 🔧.** We do not
  remove the feature, we mark it. In the UI the warning and its fix are visible together;
  in documents use ⚠️ and 🔧.
- **Extend, never rebuild.** Before adding anything, search the code for what already does
  the job and widen it: existing tables, services and helpers first (`createTask`,
  `moveTask`, `canAdministrateTarget`, `StoredFile`, `Conversation`, …). A new table that
  does what an existing table does is a bug.
- **No customer data to an external model.** A name, a phone number or an address may only
  reach a model running on the owner's own machine. Ad tokens reach no model at all.
- **No financial approval from Telegram.** Telegram may notify; money is approved in the app.
- **B2B and partner-facing surfaces carry no prices.** The external partner role never
  receives a price, a CRM value or a customer record it was not given.
- **Branch + pull request only. Never push to `main`.** Every change, even one line, goes on
  a branch with a PR and is merged only when CI is green. **One agent per branch.** A red or
  conflicting PR is never merged — "green on my machine" is not a verdict; CI is.
- **Every behaviour change ships a test that fails before the fix and passes after it.**
  The old tests stay green. A change nobody saw fail is a change nobody proved.
- **Migrations are additive only.** See "Migrations" — a production incident (2026-10-19)
  came from breaking exactly this.
- **Never accept a database reset.** If `prisma migrate dev` or any tool offers to reset,
  drop or wipe a database: answer no, stop, and report.
- **Written deliverables for the owner are Word (.docx) plus a PDF** he can read on a phone.
- **Phases run back to back.** The owner's instruction (2026-10-22): move from one phase to the
  next without waiting for approval. A phase still ends only when every gate is green and an
  independent review has been answered, and it is committed in small commits. Pushing, merging and
  deploying stay the owner's decision: nothing leaves the machine until he says so.

## How work is done

1. **Plan** (ideas, scope, order) — Claude with the owner, in chat.
2. **Build** — an agent, on a **new branch** from an up-to-date `main`
   (`git fetch origin && git merge origin/main` first). Small commits; each one passes the
   gates below.
3. **Open a PR** whose first lines are the *Definition of Done*: what must work · the tests ·
   the edge cases that matter · the blockers. Review checks against that and nothing else;
   anything noticed outside it goes in the PR description under "noticed, not fixed" and is
   not fixed in the same PR.
4. **CI judges** (`.github/workflows/ci.yml`). A PR with a conflict never starts CI: resolve
   the conflict first.
5. **Review** — "شيك" from the owner. Fix the blockers only, then one last look at those.
6. **Merge, deploy, live check** on `workspace.zakiai.io` (health, login, send a message).

Fixed blockers for any PR: CI red or an old test red · a secret exposed · a destructive
migration or a production write · a published contract broken · customer data to an external
model · money logic changed without the owner · a feature removed instead of marked.

## Zaki ecosystem — the repositories

| System | Repository | Role |
|---|---|---|
| **Zaki Workspace** (this repo) | `iahmed30004000-wq/zaki-workspace` | **source of truth** for the work OS — branches and PRs happen here. Next 14 · Prisma 5 · Node 22 |
| OMS / CRM (salesflow) | `iahmed30004000-wq/zaki-ai-OSM` | **the only source of truth for the OMS** (orders, inventory, wallets), confirmed by the OMS session on 2026-11-01. Next 16 · Prisma 6 · Node 24. Work happens there, never from this repo |
| OMS older copies | `MKory18/Zaki-ai-CRM` · `MKory18/zaki-ai-OSM-1` | ⚠️ older copies of the OMS. 🔧 Fast-forwarded **by the owner only**, when he says so; nobody commits on them |
| System 7 — replies and sales | `MKory18/AIresponse` | consumes OMS order events; will consume this repo's `/api/v1` door (ideas, tasks) once it is built |

- **Work only in the repository of the system you were asked to change.** A change that
  touches two systems is an impact table plus one ordered prompt per affected repository,
  each merged by its own PR — never an edit of the other repo from this one.
- ⚠️ All of these repositories are public: anyone can read the code and the way requests are
  signed. 🔧 No secret, token, real customer value or private URL ever goes into a tracked file.

## Integration contract rules

These are the rules every Zaki system keeps, so one system's change cannot silently break
another.

- **A published contract version never breaks.** Inside `data`, adding an *optional* field is
  allowed; removing, renaming or retyping a field is a new version (`v2`). The envelope
  `{ event, at, data }` is literal: a new field at that level is `v2` too. Contract files
  copied from another system are never edited here — the original lives in its own repo.
- **Deliveries are signed.** Headers `X-Zaki-Event` · `X-Zaki-Delivery` · `X-Zaki-Timestamp`
  · `X-Zaki-Signature: sha256=<HMAC-SHA256(secret, "<timestamp>.<body>")>`. The receiver
  recomputes the HMAC over `timestamp.body` — the timestamp text exactly as it arrived and the
  raw body, never re-serialised — with a constant-time comparison, and **rejects a timestamp
  more than 5 minutes from its own clock** (replay window). Senders differ on the unit (the
  OMS sends milliseconds, the Workspace seconds), so a receiver accepts both. The secret is
  never sent in a header, a URL or a log line.
- **Idempotency keys always include the tenant** (`organization:system:type:key`, or an opaque
  per-tenant tag). A key without the tenant lets one customer's retry replace another's.
- **No customer data crosses a contract.** Identifiers are opaque; names, phones and
  addresses stay where they belong. Prices and cash balances move only through a permission
  the owner granted for exactly that.
- **API tokens belong to one organization and carry named permissions** (read-only unless
  the permission says otherwise); revoking a person revokes the tokens issued in their name.
- **A Telegram bot has one job.** The Workspace has its own bot; it never shares the
  orders bot of the OMS.

## Gates — before every commit and PR

```bash
npm run typecheck
npm run lint
npm test                       # unit tests: no database, no network
node scripts/lint-migrations.mjs   # also runs inside `npm test`
npm run test:db                # real PostgreSQL (see below)
npm run scan:secrets           # the repository is public
npm run build
```

CI (`.github/workflows/ci.yml`) runs them in this order: typecheck → lint → unit tests →
migration lint → a fresh `prisma migrate deploy` on an empty database → `prisma migrate diff`
(must be empty) → `test:db` → `scan:secrets` → build. Node 22. Anything that is red there
is not merged, whatever passes locally.

**Running the database tests locally.** They create their own throw-away database, apply the
real migrations to it and drop it afterwards, so they cannot touch your data:

```bash
docker compose up db -d                       # Postgres 16 on localhost:5433
cp .env.example .env                          # then set DATABASE_URL and AUTH_SECRET
export TEST_DATABASE_ADMIN_URL="postgresql://zaki:zaki_local@localhost:5433/postgres"
npm run test:db
```

A local, untracked `docker-compose.override.yml` may remap the port — check `docker compose
ps`. The harness refuses any host but localhost unless `ALLOW_REMOTE_TEST_DB=1`, so a
production `DATABASE_URL` in your shell cannot be used by accident.

**Writing the tests.** Authorization rules are proven in `tests/db/` against a real
database (a member cannot read a space they are not in; a guest never sees a price): a
logic-only test of an access rule proves the logic, not the rule. Pure functions and
contracts go in `tests/`. A source-text test pins an ordering only where a database test
cannot.

## Migrations — the rules from the 2026-10-19 incident

Read `docs/DEPLOYMENT-INCIDENT-2026-10-19.md`. A migration that depended on a table created
by a *later* migration failed on a fresh database, and a folder was renamed to repair it.
`scripts/lint-migrations.mjs` (in `npm test` and CI) now enforces these:

- **Additive only.** The linter has two tiers; the owner's way out of either is to name the
  folder in `prisma/migrations/ALLOWED_DESTRUCTIVE.txt` (empty today, a decision for the owner).
  - *Hard, in every folder:* no `DROP TABLE` / `COLUMN` / `TYPE` / `SCHEMA` / `DATABASE` (a
    column dropped without writing `COLUMN` counts), no `TRUNCATE`, no `DELETE FROM`, no
    `ALTER COLUMN … TYPE`.
  - *Review, in every NEW migration* — what the empty CI database cannot see, because it depends
    on the rows production already has: a drop of a constraint / index / trigger / function / view /
    extension, any `RENAME`, `ADD COLUMN … NOT NULL` without a `DEFAULT`, `SET NOT NULL`, `UPDATE`
    without `WHERE`, a unique index or constraint on a table that already exists, `CREATE EXTENSION`.
    (A table created in the same migration is empty: its own unique indexes and `NOT NULL`
    columns are fine, and so is a unique index that includes a column the same migration adds
    with no `DEFAULT` — born NULL, and NULLs never collide, which is what `String? @unique`
    produces.) The safe shape is: add nullable or with a `DEFAULT`, backfill in a later
    migration, tighten in a third; add the new name, copy, remove the old one later.
- **A folder that was ever applied is never renamed, edited or removed.** The database
  remembers it by name and checksum. `prisma/migrations/RELEASED.txt` lists every released
  folder as `<folder> sha256:<hex>` (the hash is over the SQL with CRLF read as LF): the linter
  fails on a listed folder that is gone, on a released file whose SQL no longer matches its pin,
  on a line without a pin, and on a new folder that sorts before the last released one. Add the
  line **after** the migration has been deployed — `node scripts/lint-migrations.mjs --hash <folder>`
  prints it — and review that change with care: a released folder is frozen and is no longer
  judged by the review rules. Every table a new migration references must be created by an
  earlier one — CI proves it by deploying everything to an empty database.
- **Adding an enum value** (`ALTER TYPE … ADD VALUE`) is a migration of its own — a new value
  cannot be used in the transaction that adds it.
- **Changing structure and moving data are two migrations.** A data move is safe to repeat:
  fixed ids and `ON CONFLICT DO NOTHING`.
- **UTF-8 without a BOM.** ⚠️ Windows PowerShell 5.1 writes UTF-16 with `>` and `Out-File`.
  🔧 Create SQL with an editor, or `[IO.File]::WriteAllText($path, $sql, [Text.UTF8Encoding]::new($false))`.
- **Creating one:** `npx prisma migrate dev --create-only --name <name>` against a local
  throw-away database, read the SQL, commit it. `migrate deploy` applies it everywhere else.
  Never run `migrate dev` or `migrate reset` against a shared or production database.
- ⚠️ `pgvector` is not known to be available on the production database, and a migration
  that creates the extension would stop the deploy exactly as in the incident (the linter flags
  every `CREATE EXTENSION` for that reason).
  🔧 Check it with a read-only query on production first.
- ⚠️ The state of the production `_prisma_migrations` table after the incident is not
  documented. 🔧 Before any new migration, the owner runs the read-only status check
  (`npx prisma migrate status` from the app container) and sends the output.

## Access model — who may do what (Phase 1)

One model, in `src/server/policy/` and `src/server/auth.ts`. A route that decides access any
other way is a bug.

- **Ranks** `OWNER > ADMIN > LEAD > MEMBER > GUEST` (`rank.ts`; the order of the database enum
  means nothing). There is exactly one OWNER. A GUEST is an external partner: no prices, no
  staff directory, never writes.
- **Capabilities** are per-person switches on top of the rank (`capabilities.ts`: `spaces.create`,
  `users.manage`, `directory.view`, `crm.view`, `crm.edit`, `prices.view`, `integrations.manage`,
  `announce.send`, `escalation.configure`, `cash.view`, `penalties.view`, `archive.view`). The rank
  gives the defaults, the owner switches single ones on or off (`OrganizationMember.capabilities`
  / `revokedCapabilities`). A guest holds none; `archive.view` is the owner's alone. Check with
  `requireActor()` + `assertCan(actor, "…")`, never by comparing a role name.
- **The manufacturing stock ledger** («مخزون التصنيع», `src/server/services/manufacturing*.ts`) lives in a space of layout
  `MANUFACTURING` and is gated by `manufacturing.view` / `.edit` / `.cost` plus a row in that space (the owner reads silently). It
  records stock and cost only, never money movement, and nothing in it is linked to the OMS. A partner gets 404 for all of it. Any unit
  cost, total, value or average is cut on the server unless the person holds `.cost` (the owner's alone to hand out). Quantities are
  integer micro-units and money is integer minor units plus a currency code; the balance is the SUM of an append-only movement ledger
  (a mistake is a reversing movement), and a stocktake difference needs a second person.
- **A request is only as good as the database says it is.** Rank, status and capabilities are read
  on every request, never from the cookie. The cookie carries `tv` (the user's `tokenVersion`):
  suspending, offboarding, resetting a password, changing one's own password and "log out
  everywhere" bump it, which kills every older cookie at once. `currentUser()` returns null for a
  cookie whose `tv` is stale or for somebody with no ACTIVE membership.
- **People are ACTIVE, SUSPENDED or OFFBOARDED** (`OrganizationMember.status`). Nothing is ever
  deleted: offboarding removes the person from every space and hands their open work to someone
  else, their old messages stay. Every query that lists, validates or counts the people of an
  organization filters `status: "ACTIVE"` — `tests/active-membership-guard.test.ts` fails on one
  that does not (a deliberate exception carries `// all-statuses: <reason>` on its line).
- **A space is visible only to the people in it, and to the OWNER.** `requireWorkspace` and
  `accessibleWorkspaceIds` need a `WorkspaceMember` row (an ADMIN inherits nothing; the owner needs
  no row, and reading as the owner leaves no trace: no membership, no "seen", no notification).
- **Who may give a task to whom is decided by rank** (`policy/assign-rank.ts`, judged for every way a task gets an assignee by `services/task-assign.ts`): yourself, anybody below and anybody of the SAME rank is direct; somebody ABOVE is a request (`TaskAssignRequest`: no assignee, the higher person is told, accepts or returns it with a written reason, only once; only the addressed person or the OWNER answers). The OWNER gives to anybody; a GUEST gives and receives only inside a space both are in and never asks upward. A new place that sets `assigneeId` on a task goes through `createTask` / `updateTask`, never around them.
- **Accounts are created by the owner**, or by anybody holding `users.manage`, from the People
  screen (`/api/organizations/[id]/members`): username, optional e-mail, a temporary password the
  person must change at the first sign-in, and the transparency notice they must accept once
  (`/onboarding`; bump `Organization.settings.transparencyVersion` to ask everybody again).
  `/register` opens a NEW company (its asker becomes the OWNER) — anyone may ask, by the owner's
  decision of 2026-10-23, behind `src/server/services/registration.ts`: the company exists only once
  the e-mailed one-time link is confirmed (`PendingRegistration`, 24 h), every address gets the same
  202 (no enumeration), and a server-wide cap sits on top of the per-address limit. It never joins
  an existing company: team accounts still come from the People screen. Everybody manages only
  people STRICTLY BELOW their own rank (`member-rules.ts`); only the owner manages admins.
  ⚠️ A person holding `users.manage` can reset the password of anybody below them, which means they
  can sign in as them. 🔧 Give the switch only to somebody the owner trusts; every reset is audited.
- **A pending person** (temporary password or notice not accepted) gets 403
  `auth.onboarding_required` from every route except the few that ARE the onboarding (`/api/me`,
  `/api/me/password`, `/api/me/transparency`, sign-out). A server-rendered PAGE must get its user
  from `pageUser()` / `pageActor()`, never from `currentUser()`: in the App Router a page still
  runs when its layout redirects, so each page refuses for itself.
- **Re-issuing a cookie** (`startSession`) signs the session version the request was authenticated
  with (`CurrentUser.tv`, or the one a password change just wrote), never a fresh read: a revocation
  that lands while a request is in flight must not be undone by that request.
- **The middleware decides on the canonical path** (percent-escapes decoded, dot segments resolved):
  Next's router resolves `/%61pi/...` to `/api/...`, so the Origin guard must too.

## Security — this repository is public

- **No secret in the repository, ever.** `.env` is ignored; `.env.example` holds names and
  placeholders only; production values live in Coolify. `npm run scan:secrets` fails CI on
  anything that looks like a credential — and prints where, never what.
- **A secret that reaches a commit is a secret that must be changed**, at the provider,
  first. Deleting the line does not unpublish it: the history is public.
- **The seed never carries a password.** `npm run db:seed` prints a random one once, and
  refuses to run in production (`ALLOW_PROD_SEED=1` overrides it, on purpose).
- **Authorization is decided on the server**, from the session, on every request — never
  from what the browser says or hides. A page or route that reads or writes data without
  checking the caller's organization and workspace is a bug even if the UI hides it.
- **Uploads** are written to `UPLOAD_DIR` (a persistent volume in production), never inside
  the image; the bytes are sniffed, the client's content type is ignored. A file row exists only
  once its bytes are on disk: a failed upload removes its row (`ingest`), and a row still being
  written has `path = PENDING_PATH` — anything that reads `StoredFile` outside the files service
  must skip those.
- **Where a new file is written: Google Drive first, the server's disk only as the fallback, never
  both** (the owner, 2026-11-01: the server's disk must not fill up). Every new upload of the company
  (library, chat attachments, voice notes — an approval's files are chat uploads) goes through `ingest`,
  which asks `storageTarget()` (`src/server/files/storage-policy.ts`); profile pictures stay on the
  server by design. A Drive download is always proxied through the app after the same permission check
  (`openStored`), never a Drive link. ⚠️ While Drive is not connected the server fills up. 🔧 The library
  says so on screen with the fix, and the owner's storage panel (`/api/library-storage`, owner rank only) moves
  the old files: a copy step that deletes nothing, and a separate explicit step that removes a server
  copy only after Drive reads back the exact size and SHA-256 recorded at the move
  (`src/server/services/storage.ts`).
- Secrets stored in the database (Telegram, n8n, Google) are encrypted at rest with
  `ENCRYPTION_KEY` (derived from `AUTH_SECRET` while it is unset).
- **«مساعد المالك» (the owner's AI analyst, `src/server/ai/`)** keeps these rules, pinned by `tests/db/owner-assistant.test.ts`
  and `tests/owner-assistant-ui.test.ts`: it is the OWNER rank's alone (404 for everybody else) and behind the switch
  `ownerAssistant` (off by default). The owner's own API key is write-only: encrypted in `AiSettings.keyCipher`, read in ONE
  function (`readKey`), never returned, logged, audited or put in an error. Everything sent to the model is built by
  `buildContext` + `redactText` (`src/server/ai/redact.ts`): aggregates only, staff as «موظف n» unless the owner allows names,
  titles off unless he allows them (then redacted, 80 characters, 50 per request), never a message body, a file name, a comment,
  a CRM row or a staff e-mail / phone; `verifyContext` refuses the whole request on anything outside its list. The model
  proposes through ONE tool (`propose_action`) on a five-action whitelist; nothing runs until the owner presses «وافق», once,
  through the ordinary services (`createTask`, `updateTask`, `setPinned`, `pushNotification`); money tasks are never touched.
  ⚠️ A customer's name inside a free text has no shape a program can find. 🔧 So titles are off by default and the owner is told.

## Deployment

- **The image is built on GitHub, not on the production server** (`.github/workflows/image.yml`):
  it builds the Dockerfile, proves the image starts, migrates and is healthy, then publishes
  `ghcr.io/<owner>/zaki-workspace`. Building on the server starved the live apps before.
  ⚠️ Publishing an image changes nothing by itself: until Coolify is pointed at that image (or
  its webhook is enabled), production keeps deploying the way it did — check Coolify → Git
  Source before assuming which one is live. 🔧 The switch is the owner's, not a merge's.
- The container runs `prisma migrate deploy` when it starts, then serves on port 3000.
- Required environment: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`. Optional: `ENCRYPTION_KEY`,
  `UPLOAD_DIR` (the image sets it to `/app/storage/uploads`, which must be a persistent
  volume), `TRUSTED_PROXY_HOPS` (how many reverse proxies sit in front of the app, default 1;
  set it to 2 when a CDN sits in front of Traefik, never above the real number — the sign-in
  limiter counts that many entries of `X-Forwarded-For` from the right), `SESSION_TTL_HOURS`,
  `LOG_LEVEL`, Google client id and secret. A variable the code reads is documented in
  `.env.example` and in the README table, or `tests/repo-hygiene.test.ts` fails.
- The compose `worker` service is a heartbeat placeholder; background jobs will run inside
  the app process. `redis` is not used by the application yet.

## Conventions

- `src/app/api/**/route.ts` handlers are thin: parse with zod, call a service in
  `src/server/services/`, wrap in `withApi` (`src/server/api.ts`). Server-only code stays out
  of client components.
- The interface is Arabic and right-to-left: strings live in `src/lib/i18n/ar.json` plus one
  small fragment per feature (`ar.<feature>.json`, merged by `dict.ts`, so people can add strings
  at the same time without editing one 700-line file) and are read through `t()`. No key may exist
  in two files and every `t("key")` literal must exist (`tests/encoding-hygiene.test.ts`). Errors
  travel as machine keys (`new ForbiddenError("orgm.role_denied")`) and the screen shows
  `t(key)`, so every new error key needs its Arabic string. There is no English text on screen.
  Statuses, priorities, ranks and every other enum are shown through `enumLabel()`, board columns
  through `columnLabel()`, dates and numbers through `src/lib/format.ts` (Arabic names, Western
  digits); `tests/arabic-ui.test.ts` fails on a raw enum, a Latin word or a French/English date.
  The code always writes 0-9: a person who picks «الأرقام: ١٢٣» sees ٠-٩ because the font
  "Zaki Digits" draws them (`src/lib/digits.ts`, `<html data-digits>`) — never convert a number.
- **Colours come from the theme tokens**, never from Tailwind's default palette or a hex value:
  `text-danger`, `bg-ok/10`, `border-warn/40`, `text-info`, `bg-cat-3/10` (and `bg-surface-1`,
  `text-fg-muted`, `border-border`, `bg-accent` ...). Four themes (`night` default,
  `day`, `islamic-epic`, `neon-coast`; the retired `islamic-calm` is read as `night` by `themeOf`) define the tokens in `src/lib/themes/palettes.ts`;
  `src/app/themes.css` and `src/components/theme/decor.css` are generated
  (`node scripts/build-themes-css.mjs`, `node scripts/build-decor-css.mjs`) and a test fails when
  they drift. Decoration (ornament, photographs) appears only on the login door, empty states, the
  sidebar header and the Today strip — never behind a number, an amount or a table. The Today strip
  is the mission card: its two buttons sit INSIDE the `zk-scrim` panel, never on the picture.
- **The look is «نجمة وطريق»** (the owner's adopted mock-up, 2026-10-24): the gold of `accent-2` is
  the star (a shape colour, 3:1 — its label is `text-scrim`, held to 4.5:1 by the gate), the
  wordmark «زاكي» is Lalezar (`font-brand`), the shell's shapes are the `.zk-*` rules at the end
  of `globals.css`. «جديد» offers only what `newActionsFor()` (src/lib/nav/new-actions.ts) allows,
  and every action opens an existing form (`?new=` + `useNewIntent`). A new font, picture or
  third-party file is credited in `public/brand/CREDITS.md` AND in the guide's «الاعتمادات» article.
- Environment is read through `src/server/env.ts` (zod). A missing or malformed value fails
  at boot, loudly, with the key name and never the value.
- Read the Next.js 14 documentation for what you use; do not assume Next 15/16 behaviour
  (async `params`, `after()`, `unstable_*`) — this repository is on 14.2.
