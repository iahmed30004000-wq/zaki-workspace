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
- [ ] `src/app/(app)/my-work/page.tsx` becomes the unified screen; `/list` and `/calendar` redirect to it with
      `?view=list|calendar&scope=space` (old addresses keep working — `LEGACY_ROUTES` test).
- [ ] Scope «أنا» = assigned to me or co-assigned, across ALL my ACTIVE spaces (`accessibleWorkspaceIds`), with a
      space filter chip row; «المساحة» = the current space's visible tasks (P0.2 rule); «مشروع» = a picker.
- [ ] Quick filters (chips): اليوم · متأخرة · هالأسبوع · بدون موعد · مكتملة · أنشأتها; sort; group by stage / project /
      person / due date. The six old inner tabs map onto these chips (keep their URLs: `?tab=today` → chip «اليوم»).
- [ ] View «لوحة» groups by **stage** (W1.3), across projects.
- [ ] Data: `queryTasksForView` (`src/server/services/views.ts`) extended with `scope` and `stage`; all reads use
      `taskVisibleWhere` (P0.2). Client: TanStack Query, optimistic updates for complete / move / due date.
- [ ] Rows use D1's `list-row`; the task opens in a side panel (URL `?task=<id>`), `/tasks/[id]` stays a full page.

### W1.2 Tasks without the project hunt — `feat/work-inbox-project`
- [ ] The per-space hidden «مهام فورية» project becomes a visible, named **«صندوق المهام»** (same `systemKey`, same
      service `instant-work.ts`): shown pinned on top of «المشاريع» with its own icon (not as an ordinary card); a quick
      task from anywhere (Today, chat «اعمل مهمة» without a chosen project, «جديد») lands there in «للتنفيذ».
- [ ] «الشركة» (HQ) gets none — it holds no projects by the owner's decision of 2026-10-25 (N1 D-N3). A quick task made
      while the person is in «الشركة» lands in the «صندوق المهام» of their first STANDARD space; with no such space the
      quick add explains why («لسا ما إلك مساحة شغل»).
- [ ] Fix Today's quick add to use it instead of "the first project with a board".

### W1.3 A normalized stage — `feat/work-stage`
- [ ] Migration (additive): `BoardColumn.stage TEXT NOT NULL DEFAULT 'DOING'` (TODO | DOING | REVIEW | DONE);
      a separate data migration: `UPDATE "BoardColumn" SET stage = 'DONE' WHERE done = true;` then `UPDATE "BoardColumn" c
      SET stage = 'TODO' WHERE c.done = false AND c.position = (SELECT min(position) FROM "BoardColumn" x WHERE x."boardId"
      = c."boardId");` (both with WHERE, repeatable; ties on position: the smallest id).
- [ ] Column settings let a manager choose the stage; new boards' default columns get TODO/DOING/DONE.
- [ ] Cross-project lists group and filter by stage; `columnLabel()` still shows each board's own column name.

### W1.4 «الطلبات» — `feat/work-requests-inbox`
- [ ] One screen, two tabs «بانتظاري / طلباتي», sections: approvals (`ApprovalRequest` steps where I am the approver —
      existing `/approvals` lists), task assignment requests (`TaskAssignRequest` addressed to me — today it has NO inbox
      list), open tickets of my departments (`Ticket`), card approvals waiting for me (Card status REVIEW where I decide).
      Each row acts in place (accept / return with reason / approve / reject) through the EXISTING services.
- [ ] Badge on «الشغل» = count of «بانتظاري».
- [ ] `/approvals` keeps its pages (forms, detail); «الطلبات» links into them.

### W1.5 The project page — `feat/work-project-page`
- [ ] `src/app/(app)/projects/[id]/page.tsx` gets tabs: «اللوحة» (default; the board picker when there are several),
      «القائمة», «التقويم», «الجدول الزمني» (existing timeline), «الحقول والقواعد» (custom fields, rules, milestones —
      today cards on the page), «الإعدادات».
- [ ] Breadcrumbs (N1) on every project view and on the task.
- [ ] Board: the three `window.location.reload()` replaced (column add/delete and the third one at line 187) (TanStack mutation + `invalidateQueries`), optimistic card moves (keep
      the restore-on-failure behaviour).

