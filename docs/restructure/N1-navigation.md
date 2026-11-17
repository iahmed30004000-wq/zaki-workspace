# N1 — Navigation and structure: a site people understand («السايت مش مفهوم»)

> Prerequisites: D1. Runs alongside C2 (they share the shell: agree the rail/drawer component first, then split).
> W1 and A1/A2 fill the places this phase draws. Navigation is defined in ONE pure module,
> `src/lib/nav/places.ts`, read by the sidebar, the bottom bar, the tab strip, the palette and the guide; its rules are
> pinned by `tests/nav-places.test.ts` and `tests/db/guest-internal-pages.test.ts` — change them together with the map.

## 1. Why people get lost (from the code at `main@6e21483`)

| # | Problem | Where |
|---|---|---|
| 1 | **The chat list is scoped to the current space** — even private chats (`/api/chat/home` → `chatHome(ctx, { spaceId })`, `listDms(ctx, spaceId)`). To see another space's messages you switch the whole app. | `src/app/api/chat/home/route.ts`, `src/server/chat/home.ts` |
| 2 | **The current space is invisible and silently changes**: a cookie (`zk-space`); opening a task/board/topic of another space switches the whole app; on the phone the switcher exists only inside «الشغل»'s tab strip. | `src/server/services/current-space.ts`, `src/components/app-shell.tsx` |
| 3 | **The default space «الشركة» cannot hold projects** → a newcomer's «المشاريع/القائمة/التقويم» start empty. | `current-space.ts:72-79`, `src/app/api/projects/route.ts:61-64` |
| 4 | **13 tabs under «الشغل»** for a plain member, in one sideways strip, plus inner tabs. | `src/lib/nav/places.ts`, `tests/nav-places.test.ts` |
| 5 | **Some things are per space, some company-wide**, with no sign which (tickets, campaigns, departments have no space). | schema `Ticket`, `Campaign`, `Department` |
| 6 | **One word, many meanings**: «اللوحات» (card spaces / project boards / dashboards); «الفريق» (directory / «المقاطع» / «لوحة الفريق»); «اليوم» (a place and a tab); «شريك» (external guest and co-owner); «مشرف» vs «مدير». | `src/lib/i18n/ar*.json` |
| 7 | **The same menu slot has four names** («لوحة التحكم/المالك/الفريق/لوحتي») and tabs hide themselves by rank/switch logic (`labelFor`, `hideFor`, `singleTabTakesLabel`). | `places.ts` |
| 8 | **No breadcrumbs, no way back**: board → task leaves the board; project views (board, list, calendar, timeline) live in different places. | `board-view.tsx`, `task-detail.tsx` |
| 9 | **Offered then refused**: «الأقسام/التذاكر/الحملات» tabs without `directory.view` open pages that refuse; «جديد → مهمة» in a card space loses the intent. | `places.ts:181-184`, `new-actions.ts:57` |
| 10 | **Everyone may reorder their own menu** («ترتيب»), so no two menus look alike and the guide cannot point anywhere. | `app-shell.tsx:93-124` |

## 2. The new map

```
COMPUTER                                     PHONE (Telegram Android)
┌ rail (64 px, icons + small labels) ┐       ☰ drawer (header = me + spaces switcher)
│  [logo]                            │         الدردشة   (the app opens here)
│  الدردشة   (badge)                 │         اليوم
│  اليوم                             │         الشغل
│  الشغل     (badge: overdue)        │         المكتبة
│  المكتبة                           │         نتفرّج سوا   (switch)
│  نتفرّج سوا (switch)               │         الإدارة / الناس
│  الإدارة   (or «الناس»)            │         الإعدادات · دليل زاكي
│  ⋯                                 │
│  [space switcher]  [avatar]        │
└────────────────────────────────────┘
```

**Places and their tabs (max 4 tabs each; more lives in «المزيد»):**

