# P0 — Privacy and isolation (do this FIRST)

> Builder: read `docs/restructure/README.md` first (rules, gates, branch policy). This phase is small, urgent and
> independent of the redesign. Ship it before anything else: the owner reported real exposure.

## Why

The owner (2026-11-16): «لو أعطيت مهام لموظف بتلاقيها بتظهر عند الجميع، والمواضيع حتى لو حطيت خصوصية ما في أي خصوصية،
ما بتحسها معزولة». Four causes were confirmed by reading the code at `main@6e21483` (and re-checked by an independent
review):

| # | Cause | Where (main@6e21483) | Effect |
|---|---|---|---|
| C1 | Silent chat oversight is decided by **rank** (`role === "OWNER"`), while the permission meant to control it is the **capability** `archive.view` — which the people screen does not even offer as a switch (`src/lib/members-ui.ts` leaves it out of the catalogue; it can be taken from a partner only through the API) (checked by `holdsArchiveView`, `src/server/chat/archive-access.ts:11`). Partners («شريك (مالك)», OWNER rank, `primaryOwner = false`) are OWNER rank. | `src/server/policy/conversation.ts` `canRead()` / `canModerate()` (owner shortcut first); `src/server/chat/home.ts` (`isOwner`, `canOversee: isOwner`); `src/server/chat/unread.ts` (`isOwner`); also `redact.ts:97` (owner rank receives deleted text), `topics.ts:412-420` (`oversight`, `canJoin`, `canMakeWork`), `poll-shared.ts:81`, `order.ts:58`, `moderation.ts:51,101`. `src/server/chat/oversight.ts` already uses the capability. | A partner whose `archive.view` was revoked still opens every DM and every private topic by link, sees them in the chat list, unread counts, search and live events. `tests/db/archive-capability.test.ts` only covers the archive and oversight-list routes. |
| C2 | **Tasks have no visibility of their own.** The one task filter, `taskVisibleWhere(scope)` in `src/server/services/team-scope.ts:95` (18 files call it), knows only space and team; `requireTaskAccess` (`src/server/auth.ts`) the same. | the filter above + raw SQL on `"Task"` (24 lines, e.g. `services/owner-board.ts`, `services/control-panel.ts`), `findUniqueOrThrow` / `findFirstOrThrow`, nested `_count`/`include` of tasks (`app/(app)/projects/page.tsx`, `app/api/projects/route.ts`, `services/departments.ts`, `services/org-members.ts`, `services/users.ts`), and the «صارت مهمة» chip on chat bubbles (`chat/messages.ts` `messageInclude().tasks` → `redact.ts`). | A task given to one person is read by the whole space: boards, lists, calendar, timeline, Today, search, digest, owner assistant, `/api/v1/tasks`, counts. |
| C3 | **Work made from a private conversation lands in the open.** | `src/server/chat/make-work.ts` (`createTask` into any chosen project); ideas and projects made from a watch topic are created by `app/api/ideas/route.ts` and `app/api/projects/route.ts` (`src/server/watch/convert.ts` only validates). | The text of a message in a private topic or a DM becomes a task / idea / project title the whole space reads. |
| C4 | **Nothing on screen says who can see a topic or a task.** The person testing «خاص» is an OWNER-rank account, who reads everything by design. | topic header, topic row, task row. | «الخصوصية ما بتزبط» even where it works. |