### W1.6 Duplicates marked, with a way out — `feat/work-duplicates-marked`
- [ ] «الروتين اليومي» (Routine): a ⚠️ banner «هاد مكرّر مع المهام المتكررة» + 🔧 «حوّل الروتين لمهام متكررة»: ONE
      routine becomes ONE recurring task (`Routine` has no items): a template task titled like the routine, assigned to the
      routine's assignee, in the «صندوق المهام» (W1.2) of the routine's space (a routine with no space: the assignee's
      first STANDARD space), with a `TaskRecurrence` on the routine's weekdays through the existing recurrence service;
      the routine is archived, never deleted, and its logs stay readable.
- [ ] Campaign items: additive `CampaignItem.taskId String?` + «اعمل منه مهمة» (createTask, link both ways).
- [ ] Tickets: additive `Task.sourceTicketId String?` + «حوّل لمهمة» on a ticket; the ticket shows the linked task.
- [ ] Card → task already exists; store the link (`Task.sourceCardId String?`, additive) instead of only in the audit log
      (`src/server/services/card-links.ts`).
- [ ] D-W2 (owner, later): whether Ticket / CampaignItem / Routine are folded into Task types for good (a data-move plan
      with copies, never a drop). Not in this plan's scope.

### W1.7 Today, simplified — `feat/today-simple`
- [ ] Up to six cards, in this order: «مهامي اليوم» (today + overdue, quick add) · «بانتظار قرارك» (W1.4 count + top 5) ·
      «ذكروك» (unread mentions, links into chat) · «تذكيراتي» · «التسجيل اليومي» (switch) · ONE team card for managers
      (A2 defines its scope). The rest (TeamPulse, dashboard team card, digest, time) move to «لوحة التحكم» or «اليوم ›
      المزيد». The «اليوم» strip (decoration) follows D1.

### W1.8 Make the tabs honest — `fix/work-tabs-honest`
- [ ] Every tab's `requires` in `places.ts` equals its page's rule (departments / tickets / campaigns need
      `directory.view` → either require it in the tab or relax the pages for staff — D-W3, recommended: relax the pages
      for staff, the department data is not secret inside the company).
- [ ] «جديد → مهمة» in a card space keeps the intent (open the task sheet on `/cards`).
- [ ] Search palette also finds boards, ideas, tickets, customers (with their own access rules — `crm.view` for customers).

### W1.9 Old tasks nobody touches — `feat/work-stale-sweep`
Seen live on 2026-11-16: 262 open tasks; 196 of them on ONE account; 42 with nobody assigned; 183 not touched for 14
days or more; the hidden «مهام فورية» project listed as an ordinary project card; Today and the control panel showing
the same panel, with two different "overdue" numbers on one page (9 and 6).
- [ ] A review list «مهام قديمة» for space managers and the owner: open tasks untouched for N days (default 14), grouped
      by person and project, with bulk actions through the existing services (`updateTask`, `moveTask`): «سكّريها»,
      «عيّني مسؤول», «أجّليها لتاريخ», «أرشفيها» (the existing `Task.archived` flag — nothing is deleted). Every action is a
      `TaskActivity` line.
- [ ] Tasks that came in through the door from another system or an agent (`Task.apiTokenId` is set — an existing
      column, no new one) carry a small «آلي» mark and can be filtered out of people's lists and of the "open tasks per
      person" numbers (D-W4).
- [ ] Tests: the list respects P0.2 visibility; a bulk action on a task the person cannot edit is refused per task.

Switches (R7): `workMyTasks` (W1.1), `workInbox` (W1.2), `workStages` (W1.3), `workRequests` (W1.4); `workStaleSweep` (W1.9); W1.5–W1.8 ride
on `navV2`. Strings: `src/lib/i18n/ar.work-v2.json`.

## 4. Acceptance

- [ ] A member sees all their tasks from three spaces in one list in one click.
- [ ] A quick task needs only a title (lands in «صندوق المهام», private by default when it has an assignee — P0.2).
- [ ] «الطلبات» shows an assignment request addressed to me and lets me accept it in place.
- [ ] No page reload when adding a board column.
- [ ] `tests/nav-places.test.ts` (navV2) and the guest page tests updated and green; privacy matrix green.
