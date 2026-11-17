# A1 + A2 — Permissions people can understand, and ONE control panel

> Prerequisites: P0 (oversight by capability), N1 (the «الإدارة» place). The security rules stay exactly as they
> are; what changes is how they are SHOWN and EDITED, plus a few real inconsistencies fixed with tests.
> Must stay green throughout (permissions report, 2026-11-16): `tests/nav-places.test.ts`,
> `tests/db/guest-internal-pages.test.ts` and every `tests/db/guest-*.test.ts`, `tests/policy-capabilities.test.ts`,
> `tests/db/capability-guard*`, `active-capabilities`, `section-permissions*` (5 files), `section-grid-switch`,
> `pages-access-capabilities`, `search-capabilities`, `tests/org-members-logic.test.ts`, `tests/db/accounts-*.test.ts`,
> `tests/db/partners.test.ts`, `tests/members-ui-*.test.ts`, `tests/db/members-ui-*`, `spaces-access`, `scoping-*`,
> `teams-scoping`, `space-admin-page`, `tests/workspace-role.test.ts`, the chat privacy tests, `owner-board`,
> `control-panel`, `team-development*`, `owner-assistant*`, `task-assign-rank`, `assign-by-rank`, `co-assignees-by-rank`,
> `tests/active-membership-guard.test.ts`, `pages-access-active`, `pending-pages`, `session-revocation-race`,
> `tests/features.test.ts`, `feature-switches-new`.

## 1. What confuses people today (code at `main@6e21483`)

1. **43 controls per person** (12 switches + a 31-box grid «يشوف / يضيف ويعدّل / يحذف») plus 4 «قريبًا» labels, no
   templates, nothing settable when the account is created (`src/components/members/*`, `src/lib/members-ui.ts:242-278`).
2. **Boxes that mislead**: `announce.send`, `escalation.configure`, `cash.view`, `penalties.view` are checked nowhere today (Q1.6 wires the first,
   Q1.5 the second, I1.3 the third);
   `tasks.delete` looks on for MEMBER/LEAD but the route also needs space ADMIN (`src/app/api/tasks/[id]/route.ts:152`);
   «لوحة الفريق» reads `Team.leadId` that no screen sets; rank hints are wrong (LEAD also gets `prices.view`).
3. **Two definitions of "space manager"**: `isSpaceManager` (OWNER, space ADMIN, or org ADMIN with ANY row —
   `src/server/workspace-role.ts:50-55`) for members, teams, fields, forms…; "space ADMIN row only"
   (`src/server/policy/conversation.ts`) for topics, mute, meetings. An org ADMIN who is a space MEMBER manages the
   space's people but gets 403 on topic settings.
4. **`users.manage` does four jobs**: accounts, the settings tab, the Today team numbers, the guide's audience.
5. **A partner's revoked permission only half works**: capability checks respect it, `isOwner` checks don't (chat —
   fixed in P0.1 —, `policy/board.ts`, `policy/team-development.ts`, `services/features.ts`, `chat/purge.ts`,
   `policy/reward.ts`, `api/workspaces/route.ts` `canCreateSpaces`).
6. **The same thing edited in several places**: `managerId` (people sheet + «الهيكل», with different empty labels);
   space settings in six places (members dialog, `/spaces/current`, «المقاطع» on `/projects`, `/spaces`, topic
   settings, check-in/forms/fields dialogs); the AI connection in two (`/owner/assistant/settings` and «زاكي أي أي»).
7. **One board, five names** («لوحة التحكم/المالك/الفريق/لوحتي/المتابعة»), picked by hidden logic; switching off
   «لوحة المالك» removes every employee's «لوحتي»; «التقارير» hides itself for the owner.
8. **"My team" means three things** (spaces I manage + teams I lead; people under me by `managerId`; every space I can
   open for `users.manage`), so the same KPI shows three different numbers side by side on the owner's Today.
9. **58 company switches in one flat list** in the order they were added, dependencies only in hint texts
   (`src/components/feature-switches.tsx:95-113`).
10. **Settings scattered**: company settings in `/settings` (almost empty for an ADMIN), integrations in `/automation`,
    `/telegram`, `/files`; «كل المساحات» has no menu entry; «ملفي» only reachable from «لوحتي»; two directories titled «الفريق».

## 2. A1 — Permissions

### A1.1 Templates («قوالب») — `feat/permission-templates`
- [ ] Data: `Organization.settings.roleTemplates` (existing JSON column — no migration): `[{ id, name, rank, caps: string[],
      revoked: string[] }]`, ≤ 30. Built-in starters (editable copies, created on first open): «مدير مساحة», «موظف»,
      «مبيعات وتأكيد طلبات», «ميديا باير», «مونتاج وتصميم», «محاسبة», «مشاهدة فقط»; the owner names and edits them.