**Seen live on 2026-11-16 (read-only, signed in as the account the owner tests with):** about half of the company's
accounts hold the OWNER rank (the primary owner and several partners), and nobody has ever had a single permission
added or taken away. The testing account is itself a partner: every conversation it opens says «عين المالك: قراءة
صامتة», and its space's private topic is listed for it. So for half of the accounts — the tester included —
"private" changes nothing, by design. (The exact figures are in the owner's own summary, not in this public file.)

Checked and **correct** (keep it, keep its tests green): `canRead` for a restricted topic is "own rows only" for
everybody but oversight; `markRead` creates a row only for OPEN topics; the topic-settings dialog sends `memberIds` when
switching to «ناس محددين» and `updateTopic` replaces the rows; unread, search, notify, digest and the realtime gate call
the policy; the hub's per-stream visibility cache expires after 30 s and is cleared on `membership.changed`.

## Owner decisions (ask once, record in `DECISIONS.md`)

D-P0 (who keeps the OWNER rank), D-P1 (who keeps oversight), D-P2 (default visibility of a new task), D-P3 (old tasks), D-P4 (who else reads a private
task). Until answered, build the recommended defaults. **The feature switch `taskPrivacy` only offers the control and
sets the default for NEW tasks; the read filter for `PARTICIPANTS` rows always applies, switch on or off** (a private row
must never leak because a switch was flipped).

## Steps (each is one branch; tick the boxes in this file as you go)

### P0.0 What the owner can do today, with no code — owner actions (D-P0)

- [ ] 🔧 Review who really needs the OWNER rank («الأعضاء والصلاحيات», only the primary owner can change it): a person
      who runs a team needs «مشرف» plus the right spaces, not «شريك (مالك)». Each partner reads every private chat and
      every task of the company.
- [ ] 🔧 Check that no owner-rank account is still on the temporary password it was created with (the people screen
      marks such an account): change it, lower the rank, or suspend the account.
- [ ] 🔧 Test privacy with a plain «عضو» account (not an owner-rank one): that is what an employee really sees.
- [ ] These three do not replace P0.1–P0.5: today a partner cannot even be switched out of oversight from the screen
      (cause C1), and a task is still visible to its whole space (cause C2).

### P0.1 Oversight follows the capability — branch `fix/chat-oversight-capability`

- [ ] Failing DB test first: `tests/db/chat-partner-oversight.test.ts`. World: primary owner O, partner P, members A and
      B, a space S with A and B, a restricted topic T with A only, a DM A↔B, an open topic U.
      P with `archive.view`: reads T and the DM silently (no read row, no event). After the primary owner revokes it:
      `GET /api/chat/conversations/<T>` and `<DM>` → 404; `GET /api/chat/home` lists neither; `GET /api/chat/unread`
      does not count them; conversation and global search find nothing in them; `canReadConversation(P, T)` false; posting
      refused; a live stream of P stops receiving T's event ids immediately (see the cache step). O unchanged everywhere.
- [ ] `src/server/policy/conversation.ts`: extend `OrgFacts` with `oversight: boolean`, computed in `loadOrgFacts` with
      the SAME rule as `holdsArchiveView` (`effectiveCapabilities(member).has("archive.view")` — read `primaryOwner`,
      `capabilities`, `revokedCapabilities` in that query; export one helper and make `holdsArchiveView` call it, so there
      is ONE definition). Add `export function hasOversight(org)`.
- [ ] `canRead`: the first-line owner shortcut becomes `if (hasOversight(org)) return true;`. An OWNER-rank person
      WITHOUT oversight is treated as a space ADMIN of every space (they need no `WorkspaceMember` row, as
      `requireWorkspace` already says): `const spaceRole = facts.viewerSpaceRole ?? (isOwnerOf(org) ? "ADMIN" : null)`.
      Open topics yes; restricted topics they are not in and other people's DMs no.
- [ ] `canPost` / `canModerate` / `canPin`: oversight holders keep today's owner rules ("posts only where joined", never in
      someone else's DM). An OWNER-rank person WITHOUT oversight follows the space-ADMIN rules with the `spaceRole`
      fallback: reading an open topic leaves a normal read row (`markRead`), they may post there, they get its
      notifications — they are a normal participant, not a silent reader (recorded under D-P1).
- [ ] Replace every READ decision by rank with `hasOversight`: `home.ts` (and `canOversee` = `hasOversight`), both SQL
      queries in `unread.ts` (a boolean `oversight` parameter instead of `isOwner`), `search.ts`, `digest.ts`, `notify.ts`,
      `messages.ts` (`markRead` is silent only for `hasOversight && !viewerIsMember`), `redact.ts:97`, `topics.ts:412-420`,
      `poll-shared.ts:81`, `order.ts:58`, `moderation.ts:51,101`. Posting/purge rules that are about the OWNER rank and not
      about reading keep their check with `// oversight-ok: <reason>`.
- [ ] **The switch itself:** on a partner's sheet in the people screen (`src/components/members/member-sheet.tsx`,
      `capability-panel.tsx`), shown to the primary owner only: «الأرشيف والرقابة — بيقرأ كل المحادثات الخاصة بصمت», with ⚠️
      «لما تطفّيها، هالشريك ما عاد يشوف الخاص ولا الأرشيف» and what stays (he reads and writes open topics like a manager).
      It writes `revokedCapabilities` through the existing members route (the API already accepts it:
      `tests/db/archive-capability.test.ts`); for everybody else `archive.view` stays un-grantable. UI test: the switch
      is offered for a partner to the primary owner, to nobody else, and for no other rank.
