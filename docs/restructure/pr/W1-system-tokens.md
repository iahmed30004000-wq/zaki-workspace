Base: feat/order-status
# W1 (system tokens) — «الإعدادات ← توكنات الأنظمة»

> Naming note: this is the owner's request «W1 توكنات الأنظمة» for the media buyer (contract `workspace-mediabuyer.v1`, repository `zaki-mediabuyer`
> PR #52). It is NOT the plan's phase W1 «الشغل» of `BUILD-STEPS.md`; that phase keeps its place in the order. It was built on top of the stack
> as it stood (Q1.4) because it needs nothing from the later phases.

## What was found first
Workspace already HAS the machinery: `ApiToken` (the «الباب», `docs/contracts/workspace-door.v1.md`) — a token shown once, kept as a SHA-256 hash and
compared in constant time, named scopes (`tasks.write`, `tasks.read`, …), an expiry, revoke, `lastUsedAt`, dying with its maker, 401/403 as the
contract needs, `Idempotency-Key`, the board and task doors the media buyer calls. What it lacked, and this adds: (1) a page in the settings for the
OWNER only (the existing screen is under «الأتمتة» for whoever holds «integrations.manage»); (2) the idea of a SYSTEM with fixed scopes, so a token made
for «الميديا باير» can never be wider than its contract; (3) a 90-day default. The door itself is not changed.

## Definition of Done
- What must work: (1) a card «توكنات الأنظمة» in `/settings`, shown to the owner only; (2) the owner picks the system («الميديا باير»), the space and an expiry
  (90 days preselected; 30, 365 or never possible) — the scopes `tasks.write` + `tasks.read` come from the system, never from the request (a smuggled
  scope is refused); (3) the whole token is returned once, stored only as a hash, never listed; (4) the table shows the system, space, scopes, last use,
  expiry, status and a «إلغاء» button; (5) the contract's calls work with it: `GET /api/v1/boards`, `POST /api/v1/tasks` with its `Idempotency-Key`
  (once however many retries; another body is 409), `GET /api/v1/tasks/{id}`; (6) a missing scope is 403, a revoked, expired, unknown or missing token is 401;
  (7) only the tokens made here are listed or revoked here; the others stay on «الأتمتة».
- Tests: `tests/db/system-tokens.test.ts` (11), `tests/door-systems.test.ts` (3); must stay green: `tests/db/api-door.test.ts` and the whole suite.
- Edge cases that matter: an admin who may make door tokens still gets 403 here; with the switch «باب الربط» off the owner sees and revokes but cannot
  make (404); «constructor» / «__proto__» are no system; another company's owner sees nothing and cannot revoke.
- Blockers: CI red · an old test red · a secret exposed · a destructive migration (none).

## The failing test, before the change
`tests/db/system-tokens.test.ts` was written first; it cannot load without `/api/system-tokens` (the routes did not exist) and every case needs the new
`system` column.

## What changed
`prisma/schema.prisma` + migration `20261117140000_api_token_system` (ONE nullable column `ApiToken.system`); `src/lib/door/systems.ts` (the systems);
`src/server/services/system-tokens.ts` (owner-only list / make / revoke over `api-tokens.ts`, which gained the optional `system`); the routes
`/api/system-tokens` and `/api/system-tokens/[id]`; `src/components/system-tokens-card.tsx` placed in the settings page; `ar.system-tokens.json`.

## Switches
none new. Making a token needs the existing switch `apiDoor` («باب الربط الخارجي»), OFF by default, as the door always did.

## Decisions used
D-owner (17/11): the OMS model of tokens — «the system that owns the data mints the token, the owner pastes it once in the other system».

## Owner actions
1. Turn on «باب الربط الخارجي» in «الميزات».
2. «الإعدادات ← توكنات الأنظمة» → «الميديا باير» → the space the media buyer writes to (it must hold the board) → «اعمل المفتاح» → copy it (it shows once).
3. Paste it in the media buyer: «الإعدادات ← الربط» → Zaki Workspace → `WORKSPACE_API_TOKEN`.
4. Note: the token acts in the name of the owner who made it and dies if that person is suspended or loses access.

## Other repositories
The media buyer (`zaki-mediabuyer` PR #52) already says this page is the way (`status: ADD (W1)`); its contract lists a consent flow (`/oauth/...`) as a
later, non-blocking idea — not built here.

## Not done here (recorded)
- The contract's `example_response` for task creation is `{ id, status }`; the door answers `{ data: { id, status, … } }` (its published envelope,
  `workspace-door.v1.md` §4). The media buyer says it is built against the door's own document; if it reads the bare shape this is a difference to settle
  there (the door's v1 envelope never changes).
- The contract's «60 per minute» is the door's own limit (unchanged).
- Differences between the media buyer's contract file and the door (the door's v1 never changes; settle on the media buyer's side, which says it reads only the status and `error.code`): the list/board/status answers are wrapped in `{ data }` (the contract shows bare arrays/objects); the error codes are the door's own (`door.unauthorized`, `door.forbidden`, `door.not_found` when the switch is off, `door.idempotency_conflict`, `door.rate_limited`) where the contract lists short forms (`unauthorized`, `forbidden`, `door.disabled`, …); the door's `externalRef` must start with a letter or digit while the contract's pattern would also allow a leading `._:-/` (its own example `mb:task/…` is fine).
- A token made here is also visible (hint only, never the secret) and revocable on the old «الأتمتة» screen by an admin who holds «integrations.manage»; revoking is the safe direction, so it was left as it is.
- Rotating (making a new token and revoking the old one in one step) is two clicks for now.

## Gates
typecheck, lint (no new warning), migration lint (clean), secret scan, build: green; the code map was regenerated.
Unit tests: 277 of 279 files pass; the only red files are the two that cannot load under Node 26 (pre-existing: backup-envelope, backup-verify).
Full database suite: 259 files, all passed (run alone). `tests/db/api-door.test.ts` pins the token's keys; it now also lists the additive `system`.

## Independent review (read-only agent)
No serious hole: only the owner may list, make or revoke here (an admin who may make door tokens still gets 403); the scopes come from the server's registry and a smuggled scope is refused; the token and its hash appear only in the POST answer; the old screen keeps working; the contract's own task body is accepted by the door. One small defect fixed with a failing test first: the page listed from the company's newest 200 tokens and then filtered, so a system token could fall off the page after more than 200 newer ones — the filter is now in the query. The other findings (envelope and error-code differences with the contract file, the old screen seeing system tokens) are recorded above, not changed.
