# W1 — «الشغل»: fewer places, one task list, a clear inbox

> Prerequisites: P0 (task visibility is applied in every view below), D1, N1 (the place and its four tabs).
> Rule reminder: extend, never rebuild — every table stays; screens are merged, links are added, duplicates are
> MARKED (⚠️ + 🔧 on screen) and offered a conversion, never deleted.

## 1. What is wrong today (work-area report, 2026-11-16, code at `main@6e21483`)

- **13 tabs** for a plain member: مهامي · المشاريع · القائمة · التقويم · الأهداف · الأفكار · الروتين اليومي · الأقسام ·
  التذاكر · الحملات · العملاء · الموافقات · التسجيل اليومي (`src/lib/nav/places.ts:162-193`).
- **«مهامي» shows the current space only** (`src/app/(app)/my-work/page.tsx:33`): «مسندة إليّ» must be opened once per
  space (4 clicks each).
- **A task cannot exist without a project, a board and a column** (`schema Task` required `projectId/boardId/columnId`)
  → a hidden «مهام فورية» project per space (`src/server/services/instant-work.ts`) that shows as an ordinary project card;
  Today's quick add drops tasks in "your first project with a board" (`src/components/today/quick-add.tsx:17-19`).
- **No status field**: status = the column's name, so «القائمة» grouped by status repeats each status once per board
  (`src/app/(app)/list/page.tsx:149`).
- **"Something someone must do" lives in six tables**: Task, Ticket (own comments/activity, no space), CampaignItem
  (mini-task, no link to Task), Routine (duplicates recurring tasks), Reminder without a task, DevGoal. Comments exist ×4,
  approval-like decisions ×4 (ApprovalRequest, Card status, TaskAssignRequest — which has no inbox — AiProposal),
  repetition ×3.
- **A project's views are scattered** (board in the project, list in «القائمة», calendar in «التقويم», timeline under the
  project) and there are no breadcrumbs; opening a card leaves the board (`board-view.tsx:410`).
- **Offered then refused**: «الأقسام/التذاكر/الحملات» tabs are offered without `directory.view`, their pages require it
  (`places.ts:181-184` vs the pages).
- **The board reloads the whole page** in three places (`window.location.reload()`, `board-view.tsx:187, 199, 296`).

## 2. Target

```
«الشغل»
 ├ مهامي      one screen · view: قائمة | لوحة | تقويم · scope: أنا | المساحة | مشروع · all my spaces by default
 ├ المشاريع   the space's projects → a project page with tabs: لوحة · قائمة · تقويم · جدول زمني · حقول وقواعد · إعدادات
 ├ الطلبات    everything waiting for a decision: بانتظاري (approvals, assignment requests, tickets of my departments) · طلباتي
 └ المزيد     الأهداف · الأفكار · الروتين اليومي · الأقسام · التذاكر · الحملات · العملاء · التسجيل اليومي (each behind its switch)
```

## 3. Steps (each a branch; tick as you go)

### W1.1 One «مهامي» screen — `feat/work-my-tasks`
- [x] `src/app/(app)/my-work/page.tsx` becomes the unified screen; `/list` and `/calendar` redirect to it with
      `?view=list|calendar&scope=space` (old addresses keep working — `LEGACY_ROUTES` test).
- [x] Scope «أنا» = assigned to me or co-assigned, across ALL my ACTIVE spaces (`accessibleWorkspaceIds`), with a
      space filter chip row; «المساحة» = the current space's visible tasks (P0.2 rule); «مشروع» = a picker.
- [x] Quick filters (chips): اليوم · متأخرة · هالأسبوع · بدون موعد · مكتملة · أنشأتها; sort; group by stage / project /
      person / due date. The six old inner tabs map onto these chips (keep their URLs: `?tab=today` → chip «اليوم»).
- [x] View «لوحة» groups by **stage** (W1.3), across projects.
- [x] Data: `queryTasksForView` (`src/server/services/views.ts`) extended with `scope` and `stage`; all reads use
      `taskVisibleWhere` (P0.2). Client: TanStack Query, optimistic updates for complete / move / due date.
