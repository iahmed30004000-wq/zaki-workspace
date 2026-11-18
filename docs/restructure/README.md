# Zaki Workspace — the restructure plan (2026-11-16)

> **For the builder (Claude Sonnet 5.5, or any agent).** This folder is the complete plan written from a full review
> of the code at `main@6e21483`, checked by an independent review. It tells you WHAT to build, in WHICH order, WHERE in
> the code, and HOW to prove it. It does not contain the code. `AGENTS.md` (the repository's rules file) always wins
> over this plan; if they disagree, follow `AGENTS.md` and tell the owner.
>
> **The owner's goals, in his words (2026-11-16):** the chat becomes «شبه التليجرام 100٪ بالشكل والسلاسة وقوة الاتصال
> وسرعة الأداء والإعدادات» without losing any feature Zaki has and Telegram doesn't, adding what is missing; the phone
> app installed from Chrome looks like Telegram «بنسبة 100٪» with Zaki's identity; «الشغل», «الصلاحيات» and «لوحات
> التحكم» restructured — «السايت مش مفهوم»; real isolation — «لو أعطيت مهام لموظف بتظهر عند الجميع، والمواضيع حتى لو
> حطيت خصوصية ما في خصوصية»; a new look and new buttons; a checklist («خانة شيك ليست»); quick recall of product specs and
> customer reviews, and problems that become tickets by themselves; «فعّال 100٪، أكفأ، أعمَلي، ويناسب شغلنا».

## Files

| File | What it is |
|---|---|
| `BUILD-PROMPTS.md` | **the builder reads this at the start of every session**: what the owner pastes, the session protocol, the branch rule, decisions, STOP conditions, the report |
| `BUILD-STEPS.md` | one card per step, in order: branch, order of work, what proves it, the traps, the owner's check lists |
| `mockup/index.html` | the preview the owner approved on 2026-11-16: the LOOK only, invented data, not code to copy; a phase file wins over it |
| `00-findings.md` | the diagnosis in one page (confirmed defects first, then what the live visit showed) |
| `COVERAGE.md` | every request of the owner → the step that answers it (read it before starting; keep it true) |
| `T1-team-work-analysis.md` | how the team works today (one Telegram group, one week, counts only), 14 problems → fix → step; what the orders system already offers |
| `DECISIONS.md` | the owner's decisions, with the recommended default to build while waiting |
| `telegram-parity.md` | feature-by-feature: what Zaki has, changes, adds, keeps (ours), or declines |
| `P0-privacy.md` | **first**: privacy & security fixes (oversight by capability, private tasks, private chat → private work, visible privacy, privacy test matrix, Android signing secret) |
| `F0-connection-hotfixes.md` | the live line made reliable on today's screens |
| `D1-design-system.md` | the new look: two themes, chat tokens, typography, the button set, primitives, wallpapers |
| `C1-chat-engine.md` | chat data: cache, delta sync, history, virtualization, optimistic send, fast endpoints |
| `F1-platform-speed.md` | the whole site fast (layout, bundles, polling, jobs) |
| `N1-navigation.md` | the new map: rail (computer) / drawer (phone), max 4 tabs, visible space, one name per thing, landing page |
| `C2-chat-ui.md` | the Telegram-layout chat screen (computer + phone) |
| `C3-chat-features.md` | folders, archive, saved messages, pins, formatting, link previews, albums, media viewer, multi-select, **checklists**, scheduled & silent sends, channels, info-panel tabs, search |
| `C4-settings.md` | «إعداداتي» shaped like Telegram's settings |
| `M1-mobile-app.md` | the installed app (Chrome) and the Android app, Telegram-Android shaped |
| `W1-work.md` | «الشغل»: one «مهامي», «صندوق المهام», stages, «الطلبات», project page, duplicates marked |
| `A1-permissions-and-panels.md` | templates, one clear permissions sheet, consistency fixes, grouped switches, ONE control panel, one meaning of "my team" |
| `I1-integrations-and-fit.md` | bot cards from the OMS / media buyer, space templates like the Telegram groups, expenses through approvals, optional decisions log and Telegram bridge |
| `Q1-quick-recall-and-auto-tickets.md` | the link to the orders system; interactive product sheets by category with copy buttons; photos and feedback pictures (copy, download, share, merge into one); «/» recall in the composer; an order's state; problems become tickets; «لازم ينقرأ»; customer data hints |
| (not in this folder) | the owner's summary in Levantine Arabic (Word + a phone-sized PDF) is handed to him directly and kept OUT of git: it carries what was seen on the live site. Rebuild it for him when a decision changes the plan. |

## Order (one builder, one step at a time)

```
P0 ─► F0 ─► Q1 ─► D1 ─► C1 ─► F1 ─► N1 ─► C2 ─► C3a ─► C3b ─► C3c ─► C3d ─► C4 ─► M1 ─► W1 ─► A1 ─► A2 ─► I1
✋P0       ✋Q1                    ✋N1         ✋C2                                  ✋M1    ✋W1          ✋A2
```

- ✋ = owner check: it gates SWITCHING THE PHASE ON — finish the phase, run the independent
  review, send him the check list of that ✋ (`BUILD-STEPS.md`), leave the phase's switches OFF until «شيك», and go on
  building the next phase (AGENTS.md: phases run back to back). P0 has no switch: it is merged and deployed when CI
  is green and the owner says so, and ✋P0 is its live check after that.
- Q1 comes right after the urgent fixes because it is what the team uses all day (product sheets, automatic tickets,
  «/» recall) and it runs on TODAY's chat screen; C2 later restyles it. What waits for the orders system's small additions (the ONE ordered prompt of Q1.0): reading an order by its NUMBER,
  writing a note on it, the category and photos coming by themselves, the gift units and the delivery line of an offer,
  and the copied contract example. Each has a stated fallback until then.
- With two builders at once (never on the same files): Track A = Q1 → C1 → C2 → C3 → C4 → M1; Track B = D1 → N1 → W1 →
  A1 → A2. F1 fits in either track's gaps. I1.1 can run right after Q1 (it reuses Q1.0 and the CARD message); I1.2 any time;
  I1.3 needs W1.4. D1 and N1
  must be merged before C2's phone screens.

## Rules for every step (on top of `AGENTS.md`)

- **R1** One step = one branch. While the owner has not said «ارفع», the branches form ONE straight stack: a step
  branch starts from the last finished step branch (`BUILD-PROMPTS.md` §4); once everything is merged it starts from
  an up-to-date `main`. Prepare the PR description with its Definition of Done first
  (what must work · the tests · the edge cases · the blockers) and "noticed, not fixed". **Pushing the branch and opening
  the PR happen only when the owner says so** (AGENTS.md: nothing leaves the machine until he says so). One agent per
  branch.
- **R2** Test first: every behaviour change ships a test that FAILS before the change and passes after; paste the red
  run in the PR description. Authorization rules are proven in `tests/db/` against a real database.
- **R3** Gates before every commit: `npm run typecheck`, `npm run lint`, `npm test`, `node scripts/lint-migrations.mjs`,
  `npm run test:db`, `npm run scan:secrets`, `npm run build`. CI is the judge; red is never merged.
- **R4** Migrations additive only; structure and data moves are separate migrations; a new enum value is its own
  migration (prefer TEXT columns validated by zod); never edit a released folder; never accept a database reset.
  🔧 Before the FIRST new migration of this plan (P0.2), the owner runs the read-only `npx prisma migrate status` from
  the app container and sends the output (AGENTS.md «Migrations»).
- **R5** Arabic only on screen, through `t()`, Western digits 0-9 in every string (`tests/arabic-ui.test.ts`); Latin
  only what the two allow-lists of that test already hold (`LATIN_IN_DICTIONARY` for dictionary strings,
  `LATIN_ON_SCREEN` for text written in a screen file: brand and provider names, «Ctrl», «Esc») — write other keys in
  Arabic letters and never extend either list without the owner.
  Strings per phase: P0 `ar.task-privacy.json` · D1 `ar.design-v2.json` · N1 `ar.nav-v2.json` · C2 `ar.chat-ui.json` ·
  C3 `ar.chat-features.json` · C4 `ar.settings-me.json` · M1 `ar.mobile.json` · W1 `ar.work-v2.json` · A1
  `ar.permissions-v2.json` · A2 `ar.control-panel-v2.json` · I1 `ar.integrations-fit.json` · Q1 `ar.quick-recall.json`
  (F0/F1/C1 add strings only for errors: put them in the fragment of the feature they belong to). No key in two files.
- **R6** Colours only from theme tokens; no hex, no raw Tailwind palette (D1 adds the chat tokens).
- **R7** Never remove a feature: new behaviour goes behind a feature switch (key in `FEATURES` + default in
  `src/lib/features.ts`, its Arabic name and hint in `src/lib/i18n/ar.features.json`, `tests/features.test.ts`), the old
  path keeps working, and the old thing is marked ⚠️ + 🔧 ON SCREEN until the owner says to remove it.
- **R8** The server decides access, through `src/server/policy/*`, `src/server/services/team-scope.ts` and the existing
  guards; no route compares a role name. `tests/db/privacy-matrix.test.ts` (built in P0.5) is a required check: every new
  read path adds its rows.
- **R9** Extend, never rebuild: search for the existing service/table first (each phase file names them). A new table
  must say in its PR why no existing table holds it.
- **R10** Next.js 14.2 only (no async `params`, no `after()`, no `unstable_*` of 15/16).
- **R11** No new dependency unless an installed one cannot do it — installed and unused today:
  `@tanstack/react-virtual`, `frimousse`, `emojibase-data`; installed and used: `@tanstack/react-query`, `lucide-react`,
  `@dnd-kit/*`, `livekit-client`. Say why in the PR when adding one.
- **R12** Other systems (OMS `zaki-ai-OSM`, `zaki-mediabuyer`, n8n): never edit them from here; write one ordered prompt
  per repo in the PR.
- **R13** Never write a secret anywhere (PR text, docs, logs, commits) — including the Android passwords of P0.6. Never
  copy customer data (names, phones, addresses) into code, tests, docs or commits — the repository is public. The same
  for what the live site shows: which account has which rank or password state, private addresses of other systems,
  staff names. Such things go to the owner in his own summary, never into a tracked file.
- **R14** Stop and ask the owner when: a test that pins a security/privacy rule must change; a step needs an answer
  from `DECISIONS.md` beyond its default; an earlier owner decision would be reversed; a migration would need
  `ALLOWED_DESTRUCTIVE.txt`; anything could expose customer data or prices.
- **R15** Report to the owner in Levantine Arabic, with no English word, results only; risks as ⚠️ with the fix 🔧
  under it. Written deliverables for him: Word + PDF.
- **R16** When a step closes an item of `docs/PHASE0-AUDIT.md` (R11 sessions, R12 capabilities wired to nothing, R13
  escalation), update that row in the same branch.

## Feature switches this plan adds, and the order they are turned on

| Switch | Phase | Default when merged | Turned on for everybody by |
|---|---|---|---|
| `taskPrivacy` | P0.2 | ON (offers the control; the read filter always applies) | merge |
| `themeV2Default` | D1 | OFF | the owner, after the gallery review |
| `chatOneList` | C1.2 | per D-N2 | the owner's answer to D-N2 |
| `navV2` | N1 | OFF | the owner, after ✋N1 |
| `chatLayoutV2` | C2 | OFF | the owner, after ✋C2 |
| C3 switches (`chatPersonalState`, `chatFolders`, `savedMessages`, `chatFormatting`, `linkPreviews`, `chatAlbums`, `chatMultiSelect`, `chatChecklists`, `chatSilentSend`, `chatScheduled`) | C3 | ON once `chatLayoutV2` is ON | merge |
| `workMyTasks`, `workInbox`, `workStages`, `workRequests`, `workStaleSweep` | W1 | OFF | the owner, after ✋W1 |
| `permissionTemplates`, `controlPanelV2` | A1/A2 | OFF | the owner, after ✋A2 |
| `omsEvents`, `doorMessages`, `spaceTemplates`, `expenseForms`, `decisionsLog`, `telegramBridge` | I1 | OFF | the owner |
| `omsLink`, `knowledgeCards`, `quickRecall`, `orderStatus`, `autoTickets`, `mustRead`, `orderTemplateHint`, `productAssistant` | Q1 (right after F0) | OFF (`productAssistant` stays OFF) | the owner, after ✋Q1 |

Rollout order: `taskPrivacy` → (✋P0) → Q1 switches (✋Q1) → `themeV2Default` → `navV2` → `chatLayoutV2` + C3 switches → the phone (M1 uses the
same switches) → W1 → A1/A2 → I1. Each switch can be turned back off without data loss.

## Starting a step

The full instructions are in `BUILD-PROMPTS.md` (what to paste, the session protocol) and `BUILD-STEPS.md` (the card of
each step). The short form, for a session that already knows them:

```
Read AGENTS.md, then docs/restructure/BUILD-PROMPTS.md, and follow its session protocol exactly.
Do the next step of the plan (the first unticked box below whose prerequisites are done), then the one after it.
Never push, open a pull request, merge or deploy. Report in Levantine Arabic.
```

## The checklist («الشيك ليست») — a box is ticked in the step's own branch

It counts for the NEXT step as soon as it is ticked on the branch that step is built on, and for the owner once that
branch is merged. `P0.0` and the ✋ boxes are the owner's: ticked only when his answer is recorded.

### S0 — the plan in the repository
- [x] S0 The plan folder committed on its branch; the pointer in `AGENTS.md`; `pr/` and `ordered-prompts/` started

### P0 — privacy & security
- [ ] P0.0 Owner actions today: who keeps the OWNER rank; no owner-rank account on a temporary password; test with a plain member
- [x] P0.1 Oversight follows `archive.view` (partners lose it when revoked) + the switch for it on a partner's sheet
- [x] P0.2 Private tasks («المعنيين بس») applied to every read (the create-form picker and the lock on board cards, the calendar and search hits are still open: see `pr/P0.2.md`)
- [x] P0.3 Work made from a private chat stays private
- [x] P0.4 Privacy visible on screen (who can see a topic / a task)
- [x] P0.5 Privacy test matrix
- [x] P0.6 Android signing passwords out of the repository — the code is done; ✋ the owner still rotates both passwords and adds the two secrets BEFORE it is merged (`pr/P0.6.md`)
- [ ] ✋ Owner live check

### F0 — connection hotfixes
- [x] F0.1 Listener cursor (and the reconnect test rewritten) · [x] F0.2 Close ended streams · [x] F0.3 Visible heartbeat + jitter + pause
- [x] F0.4 One list of event kinds · [x] F0.5 Read only when seen; push when not viewing
- [x] F0.6 Debounce the old chat list · [x] F0.7 Retries don't eat the rate limit · [x] F0.8 `(createdAt,id)` paging
- [x] F0.9 Health shows the live line

### Q1 — product sheets, quick recall, tickets, must-read
- [x] Q1.0 The link to the orders system (token, client, sync, ONE ordered prompt for its repository)
- [x] Q1.1 Product sheets by category: live prices, copy buttons on every part, offer message, optional caution, questions and answers, «الصقي كرت قديم»
- [ ] Q1.2 Photos and feedback pictures: copy, download, share, one by one, merge into one picture; cover + consent; the Android app's three bridges (new APK)
- [x] Q1.3 «/» in the composer + the CARD message · [x] Q1.4 An order's state (chips, «/طلب»)
- [ ] Q1.5 Problems → tickets (kinds, rules, assignee from the mention, one ticket per order, protected customer number, chip, «✅ انحلّت», escalation, «اسألي مشرفتك»)
- [ ] Q1.6 «لازم ينقرأ» · [ ] Q1.7 Customer data hints · [ ] Q1.8 (optional) Product assistant
- [ ] ✋ Owner check

### D1 — look & buttons
- [ ] D1.1 Two themes + chat tokens + gate · [ ] D1.2 Primitives & button set · [ ] D1.3 Gallery review page · [ ] D1.4 Credits

### C1 — chat engine
- [x] C1.1 `lastMessageAt` + indexes · [ ] C1.2 list / topics / header / messages / sync endpoints
- [ ] C1.3 Live line: parallel fan-out, one line per browser, badges from frames · [ ] C1.4 Cache module (one writer)
- [ ] C1.5 IndexedDB start cache (wiped at sign-out) · [ ] C1.6 History, unread landing, jump
- [ ] C1.7 Virtualized viewport · [ ] C1.8 Optimistic send, receipts as deltas, cheap typing · [x] C1.9 Per-request efficiency (or in F1)

### F1 — platform speed
- [x] F1.1 `cache()` + parallel layout · [x] F1.2 Settings once per request · [x] F1.3 Lazy LiveKit & shell extras
- [ ] F1.4 Fewer `router.refresh()`, no reloads · [ ] F1.5 Badges from the live line · [ ] F1.6 Per-place skeletons
- [x] F1.7 Calm decoration · [x] F1.8 One Prisma client · [x] F1.9 Jobs in the worker (owner switch; default unchanged) · [ ] F1.10 (later) multi-instance

### N1 — navigation
- [x] N1.1 New map behind `navV2` + tests · [ ] N1.2 Rail / drawer / app bars · [ ] N1.3 Visible space + banner
- [x] N1.4 Glossary renames · [ ] N1.5 Breadcrumbs · [ ] N1.6 Guide tours · [x] N1.7 Old addresses redirect · [x] N1.8 Landing page
- [ ] ✋ Owner check of the new menu

### C2 — the Telegram-layout chat
- [ ] C2.1 Shell + layout + empty state (`chatLayoutV2`) · [ ] C2.2 List column + folders · [ ] C2.3 Forum view
- [ ] C2.4 Conversation pane · [ ] C2.5 Composer · [ ] C2.6 Message menu + shortcuts · [ ] C2.7 Info panel
- [ ] C2.8 Phone screens + motion · [ ] C2.9 Call entry points restyled
- [ ] ✋ Owner live check of the new chat

### C3 — chat features
- [ ] C3a.1 Personal pin / archive / mark unread · [ ] C3a.2 Folders · [ ] C3a.3 Saved messages
- [ ] C3b.1 Formatting · [ ] C3b.2 Link previews · [ ] C3b.3 Albums + media viewer · [ ] C3b.4 Voice speed
- [ ] C3b.5 Multi-select + forward many · [ ] C3b.6 «@» jump + «مين شاف»
- [ ] C3c.1 **Checklists** · [ ] C3c.2 Send without sound · [ ] C3c.3 Scheduled messages · [ ] C3c.4 Channels look
- [ ] C3d Info-panel tabs + list search + in-chat search

### C4 — settings
- [ ] C4.1 «إعداداتي» sections · [ ] C4.2 Sessions list (end one device) · [ ] C4.3 Company chat settings group

### M1 — phone app
- [ ] M1a Installed site: manifest, share target, service worker shell, push ask, badge, grouped notifications
- [ ] M1b Android shell: web chat, back/system bars bridge, notification channels + reply, share sheet, call screen
- [ ] ✋ Owner check on his phone (side-by-side screenshots)

### W1 — work
- [ ] W1.1 One «مهامي» · [ ] W1.2 «صندوق المهام» · [ ] W1.3 Stages · [ ] W1.4 «الطلبات» · [ ] W1.5 Project page
- [ ] W1.6 Duplicates marked + conversions · [ ] W1.7 Today simplified · [ ] W1.8 Honest tabs + search · [ ] W1.9 Old-task sweep
- [ ] ✋ Owner check

### A1 / A2 — permissions & panels
- [ ] A1.1 Templates · [ ] A1.2 Clear sheet + «شو بيقدر يعمل؟» · [ ] A1.3 Consistency fixes · [ ] A1.4 Grouped switches + presets
- [ ] A2.1 One control panel · [ ] A2.2 One settings page per space · [ ] A2.3 One meaning of "my team"
- [ ] ✋ Owner check

### I1 — fit to the work
- [ ] I1.1a Receive the orders system's signed order events (cards, the five daily counts) · [ ] I1.1b A door for other senders (new contract v2, `POST /api/v2/messages`)
- [ ] I1.2 Space templates
- [ ] I1.3 Expenses through approvals (`cash.view` wired) · [ ] I1.4 (optional) Decisions log · [ ] I1.5 (optional) Telegram bridge

### Z9 — closing
- [ ] Z9 Coverage true row by row; audit rows updated; the guide matches; the list of old things waiting for «شيلها»; the owner's summary rebuilt

## Progress log

| Date | Step | PR | Result |
|---|---|---|---|
| 2026-11-16 | plan written, reviewed; live site and orders system visited; team work analysed (T1); Q1 rebuilt on it; coverage table added | — | this folder |
| 2026-11-16 | the owner approved the preview («مزبوط»); build instructions written (`BUILD-PROMPTS.md`, `BUILD-STEPS.md`) | — | `mockup/`, the two files |
| 2026-11-16 | S0 done on `docs/restructure-plan`: the plan is tracked, `AGENTS.md` points at it. Base gates: typecheck, lint, migration lint, secret scan, build green; unit tests 4262 passed, 2 files could not load under Node 26 (pre-existing); database tests not completed on the base | — | `pr/S0.md` |
| 2026-11-16 | P0.1 done on `fix/chat-oversight-capability` (stacked on S0): silent oversight = the capability, not the rank; the switch on a partner's sheet; the live line told. Gates: typecheck, lint, migration lint, secret scan, build green; unit tests 4267 passed, the same 2 pre-existing files cannot load under Node 26; full database suite 240 files / 3442 tests passed | — | `pr/P0.1.md` |
| 2026-11-17 | P0.2 gates closed on `feat/task-visibility`: build green, full DB suite green after `tests/db/features.test.ts` learned the new switch | — | `pr/P0.2.md` |
| 2026-11-17 | P0.3 done on `fix/private-chat-work` (stacked on P0.2): a task made from a private conversation is «المعنيين بس»; public, a ticket, an idea or a project from a private source need the person's confirmation, enforced on the server; the dialog explains. Gates: typecheck, lint, migration lint, secret scan, build green; DB suite green except two load-only flakes that pass alone | — | `pr/P0.3.md` |
| 2026-11-17 | P0.4 done on `feat/privacy-visible` (stacked on P0.3): a private conversation says so in its head and row, the sheet names its people and says honestly when the owner may read silently, «رح يشوفه: …» before saving settings, the banner reworded. Gates: typecheck, lint, migration lint, secret scan, build green; unit tests green except the two Node 26 files; database suite 3462/3462 | — | `pr/P0.4.md` |
| 2026-11-17 | P0.5 done on `test/privacy-matrix` (stacked on P0.4): one table says who sees which conversation and task, and the doors, lists, search and policy must agree; proved by breaking the oversight rule on purpose. Gates green; database suite 3470/3470. Unread counts, notification audience, live gate, digest and attachments are not in the table yet | — | `pr/P0.5.md` |
| 2026-11-17 | P0.6 done on `fix/android-signing-secret` (stacked on P0.5): the Gradle file reads the two signing passwords from the environment, the workflow passes the repository secrets, the secret scan fails on a literal in a Gradle file. Gates green (database suite not rerun: nothing under `src/` changed). ⚠️ The owner must change both passwords and add the secrets BEFORE merging | — | `pr/P0.6.md` |
| 2026-11-17 | P0.R: the independent review of P0 found five real holes (publishing a private-chat task in one click, the reporting line across companies, link titles, the time report, counts), all reproduced by a failing test and fixed on `fix/p0-review-findings`; the Android workflow now stops on a half-set key; the rest is recorded in the PR file. Gates green; database suite green except two load-only flakes that pass alone | — | `pr/P0.R.md` |
| 2026-11-17 | F0 done on `fix/realtime-reliability` (stacked on P0.R): the live line starts at the newest event, says bye, pings, jitters, pauses when hidden; messages are marked read only when seen; a hidden tab still gets the push; the chat list does not storm; retries do not eat the quota; paging never skips; health shows the live line. Gates green; database suite 3491/3491 | — | `pr/F0.md` |
| 2026-11-17 | F0.R: the independent review of F0 found eight real holes in the live line (a ghost heartbeat swallowing pushes, a lost failed replay, a late commit missed, a duplicate during a long replay, a failed connect never retried, one tab changing another's state, online-while-hidden reopening the stream, a lost eviction note) plus smaller ones; all fixed on `fix/f0-review-findings` with failing tests first. Gates green; database suite 3496/3496 | — | `pr/F0.R.md` |
| 2026-11-17 | Q1.0 done on `feat/oms-link` (stacked on F0.R): the orders system is read every 5 minutes into the snapshot beside each linked sheet (no revision, no price typed), the owner's card (write-only token, end date, read now), the stale rule, the ordered prompt for that system; the independent review found seven real holes (the token sendable to a new address, a path traversal through an order id, a non-list answer counted as good, an unreadable row marking a sheet gone, zero or negative prices, two processes, raw keys in the card) — all fixed with failing tests first. Gates green; database suite 3535/3535 | 🔧 token + ordered prompt (owner) | `pr/Q1.0.md` |
| 2026-11-17 | Q1.1 done on `feat/product-sheets` (stacked on Q1.0): a product sheet per product (PRODUCT and REPLY kinds kept out of the ordinary cards), the approved-version serving rule with the live price, who writes and who approves, copy buttons on every part, an offer message that refuses a stale or missing price, the pasted-old-card parser, «اسألي مشرفتك» as an instant ticket, draft sheets made by the sync, the library tab «المنتجات»; the independent review found nine real holes (an archived sheet still visible, deleting an approved sheet by a plain editor, an unapproved title in a reader's ticket, a category named «constructor» crashing reads, prices rounded to one decimal, an offer message that ignored a gone product, approving content not seen, a save without a version, the sheets orphaned by a new space) — all fixed with failing tests first. Gates green; database suite 3591/3591 | 🔧 knowledge space, editors, approvers (owner) | `pr/Q1.1.md` |
| 2026-11-17 | Q1.3 done on `feat/quick-recall` (stacked on Q1.1): the CARD message kind (address only, no price in the row), «/» and «+» → «من المنتجات» in the composer, «منتج» sends the approved card and «رد» inserts an approved answer; every reader's screen asks for the card itself. The independent review found five small holes (a repeated tap posting twice, «/constructor» swallowing the draft, a pasted text swallowed, a wrong saved draft after insert, a stale error) — fixed with failing tests first. Gates green; database suite 3602/3602 | 🔧 switch `quickRecall` after «المنتجات» | `pr/Q1.3.md` |
| 2026-11-17 | Q1.4 done on `feat/order-status` (stacked on Q1.3): an order number in a message becomes a chip and «/طلب» sends an order card (the number only); the state is read from the orders system by number inside a conversation the person can read, kept 60 seconds in the new table `OmsOrderState` with only the contract's fields, an unknown state shows «حالة غير معروفة». The independent review found no serious hole and three small ones (a mistyped number showing a failure on the owner's card, chips shown while the system is not connected, repeated lookups) — fixed with failing tests first. Until the orders system adds the by-number door every chip says «تتفعّل بعد تحديث نظام الطلبات» | 🔧 switch `orderStatus` after «ربط نظام الطلبات»; the orders system's item 3 | `pr/Q1.4.md` |
| 2026-11-18 | F1.3 + F1.7 done on `perf/lazy-shell` (from main after D1): `livekit-client` and the call screen's picture code load with `import()` when a call starts or rings; the quick chat and the guide are `next/dynamic` chunks; the client chunks of `/` fall from 544 kB to 398 kB gzip with the LiveKit chunk gone (the build table does not count them: 279 kB both times); the flat themes draw nothing (pinned), the old ones keep their decoration and now go off under «وضع التوفير». `nav-sort` stays static (its three importers belong to N1.2). Tests: `lazy-shell` (13), `decor-calm` (15); no schema | — | `pr/F1.3.md` |
| 2026-11-18 | F1.1 + F1.2 + F1.8 + F1.9 (= C1.9) done on `perf/request-cache` (from `origin/main`, in three commit groups): `cache()` around `currentUser`, `pageUser`, `pageActor`, `requireActor`, `currentSpace`, the company's name and settings (one read per request, shared by every `isFeatureOn`); the layout's independent reads together. Counted in a database test: the layout went from 8 Prisma calls in 7 round trips to 7 calls in 3, and a page after the layout adds none; one Prisma client per process in production, `connection_limit` documented; the scheduler can run in the compose `worker` behind `JOBS_IN_WORKER=1`, default unchanged. ⚠️ `cache()` has no scope in a route handler in Next 14, so the API routes still read per call (C1.2 needs another way). Not measured: browser timings | 🔧 `JOBS_IN_WORKER=1` in Coolify, with the worker's environment; `connection_limit` in `DATABASE_URL` | `pr/F1.1.md` |
| 2026-11-18 | C1.1 done on `feat/chat-last-message-at` (from main): `Conversation.lastMessageAt` + index, its backfill in its own folder (with a WHERE, repeatable, ignores deleted messages) and the message index `(conversationId, createdAt, id)`, three migrations; written in the send transaction, recomputed when the newest message is deleted. Gates: typecheck, lint, migration lint, `migrate diff` empty, the related database tests green; the full suites and the build not run by the worker. Forward, system lines, the assistant and the ticket reply do not move the column yet (recorded) | 🔧 deploy the index migration in a quiet moment | `pr/C1.1.md` |
| 2026-11-18 | N1.1 + N1.4 + N1.7 + N1.8 done on `feat/nav-v2-map` (from `origin/main`): the new map `PLACES_V2` behind the switch `navV2` (OFF; the old map kept as `PLACES_V1`, both pinned), at most 4 tabs plus «المزيد», the owner's two pinned work tabs (`Organization.settings.workTabs`), the landing page setting (`Organization.settings.landing`, default the chat, only while `navV2` is on), the company menu order read (D-N5), the glossary renames in the fragments this step owns, `/list` and `/calendar` still their own pages. Not wired here: `navSubjectOf` must spread `navExtrasOf(settings)` (N1.2); «المقاطع»→«الفرق», «مشرف عام» and the guest-notice word wait for the tests that pin the old words | — | `pr/N1.1.md` |
