# 00 — What was found (2026-11-16, code at `main@6e21483`)

> The diagnosis behind the plan, in one page. Details, file references and fixes are in each phase file.
> Sources: a full read of the chat code, the policy layer and the realtime layer by the planner; three read-only code
> surveys (work area & navigation, permissions & panels, platform & performance) and an independent review of the plan;
> a read-only visit of the live site and of the orders system's product screen, signed in as the account the owner
> tests with; the owner's screenshots; an export of one of the team's Telegram groups (`T1-team-work-analysis.md`); the
> orders system's repository (read-only). No name, number or message text from the site or the export is in this folder.

## Confirmed defects (fix first)

| Severity | Defect | Phase |
|---|---|---|
| 🔴 privacy | About half of the company's accounts hold the OWNER rank; each of them reads every private topic, DM and task silently — the testing account included — and the people screen has no switch to take that reading away from a partner. | P0.0 (owner action), P0.1 |
| 🔴 privacy | A partner whose «الأرشيف والرقابة» was revoked still reads every DM and private topic (rank-based `canRead`, home, unread, search). | P0.1 |
| 🔴 privacy | Tasks have no visibility of their own: a task assigned to one person is visible to the whole space (boards, lists, calendar, Today, search, digest, API). | P0.2 |
| 🔴 privacy | A task made from a private topic or a DM lands in the open space. | P0.3 |
| 🔴 security | The Android signing passwords are written in a public file (`android/app/build.gradle`). | P0.6 |
| 🔴 security | Owner-rank accounts must not stay on the temporary password they were created with (the people screen marks them). | P0.0 (owner action) |
| 🟠 reliability | The realtime listener replays the whole event table on boot and re-delivers every event since boot after a reconnect; streams wait for that replay after each deploy. | F0.1 |
| 🟠 reliability | Evicted / signed-out streams are never closed; heartbeats are invisible to the browser; call/whiteboard/watch events lose their kind on replay; background tabs mark messages read. | F0.2–F0.5 |
| 🟠 function | A conversation only ever shows its newest 40 messages (no scrolling back). | C1.6 |
| 🟠 function | The chat list (even private chats) is scoped to the current space: the visit showed 1 of the account's 7 spaces. | N1 / C1.2 (D-N2) |
| 🟡 cost | One message in a topic with 10 viewers ≈ 800 database calls (full refetch on every event). | C1 |

## The live visit (2026-11-16, read-only)

| Seen | Meaning | Phase |
|---|---|---|
| About half of the accounts hold the OWNER rank; no permission was ever added or removed for anybody | "there is no privacy" is true for half the company by design | P0.0, P0.1, A1.1 |
| Every conversation opens with «عين المالك: قراءة صامتة» for the testing account; its space's one private topic is listed | the tester is an overseer; test with a plain member account | P0.0, P0.4 |
| Chat list ≈ 170 ms, one conversation ≈ 175 ms, unread ≈ 125 ms from the browser | the server is fast at today's size; the slowness is the page pattern | C1, F1 |
| The chat list is one centred card on a wide empty screen; a conversation is a column one third of the screen wide | the layout is the gap to Telegram, not the features | C2 |
| A dozen «بلّش مكالمة» / «خلصت المكالمة» lines in a row; an assistant answer showing raw math markup; a missing profile picture drawn as a broken image on every page | small things that make it feel unfinished | C2, C3b.1, D1 |
| «الشغل» shows 13 tabs; «مهامي» opens empty; «مهام فورية» is listed as an ordinary project | as the code survey said | W1, N1 |
| 262 open tasks: 196 on one account, 42 with nobody assigned, 183 untouched for 14+ days | the task list is full of old and machine-made tasks | W1.9 |
| Today and the control panel draw the same panel; "overdue" reads 9 in one card and 6 in another on the same page | one number, two answers | A2.3, W1.7 |
| «الإدارة» shows 10 tabs; the settings page is 6 450 px tall with 59 switches (51 on) | as the code survey said | A1.4, A2.1 |
| The orders system: 9 categories (one is clothing), 44 active products — 33 without a photo, 2 without a category, none with its category's questions answered, 26 with offers | product knowledge lives nowhere structured; prices and categories do | Q1.0, Q1.1 |
| The first automated visit to `/chat` hung for > 45 s; the second loaded normally | not reproduced — not counted as a defect | F1 #11 |

## Chat vs Telegram

The chat already has many strong pieces (topics, DMs, reactions, replies, forward, pin, polls, voice notes with
waveform and transcript, translation, image text, notes, reminders, message → task/ticket, whiteboard, watch-together,
calls on its own server, offline outbox, read ticks, typing, presence, owner archive). What makes it not feel like
Telegram: a page of cards instead of a persistent list + conversation; navigating away to open a chat; no history; no
cache (every open is cold); full refetch on every event; no folders, archive, saved messages, personal pins, mark
unread; no formatting, link previews, albums, media viewer, emoji picker, paste/drop, multi-select, scheduled/silent
sends; settings scattered; the phone app polls every 5–15 s. → `telegram-parity.md`, C1–C4, M1.

## The team's daily work

`T1-team-work-analysis.md` (one Telegram group, one week, counts only): prices live in chat posts that replace each
other (22 price-carrying posts, 3 corrections); 26 instruction posts, 5 acknowledged; 72% of messages in two catch-all
topics while every problem topic is empty; 33 questions, 18 with no reply attached; 105 messages carrying a customer's
phone number and 37 orders typed by hand; no organised product knowledge or customer feedback; a report bot that fails
on a sign-in screen. → Q1 (product sheets, quick recall, feedback pictures, automatic tickets, must-read), I1.1.

## Work («الشغل»)

13 tabs; «مهامي» per space only; a task needs a project + board + column (so a hidden instant project and five
parallel to-do tables exist: tickets, campaign items, routines, task-less reminders, development goals); no status
field (lists repeat statuses per board); comments ×4, approvals ×4, repetition ×3; project views scattered; no
breadcrumbs; tabs offered then refused; old and machine-made tasks crowd the lists. → W1.

## Navigation and look

The current space is invisible and changes silently; «الشركة» cannot hold projects; one word means several things
(«اللوحات», «الفريق», «شريك», «اليوم»); one menu slot has four names; everybody reorders their own menu; decoration
and cards everywhere; a pink «جديد» pill. → N1, D1.

## Permissions and panels

43 controls per person, no templates; four capabilities wired to nothing (Q1 wires two of them, I1.3 a third); misleading boxes (`tasks.delete`); two
definitions of "space manager"; `users.manage` doing four jobs; a partner's revocation half-working; `managerId` and
space settings edited in several places; one board with five names; "my team" with three meanings; 58 flat company
switches; settings scattered over `/settings`, `/automation`, `/telegram`, `/files`. → A1, A2.

## Fit to the systems around it

The orders system already offers a door for products with live prices, an order's state with no customer data, notes
on an order, and signed order events — and says itself that no other system may keep a price list. It also already
flags a duplicate order and a suspect number, lists postponed orders, and reads a pasted order text: three things the
team still does by hand in chat. The Workspace uses
none of it today. Money (boxes, office expenses) is discussed in chat and belongs in approvals. → Q1.0, I1.

## Platform speed

Layout ≈ 8 sequential calls with duplicates and no `cache()`; LiveKit on every page; 69 `router.refresh()`; polling
everywhere; jobs share the web process; no app-shell caching in the service worker. → F1, M1a.