- [ ] Applying a template to a person writes `capabilities` / `revokedCapabilities` through the existing service
      (`src/server/services/accounts.ts` / `org-members.ts`: same rank rules, nobody grants what they do not hold,
      audited); the person's sheet shows «القالب: X» and «معدّل» when changed by hand afterwards.
- [ ] The create-account sheet gets «القالب» + «المساحات» (today spaces only at creation, rank/caps after).
- [ ] Tests: applying a template cannot give more than the applier holds; a guest template is refused; audit row.

### A1.2 One clear permissions sheet — `feat/permissions-sheet`
- [ ] The person sheet (`src/components/members/member-sheet.tsx`) reorganised in plain words by AREA («المهام
      والمشاريع», «الدردشة والمكالمات», «الملفات», «الزبائن والأسعار», «التقارير واللوحات», «إدارة الناس والمساحات»,
      «التكاملات»), each area a short list of switches with one-line explanations, the grid's three columns kept but
      labelled «يشوف / يضيف ويعدّل / يحذف» per area, collapsed by default.
- [ ] **«شو بيقدر يعمل؟»** — an effective-permissions view: every capability with ✓/✗ and WHY (rank default · added by
      hand · removed by hand · the company switched the feature off · «صلاحيات الأقسام» off). Pure function
      `explainCapabilities(member, settings)` next to `effectiveCapabilities` in `src/server/policy/capabilities.ts`,
      unit-tested against it (both must agree for every rank × switch combination).
- [ ] Hide the capabilities that are still wired to nothing when this step runs (four today; `penalties.view` alone
      once Q1 and I1.3 are in) from the sheet (they stay in the catalogue — R12 in
      `docs/PHASE0-AUDIT.md`); show them again in the phase that wires them.
- [ ] `tasks.delete`: D-A1 — recommended: the route honours the capability for the task's creator and space managers;
      until decided, the box shows «بيحتاج كمان يكون مدير المساحة».
- [ ] Team lead: a «قائد الفرقة» picker in the teams dialog (`src/components/workspace-teams-button.tsx`) writing
      `Team.leadId` through `src/server/services/teams.ts` (API exists).
- [ ] Rank hints rewritten to match `src/server/policy/capabilities.ts` (`src/lib/i18n/ar.members.json` `rank_hint_*`);
      a test compares the hint's claims (a small data table) with the rank defaults.

### A1.3 One meaning per rule — `fix/permission-consistency`
- [ ] **Space manager** (D-A2): recommended ONE definition = OWNER (or partner) OR a space-ADMIN row. An org ADMIN
      manages a space only when made its ADMIN (explicit, visible). Apply in `src/server/workspace-role.ts`
      `isSpaceManager` and keep `src/server/policy/conversation.ts`; update the tests that pin the org-ADMIN-with-a-row
      path (`tests/workspace-role.test.ts`, `tests/db/space-admin-page.test.ts`, `tests/db/chat-admin-scope.test.ts`)
      ONLY after the owner's answer; HQ keeps `alignSpaceRoles` (org ADMIN = HQ space ADMIN).
- [ ] **Partner revocation everywhere** (§1.5): replace each `isOwner` decision by the capability it stands for —
      `policy/board.ts` → `board.team` / `board.self`; `policy/team-development.ts` → `people.review` /
      `people.manage_lines`; `api/workspaces/route.ts` `canCreateSpaces` → `spaces.create`; `policy/reward.ts` → the
      capability of the section it guards. `services/features.ts` (who flips company switches) and `chat/purge.ts`
      («حذف نهائي») stay OWNER rank, unchanged, until D-A4 is answered. One DB test per changed site: revoke → refused.
- [ ] **`users.manage`** = accounts only. Today's team widgets use the same rule as the control panel's team scope (A2.3);
      the guide audience uses an explicit list.
- [ ] **`managerId`** edited in ONE component (`ManagerPicker`) used by the people sheet and «الهيكل»; one empty label
      «بدون مسؤول مباشر»; one service path (`src/server/services/team-lines.ts` delegates to the accounts rule set:
      rank limit applies in both — today «الهيكل» has none; D-A5 confirms).

### A1.4 Company switches, grouped — `feat/features-grouped`
- [ ] `src/lib/features.ts`: add pure metadata `group` (المهام والشغل · المكتبة · الدردشة والمكالمات · الناس · لوحات المالك
      والذكاء · المنصة) and `dependsOn?: FeatureKey[]` for each key; `tests/features.test.ts` checks every key has a group and
      that dependencies exist and are acyclic.
- [ ] `src/components/feature-switches.tsx`: groups with headers, search, each switch with its hint and ⚠️/🔧 where it
      has a risk; a child switch is disabled (with «بيحتاج: …») while its parent is off.