| Place | Tabs | Notes |
|---|---|---|
| «الدردشة» | none (folders inside) | **D-N2 decides between two shapes (both built in C1, switch `chatOneList`).** (a) Recommended — ONE list like the team's Telegram: every space as a forum row and every private chat; opening a topic no longer switches the app's space. Because DMs belong to a space (the owner's decision of 2026-10-25, `src/server/chat/dm.ts`: one DM per pair per space), the same person can appear once per space: each such row carries a small space chip; «رسالة جديدة» opens the DM in the current space, as today. (b) Keep "each space is like a separate account" (the 2026-10-25 decision, which is Telegram's multi-account model): the list stays per space, and the space switcher shows every space's unread count like Telegram's account list. Never reverse the 2026-10-25 decision without the owner's answer. |
| «اليوم» | none | Personal: my tasks today/overdue, mentions, things waiting for my decision (approvals, assignment requests), reminders, check-in, digest; managers get ONE team card (one scope, see A2). |
| «الشغل» | «مهامي» · «المشاريع» · «الطلبات» · «المزيد» | W1 builds them. «مهامي» = one screen with view (قائمة / لوحة / تقويم) and scope (أنا / المساحة / مشروع) switches, across ALL my spaces by default with a space filter chip. «الطلبات» = approvals + assignment requests + my department tickets. «المزيد» = the optional tools (الأهداف، الأفكار، الروتين اليومي، الأقسام، التذاكر، الحملات، العملاء، التسجيل اليومي), each behind its switch; the owner may pin up to 2 of them as tabs for the company (`Organization.settings.workTabs`). |
| «المكتبة» | «الملفات» · «المستندات» · «المنتجات» | «المنتجات» is Q1's product sheets (staff only, switch `knowledgeCards`); the owner may pin it as its own place for the sales team (A2 «القائمة»). |
| «نتفرّج سوا» | none | unchanged rules (owner's decision 2026-10-26). |
| «الإدارة» | one «لوحة التحكم» with sections (A2) | For staff with no admin power the place is called «الناس» and opens the directory + «لوحتي». No `labelFor` games: each section has ONE name. |

**Spaces, made visible (D-N3):**
- The current space is always shown: rail bottom (computer) and drawer header (phone), with each space's unread
  count and overdue count, like Telegram's account switcher.
- Opening something of another space (a task link, a notification) shows a one-line banner «هاد من مساحة «X» —
  [انتقل لها]» instead of switching silently (keep `keepInSpace` behind the banner's button; the chat never needs it
  after D-N2).
- «الشركة» (HQ) stays without projects — the owner's decision of 2026-10-25 (`src/app/api/projects/route.ts`: "a
  project there would be seen by everybody"). D-N3 (recommended): the work tabs open in the person's first STANDARD space
  that has projects; «مهامي» spans all spaces (W1.1) so it is never empty when the person has tasks; a newcomer with no
  such space sees an empty state «لسا ما إلك مساحة شغل — اطلب من مديرك يضيفك» instead of empty lists.

**Names (one meaning each) — a glossary added to `src/lib/i18n/ar.json` comments and the guide:**

| Concept | One name | Retired uses |
|---|---|---|
| a project's kanban | «لوحة المشروع» | «اللوحات» only for card spaces' place («اللوحات») |
| dashboards | «لوحة التحكم» (owner/admin), «لوحتي» (personal) | «لوحة المالك», «لوحة الفريق», «لوحة المتابعة» → sections of «لوحة التحكم» |
| people directory | «الناس» | «الفريق» as a tab name |
| `Team` model | «المقاطع» → rename on screen to «الفرق» (D-N4) | — |
| external guest | «ضيف خارجي» | «شريك خارجي» |
| co-owner | «شريك» | — |
| org ADMIN rank | «مشرف عام» | — |
| space ADMIN | «مدير المساحة» | «مدير» alone |
| LEAD rank | «قائد فريق» | — |
| `/production` | «الروتين اليومي» | — |

**Menu order:** fixed by the company (the owner may reorder for everybody in A2 → «القائمة»); a person may hide
optional places for themselves but not reorder (D-N5) — so the guide, screenshots and colleagues all see the same
menu. The per-person «ترتيب» is not removed: while the company order is set, its screen shows ⚠️ «الترتيب صار للشركة
كلها» with 🔧 «اطلب من المدير يغيّره» (marked ON SCREEN, AGENTS.md), and `User.navOrder` stays stored and is used again
if the owner switches the company order off.

**Breadcrumbs everywhere below a place:** `المساحة › المشروع › اللوحة › المهمة`, clickable; the task opens as a side
panel over the board/list (URL `/tasks/[id]` still a page when opened directly), Esc returns.

**«جديد»:** stays one menu (`newActionsFor()`); on the phone it is the FAB of the current place (chat → «رسالة»,
work → «مهمة»). A card space keeps the `?new=` intent through the redirect (fix the `/` → `/cards` drop).

## 3. Implementation steps

- [ ] N1.1 `src/lib/nav/places.ts`: new map (above) behind the switch `navV2` (default ON after the owner's check); the
      old map stays as `PLACES_V1` for the switch-off path and its tests (both pinned). Rewrite `tests/nav-places.test.ts`
      expectations for `navV2` rank by rank (keep the V1 suite), and extend `tests/db/guest-internal-pages.test.ts` to the
      new tab keys (a tab not offered to guests must still refuse them).
- [ ] N1.2 Shell: `src/components/shell/sidebar.tsx` → `rail.tsx` (computer); `bottom-nav.tsx` → `drawer.tsx` (phone,
      the bottom bar kept behind `navV2` OFF); `top-bar.tsx` → per-place app bar (title, search, actions); space switcher
      moved to rail/drawer; `place-tabs.tsx` max 4 tabs + «المزيد» menu.
- [ ] N1.3 Visible space: the switcher in rail/drawer with counts; a banner instead of silent switching
      (`current-space.ts` `keepInSpace` called from the banner's button). Whether the chat list is one list or per space
      is D-N2 (C1's `GET /api/chat/list` serves both).
- [ ] N1.4 Glossary renames in the `ar*.json` fragments (no key in two files; `tests/encoding-hygiene.test.ts`).
- [ ] N1.5 Breadcrumb component `src/components/shell/breadcrumbs.tsx` used by project, board, list, timeline, task.
- [ ] N1.6 Guide tours (`src/lib/guide/tours.ts`) rewritten for the new map + a «الشغل» tour.
- [ ] N1.7 `LEGACY_ROUTES`: every old address still a page (redirects where a page moved, e.g. `/list` →
      `/my-work?view=list&scope=space` once W1.1 lands).
- [ ] N1.8 The landing page (D-N1): a company setting `Organization.settings.landing` («الدردشة» recommended / «اليوم»)
      read by `src/app/(app)/page.tsx` (redirect to `/chat` when «الدردشة», keeping `/` reachable as «اليوم» from the menu)
      and by the manifest's `start_url` (M1a). Strings in `src/lib/i18n/ar.nav-v2.json` (all N1 strings).

## 4. Acceptance

- [ ] A new member's first day (manual script in the PR): sign in → sees all chats in one list (with D-N2 = one list) → opens a topic of
      another space without the app changing space → «الشغل › مهامي» shows tasks from all spaces → creates a task in ≤ 3
      clicks → finds it on the project board through the breadcrumb.
- [ ] Every tab offered is a page that serves that person (test: render every offered tab per rank — no refusal).
- [ ] The same menu for two members of the same rank (test).
