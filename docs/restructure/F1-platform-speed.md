# F1 — The whole site fast (beyond the chat)

> Prerequisites: F0. Independent of the redesign; can run in parallel with D1/C1 (different files). Every item is a
> measured before/after in its PR (Lighthouse on `/`, `/my-work`, `/chat` with 4× CPU throttle; server timing of the
> layout).

## Findings (platform report, code at `main@6e21483`)

| # | Finding | Where |
|---|---|---|
| 1 | The `(app)` layout makes ~8 Prisma calls (~13 SQL) in ~6 sequential round trips; `currentUser` runs twice; no React `cache()` anywhere, so pages repeat `pageActor` (+3) and `currentSpace` (+2). | `src/app/(app)/layout.tsx:31-47`, `src/server/auth.ts:47` (`currentUser`), `src/server/policy/actor.ts:23` (`requireActor`), `src/app/(app)/_access.tsx` (`pageUser`, `pageActor`) |
| 2 | `livekit-client` ships on EVERY signed-in page (static import in `CallProvider`, mounted by the layout). | `src/components/calls/call-provider.tsx:6` |
| 3 | The shell statically imports QuickChat, PeopleDock, SiteGuide, nav-sort (`@dnd-kit`), SwitchFx; `next/dynamic` is used in 4 places only. | `src/components/app-shell.tsx` |
| 4 | 69 `router.refresh()` calls (each re-runs the whole server tree incl. the layout); `window.location.reload()` three times in the board and once when editing a space. | `grep -rn "router.refresh()" src`; `src/components/board-view.tsx:187,199,296`; `src/components/workspace-edit-button.tsx:37` |
| 5 | Per-tab polling: unread 30 s, presence 30 s, bell 30 s, `/api/workspaces` 60 s AND on every page change, quick chat 4 s. | `use-chat-unread.ts`, `people-dock.tsx`, bell, `space-switcher.tsx:60-70`, `quick-chat.tsx:103` |
| 6 | `isFeatureOn` re-reads `Organization.settings` on every call (7× in one conversation fetch). | `src/server/services/features.ts:12-19` |
| 7 | One `next start` process also runs the jobs (backup, IMAP, OCR, embeddings) every 30 s on the same event loop as SSE and the API. | `Dockerfile`, `src/server/jobs/scheduler.ts` |
| 8 | Prisma client pinned to `globalThis` only outside production. | `src/server/db.ts` |
| 9 | Only one `loading.tsx` (the whole app area); no per-place skeletons. | `src/app/(app)/loading.tsx` |
| 10 | Decoration layers animate infinitely with backdrop blur (paused when hidden). | `src/components/theme/*` |
| 11 | The first automated visit to `/chat` hung for > 45 s; a second visit the same day loaded normally (10 API calls in 10 s, list drawn) — NOT reproduced, so not counted as a defect. Measured on the second visit, signed in, from the browser: chat list ≈ 170 ms, one conversation ≈ 175 ms, unread ≈ 125 ms (1 space, 8 topics, 24 messages). The server answers fast at today's size; what feels slow is the page pattern (a cold load and a refetch for everything), i.e. C1. Also seen: `/api/workspaces` fetched twice per page, a push subscription re-posted on every load, and a missing profile picture answering 404 on every page. | live, 2026-11-16 |

## Steps

- [ ] F1.1 `cache()` for `currentUser`, `pageUser`, `pageActor`, `currentSpace`, `buildNav` inputs; parallelize the
      layout's independent reads with `Promise.all`. Target: ≤ 3 round trips for the layout.
- [ ] F1.2 Settings read once per request (memo in the request context) — shared with C1.9.
- [ ] F1.3 `CallProvider` loads `livekit-client` with `import()` when a call starts or rings; QuickChat, SiteGuide,
      nav-sort, SwitchFx via `next/dynamic` (`ssr: false` where client-only). Check the first-load JS of `/` drops (record
      the build's route table before/after in the PR).
- [ ] F1.4 Replace `router.refresh()` with TanStack `invalidateQueries` where the data is client-fetched; keep it only
      where a server component must re-render. Remove the four `window.location.reload()` (board ones in W1.5, the space
      edit one here).
- [ ] F1.5 Badges, presence and the space switcher's counts from the live line (C1.3) — polls become a 5-minute
      safety refresh on focus.
- [ ] F1.6 `loading.tsx` per place (skeletons shaped like the page: list rows, board columns).
- [ ] F1.7 Decoration: no infinite animation by default in the new themes (D1); the old themes keep theirs, paused when
      hidden (as today) and off under «وضع التوفير» (`economyMode`).
- [ ] F1.8 `src/server/db.ts`: one Prisma client per process in production; explicit `connection_limit` in
      `DATABASE_URL` documented in `.env.example` and the README table (`tests/repo-hygiene.test.ts`).
- [ ] F1.9 Jobs off the request loop (D-F1): run the scheduler in the existing compose `worker` service (it has the image
      and the volume) with the same advisory lock; the web process stops scheduling when `JOBS_IN_WORKER=1`. The scheduler
      starts in `src/instrumentation.ts`; the variable is read through `src/server/env.ts` (zod) and documented in
      `.env.example` and the README table (`tests/repo-hygiene.test.ts`). The worker needs the same environment as the
      app (`DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, Google/SMTP keys) — today's compose `worker` lacks
      several. ⚠️ Changes how production runs. 🔧 The owner switches it in Coolify; default unchanged.
- [ ] F1.10 Multi-instance readiness (LATER unless scaling): presence/typing/stream-cap/rate limits/device lines are per
      process memory; move them to Postgres (NOTIFY for presence/typing, a small table for rate limits) before running two
      app containers. Document in `AGENTS.md` «Deployment».

## Acceptance

- [ ] Layout server time halved (log `server-timing`), first-load JS of `/` reduced (LiveKit gone from it), no page
      reload anywhere in normal use, `/chat` never freezes on first load (Performance recording attached).
