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
- [x] C1.1 `lastMessageAt` + indexes · [x] C1.2 list / topics / header / messages / sync endpoints
- [x] C1.3 Live line: parallel fan-out, one line per browser, badges from frames (the bell keeps its poll, see `pr/C1.3.md`) · [x] C1.4 Cache module (one writer, see `pr/C1.4.md`)
- [x] C1.5 IndexedDB start cache (wiped at sign-out, see `pr/C1.4.md`) · [x] C1.6 History, unread landing, jump (hooks; see `pr/C1.6.md`)
- [x] C1.7 Virtualized viewport (hooks; drawn by C2.4, see `pr/C1.6.md`) · [ ] C1.8 Optimistic send, receipts as deltas, cheap typing · [x] C1.9 Per-request efficiency (or in F1)
- [x] C1.5 IndexedDB start cache (wiped at sign-out, see `pr/C1.4.md`) · [ ] C1.6 History, unread landing, jump
- [ ] C1.7 Virtualized viewport · [x] C1.8 Optimistic send, receipts as deltas, cheap typing (the engine side; the C2 screen draws it, see `pr/C1.8.md`) · [x] C1.9 Per-request efficiency (or in F1)

### F1 — platform speed
- [x] F1.1 `cache()` + parallel layout · [x] F1.2 Settings once per request · [x] F1.3 Lazy LiveKit & shell extras
- [ ] F1.4 Fewer `router.refresh()`, no reloads · [x] F1.5 Badges from the live line (built with C1.3) · [ ] F1.6 Per-place skeletons
- [x] F1.7 Calm decoration · [x] F1.8 One Prisma client · [x] F1.9 Jobs in the worker (owner switch; default unchanged) · [ ] F1.10 (later) multi-instance

### N1 — navigation
- [x] N1.1 New map behind `navV2` + tests · [x] N1.2 Rail / drawer / app bars · [x] N1.3 Visible space + banner
- [x] N1.4 Glossary renames · [ ] N1.5 Breadcrumbs · [ ] N1.6 Guide tours · [x] N1.7 Old addresses redirect · [x] N1.8 Landing page
- [ ] ✋ Owner check of the new menu

### C2 — the Telegram-layout chat
- [x] C2.1 Shell + layout + empty state (`chatLayoutV2`) · [x] C2.2 List column + folders · [x] C2.3 Forum view
- [x] C2.4 Conversation pane (`pr/C2.4.md`) · [x] C2.5 Composer (`pr/C2.5.md`) · [x] C2.6 Message menu + shortcuts (`pr/C2.6+C2.7.md`) · [x] C2.7 Info panel (`pr/C2.6+C2.7.md`)
- [x] C2.8 Phone screens + motion (`pr/C2.8+C2.9.md`) · [x] C2.9 Call entry points restyled (`pr/C2.8+C2.9.md`)
- [ ] ✋ Owner live check of the new chat