- [x] Rows use D1's `list-row`; the task opens in a side panel (URL `?task=<id>`), `/tasks/[id]` stays a full page.
      Built 2026-11-20 on `feat/work-my-tasks` behind the switch `workMyTasks` (OFF): the screen, the three scopes, the chips, the stage board, the optimistic changes, the side panel,
      the redirects of `/list` and `/calendar` and the loading file are done; notes and what is NOT done (the shell's one line for the old map, the full task card inside the
      panel, the custom-fields bar of the old list): `docs/restructure/pr/W1.1.md`.

### W1.2 Tasks without the project hunt — `feat/work-inbox-project`
- [x] The per-space hidden «مهام فورية» project becomes a visible, named **«صندوق المهام»** (same `systemKey`, same
      service `instant-work.ts`): shown pinned on top of «المشاريع» with its own icon (not as an ordinary card); a quick
      task from anywhere (Today, chat «اعمل مهمة» without a chosen project, «جديد») lands there in «للتنفيذ».
- [x] «الشركة» (HQ) gets none — it holds no projects by the owner's decision of 2026-10-25 (N1 D-N3). A quick task made
      while the person is in «الشركة» lands in the «صندوق المهام» of their first STANDARD space; with no such space the
      quick add explains why («لسا ما إلك مساحة شغل»).
- [x] Fix Today's quick add to use it instead of "the first project with a board".
      Built on `feat/work-inbox-project` behind the switch `workInbox` (OFF); notes: `docs/restructure/pr/W1.2.md`.

### W1.3 A normalized stage — `feat/work-stage`
- [x] Migration (additive): `BoardColumn.stage TEXT NOT NULL DEFAULT 'DOING'` (TODO | DOING | REVIEW | DONE);
      a separate data migration: `UPDATE "BoardColumn" SET stage = 'DONE' WHERE done = true;` then `UPDATE "BoardColumn" c
      SET stage = 'TODO' WHERE c.done = false AND c.position = (SELECT min(position) FROM "BoardColumn" x WHERE x."boardId"
      = c."boardId");` (both with WHERE, repeatable; ties on position: the smallest id).
- [x] Column settings let a manager choose the stage; new boards' default columns get TODO/DOING/DONE.
- [ ] Cross-project lists group and filter by stage; `columnLabel()` still shows each board's own column name.
      Built 2026-11-20 on `feat/work-stage` (switch `workStages`, OFF): the column, both data moves (own folders `20261123102100_board_column_stage` and
      `..102101_board_column_stage_backfill`), `PATCH`/`POST`/`GET /api/boards/[id]/columns` and the picker on the board are done; the LISTS that group and filter by
      stage are W1.1's screens (they read `BoardColumn.stage`; `src/lib/work/stage.ts` is the vocabulary). Notes: `docs/restructure/pr/W1.3.md`.

### W1.4 «الطلبات» — `feat/work-requests-inbox`
- [ ] One screen, two tabs «بانتظاري / طلباتي», sections: approvals (`ApprovalRequest` steps where I am the approver —
      existing `/approvals` lists), task assignment requests (`TaskAssignRequest` addressed to me — today it has NO inbox
      list), open tickets of my departments (`Ticket`), card approvals waiting for me (Card status REVIEW where I decide).
      Each row acts in place (accept / return with reason / approve / reject) through the EXISTING services.
- [x] Badge on «الشغل» = count of «بانتظاري». (built 2026-11-19 on `feat/work-requests-inbox`: `/api/workspaces` carries `waiting`, `place-badge.tsx` has `useWorkWaiting`; ⚠️ the shell's one line that passes it to the badges is the integrator's, see docs/restructure/pr/W1.4.md)
- [x] `/approvals` keeps its pages (forms, detail); «الطلبات» links into them. (built; the tab is `/requests`, the switch `workRequests` is OFF)

### W1.5 The project page — `feat/work-project-page`
- [x] `src/app/(app)/projects/[id]/page.tsx` gets tabs: «اللوحة» (default; the board picker when there are several),
      «القائمة», «التقويم», «الجدول الزمني» (existing timeline), «الحقول والقواعد» (custom fields, rules, milestones —
      today cards on the page), «الإعدادات».
