Base: `origin/main` (712b1054). Branch `feat/space-isolation`. No schema, no migration, no new switch: this is THE behaviour (the owner's decision), not an option.

# B4 — «كل مساحة حساب لحالها»

The owner decided on 2026-10-25 and said it again on 2026-11-21 («المساحات معزولة»): each space is an ACCOUNT, like Telegram's accounts. Inside a space the person sees THAT space only; the other spaces appear as numbers on the drawer. «الشركة» (kind HQ, holds no projects) is the owner's / the person's view over ALL their spaces, grouped by space, each group with «انتقل» (`/go`). D-N3 is answered in `DECISIONS.md`.

## جرّب
1. افتح مساحة وروح على «مهامي»: بتشوف مهامك بهاي المساحة بس، والسطر تحت العنوان بيقلك اسمها؛ ومن القائمة اختار «كل مساحاتي» لتشوف الكل.
2. افتح «الطلبات» و«مهام قديمة»: نفس الشي، مساحتك بس، ورقم «الشغل» بيعدّ مساحتك بس.
3. افتح «الشركة»: «اليوم» بيصير ملخص بكل مساحاتك (مفتوحة، متأخرة، رسائل جديدة) ومعها «انتقل»، و«الطلبات» مجمّعة حسب المساحة.
4. من «الشركة» اضغط «+ مهمة»: بيسألك بأي مساحة، وبعد ما تضيف الإشعار بيقلك «انضافت المهمّة لمساحة «…»».
5. افتح مهمة من مساحة تانية من «كل مساحاتي»: اللوحة بتقلك «هاد من مساحة «…»» ومعها «انتقل لها»، وما بتنفتح لحالها.

## What changed (one commit per item)
1. **«مهامي»** — default scope «أنا» = the current space (inside «الشركة»: all); `?space=all` («كل مساحاتي») is explicit and never the default; the select lists the current space first; the project picker lists the current space's projects only (a project page still opens its own tasks); the `?task=` panel answers `{ foreign: { spaceId, spaceName } }` for a task of another space (no title, nothing else) and the panel shows the existing banner words + «انتقل لها».
2. **«الطلبات»** — `workRequestsOf` / `waitingRequestCount` / `waitingCount` take a scope: one space (approvals, assignment requests, cards, product sheets cut to it) or `groups` (every space, plus one company-wide group for tickets). Tickets stay company-wide (departments have no space). The page, the route, the nav badge on «الشغل», the old approvals page and Today's «بانتظار قرارك» follow the cookie's space; inside «الشركة» they are grouped by space with «انتقل».
3. **«مهام قديمة»** — default = the current space when the person manages it, else all the spaces they manage; `?space=all` explicit.
4. **Assignment** — `judgeAssignment` (the one judge behind create, update, co-assignees, mail-to-task and the rules) refuses a direct hand-over to somebody outside the task's space: `assign.target_not_in_space` (MSA); the owner rank is the exception as a target; no row is rewritten; the stale sweep offers only the managed spaces' members and the owner.
5. **Quick add** — `spaceId` on `POST /api/instant/inbox` and `POST /api/work/tasks`; `GET /api/instant` says `choose` + `spaces` inside «الشركة»; the sheet asks (required select), the toasts name the space; the inline line is not offered where it cannot know. (Also fixes the `split(/\s+/)` regex of #302.)
6. **Today** — «الشركة» shows `TodayHqSummary` (the person's open, late, unread per space) instead of an empty tasks card; the team card there is `teamWide` with the scope the service counted (`scopeInfo`): the two dead leftovers are wired, no zeros; Today's counts equal «مهامي»'s chips for the same space; «مواعيد اليوم» rows open `/tickets?ticket=<id>`.
7. **Overview** — `src/server/services/space-figures.ts` is the ONE per-space counter. Duplicates removed: two raw-SQL queries in `control-panel.ts` (the insight's `overdueBySpace` and the report's `bySpace`), the two `groupBy` queries in `spaces-overview.ts`, the `groupBy` in `nav-order.ts` `overdueBySpace`. The late-work insight links to `/go` → «مهامي» on that space's late tasks (the old `/list?filter=overdue` was read by nothing); the ideas insight counts per space with `ideaPlaceWhere` (the page's own filter) and links to that space's «الأفكار».

## Pinned tests changed on purpose
- `tests/db/work-requests.test.ts`: the owner's cards in review are per space (the other space's card waits in THAT space); the product-sheet tests put the people in the knowledge space (a sheet waits there).
- `tests/db/work-stale-sweep.test.ts`: the owner's default list is the current space; `space=all` is the old all-spaces answer.
- `tests/db/active-assignments.test.ts`, `pages-access-active.test.ts`, `scoping-ideas-tasks.test.ts`: the colleague who is given a task works in the task's space.
- `tests/control-panel.test.ts`, `tests/db/control-panel.test.ts`, `tests/db/today-page.test.ts`: the insights' links and the ideas sentence (per space).
- `tests/work-my-tasks-render.test.ts`, `-optimistic`, `work-project-page`: fixtures carry the new `space` field.

## Tests added
`tests/db/space-isolation.test.ts` (new), `tests/space-isolation-ui.test.ts` (new), and blocks in `tests/db/my-work-scope.test.ts`, `work-requests.test.ts`, `work-stale-sweep.test.ts`, `assign-by-rank.test.ts`, `tests/work-my-tasks*.test.ts`, `tests/task-assign-rank.test.ts`.

## For the owner to decide
- Product sheets now wait in the knowledge space only («المنتجات»); the approver sees them there and in «الشركة».
- Per-space «waiting» counts on the drawer (like unread / late) are not built: only the current space's number is on «الشغل».