- [ ] Live line: changing a person's rank or capabilities (`src/server/services/accounts.ts` / `org-members.ts` update
      paths) emits `membership.changed` with `{ userId, targetUserId }` so the hub clears that org's visibility caches
      (`src/server/realtime/hub.ts` already clears on that kind). Test: revoke → the next event of T is not delivered to P.
- [ ] Guard test `tests/chat-oversight-guard.test.ts` (source text): no `role === "OWNER"` / `orgRole === "OWNER"` /
      `isOwnerOf(` in `src/server/chat/**` and `src/server/policy/conversation.ts` except lines carrying
      `// oversight-ok: <reason>`.
- [ ] Keep green: `tests/db/partners.test.ts` (a partner reads like an owner, private DMs too — true while he holds
      `archive.view`, which partners hold by default), `chat-owner-reads-dms`, `archive-capability`, `topic-privacy`,
      `realtime-replay-gate`.
- [ ] Noticed, not fixed here (A1.3 fixes them): `isOwner` checks that ignore a partner's revocation in
      `policy/board.ts`, `policy/team-development.ts`, `services/features.ts`, `chat/purge.ts`, `policy/reward.ts`,
      `api/workspaces/route.ts` (`canCreateSpaces`).
- [ ] `AGENTS.md` «Access model»: "silent oversight = the capability `archive.view` (`holdsArchiveView`), never the rank"
      and "one primary owner plus partners («شريك (مالك)») who hold every capability the primary owner did not take away"
      (replaces "There is exactly one OWNER").

### P0.2 A task can be private — branch `feat/task-visibility`

> 🔧 Owner action BEFORE this branch (AGENTS.md «Migrations»): run the read-only `npx prisma migrate status` from the
> app container and send the output; this is the plan's first new migration.

Data (additive):
- [ ] Migration A: `ALTER TABLE "Task" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'SPACE';` + index
      `("workspaceId","visibility")`. Prisma: `visibility String @default("SPACE") // SPACE | PARTICIPANTS`. Values
      validated by zod (`TASK_VISIBILITY`). No backfill (D-P3).