- [x] Breadcrumbs (N1) on every project view and on the task.
- [x] Board: the three `window.location.reload()` replaced (column add/delete and the third one at line 187) (TanStack mutation + `invalidateQueries`), optimistic card moves (keep
      the restore-on-failure behaviour).
      Built 2026-11-20 on `feat/work-project-page` (rides on `navV2`, no switch of its own): with it ON `/projects/[id]` is the page with tabs (`project-page.tsx`: the trail, the title with its
      progress, ONE strip — «اللوحة» with a picker for several boards · «القائمة» · «التقويم» (W1.1's rows and calendar with the scope fixed to this project, the address stays on the project page) ·
      «الجدول الزمني» (its own page, which wears the same strip) · «الحقول والقواعد» (the old three cards, offered only when one exists for the person) · «الإعدادات» (team, boards)); with it OFF the old page
      is untouched. The board no longer reloads the page (the card, the new column and the deleted column change the board at once and ask the server again with `router.refresh()`), a card opens in W1.1's
      side panel while `workMyTasks` is on. Notes, deviations and what is NOT done: `docs/restructure/pr/W1.5.md`.

### W1.6 Duplicates marked, with a way out — `feat/work-duplicates-marked`
- [x] «الروتين اليومي» (Routine): a ⚠️ banner «هاد مكرّر مع المهام المتكررة» + 🔧 «حوّل الروتين لمهام متكررة»: ONE
      routine becomes ONE recurring task (`Routine` has no items): a template task titled like the routine, assigned to the
      routine's assignee, in the «صندوق المهام» (W1.2) of the routine's space (a routine with no space: the assignee's
      first STANDARD space), with a `TaskRecurrence` on the routine's weekdays through the existing recurrence service;
      the routine is archived, never deleted, and its logs stay readable.
- [x] Campaign items: additive `CampaignItem.taskId String?` + «اعمل منه مهمة» (createTask, link both ways).
- [x] Tickets: additive `Task.sourceTicketId String?` + «حوّل لمهمة» on a ticket; the ticket shows the linked task.
- [x] Card → task already exists; store the link (`Task.sourceCardId String?`, additive) instead of only in the audit log
      (`src/server/services/card-links.ts`).
      Built 2026-11-20 on `feat/work-duplicates-marked` (no switch of its own; the routine conversion needs `recurringTasks`): the routine page wears ⚠️ + 🔧 and every routine converts to ONE recurring task in the space's «صندوق المهام»
      (`convertRoutineToTask`, idempotent under an advisory lock; the routine is archived, `active = false`, its logs still read on the days they were ticked); a campaign item → «اعمل منه مهمة» (`CampaignItem.taskId`); a ticket → «حوّل لمهمة»
      (`Task.sourceTicketId`; a ticket from a private chat makes a «المعنيين بس» task and publishing it needs `confirmPublic`, also later through `updateTask`); the card link is stored in `Task.sourceCardId` (filled when the card's links are read:
      `cards.ts` is not in this package). A reader who may not open the task sees only that a link exists. D-W2 (the fold) is NOT built. Notes and what is NOT done: `docs/restructure/pr/W1.6.md`.
- [ ] D-W2 (owner, later): whether Ticket / CampaignItem / Routine are folded into Task types for good (a data-move plan
      with copies, never a drop). Not in this plan's scope.

### W1.7 Today, simplified — `feat/today-simple`
- [x] Up to six cards, in this order: «مهامي اليوم» (today + overdue, quick add) · «بانتظار قرارك» (W1.4 count + top 5) ·
      «ذكروك» (unread mentions, links into chat) · «تذكيراتي» · «التسجيل اليومي» (switch) · ONE team card for managers
      (A2 defines its scope). The rest (TeamPulse, dashboard team card, digest, time) move to «لوحة التحكم» or «اليوم ›
      المزيد». The «اليوم» strip (decoration) follows D1.
      Built on `feat/today-simple` behind `navV2` (no switch of its own): `todayLayout` and `TODAY_HAND_OFF` in `src/lib/today.ts` say which cards exist and where every moved part went;
      notes: `docs/restructure/pr/W1.7.md`. A2.3 edits `today.ts` and `today-dashboard.ts` after this step (the team card's scope).

### W1.8 Make the tabs honest — `fix/work-tabs-honest`
- [x] Every tab's `requires` in `places.ts` equals its page's rule (departments / tickets / campaigns need
      `directory.view` → either require it in the tab or relax the pages for staff — D-W3, recommended: relax the pages
      for staff, the department data is not secret inside the company).
      Built on `fix/work-tabs-honest`: D-W3 is PENDING, so the TABS require `directory.view` (`tickets` / `campaigns` also their own box, through the new `{ allOf }` requirement)
      and NO page is relaxed; `tests/db/work-tabs-honest.test.ts` pins page = tab for every optional work tool and the refusal itself. The owner's yes is ONE commit
      (the three tabs, the three pages, that test; then record it in DECISIONS.md). Notes: `docs/restructure/pr/W1.8.md`.
- [x] «جديد → مهمة» in a card space keeps the intent (open the task sheet on `/cards`).
      `/cards?new=task` mounts the quick add (the same sheet as Today) beside the cards; `newHrefFor(task, v2, layout)` and `cardsHomeHref` (new-actions.ts) carry the intent, and `src/app/(app)/page.tsx` redirects a card space with
      `cardsHomeHref(searchParams)`, so «جديد → مهمة» (the wheel's `/?view=today&new=task`) ends at `/cards?new=task` (tested: `tests/db/work-tabs-honest.test.ts` C). Not wired: the wheel does not pass the
      space layout to `newHrefFor` (the shell has no layout on the client; it would save one redirect hop) — see the PR notes.
- [x] Search palette also finds boards, ideas, tickets, customers (with their own access rules — `crm.view` for customers).
      `src/server/search/work-search.ts`; the answer gains `boards` / `ideas` / `tickets` / `customers` ONLY when there is a hit (the old shape is byte for byte as before); the palette is the wide one (`xl`).

### W1.9 Old tasks nobody touches — `feat/work-stale-sweep`
Seen live on 2026-11-16: 262 open tasks; 196 of them on ONE account; 42 with nobody assigned; 183 not touched for 14
days or more; the hidden «مهام فورية» project listed as an ordinary project card; Today and the control panel showing
the same panel, with two different "overdue" numbers on one page (9 and 6).
- [x] A review list «مهام قديمة» for space managers and the owner: open tasks untouched for N days (default 14), grouped
      by person and project, with bulk actions through the existing services (`updateTask`, `moveTask`): «سكّريها»,
      «عيّني مسؤول», «أجّليها لتاريخ», «أرشفيها» (the existing `Task.archived` flag — nothing is deleted). Every action is a
      `TaskActivity` line.
      Built on `feat/work-stale-sweep` behind `workStaleSweep` (OFF): `/my-work/stale` and `GET|POST /api/work/stale`; «old» = open, untouched (no edit, comment or log line) for N days, default 14; only the spaces the person manages (the owner: all);
      each task is judged on its own (`task.not_found` / `stale.not_manager` / `stale.not_open` / the service's own refusal), a higher-rank assignee is asked, never given; every change adds a `task.stale_swept` line. Notes: `docs/restructure/pr/W1.9.md`.
- [x] Tasks that came in through the door from another system or an agent (`Task.apiTokenId` is set — an existing
      column, no new one) carry a small «آلي» mark and can be filtered out of people's lists and of the "open tasks per
      person" numbers (D-W4).
      D-W4 is PENDING: built as the recommended default (marked «آلي», counted apart, the filter «الكل · بدون الآلي · الآلي بس» defaults to «الكل»), labelled on screen «بانتظار المالك». `RowTask.automated` draws the mark in `task-row.tsx`.
- [x] Tests: the list respects P0.2 visibility; a bulk action on a task the person cannot edit is refused per task.
      `tests/db/work-stale-sweep.test.ts` (23) and `tests/db/privacy-matrix.test.ts` (+3: the list as one more surface of the owner's table).

Switches (R7): `workMyTasks` (W1.1), `workInbox` (W1.2), `workStages` (W1.3), `workRequests` (W1.4); `workStaleSweep` (W1.9); W1.5–W1.8 ride
on `navV2`. Strings: `src/lib/i18n/ar.work-v2.json`.

## 4. Acceptance

- [ ] A member sees all their tasks from three spaces in one list in one click.
- [ ] A quick task needs only a title (lands in «صندوق المهام», private by default when it has an assignee — P0.2).
- [ ] «الطلبات» shows an assignment request addressed to me and lets me accept it in place.
- [ ] No page reload when adding a board column.
- [ ] `tests/nav-places.test.ts` (navV2) and the guest page tests updated and green; privacy matrix green.