- [ ] Two presets at the top: «الوضع البسيط» (turns OFF these switch keys of `src/lib/features.ts`: `okr`, `checkins`,
      `customFields`, `taskRules`, `taskRewards`, `milestones`, `taskLinks`, `watch`, `whiteboard`, `timeTracking`; goals,
      production, campaigns and CRM are NOT switches — they are permissions, so the preset only hides their tabs through
      N1's company tab settings) and «كل شي» — each a confirmation listing what changes. Nothing is deleted; switching back
      restores.

## 3. A2 — ONE control panel («لوحة التحكم»)

### A2.1 Structure — `feat/control-panel-v2`
`/owner` keeps its address. One page, one name, sections in a side list:

| Section | Content (existing parts moved, not rebuilt) | Who |
|---|---|---|
| «نظرة عامة» | KPIs with an explicit scope chip «كل الشركة / مساحة: X», insights, the day strip | OWNER rank (oversight caps), managers with their scope |
| «الناس» | the activity table (`loadPeopleActivity`), person page `/owner/people/[id]` | same |
| «التقارير» | `/analytics` content (moved; `/analytics` redirects) + the 8-week series + per-space table | `reports.view` |
| «الحسابات والصلاحيات» | the people screen `/members` (A1) | `users.manage` |
| «المساحات» | `/spaces` board (today no menu entry) + each space's ONE settings page (A2.2) | OWNER/ADMIN rank as today |
| «الميزات» | A1.4 | OWNER |
| «التكاملات» | `/automation`, `/telegram`, Google Drive, the API door tokens, backup, mail → task, the AI gateway («زاكي أي أي») — ONE place for the AI connection (merge the two forms onto `AiSettings`) | `integrations.manage` (owner-only parts stay owner-only) |
| «الهيكل والتطوير» | `/structure`, `/development` | as today |
| «الأرشيف والرقابة» | `/archive` + the oversight list | `archive.view` |
| «مساعد المالك» | `/owner/assistant` | OWNER, switch |
| «إعدادات الشركة» | name, time zone, the company menu order (N1 D-N5), «الشغل» pinned tabs, chat settings group (C4 §4) | OWNER |

- A person sees only the sections they may open; the page answers 404 for a section they may not (the existing rule:
  board/panel/development answer 404, never 403). No section changes name by rank.
- «لوحتي» (personal: my numbers + «ملفي») moves to the avatar menu and «اليوم», independent of the owner's board
  switch (today switching off «لوحة المالك» removes every employee's «لوحتي» — D-A6 confirms the split).

### A2.2 One settings page per space — `feat/space-settings`
- [ ] `/spaces/[id]/settings` (and `/spaces/current` redirects): «عام» (name, emoji, description, layout), «الناس»
      (members + roles, the existing members dialog content), «الفرق» («المقاطع» moved from `/projects`), «الدردشة»
      (default topics, who opens topics), «الشغل» (default board columns + stages W1.3, custom field defaults, approval
      forms, check-ins settings), «خطر» (archive, delete — OWNER as today). Existing dialogs become these tabs; the
      buttons on `/projects` link here.

### A2.3 One meaning of "my team" — `fix/team-scope`
- [ ] D-A3 (recommended): **my team = everybody under me in the reporting line (`managerId`, transitive, ACTIVE)**,
      for the panel's people numbers, «الأداء والتطوير» and the Today team card; space managers additionally see the
      SPACE numbers of their spaces under «المساحات». Implement once in a NEW `src/server/policy/people-scope.ts` (not "team-scope": `src/server/services/team-scope.ts` already
      means the «مقاطع» inside a space) and use it in
      `policy/board.ts`, `policy/team-development.ts`, `services/today.ts`, `services/today-dashboard.ts`.
- [ ] Every KPI shows its scope; the owner's Today shows ONE team card (company scope) instead of three. (Seen live on
      2026-11-16: «متأخرة بالشركة 9» and «نبض الفريق … 6 متأخرة» on the same page, and the whole control panel drawn twice —
      on Today and on its own page.)

Switches (R7): `permissionTemplates` (A1.1, A1.2), `controlPanelV2` (A2.1, A2.2); A1.3 and A1.4 are fixes and need none.
Strings: `src/lib/i18n/ar.permissions-v2.json` (A1) and `ar.control-panel-v2.json` (A2). When A1.2 shows the four
capabilities again or I1.3 wires `cash.view`, update `docs/PHASE0-AUDIT.md` R12 in the same PR.

## 4. Acceptance

- [ ] A new employee can be created with a template and spaces in one sheet; «شو بيقدر يعمل؟» shows exactly what the
      server enforces (test).
- [ ] Revoking any capability from a partner takes effect on every surface (tests per surface).
- [ ] One control panel; every old address redirects; no KPI appears twice with different numbers on one screen.
- [ ] All the tests listed at the top stay green (or are changed only with a recorded owner decision in `DECISIONS.md`).