Policy — EXTEND the existing helper, do not create a second one:
- [ ] `src/server/services/team-scope.ts`: `WorkScope` gains `userId`, `managedSpaces` (the spaces where
      `isSpaceManager` is true — computed in `loadWorkScope`, which already evaluates it), `reportIds` (everybody under the
      person through `OrganizationMember.managerId`, transitive, ACTIVE only, depth ≤ 6) and `oversight` (P0.1's helper).
      `narrowScope` carries them.
- [ ] `taskVisibleWhere(scope)` ANDs its current space/team rule with the participant rule:
      `{ OR: [ { visibility: "SPACE" }, { creatorId: me }, { assigneeId: me }, { coAssignees: { some: { userId: me } } },
      { workspaceId: { in: managedSpaces } }, { assigneeId: { in: reportIds } }, { coAssignees: { some: { userId: { in:
      reportIds } } } } ] }` — skipped entirely when `scope.oversight`. All 18 existing callers get it for free.
- [ ] New in the same module: `canSeeTask(scope, task)` (one row, same rule) and `taskVisibleSql(scope, alias)` (a
      `Prisma.sql` fragment of the same rule for raw SQL). `requireTaskAccess` calls `canSeeTask` after the space/team
      check → `NotFoundError("task.not_found")` (404: existence is private too).

Apply to every reader (tick each):
- [ ] Prisma readers not yet on the helper: `services/tasks.ts`, `task-recurrence.ts`, `task-assign.ts`, `reminders.ts`,
      `first-steps.ts`, `time-tracking.ts`, `custom-fields*.ts`, `okr.ts`, `pinned.ts`, `rewards.ts`, `checkins.ts`,
      `task-links.ts`, `card-links.ts`, `approvals.ts` (linked task), `owner-assistant-*.ts`, `assistant-work.ts`,
      `api-door.ts` (the token's person is the actor), `search-semantic.ts`, `search-embed-index.ts`,
      `app/api/search/route.ts`, `calendar-feed.ts`, `today.ts`, `today-dashboard.ts`, `timeline.ts`, `milestones.ts`,
      `analytics.ts`, `spaces-overview.ts`, `digest.ts`, `views.ts`, the pages `app/(app)/boards/[id]`, `projects/[id]`,
      `tasks/[id]`, routes `app/api/boards/[id]` and `app/api/boards/[id]/columns/[columnId]`, the `app/api/tasks/[id]/**`
      routes (through `requireTaskAccess`). Include the `findUniqueOrThrow` / `findFirstOrThrow` calls.
- [ ] Raw SQL on `"Task"` (24 lines; `grep -rn 'FROM "Task"\|JOIN "Task"' src`): `owner-board.ts`, `control-panel.ts`
      and the others — add `taskVisibleSql(...)`, or mark owner-only aggregates (oversight holders) with
      `// task-visibility: oversight-only aggregate`.
- [ ] Nested counts and includes: `projects/page.tsx`, `api/projects/route.ts`, `departments.ts`, `org-members.ts`,
      `users.ts` — count through a `where` built from the helper.
- [ ] Chat bubbles: `presentMessage` (`src/server/chat/dto.ts` / `redact.ts`) shows «صارت مهمة» only for task ids the
      viewer can see (filter `message.tasks` with `canSeeTask`), so a private task's existence does not leak.
- [ ] Jobs and system paths (`jobs/recurrence.ts`, `jobs/reminders.ts`, `recurrence-spawn.ts`, `task-rules-run.ts`,
      `space-delete.ts`, `accounts.ts` offboarding hand-over) read as the system: `// task-visibility: system (<reason>)`.
- [ ] New tasks: `createTask` sets `visibility` from the input, else D-P2's default. Tasks created by a recurrence or a
      rule copy the template task's visibility; tasks from the door (`/api/v1/tasks`), e-mail and the assistant default to
      SPACE unless the caller sends `visibility`. `updateTask` may change it (creator, a space manager, the assignee's
      manager, oversight); each change is a `TaskActivity` line.
- [ ] Guard test `tests/task-visibility-guard.test.ts` (source text): every task read in `src/` (`.task.findMany|findFirst|
      findUnique|findUniqueOrThrow|findFirstOrThrow|count|groupBy|aggregate`, `_count` selects of `tasks`, raw SQL
      containing `"Task"`) either calls `taskVisibleWhere(` / `canSeeTask(` / `taskVisibleSql(` / `requireTaskAccess(` in the
      same statement, or carries `// task-visibility: <reason>` on its line. It must FAIL on today's code (paste it).

UI (strings in `src/lib/i18n/ar.task-privacy.json`):
- [ ] Task create / edit (`src/components/create-forms.tsx`, `src/components/task-detail.tsx`, Today quick add,
      `src/components/chat/message/make-work-dialog.tsx`): «مين بيشوفها؟ — المساحة كلها / المعنيين بس», with
      «⚠️ كل أعضاء المساحة رح يشوفوها» + 🔧 «اختار المعنيين بس» under «المساحة كلها» when an assignee is set.
- [ ] A lock icon (lucide `Lock`, `text-fg-muted`) on private tasks in `task-row`, `board-view`, calendar cells, search
      hits; tooltip «بيشوفها: فلان، علّان، مدراء المساحة».
- [ ] Space settings (`/spaces/current`): «خلّي المهام المسندة المفتوحة خاصة» → a confirmation with the count → bulk
      `updateTask` (audited).

Tests:
- [ ] `tests/db/task-visibility.test.ts`: a private task of assignee A is visible to A, its creator, a co-assignee, A's
      manager and the manager's manager, a space manager, the primary owner; invisible (404 / absent / not counted) to
      another member of the same space on: task GET, comments, board, list, calendar, timeline, Today, global and semantic
      search, digest, `GET /api/v1/tasks`, the calendar feed, counts, owner-board/control-panel aggregates for non-oversight
      viewers, the «صارت مهمة» chip. SPACE tasks unchanged. Guests unchanged.

### P0.3 Private conversation → private work — branch `fix/private-chat-work`

- [ ] `make-work.ts`: from a DM, a restricted topic or a team topic, the new task's default visibility is PARTICIPANTS;
      SPACE requires `confirmPublic: true` — **enforced on the server** (400 `work.confirm_public_required` without it);
      the dialog asks with «⚠️ الرسالة من محادثة خاصة؛ إذا خليتها للمساحة كلها رح يشوفها الكل» / 🔧 «خليها للمعنيين بس».
- [ ] Same server rule for ideas and projects made from a private source: `app/api/ideas/route.ts` and
      `app/api/projects/route.ts` (watch topics are restricted; `watch/convert.ts` validates the source) and tickets from
      a private message (`make-work.ts` ticket path): `confirmPublic` required.
- [ ] DB tests for each path (default private; public without `confirmPublic` → 400).

### P0.4 Say who can see it — branch `feat/privacy-visible`

- [ ] Topic header subtitle for a restricted topic: «🔒 خاص · 4 أشخاص» (button) → a sheet with the people, plus one line
      «والمالك بصفة رقابة» when oversight holders exist (honest, matches the transparency notice).
- [ ] Topic row: lock icon for restricted, people icon for a team topic.
- [ ] Topic settings: before saving, «رح يشوفه: …» with the resulting list.
- [ ] Oversight banner reworded: «أنت عم تقرأ هالموضوع بصفة رقابة — أصحابه ما بيعرفوا إنك قرأت».
- [ ] Render tests for the four states. Digits are Western 0-9 in every string (`tests/arabic-ui.test.ts`).

### P0.5 Privacy regression matrix — branch `test/privacy-matrix`

- [ ] `tests/db/privacy-matrix.test.ts`: personas (primary owner; partner with / without `archive.view`; org ADMIN in /
      out of the space; space ADMIN; member in / out of a restricted topic; team member / non-member; guest) × objects
      (open topic, restricted topic, team topic, DM, SPACE task, PARTICIPANTS task, task made from a private topic,
      attachment in a private topic) × surfaces (chat home, open, page of messages, search, unread, notify audience,
      realtime gate, digest, attachment download, task GET, task lists, counts). Table-driven; the expected matrix is data
      at the top of the file so the owner's decisions are readable.
- [ ] Required for every later phase (README rule R8).

### P0.6 The Android signing password is in a public file — branch `fix/android-signing-secret`

`android/app/build.gradle` (`signingConfigs`, lines 27 and 29) writes the keystore password and the key password as
plain strings in a public repository; `npm run scan:secrets` does not catch the Gradle form. The key file itself is a
repository secret (`ANDROID_KEYSTORE_B64`), so the password alone does not sign an APK — but a published secret must be
changed (AGENTS.md «Security»).
- [ ] 🔧 Owner action first: change BOTH passwords of the existing keystore (`keytool -storepasswd`, `keytool -keypasswd`
      — same key, so phones keep updating; never a new key), re-encode into `ANDROID_KEYSTORE_B64`, add
      `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` as repository secrets.
- [ ] `build.gradle` reads them with `System.getenv(...)`; `.github/workflows/android.yml` passes them; without them the
      build falls back to the debug key and warns.
- [ ] `scripts/scan-secrets.mjs`: a rule for `storePassword|keyPassword` followed by a quoted literal in `*.gradle` /
      `*.gradle.kts` + tests in `tests/scan-secrets.test.ts` (the current file must fail the scan before the fix).
- [ ] Never write the old value anywhere (PR text, docs, commits).

## Definition of done for P0

- All six branches ready with CI green; each new test failed before its fix (red run pasted in the PR description).
- `DECISIONS.md` records D-P0..D-P4 (or «بانتظار المالك» with the default used).
- Owner live check on `workspace.zakiai.io`: a partner without `archive.view` cannot open a private topic; a member of
  the space cannot open another member's private task.