### C3 — chat features
- [x] C3a.1 Personal pin / archive / mark unread / mute presets (`pr/C3a.1.md`; ⚠️ the personal mute does not stop a push yet) · [ ] C3a.2 Folders · [ ] C3a.3 Saved messages
- [ ] C3b.1 Formatting · [ ] C3b.2 Link previews · [ ] C3b.3 Albums + media viewer · [ ] C3b.4 Voice speed
- [ ] C3b.5 Multi-select + forward many · [ ] C3b.6 «@» jump + «مين شاف» (`pr/C3b.6.md`: the door and the walk are built; tick when `message-viewport.tsx` calls `useMentionsWalk`)
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
- [x] I1.1a Receive the orders system's signed order events (cards, the five daily counts) — ⚠️ the verbatim contract copy is NOT done (the box in `I1-integrations-and-fit.md` stays unticked; the tests use a provisional fixture) · [x] I1.1b A door for other senders (new contract v2, `POST /api/v2/messages`) — ⚠️ the owner's screens for a token's button hosts and a topic's door name are not built
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
| 2026-11-18 | C1.2 done on `feat/chat-endpoints` (from `origin/main`): `GET /api/chat/list` in ONE query in both shapes of D-N2 (switch `chatOneList`, default ON, pending the owner), the forum view `GET /api/chat/spaces/[id]/topics`, the header and the message windows (`before` / `after` / `around`) split from `conversationDetail` (unchanged), and the sync feed `GET /api/chat/sync` (messages presented per viewer, marks, rows, `removed`, `reset`); the company's settings are read once per request through a scope kept on the request's ctx. Five new surfaces in the privacy matrix; Q1 carried over (card, order chip, ticket chip, must-read) with a case each. Typecheck, eslint and the chat database tests green; no reviewer could be started from the worker, full suites and build not run | D-N2 | `pr/C1.2.md` |
| 2026-11-20 | I1.1a + I1.1b done on `feat/oms-events` (from `origin/main`): the orders system's signed events at `POST /api/integrations/oms/events/[receiverId]` (the existing verifier, unsigned refused, 64 KiB, each delivery once in the new table `InboundDelivery`, total/currency/city dropped, the raw body never stored), the state refreshed, a card per rule, the by-EVENT ticket rule, the daily card with the five counts; the door `POST /api/v2/messages` (new contract v2, permission `messages.write`, `Conversation.doorKey`, the phone guard, 120 a minute and a daily cap). Switches `omsEvents`, `doorMessages` OFF. The verbatim contract copy waits for the owner's files | — | `pr/I1.1.md` |
| 2026-11-18 | N1.2 + N1.3 done on `feat/nav-v2-shell` (from `origin/main`): the new map is wired (`navSubjectOf` spreads `navExtrasOf`, so the landing redirect and the map agree); with `navV2` ON the shell draws the rail (computer, 64 px) and the drawer (phone, header = me + the spaces with unread and overdue counts), the per-place app bar and «المزيد» in the tab strip, «اليوم» matched by its path; with it OFF the old side menu, top bar and bottom bar are untouched. A thing of another space shows «هاد من مساحة «X» [انتقل لها]» instead of switching by itself (`keepInSpace` no longer redirects while the switch is on); «اطلب من مديرك يضيفك» for a newcomer with no work space (D-N3); while the company order is set the person's «ترتيب» shows ⚠️ + 🔧 (D-N5, `User.navOrder` untouched); `/api/workspaces` is fetched once per page (F1). The rail and the drawer take a `listSlot` for C2. Tests: `nav-shell-v2` (38), the todo of `nav-places-v2` made real, `guest-internal-pages` (+5); no schema | — | `pr/N1.2.md` |
| 2026-11-18 | N1.2 + N1.3 done on `feat/nav-v2-shell` (from `origin/main`): the new map is wired (`navSubjectOf` spreads `navExtrasOf`, so the landing redirect and the map agree); with `navV2` ON the shell draws the rail (computer, 64 px) and the drawer (phone, header = me + the spaces with unread and overdue counts), the per-place app bar and «المزيد» in the tab strip, «اليوم» matched by its path; with it OFF the old side menu, top bar and bottom bar are untouched. A thing of another space shows «هاد من مساحة «X» [انتقل لها]» instead of switching by itself (`keepInSpace` no longer redirects while the switch is on); «اطلب من مديرك يضيفك» for a newcomer with no work space (D-N3); while the company order is set the person's «ترتيب» shows ⚠️ + 🔧 (D-N5, `User.navOrder` untouched); `/api/workspaces` is fetched once per page (F1). The rail and the drawer take a `listSlot` for C2. Tests: `nav-shell-v2` (40), the todo of `nav-places-v2` made real, `guest-internal-pages` (+6); no schema | — | `pr/N1.2.md` |
| 2026-11-19 | C2.4 done on `feat/chat-v2-conversation` (from `origin/main`): the conversation pane behind `chatLayoutV2` (OFF): the header with its line («المساحة · N عضو», «🔒 خاص · N» with no name, last seen, «عم يكتب…») and a «⋮» that draws only what has a server door, the virtualized reverse viewport over the C1 hooks, bubbles built from `message-item.tsx`'s logic (runs, tails, the name colour, the footer, the reply block with a jump, reactions, boxes reserved for pictures and voice notes), service lines with a run of calls folded into one chip, the sticky date, the «رسائل غير مقروءة» line, «↓» and «@», the pending bubble, the read mark only while the newest message is on screen, the call bar, and the four seams for C2.5 to C2.7 (one actions context, the composer host, the menu host, the info host). OFF renders the old page unchanged (a render test, the four combinations with `navV2`); no schema, no new door. Timing targets are listed for the owner's browser check, not measured | — | `pr/C2.4.md` |
| 2026-11-19 | C2.5 done on `feat/chat-v2-composer` (from `origin/main`): the new composer of the pane behind `chatLayoutV2` (OFF): `ChatComposerV2` wraps the old composer's logic in `useComposer` (draft, optimistic send and outbox, upload, recorder, mentions, «/»), the old `ChatComposer` is untouched; emoji (frimousse; a popover on the computer, a bottom sheet on the phone, recents on the device), the attach menu («صورة أو فيديو» · «ملف» · «استطلاع» only with `me.canPoll`), a pasted picture opens the send dialog (preview, caption, «ابعتها كملف»), dropping files on the pane shows «ابعت كصور» / «ابعت كملفات», the round button is the microphone while empty and send with text or a file (hold on the phone: slide to cancel, slide up to lock; click to start and stop on the computer), the reply / edit bar with the ✕, Esc ends it, «↑» in an empty box edits my last text message (the registry's rule), the Q1 «/» menu with its «⚡» and the customer-data line. No schema, no door, no migration; the timing of the mic and the phone keyboard are the owner's browser checks. |
| 2026-11-19 | C2.6 + C2.7 done on `feat/chat-v2-menu` (from `origin/main`): the message menu of the new screen drawn from the ONE registry (five opt-in items: «نسخ الرابط», «اقرأ النص», «حوّل الصوت لنص», «مين شاف», «اسألي مشرفتك»; Telegram's order and words; the old screen never gets an id it cannot run), the six quick reactions with «⌄» opening a frimousse picker on the installed emoji data, hover actions («↩» and a reaction button), right click, double click = reply, one keyboard module mounted from the shell (Alt+↑/↓, Alt+Shift+↑/↓, Ctrl+1…9, Ctrl+F, Esc, Ctrl+Shift+? with a sheet whose only Latin key names are Ctrl and Esc), and the info panel (a private chat or a topic; 360 px column from 1024 px, an end-side sheet below; ONE body for C2.8's phone route; a private topic says «🔒 خاص» without names unless the door gave them; no bell, no tabs). `chatLayoutV2` stays OFF; no schema, no migration, no new door. Hover feel, panel overlay and the keys are browser checks for the owner, not measured | — | `pr/C2.6+C2.7.md` |
| 2026-11-19 | C2.8 + C2.9 done on `feat/chat-v2-phone` (from `origin/main`): the phone's screens behind `chatLayoutV2` (OFF): the list screen's own 56 px bar («☰» only with `navV2` ON, the folder's name or «زاكي», a search that expands full width), the round button at the bottom END, the conversation as the whole screen (the frame hides its top bar, and inside a conversation its bottom bar and people row, through `group-has-*` classes on a marker the chat draws; the frame's N1 tests stay green), a 200 ms slide from the start edge, a swipe from the start edge that goes back (a pointer-event controller tested end to end), the composer above the keyboard (`visualViewport`) with the safe-area insets on the header and the composer only, `/chat/[id]/info` mounting the C2.7 panel body; motion (row slide 150, bubble fade-up 120, reaction pop 150, all off under reduced motion); and the call bar, the ring card, «مكالمة» and «اجتماع جديد» on the D1 tokens (looks only, the call logic untouched). No schema, no door, no migration. Nothing measured: the owner's browser list is in the PR file | — | `pr/C2.8+C2.9.md` |
| 2026-11-19 | **C2 phase end** (C2.1 to C2.9, all on `origin/main` or this branch, all behind `chatLayoutV2`, OFF): the whole Telegram-layout chat is built — the persistent shell with the list column, folders and forum view; the conversation pane with a virtualized reverse viewport, bubbles built from the old logic, service lines (a run of calls folded into one chip), unread separator, jump buttons; the composer; the message menu, hover actions and the keyboard; the info panel; the phone screens and motion; the call entry points restyled. Nothing of Q1 was lost (one render test each, pinned by `tests/chat-v2-phone-sweep.test.ts`); the guards (no hex, logical sides, only «Ctrl» and «Esc» Latin) cover every new folder; the four `chatLayoutV2` × `navV2` combinations have render tests; the privacy matrix and every chat test are green. What is NOT done and is the owner's: ✋C2 in a real browser (the timing checks — paint under 100 ms at 4× throttle, 1 000 messages smooth, no jump on older pages, swipe back, composer above the keyboard — are listed in `pr/C2.8+C2.9.md`, never written as measured), and flipping `chatLayoutV2` ON only after it. D-C1 stands: the old screen stays, hidden, not removed. `docs/CODEMAP.md` is the integrator's | — | `pr/C2.8+C2.9.md` |
| 2026-11-19 | F1.4 done on `perf/no-refresh` (from `origin/main`): the space-edit button no longer reloads the page (`router.refresh()` plus the `["orgs"]` invalidation it already had), a card's delete invalidates the client-fetched cards list instead of refreshing; every other refresh of the package draws a server page and stays (listed with the reason in the PR file). Counts from the terminal: package files 39 refresh / 1 reload before, 39 / 0 after; no schema, no migration. Browser behaviour not measured | — | `pr/F1.4.md` |
| 2026-11-19 | F1.6 done on `feat/place-skeletons` (from `origin/main`): a `loading.tsx` for 15 places (files, documents, knowledge, tickets, departments, goals, ideas, campaigns, crm, production, watch, time, checkins, cards, archive), each drawing the shape of its page (rows, boxed sections, cards, a document, a table, the production day, the watch room) from the one `Skeleton` primitive in `src/components/ui/skeletons.tsx`, wearing the page's own outer classes so nothing jumps; hidden from screen readers but for one «جارٍ التحميل…», logical properties and theme tokens only, still under reduced motion and in «وضع التوفير». It applies with `navV2`/`chatLayoutV2` OFF too, so it follows the page, never a switch. Not made on purpose (a later step reshapes the page): my-work, projects, boards, requests, approvals, owner, analytics, settings, spaces, members, structure, development, calendar, list; `(app)/loading.tsx` and `chat/loading.tsx` untouched. Tests: `place-skeletons` (136); no schema. Not measured: browser timings | — | `pr/F1.6.md` |
| 2026-11-19 | C3b.1 done on `feat/chat-formatting` (from `origin/main`): ONE pure parser (`src/lib/chat/format/parse.ts`) turns a body into blocks and inline tokens (`**bold**`, `__italic__`, `~~strike~~`, `code`, a fenced block, `||spoiler||`, quote lines, `[text](address)` and bare links); `render.tsx` draws them as React elements (no raw-HTML API), links only `https:` / `http:` / `mailto:` or an in-app `/chat/…` `/tasks/…` path (`javascript:`, `data:`, an address with a user name and a label that shows another site are not links), the new bubble composes the formatting with mentions and order chips, the composer has a selection toolbar and Ctrl+B / I / U / K, Ctrl+Shift+X / M, leftover math markup is shown as plain characters and the assistant is told to write plain text. `stripFormatting` is the one door of every text-out path: list row, push, search snippet, `buildChatPrompt` (assistant, digest, summarize), translate. A 10 000-character body parses under 5 ms (unit test). Switch `chatFormatting` (ON). No schema. Not wired here: the switch itself reaches the two components as an optional prop (files of other packages), and the reply-quote and pinned previews | — | `pr/C3b-1.md` |
| 2026-11-19 | C3b.6 built on `feat/chat-mentions-jump` (from `origin/main`): `GET /api/chat/conversations/[id]/mentions?after=&limit=` (the ids of the unread messages that mention me or «@الكل», oldest first, paged; the chat list's own «unread» rule; a reader in silent oversight gets an empty list and the door writes nothing), the «@» button's walk (`useMentionsWalk` in `floating.tsx` + pure `walkTargetsOf` / `pruneVisited` and `collectUnreadMentions`) and the check of «مين شاف» (built in C2.6, nothing added). No schema, no migration, no switch. ⚠️ `message-viewport.tsx` (C2.4's file, not in this package's paths) still has to call the hook: until it does the button walks the loaded mentions as before | — | `pr/C3b.6.md` |
| 2026-11-19 | C3b.3 done on `feat/chat-albums` (from `origin/main`): ONE pure layout function (`src/lib/chat/album-layout.ts`) lays 2 to 10 pictures and videos out as a mosaic from their stored `width` / `height` (2 side by side, 3 one big over two, 4 a 2x2, 5 to 10 rows of 2 or 3; no hole, no overlap, bounded crop, a tall stack is made narrower), the bubble draws it and `albumBox` in `sizes.ts` reserves the same box; a tap opens the media viewer (`media-viewer.tsx`: a full-screen Radix dialog, arrows and swipe that follow the screen's direction, wheel / pinch / double-tap zoom, download, «اعرض بالمحادثة», the caption, native video controls; Esc closes only the viewer; one source function `viewerItemsOf` that C3d swaps; the files of a deleted message are never listed). The composer's limit of 10 files in one message with one caption was verified and now refuses the eleventh at pick time. Switch `chatAlbums` (ON). No schema. Not wired here (other packages' files): the switch and the viewer's provider reach the bubble and the pane, and the viewport's estimate is opt-in | — | `pr/C3b-3.md` |
| 2026-11-19 | A1.1 built on `feat/permission-templates` (from `origin/main`): «قوالب» behind `permissionTemplates` (OFF): the company's templates in `Organization.settings.roleTemplates` (no migration; seven starters until the first save; the save is guarded by a `rev` under the row lock), applying one THROUGH `updateAccount` (rank rules, never more than the applier holds, a guest template refused, `archive.view` never, audit `org.template_applied`), «القالب: X» / «معدّل» on the person's sheet, «القالب» on the create sheet. Not built: the templates editor screen (A2.1). `tests/db/features.test.ts` needs one line appended (see `pr/A1.1.md`). |
| 2026-11-19 | W1.4 built on `feat/work-requests-inbox` (from `origin/main`): «الطلبات» as one inbox at `/requests` behind `workRequests` (OFF): «بانتظاري» (approvals whose turn is mine, task assignment requests addressed to me — they had no list — the open tickets of MY departments, cards in review in a space I moderate, product sheets for the owner and his named approvers) and «طلباتي», each row acting in place through the EXISTING doors (approvals `/decide`, task `/request/accept` and `/return`, ticket PATCH, card and sheet `/status`), no new decision path; every row and every count filtered by what the person may see (`taskVisibleWhere` for tasks, approver and department rules, a guest sees nothing); `GET /api/work/requests`, `/api/workspaces` carries `waiting`, the tab of the new map points at `/requests` (the approvals pages stay pages of the same tab; with the switch off the address serves the approvals page), `approvals.ts waitingCount` now agrees with its list. No schema. Details: `docs/restructure/pr/W1.4.md`. |
| 2026-11-19 | W1.7 built on `feat/today-simple` (from `origin/main`): «اليوم» with `navV2` ON is up to SIX cards in one order — «مهامي اليوم» (the quick add at its foot, W1.2's inbox), «بانتظار قرارك» (W1.4's count and its newest five), «ذكروك» (unread mentions from the chat list's own numbers, each a link into its conversation, nothing in silent oversight), «تذكيراتي» (with Q1.5's follow-up day as «مواعيد اليوم»), «التسجيل اليومي», and ONE team card with its scope chip (the old pulse and the dashboard's team strip folded into it; the owner's panel is «لوحة التحكم» at /owner, which the card links to). The personal numbers, the digest, the day's time, the pinned tasks and the projects are under «اليوم › المزيد» (a folded section); nothing deleted, a tested hand-off table (`TODAY_HAND_OFF`). With `navV2` OFF the page is the old one (render test). No schema, no switch of its own, no new door. Details: `docs/restructure/pr/W1.7.md`. |
| 2026-11-19 | C3a.1 built on `feat/chat-personal-state` (from `origin/main`): a person's OWN pin (at most 10, their order in `UserChatOrder` scope `pins`), archive, «علّم كغير مقروء» and mute presets, behind `chatPersonalState` (ON). Three additive columns on `ConversationMember`; `PUT /api/chat/conversations/[id]/me` (404 with no row, no event and no trace for a reader in silent oversight, a restricted topic or a private chat needs an existing row, an open topic gets a row like `markRead`, the 11th pin is a 422); opening a conversation clears the mark; an archived chat comes back when a message arrives unless it is muted; the flags are filled in the ONE list query (the switch is read inside it, so the feed still reads no settings) and reach the person's other tabs through the sync feed as one event for them alone. The row menu, the «الأرشيف» tab, the pins' order and the forum view are drawn; the old screen is untouched. Gates: typecheck, eslint on the touched files, migration lint, `migrate diff` empty, secret scan clean, `next build` green, the unit tests of the area (29 files) and the chat database tests (51 files, 455 tests, plus the matrix) green; the FULL unit and database suites were not run here. Not done: a push still ignores the personal mute, pins cannot be dragged (another package's `scopeSchema`), the C1.2 `removed` gap | — | `pr/C3a.1.md` |
