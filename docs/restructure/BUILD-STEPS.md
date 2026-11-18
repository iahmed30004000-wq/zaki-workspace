# Build steps — one card per step, in the order they are built

> Read `BUILD-PROMPTS.md` first (the session protocol). Then read ONLY the card of your step here and the spec section
> it names. A card does not repeat the spec: it gives the order of work, what proves the step, the traps, and what
> "done" means. The spec (the phase file) holds the detail and its boxes are the ones you tick.
>
> Order: `S0 → P0 → F0 → Q1 → D1 → C1 → F1 → N1 → C2 → C3a → C3b → C3c → C3d → C4 → M1 → W1 → A1 → A2 → I1 → Z9`.
> The stack is ONE straight line: always branch from the last finished step branch (BUILD-PROMPTS §4). "After" only
> names what must already be inside that line — it is never a branch to fork from. "Look" = the address to open in the approved
> preview (`docs/restructure/mockup/index.html`; add `&m=phone` for the phone). Branch names marked * are suggested
> (the phase file names none).

---

## S0 — Put the plan in the repository

- **Branch** `docs/restructure-plan` · **After** nothing · **Spec** this folder
- **Order of work:** (1) the baseline of BUILD-PROMPTS §2 step 3: Node 22, `npm ci`, `.env`, the local database, the
  SEVEN gates on `main` — write any gate that is already red under "noticed" in `pr/S0.md` and tell the owner; (2)
  confirm `docs/restructure/` is complete (the files of README's table, `BUILD-PROMPTS.md`, `BUILD-STEPS.md`,
  `mockup/index.html`) — it is untracked at this point and it is the plan itself: commit it; (3) start the two
  folders: `docs/restructure/pr/README.md` ("one file per branch, template in BUILD-PROMPTS §10") and
  `docs/restructure/ordered-prompts/README.md` ("one file per repository and step, rules in BUILD-PROMPTS §9");
  (4) add to `AGENTS.md`, under «How work is done», a short section «The restructure plan»: the plan lives in
  `docs/restructure/`; a session told «كمّل البناء» follows `docs/restructure/BUILD-PROMPTS.md`; while the owner has
  not said «ارفع», a step branch starts from the last finished step branch (one straight stack) and a box counts
  for the next step once ticked there; the plan never overrides this file; (5) run the seven gates again; commit.
- **Traps:** do NOT commit `owner-summary/` (it is excluded on purpose: it carries what was seen on the live site). Do
  not reformat the plan files. Nothing in `src/` changes in this step.
- **Done when:** the folder is tracked on the branch, the gates that ran are green, the progress log has its row.
- Every later branch starts from this one until it is merged (BUILD-PROMPTS §4).

---

## P0 — Privacy and security (first; the owner reported real exposure)

Spec: `P0-privacy.md`. Strings: `src/lib/i18n/ar.task-privacy.json`. Decisions: D-P0 … D-P4 (defaults are buildable).

### P0.0 — What the owner can do today
- **No code.** In the first report, ask the three owner actions of the spec once (who keeps the OWNER rank; no
  owner-rank account on a temporary password; test with a plain member). Write «انسأل <التاريخ>» under D-P0. Go on
  to P0.1 without waiting. The P0.0 box is the owner's: tick it only when his answer is recorded.

### P0.1 — Oversight follows the capability, not the rank
- **Branch** `fix/chat-oversight-capability` · **After** S0 · **Spec** P0.1 · **Decisions** D-P1 · **Switch** none
- **Order of work:** (1) the failing DB test `tests/db/chat-partner-oversight.test.ts` exactly as the spec's world
  (owner O, partner P, members A and B, restricted topic T, a DM A↔B, an open topic U); (2) ONE definition of
  "holds oversight": extend `OrgFacts` with `oversight`, add `hasOversight(org)`, make `holdsArchiveView` call the same
  helper; (3) `canRead` uses it; an OWNER-rank person WITHOUT it is treated as a space ADMIN of every space (open
  topics yes, leaves a normal read row, may post; restricted topics and other people's DMs no); (4) replace every READ
  decision by rank in the files the spec lists (home, both SQL queries of unread, search, digest, notify, messages,
  redact, topics, poll-shared, order, moderation); rank checks that are about posting or purging keep theirs with
  `// oversight-ok: <reason>`; (5) the SWITCH on a partner's sheet, offered to the primary owner only, with its ⚠️ text;
  (6) `membership.changed` on a rank or capability change so the hub drops its cache; (7) the source-text guard test
  `tests/chat-oversight-guard.test.ts`; (8) the two sentences in `AGENTS.md` «Access model».
- **Prove:** the new DB test red then green; the guard test; a UI test that the switch is offered for a partner to the
  primary owner and to nobody else. Must stay green: `tests/db/partners.test.ts`, `chat-owner-reads-dms`,
  `archive-capability`, `topic-privacy`, `realtime-replay-gate`.
- **Traps:** partners hold `archive.view` by default — the old tests stay true. Silent reading (no read row, no event,
  no notification) belongs to oversight ONLY; a partner without it is a normal participant. Do not touch the `isOwner`
  checks outside chat (board, development, features, purge, rewards, creating spaces): they are A1.3 — list them under
  "noticed, not fixed". `archive.view` stays un-grantable to every other rank.
- **Done when:** after revoking, the partner gets 404 on T and the DM, they are absent from home, unread, search and
  digest, and his open stream stops receiving T's events at once; the primary owner is unchanged everywhere.
- **Look:** `#p=admin&sec=people&o=person:m1` (the switch) · `#p=chat&c=mgmt` (a private topic).

### P0.2 — A task can be private («المعنيين بس»)
- **Branch** `feat/task-visibility` · **After** P0.1 · **Spec** P0.2 · **Decisions** D-P2, D-P3, D-P4 · **Switch**
  `taskPrivacy` (ON when merged; it only offers the control and sets the default — the read filter ALWAYS applies)
- **Owner first:** 🔧 the read-only `npx prisma migrate status` from the app container (this is the plan's first new
  migration). Without it: write and test locally, and write "do not deploy before the status check" in the PR file.
- **Order of work:** (1) the guard test `tests/task-visibility-guard.test.ts` — it must FAIL on today's code (paste
  it); (2) migration A alone: the TEXT column with its default and index, no backfill; zod `TASK_VISIBILITY`;
  (3) EXTEND `src/server/services/team-scope.ts`: `WorkScope` gains `userId`, `managedSpaces`, `reportIds`,
  `oversight`; `taskVisibleWhere` ANDs the participant rule; add `canSeeTask` and `taskVisibleSql`;
  `requireTaskAccess` answers 404 for a hidden task; (4) put EVERY reader on the helper, in the spec's four groups —
  Prisma readers, the raw SQL lines on `"Task"`, nested counts and includes, the chat bubble's «صارت مهمة» chip;
  (5) system paths (jobs, recurrence, offboarding) carry `// task-visibility: system (<reason>)`; (6) `createTask` /
  `updateTask` (default per D-P2; each change a `TaskActivity` line); (7) the screen: «مين بيشوفها؟», the lock icon,
  the space's bulk action; (8) `tests/db/task-visibility.test.ts`.
- **Prove:** the guard test (red on today's code, green after); the DB test over every surface the spec lists (task
  GET, comments, board, list, calendar, timeline, Today, both searches, digest, the door, the calendar feed, counts,
  the owner aggregates, the chip).
- **Traps:** do not write a second filter — extend the one that exists. A count that includes a hidden task is a leak.
  Existence is private: 404, never 403. The reporting chain is ACTIVE people only, depth ≤ 6. Old tasks are NOT
  changed (D-P3). A task from the door, e-mail or the assistant defaults to SPACE unless the caller says otherwise.
  Notifications and pushes about a private task go only to people who can see it. If D-P2's default (a new task
  with an assignee is private) turns an EXISTING test red, do not edit that test: keep SPACE as the default for new
  tasks until the owner answers D-P2, offer the control, and say so in the report.
- **Done when:** another member of the same space cannot open, list, count, search or be told about a private task;
  SPACE tasks and guests behave exactly as before.
- **Look:** `#p=work&tab=mine` (the lock; switch to «المساحة» to see the hidden count).

### P0.3 — Work made from a private conversation stays private
- **Branch** `fix/private-chat-work` · **After** P0.2 · **Spec** P0.3
- **Order of work:** failing DB tests for each path first; then `make-work.ts` (task and ticket), the ideas route, the
  projects route, `watch/convert.ts`: the default is PARTICIPANTS, and making it public needs `confirmPublic: true`
  ENFORCED ON THE SERVER (400 `work.confirm_public_required`); then the dialog's ⚠️ / 🔧 lines.
- **Traps:** the rule lives on the server; the dialog only explains it. "Private source" = a DM, a restricted topic,
  a team topic.

### P0.4 — Say who can see it
- **Branch** `feat/privacy-visible` · **After** P0.1 · **Spec** P0.4
- **Order of work:** render tests for the four states first; the header subtitle «🔒 خاص · 4 أشخاص» with its sheet (and
  the honest line about oversight); the row icons; «رح يشوفه: …» before saving a topic's settings; the reworded
  oversight banner.
- **Look:** `#p=chat&c=mgmt`.

### P0.5 — The privacy matrix
- **Branch** `test/privacy-matrix` · **After** P0.1–P0.4 · **Spec** P0.5
- **Order of work:** one table-driven DB test, personas × objects × surfaces, the expected matrix as DATA at the top
  of the file (the owner's decisions must be readable there). Give it a small helper so later steps add rows in one
  line.
- **Traps:** this file is a required check for every later step (R8). If a row is red, the CODE is wrong — never
  loosen a row without the owner's recorded answer.

### P0.6 — The Android signing passwords
- **Branch** `fix/android-signing-secret` · **After** S0 · **Spec** P0.6
- **Owner first:** 🔧 changes BOTH passwords of the SAME keystore and stores them as CI secrets.
- **Order of work:** the scan test first (the current Gradle file must FAIL the new rule); `build.gradle` reads the
  environment; the workflow passes the secrets; without them the build uses the debug key and warns.
- **Traps:** never write the old or the new value anywhere — not in the PR file, a commit, a log or the report. Never
  a new key (phones would stop updating). The git history keeps the old value: that is why he changes it first.

### ✋ P0 — the owner's LIVE check
P0 has no switch to hold it back: it is merged and deployed when CI is green and the owner says so. Send him this
list for after the deploy; a check that fails comes back through prompt (E).
```
فحص الخصوصية — جرّبها بحساب موظف عادي، مش حسابك:
1. موضوع خاص ما إنت فيه: لازم ما يبيّن بالقائمة ولا بالبحث ولا بعدّاد غير المقروء.
2. مهمة «المعنيين بس» لموظف تاني بنفس المساحة: لازم ما تبيّن باللوحة ولا بالقائمة ولا بالتقويم ولا بالبحث.
3. من كرت الشريك: طفّي «الأرشيف والرقابة»، وافتح بحسابه محادثة خاصة لغيره — لازم ما تفتح.
4. اعمل مهمة من رسالة بمحادثة خاصة: لازم تطلع «المعنيين بس» لحالها.
5. افتح موضوع خاص إنت فيه: لازم ينكتب فوق مين بيشوفه.
```

---

## F0 — The live line made reliable (one branch, one commit per item)

- **Branch** `fix/realtime-reliability` · **After** P0 · **Spec** `F0-connection-hotfixes.md` · **Switch** none
- **Order of work — nine commits, each with its failing test first:**
  F0.1 the listener cursor (no replay on boot; `lastId` advances; `LISTEN` resolves at once) ·
  F0.2 ended streams send `bye` and close; the client goes to sign-in on `signed_out` and does NOT reconnect on
  `evicted` · F0.3 a `ping` frame every 25 s, a 60 s watchdog, ±30 % jitter, the real pause when hidden ·
  F0.4 `RT_KINDS` built from `REALTIME_KINDS` (ONE list) · F0.5 mark read only when visible and focused; a separate
  `isViewing` for push suppression · F0.6 300 ms debounce + abort on the old chat list · F0.7 the idempotency check
  before the rate limit · F0.8 order and page by `(createdAt, id)` · F0.9 `/api/health` gains `realtime`.
- **Traps:** F0.1 breaks the hook of `tests/db/realtime-notify.test.ts` ("on reconnect it replays events with an id
  greater than the last seen"): rewrite that test's SETUP so it still proves the same promise — it pins a behaviour,
  not a privacy rule; say so in the PR file. F0.9 must not change the HTTP status of the health route (the deploy
  checks it). The old chat screen stays in service until C2 is switched on: fix it, do not restyle it.
- **Done when:** a deploy no longer replays the event table; a hidden tab neither marks read nor swallows the push; two
  messages sharing a timestamp are never skipped across a page; every realtime kind survives a replay.

---

## Q1 — Product sheets, quick recall, tickets, must-read (on TODAY's chat screen)

Spec: `Q1-quick-recall-and-auto-tickets.md` (read §1 and §2 first: who owns which fact, and a day by role).
Strings: `src/lib/i18n/ar.quick-recall.json`. All switches OFF when merged; the owner turns them on after ✋Q1.

### Q1.0 — The link to the orders system
- **Branch** `feat/oms-link` · **After** F0 · **Spec** Q1.0 · **Decisions** D-Q2 · **Switch** `omsLink`
- **Order of work — what Q1.0 itself delivers:** (1) the enum value `'OMS'` ALONE in its own migration folder; (2)
  the client `src/server/integrations/oms.ts` (three calls, Bearer, `net-guard`, 5 s, no redirects, failures as
  `IntegrationEvent` rows, never a response body in a log); (3) `Card.external JSONB NULL`, written only by the
  sync, never through `saveCardEdit`; (4) the sync job (5 minutes, idempotent, never deletes) refreshing the
  snapshot of cards that are already linked, and the integration card with its ⚠️ / 🔧 states and the token's end
  date; (5) the stale rule as a pure, tested helper (older than 30 minutes = stale); (6) the ONE ordered prompt for
  the orders system in `ordered-prompts/zaki-ai-OSM-Q1.0.md` (the four items of the spec), which also asks that
  system to hand back its contract example; (7) the fallbacks until that prompt lands.
- **Wired in later steps (tick these boxes of the spec THERE, not here):** creating a DRAFT sheet for a product
  that has none, and linking a sheet to a product → Q1.1 (the PRODUCT kind is born there); refusing to copy or send
  a stale price → Q1.1 (the copy buttons) and Q1.3 («/منتج»); the price notice → Q1.6 (it is a CARD with must-read).
- **Prove:** a contract test against the orders system's example of its products door (until the owner brings the
  real copy: a PROVISIONAL fixture `tests/fixtures/oms-products.provisional.json` written from the spec — never in
  `docs/contracts/`, never called "copied"); the token never in a response, a log or an
  error; the sync creates no `CardRevision` and is idempotent; an unreachable system keeps the last snapshot and
  shows ⚠️; the stale helper.
- **Traps:** a price is NEVER typed, edited or stored as truth here. The token is write-only and encrypted. Do not put
  the orders system's address in a tracked file: it is a setting. Reviews (first names, cities) never cross.
- **Owner:** 🔧 issues the token (three scopes) and pastes it; pastes the ordered prompt into that system's session.

### Q1.1 — The product sheet
- **Branch** `feat/product-sheets` · **After** Q1.0 · **Spec** Q1.1 · **Decisions** D-Q4, D-Q10, D-Q12 (D-Q5, D-Q6,
  D-Q11 are answered) · **Switch** `knowledgeCards`
- **Order of work:** (0) what Q1.0 left for this step: the sync creates a DRAFT sheet for a product that has none and
  links a sheet by id, else by code + name, never by itself when two products share a code; a stale price cannot
  be copied («حدّثي هلّق» instead); (1) zod for the PRODUCT data in `src/lib/cards/knowledge.ts` with the length limits; `CARD_KINDS`
  gains `PRODUCT` and `REPLY`; (2) `Card.approvedVersion INT NULL` and the serving rule (a non-editor always gets the
  last APPROVED knowledge with the LIVE snapshot; never approved = invisible to non-editors); (3) the write rule for
  these two kinds (space managers + named editors; who approves per D-Q4); (4) the category templates
  (`src/lib/cards/product-templates.ts`, editable by the owner); (5) `src/lib/cards/copy-text.ts` — pure, plain text,
  Western digits — and the copy buttons on EVERY part through the existing `copyText()`; (6) the offer message built
  from its template and the live prices; (7) «انسخي الكل» with remembered ticks; (8) questions and answers with the
  Arabic folding search and «اسألي مشرفتك» when nothing matches (it opens a ticket through the EXISTING instant-ticket
  door today; Q1.5 extends it); (9) the page `/knowledge`, the sheet
  `/knowledge/[cardId]`, the third tab «المنتجات» in the library place; (10) what a sheet lacks, and «الصقي كرت قديم»
  (a pure parser).
- **Prove:** the limits; a sheet with no caution renders none; a guest gets no price and a MEMBER does; a non-editor
  cannot write and never reads an unapproved sheet; approved-version serving; the copy-text builder; the parser; two
  products with one code are not linked; a stale snapshot refuses to build an offer message; the
  nav tests (`tests/nav-places.test.ts`, `tests/db/guest-internal-pages.test.ts`) updated for the new tab.
- **Traps:** the caution is OPTIONAL and belongs to the team: no category adds one, and it is never part of any text
  copied for a customer. The selling price is shown to every STAFF reader — it is NOT the capability `prices.view` —
  and never to a guest, cut on the server. Only «أسئلة الزباين» is open by default. No new table: extend `Card`.
- **Look:** `#p=library&o=product:harak` (health and care) · `#p=library&o=product:set` (clothing, no caution) ·
  `#p=library&o=product:neck` (a stale price) · `#p=library` (the grid, what a sheet lacks).

### Q1.2 — Photos and feedback pictures
- **Branch** `feat/product-media` · **After** Q1.1, P0.6 (for the Android build) · **Spec** Q1.2 · **Decisions** D-Q7
- **Order of work:** (1) `StoredFile.purpose = "KNOWLEDGE"` through the sheet's own upload route and `ingest`;
  `assertMayReadFile` learns the rule; (2) `CardAttachment.role` and `.meta` (additive), the two caps (30 and 60);
  (3) photos on top of the sheet; (4) on any picture: copy, download, share, send to a chat; (5) the feedback gallery:
  select several → one by one, or merged into one picture; (6) the layout as a PURE function
  `src/lib/cards/collage-layout.ts` (2 to 9 pictures, never cropped, 2 or 3 columns, split when taller than 4096 px);
  (7) adding a feedback item: the cover tool IN THE BROWSER, then consent, then approval; (8) a picture sent into a
  chat is a COPY; (9) the three Android bridges and the download listener in `WebHost.kt`, shipped as a new build.
- **Prove:** the layout function (counts, columns, the split); a KNOWLEDGE file is not in the library list; an item
  without consent or approval is never returned to an agent; the download header; guests get nothing.
- **Traps:** the ORIGINAL feedback picture never leaves the phone — the rectangles are painted into the pixels before
  anything is uploaded. Nothing is merged on the server. Each bridge refuses unless the page shown is this site's own,
  caps the size and cleans the file name. The Android code cannot be built on this machine: report it «مش مفحوص»
  and leave its box unticked until the Android workflow is green after «ارفع» (BUILD-PROMPTS §13).
- **Look:** `#p=library&o=product:harak&fb=1`.

### Q1.3 — «/» in the composer and the CARD message
- **Branch** `feat/quick-recall` · **After** Q1.1 · **Spec** Q1.3 · **Switch** `quickRecall`
- **Order of work:** DB tests first (recall refused where the person may not post or may not read the sheet; the
  stored message holds no price; a guest reading gets none; an unapproved sheet cannot be sent); the additive columns
  on `ChatMessage` (`kind = "CARD"`, `card`, `viaApp`); the two routes; the NEW service `recallToConversation` beside
  `sendCard`; the menu in today's composer and the «⚡» button on the phone; the CARD bubble in today's
  `message-item.tsx`; «/منتج» refuses a stale price (the helper of Q1.0).
- **Traps:** the message stores ONLY `{ type: "product", cardId }` and a readable body WITHOUT a price; everything
  shown is resolved for each VIEWER at read time. `sendCard` is pinned by `tests/db/cards.test.ts`: do not change it.
  «/رد» INSERTS text into the composer — it never sends by itself.
- **Look:** `#p=chat&c=dm_salma&o=slash` · `#p=chat&c=dm_salma` (the card bubble).

### Q1.4 — An order's state
- **Branch** `feat/order-status` · **After** Q1.0, Q1.3 · **Spec** Q1.4 · **Switch** `orderStatus`
- **Order of work:** the pattern test first (accepts the two known shapes, refuses a phone number); the constant copied
  from the orders system WITH its source named; the NEW table `OmsOrderState` (say in the PR file why no existing
  table holds it); the lookup with its 60-second freshness; the chip and «/طلب»; the Arabic map of states.
- **Traps:** reading by NUMBER waits for the ordered prompt — until then the chip says so. An unknown state shows
  «حالة غير معروفة», never a raw word. The cache never stores a field the door does not send.
- **Look:** `#p=chat&c=problems` (the order numbers inside messages).

### Q1.5 — Problems become tickets
- **Branch** `feat/auto-tickets` · **After** Q1.3, Q1.4 · **Spec** Q1.5 · **Decisions** D-Q1, D-Q8 · **Switch**
  `autoTickets`
- **Order of work:** DB tests for each rule and mode first; the additive `Ticket` columns and indexes; kinds and rules
  as organization settings; who gets it, through the EXISTING doors (`createInstantTicket`, `createTicket`,
  `messageToTicket` extended to take the kind and an instant target); one problem = one ticket (a later message with
  the same order number or customer number becomes a comment); the protected customer number (ONE masking helper;
  encrypted; a keyed hash for matching; wiped by a job 30 days after `resolvedAt`); the chip under the message, the
  new realtime kind `ticket.changed`, the «✅ انحلّت» reply; the note on the order when allowed; «افتح بنظام الطلبات»;
  «اسألي مشرفتك», the screen-recording rule, «طلب إذن» as an approval form; waiting and escalation inside working
  hours; `escalation.configure` wired (update PHASE0-AUDIT R12).
- **Prove:** every rule and mode; an instant ticket from ONE mention; one ticket per order and per customer number;
  the number is never returned outside the ticket's readers, never in a push, and is wiped by the job; the chip and
  the «✅» reply; no automatic ticket from a private topic; escalation skips a person who is not ACTIVE.
- **Traps:** content rules run on OPEN topics only — in a private topic or a DM, by hand only. Reuse the EXISTING phone
  pattern of `src/server/ai/redact.ts` (export it; do not write a second one), after order numbers are taken out.
  Duplicates, suspect numbers and postponed orders are the orders system's tools: a button OPENS them, nothing is
  rebuilt here. `followUpAt` reminds the agent; the customer's delivery day is set in the orders system only.
- **Look:** `#p=chat&c=problems&f=p5` (the chip) · `#p=work&tab=tickets`.

### Q1.6 — «لازم ينقرأ»
- **Branch** `feat/must-read` · **After** Q1.3 · **Spec** Q1.6 · **Decisions** D-Q9 · **Switch** `mustRead`
- **Order of work:** tests first (who counts; a guest and an oversight reader never count; each reminder once;
  removing the reaction un-reads); the two additive columns; «قرأت ✓» writes a ✅ reaction in the EXISTING
  `ChatReaction` table; «قرأ 7 من 10» and the list for the author and moderators; the reminder job; `announce.send`
  wired; «/إعلان» uses it; and the price notice left by Q1.0 is built HERE: when the price or the offers of an
  APPROVED sheet differ from the previous snapshot (never on a product's first sync), ONE CARD pointing at the sheet
  goes to the knowledge space's announcements topic with must-read — no price is written into a message.
- **Look:** `#p=chat&c=instr`.

### Q1.7 — Customer data out of the open chat
- **Branch** `feat/customer-data-hints` · **After** Q1.5 · **Spec** Q1.7 · **Switch** `orderTemplateHint`
- **Order of work:** detector tests first (true and false cases; an order number is not a phone); the two hints, shown
  to the author and the moderators only; the warning beside the three switches that send message text to a model.
- **Traps:** nothing is blocked — the hints teach the path. No customer data ever goes into an address. A masked edit
  goes through the ordinary edit path and the hint says the original stays in the owner's archive.
- **Look:** `#p=chat&c=problems` (the hint under the hand-typed order).

### Q1.8 — Product answers from the assistant — SKIP until the owner says yes (D-Q3)

### ✋ Q1 — the owner's check
```
فحص الكروت والتذاكر:
1. اكتب 3 أحرف من اسم منتج: لازم يطلع الكرت بأقل من ثانية، وكل جزء ينتسخ بكبسة.
2. غيّر سعر بنظام الطلبات: خلال 5 دقايق لازم يتغيّر بالكرت وبرسالة العرض، ويوصل تنبيه واحد «لازم ينقرأ».
3. كرت ملابس: مقاسات وخامة وألوان وغسيل، وبدون تنبيه.
4. اختار 6 صور آراء واجمعهم بصورة وحدة عالجوال: لازم تنقرأ وما تنقص، وتنزل وتنتسخ وتنشارك.
5. اكتب رسالة فيها رقم طلب وكلمة «مرتجع» واذكر موظف: لازم تنعمل تذكرة وحدة إله، والرسالة التانية تنضاف عليها.
6. سكّر التذكرة: لازم ينكتب «✅ انحلّت» تحت الرسالة الأولى.
```

---

## D1 — The new look and the buttons

Spec: `D1-design-system.md`. Strings: `ar.design-v2.json`. Decision: D-D1 (the switch `themeV2Default` stays OFF). NOTE (D1 review): the switch is NOT added in D1 — nothing reads `systemTheme()` yet and a switch that does nothing lies; the step that connects `systemTheme()` (with the client's `prefers-color-scheme`) adds the switch, OFF, with it.
Look: the whole preview, light and dark (the moon button on its top bar).

### D1.1 — Two themes and the chat tokens
- **Branch** `feat/design-tokens-v2`* · **After** Q1
- **Order of work:** the contrast gate first (it must fail for the missing tokens); «سماء» and «ليل أزرق» in the
  registry and the palettes, plugged into the EXISTING theme engine (registry entry, palette, FX colours, switch
  mapping) — not a parallel system; the nine chat tokens, with values for the four old themes too; the six
  wallpapers drawn in-house; regenerate the CSS.
- **Traps:** `DEFAULT_THEME` does NOT change while `themeV2Default` is OFF: the existing assertions of
  `tests/pwa-manifest.test.ts` stay as they are, and the test GAINS a case for the switch ON. The four old themes
  stay selectable. No downloaded pattern set.

### D1.2 — Primitives and the button set
- **Branch** `feat/ui-primitives-v2`* · **After** D1.1 · **Spec** §1, §3, §4, §5
- **Order of work:** render tests first; the button variants (keep the component's API; add `tonal` and `fab`); the
  restyled primitives; the new `list-row`, `badge`, `segmented`, `switch`; the avatar falls back to initials when its
  picture fails and stops asking for it; the guard test for button styles; the typography of §3 (the sizes, the
  line height, tabular numbers, the variable `--chat-font-scale`); the five principles of §1 written into
  `AGENTS.md` «Conventions» (it must stop saying "four themes").
- **Traps:** no screen changes behaviour in this step. Icons from `lucide-react` only.

### D1.3 — The gallery review page · D1.4 — Credits
- **Branch** `feat/theme-gallery-v2`* · **After** D1.2
- Every primitive in every theme on the existing `/theme-gallery`; our patterns and sounds credited in
  `public/brand/CREDITS.md` and the guide's «الاعتمادات» article. **Owner:** 🔧 picks the final accent shades there.

---

## C1 — The chat engine

Spec: `C1-chat-engine.md`. It must not change who may read what: every new endpoint goes through
`src/server/policy/conversation.ts` and the presenter, and adds its rows to the privacy matrix.

### C1.1 — `lastMessageAt` and the indexes
- **Branch** `feat/chat-last-message-at`* · **After** D1 (any order with D1) · **Spec** C1.1
- Three migrations in three folders: the column + index; the data move (with its `WHERE`, safe to repeat); the
  message index. Written inside the send transaction and recomputed when the newest message is deleted.

### C1.2 — The endpoints and the sync feed
- **Branch** `feat/chat-endpoints`* · **After** C1.1 · **Spec** C1.2 · **Decisions** D-N2 · **Switch** `chatOneList`
- **Order of work:** `tests/db/chat-sync.test.ts` and the list / topics / header / messages tests first; `chatList`
  (ONE SQL with `LATERAL` joins — no loop; BOTH shapes of D-N2); GET on the topics route; header and messages split
  from `conversationDetail`; `src/server/chat/sync.ts`.
- **Traps:** visibility for a whole batch is decided in ONE query, never one `canRead` per row. Present messages ONLY
  through the existing presenter (`dto.ts` + `redact.ts`). `typing` and `call.ring` are not in sync. The old
  `GET /api/chat/conversations/[id]` and `chatHome` stay for the old screen and the Android app. Carry Q1 over: the
  CARD kind resolved per viewer, the order chips, the ticket chip, `ackRequired` — one sync test case for each.
- **Done when:** sync never returns a message of a conversation the viewer cannot read; a topic made private appears in
  `removed` for the people dropped; a deleted message is a tombstone without its text; an old cursor answers `reset`.

### C1.3 — The live line
- **Branch** `feat/chat-live-line`* · **After** C1.2 · **Spec** C1.3
- Parallel fan-out with one readers query per event; one line per browser (Web Lock + BroadcastChannel, with the
  one-per-tab fallback); badges and presence from frames; quick chat stops polling.
- **Traps:** frames carry ids only — never content. Keep the public `useRealtime(handler)` API: calls, whiteboard,
  watch and the bell depend on it. `presence.changed` is stream-only (not a row, not in `REALTIME_KINDS`). Remove a
  poll only after the frame path is proven; keep the 5-minute safety refresh.

### C1.4 — The client cache
- **Branch** `feat/chat-cache`* · **After** C1.3 · **Spec** C1.4
- TanStack Query keys as the spec lists; ONE module (`src/lib/chat/cache/`) owns every write; frames →
  `scheduleSync()` (120 ms, one request at a time); unread derived from the cache, the server's numbers win; prefetch.

### C1.5 — The start cache on the device
- **Branch** `feat/chat-start-cache`* · **After** C1.4 · **Spec** C1.5
- **Traps:** ⚠️ message text is kept on the device. 🔧 Wiped on sign-out and on a different user; export the wipe as
  one function — its button in settings comes in C4.1. The test proves the wipe.

### C1.6 — History, the unread landing, the jump · C1.7 — The virtualized viewport
- **Branches** `feat/chat-history`*, `feat/chat-virtual-viewport`* · **After** C1.4 · **Spec** C1.6, C1.7
- `around=firstUnreadId`; paging both ways; the jump with its highlight; at most 10 pages kept; `@tanstack/react-virtual`
  with measured heights; the visible message stays in place when older pages arrive; images reserve their box.
- **Traps:** keep today's `onNewest()` / `isAtBottom()` rules. These hooks serve the C2 screen: the old screen keeps
  working untouched.

### C1.8 — Sending, receipts, typing
- **Branch** `feat/chat-optimistic-send`* · **After** C1.4 · **Spec** C1.8
- The bubble on the FIRST attempt; the route answers right after the commit; read marks only when visible and focused
  and only when the newest read message changed; the typing route caches its policy facts for 30 s.
- **Traps:** the `clientId` keeps a retry from sending twice (F0.7). A notification that runs after the response must
  still be logged when it fails.

### C1.9 — Per-request efficiency
- Build it NOW, at C1.9's turn, as the two branches `perf/request-cache` and `perf/prisma-one-client` described
  under F1 below. Tick C1.9, F1.1, F1.2 and F1.8. C1's phase-end review comes after them; F1 then starts at F1.3.

---

## F1 — The whole site fast

Spec: `F1-platform-speed.md`. No behaviour changes. Every item records a before / after in its PR file — only what
the terminal can show (the build's route table, counted database calls, server timing in a test); what needs a
browser's performance panel goes under "Owner actions", never written as measured (BUILD-PROMPTS §13).

- **F1.1 + F1.2 (= C1.9, already built at C1.9's turn)** `perf/request-cache`* — `cache()` around `currentUser`, `pageUser`, `pageActor`,
  `requireActor`, `currentSpace`; the layout's calls in parallel; settings read once per request.
  **Trap:** `cache()` is per request — never a module-level memo of a user or a permission.
- **F1.3** `perf/lazy-shell`* — `livekit-client` loaded when a call starts or rings; QuickChat, the guide, nav-sort
  and SwitchFx through `next/dynamic`. **Prove:** the first-load script of `/` drops (record both numbers); a call
  still rings.
- **F1.4** `perf/no-refresh`* — `router.refresh()` replaced by query invalidation where the data is client-fetched;
  the reload of the space-edit button goes here. The board's three reloads are W1.5's — leave them.
- **F1.5** `perf/live-badges`* (after C1.3) — badges, presence and the space counts from the live line.
- **F1.6** `feat/place-skeletons`* — a `loading.tsx` per place, shaped like its page.
- **F1.7** `perf/calm-decoration`* (after D1) — no endless animation in the new themes; the old themes keep theirs.
- **F1.8 (already built at C1.9's turn)** `perf/prisma-one-client`* — one client per process in production.
- **F1.9** `feat/worker-jobs`* (D-F1) — the scheduler can run in the worker service behind a setting; the app keeps
  running it until the owner flips the service. **Owner:** 🔧 the flip in the deployment panel.
- **F1.10** — LATER; skip.

---

## N1 — Navigation people understand

Spec: `N1-navigation.md`. Strings: `ar.nav-v2.json`. Switch `navV2` (OFF when merged). Decisions: D-N1 … D-N5.
Look: the rail on the computer (`#p=work`), the drawer on the phone (`#p=chat&m=phone`, then «☰»).

- **N1.1 the new map** `feat/nav-v2-map`* (after D1) — the map in `src/lib/nav/places.ts` behind `navV2`; the old map
  kept as `PLACES_V1` with its tests; `tests/nav-places.test.ts` gains the `navV2` expectations rank by rank;
  `tests/db/guest-internal-pages.test.ts` extended to the new tab keys. **Trap:** every tab offered must be a page
  that serves that person; a tab not offered to guests must still refuse them. Places whose new page is built
  LATER point at today's page until then: «الطلبات» → today's approvals page (W1.4 replaces it); «مهامي» → today's
  my-work page (W1.1); «الإدارة» keeps today's admin tabs until `controlPanelV2` (A2.1); «المنتجات» is Q1's page.
- **N1.2 rail, drawer, app bars** `feat/nav-v2-shell`* — the rail (computer) and the drawer (phone); the bottom bar
  stays for `navV2` OFF; at most 4 tabs plus «المزيد». Build the rail and the drawer so that C2's chat shell reuses
  them as they are (C2.1 comes later and must not make a second pair).
- **N1.3 the visible space** `feat/visible-space`* — the switcher with its counts; a one-line banner instead of a
  silent switch. **Trap:** D-N2 — whether the chat is one list is the owner's answer; never reverse his decision of
  2026-10-25 by yourself.
- **N1.4 the glossary** `fix/nav-glossary`* — one name per thing, in the fragments. **Trap:** no key in two files.
- **N1.5 breadcrumbs** `feat/breadcrumbs`* · **N1.6 the guide tours** `feat/guide-tours-v2`* ·
  **N1.7 old addresses** `fix/legacy-routes`* (every old address is still a page) ·
  **N1.8 the landing page** `feat/landing-page`* (D-N1: a company setting; `/` stays reachable as «اليوم»).
- **Traps for the phase:** «الشركة» keeps no projects (D-N3). The person's own menu order is not deleted: while the
  company order is set, its screen shows ⚠️ + 🔧 and `User.navOrder` stays stored.

### ✋ N1 — the owner's check
```
فحص القائمة الجديدة:
1. بالحاسوب: القائمة صارت عمود رفيع عاليمين، وكل مكان فيه 4 تبويبات بالكتير.
2. بالجوال: القائمة بتفتح من «☰»، وفوقها المساحات وعدّاد كل وحدة.
3. افتح مهمة من مساحة تانية: لازم يطلع سطر «هاد من مساحة كذا» بدل ما يتغيّر الموقع لحاله.
4. موظف جديد ما إله مساحة شغل: لازم يشوف «اطلب من مديرك يضيفك»، مش قوائم فاضية.
5. كل عنوان قديم كنت تفتحه لازم يضل يفتح.
```

---

## C2 — The chat screen, Telegram layout (computer and phone)

Spec: `C2-chat-ui.md` (+ `telegram-parity.md` for the feature list). Strings: `ar.chat-ui.json`. Switch
`chatLayoutV2` (OFF when merged). Decision: D-C1 (the old screen stays, hidden, until he says remove).
New components live in `src/components/chat/v2/`. After: C1, D1, N1.2.

- **C2.1 shell** `feat/chat-v2-shell`* — `ChatShell` + `layout.tsx` + the empty state; with the switch OFF, `/chat`
  renders today's `ChatHomeClient` unchanged (one render test). Look: `#p=chat&c=problems`.
- **C2.2 the list column** `feat/chat-v2-list`* — virtual rows reading C1's cache, each row subscribed to itself;
  the folders; «كل الشركة» for oversight holders only. Look: `#p=chat` and `#p=chat&m=phone`.
- **C2.3 the forum view** `feat/chat-v2-forum`* — `/chat/s/[spaceId]`.
- **C2.4 the conversation pane** `feat/chat-v2-conversation`* — header, virtualized reverse viewport, bubbles built
  from today's `message-item.tsx` LOGIC, service lines (a run of call lines folds into ONE chip), sticky dates, the
  unread separator, the jump buttons.
- **C2.5 the composer** `feat/chat-v2-composer`* — emoji, the attach menu, paste and drop, mic ⇄ send; reuse the
  existing upload, outbox, recorder, mentions and draft code.
- **C2.6 the message menu and shortcuts** `feat/chat-v2-menu`* — quick reactions + the registry; the registry stays
  the ONE source of menu items.
- **C2.7 the info panel** `feat/chat-v2-info`* · **C2.8 phone screens and motion** `feat/chat-v2-phone`* ·
  **C2.9 call entry points restyled** `feat/chat-v2-calls`*.
- **Prove (the spec's §10):** render tests for the row kinds, bubble runs and tails, menu items by permission,
  composer states; a guard test: no hex colour in `src/components/chat/v2/**`; the four switch combinations of
  `chatLayoutV2` × `navV2`; the privacy matrix and every existing chat test green. The timing checks of §10 (paint
  under 100 ms, smooth scrolling) need a browser: list them for the owner's ✋, never write them as measured.
- **Traps:** the server still decides every action — the new screen reads the same flags and adds no door. NOTHING of
  Q1 may be lost: the «/» menu and «⚡», the CARD bubble, the order chip, the ticket chip and «✅ انحلّت», «قرأت ✓» with
  its count, the hints, «🎫 مشكلة» and «اسألي مشرفتك» — one render test for each. On screen only «Ctrl» and «Esc» may
  be Latin; write the other keys in Arabic letters and do not extend the allow-list. Everything "left / right" is
  written with logical properties. The new-message button on the phone sits at the bottom END (the left, in this
  right-to-left layout).

### ✋ C2 — the owner's check
```
فحص شاشة الدردشة الجديدة:
1. بالحاسوب: القائمة ثابتة عاليمين، والتنقّل بين محادثتين فوري وبدون ما تتحمّل الصفحة.
2. افتح محادثة فيها غير مقروء: لازم تنزل على سطر «رسائل غير مقروءة».
3. اطلع لفوق بموضوع قديم: لازم تتحمّل الرسائل القديمة بدون ما تنطّ الشاشة.
4. بالجوال: القائمة ← المحادثة ← رجوع بالسحب، وخانة الكتابة فوق الكيبورد.
5. جرّب كل شي كان موجود: «/»، كرت المنتج، التذكرة تحت الرسالة، «قرأت ✓»، المكالمة.
6. طفّي المفتاح: لازم ترجع الشاشة القديمة متل ما كانت.
```

---

## C3 — The missing chat features, and the checklist

Spec: `C3-chat-features.md`. Strings: `ar.chat-features.json`. Each feature has its own switch (the spec's table),
ON once `chatLayoutV2` is on. One branch per item. After: C2.

- **C3a.1 personal pin, archive, mark unread** `feat/chat-personal-state`* — three additive columns on
  `ConversationMember`; `PUT /api/chat/conversations/[id]/me`. **Traps:** refused (404) while reading through
  oversight — no trace; a restricted topic or a DM needs an existing row (no row = no audience); at most 10 pins.
- **C3a.2 folders** `feat/chat-folders`* — `User.chatPrefs JSONB`, one zod schema in `src/lib/chat/prefs.ts`;
  filtering on the client over the cache (a pure, tested function).
- **C3a.3 saved messages** `feat/saved-messages`* (D-C3) — a DM with oneself, created idempotently.
- **C3b.1 formatting** `feat/chat-formatting`* — ONE pure parser to tokens to elements. **Traps:** no
  `dangerouslySetInnerHTML`; links `https:` / `http:` / `mailto:` only; previews, notifications, search and the model
  paths strip the markers; no math library — leftover markup is shown as plain characters.
- **C3b.2 link previews** `feat/link-previews`* — a NEW table (say why); fetched after the send commits through
  `net-guard`; the image stored through `ingest`. **Trap:** ⚠️ the server visits the link. 🔧 Written in the guide.
- **C3b.3 albums and the media viewer** `feat/chat-albums`* (a pure layout function) · **C3b.4 voice speed**
  `feat/voice-speed`* · **C3b.5 multi-select and forwarding many** `feat/chat-multi-select`* (reuse `forwardMessage`
  and `deleteMessage` per item; a task made from a selection follows P0.3) · **C3b.6 «@» jump and «مين شاف»**
  `feat/chat-mentions-jump`*.
- **C3c.1 the checklist** `feat/chat-checklists`* (D-C4) — two NEW tables (the spec says why a poll and a task step
  cannot hold it); kind `CHECKLIST`; the add / tick / edit routes; realtime `checklist.changed`; «اعمل منها مهمة».
  **Traps:** an oversight reader cannot tick (no trace, like polls); guest rules like polls; at most 30 items.
  Look: `#p=chat&c=problems&f=p7`.
- **C3c.2 send without sound** `feat/chat-silent-send`* · **C3c.3 scheduled messages** `feat/chat-scheduled`* — a
  SEPARATE table on purpose; the job re-checks `canPost` at send time and is idempotent by `clientId` ·
  **C3c.4 channels** `feat/chat-channels-look`* (no schema change).
- **C3d info-panel tabs and search** `feat/chat-info-search`* — the media route never returns the files of a deleted
  message; the «الشغل» tab is filtered by task visibility and ticket access.
- **Done for each:** additive migration, `migrate diff` empty; every new route has zod, `withApi`, a policy check, a DB
  test with a refusal case, and a privacy-matrix row; the C2 checks still pass.

---

## C4 — «إعداداتي»

Spec: `C4-settings.md`. Strings: `ar.settings-me.json`. After: C2, C3a.2. Look: `#p=settings&sec=chat` (and `&m=phone`).

- **C4.1 the sections** `feat/settings-me`* — `/settings/me/<section>`; `/profile` redirects and keeps working; the
  person's choices in `User.chatPrefs`, device-only ones in `localStorage`. **Prove:** a notification type switched
  off produces no push; preview off sends the generic text; text size and wallpaper apply at once.
- **C4.2 sessions** `feat/user-sessions`* — the devices list and «اطلع من كل الأجهزة»; then the per-session table
  (additive; a revoked session gets 401 on its next request; the others keep working). Update PHASE0-AUDIT R11.
- **C4.3 the company's chat settings group** `feat/company-chat-settings`* — the chat switches grouped and explained,
  each with ⚠️ / 🔧 where it has a risk.
- **Trap:** nothing that belongs to the company moves into a person's settings.

---

## M1 — The phone app

Spec: `M1-mobile-app.md`. Strings: `ar.mobile.json`. Decision: D-M1 (ONE chat screen). After: C2 (and P0.6 for a
new Android build). Look: the whole preview with `&m=phone`.

- **M1a the installed site** `feat/pwa-shell`* — the manifest (opens on the chats), the share target and `/share`
  (never sends by itself), the service worker shell (never caches `/api/*`), the push ask at the right moment, the
  badge, grouped notifications. **Trap:** `tests/pwa-manifest.test.ts` pins `start_url`: it changes only with the
  owner's answer to D-N1 — until then the manifest opens where it opens today and the rest of M1a is built.
- **M1b the Android shell** `feat/android-shell`* — one full-screen web host on `/chat`; the back bridge; system bars
  from the theme (a strict colour pattern); notification channels with reply and mark-read; the share sheet; the call
  screen restyled. **Traps:** the old native screens stay behind ONE in-app setting «الشكل القديم» with its ⚠️ + 🔧;
  keep the three bridges of Q1.2 with their checks; nothing in the app says "Telegram" and no asset of it is used.
- **Prove:** the web side by the gates. The Android side cannot be built here: report it «مش مفحوص», and tick M1b
  only after the Android workflows are green following «ارفع». The side-by-side pictures are the owner's (✋ M1).

### ✋ M1 — the owner's check (on his own phone)
```
فحص الجوال — بالتطبيق المثبّت من المتصفح وبتطبيق الأندرويد:
1. بيفتح عالدردشة، وبدون شريط المتصفح.
2. زر الرجوع: بيسكّر القائمة، بعدين المحادثة، بعدين بيطلع من التطبيق.
3. والتطبيق مسكّر: الرسالة بتوصل إشعار فيه «رد» و«علّم كمقروء»، والرد بيوصل مرة وحدة.
4. شارك نص من تطبيق تاني لزاكي: بيفتح اختيار المحادثة وما بيبعت لحاله.
5. من كرت المنتج: انسخ صورة، نزّلها، وشاركها.
```

---

## W1 — «الشغل»

Spec: `W1-work.md`. Strings: `ar.work-v2.json`. Switches: `workMyTasks`, `workInbox`, `workStages`, `workRequests`,
`workStaleSweep` (OFF when merged). After: P0, D1, N1. Every read uses `taskVisibleWhere`.

- **W1.1 one «مهامي»** `feat/work-my-tasks` — one screen, three views, three scopes, ALL my spaces by default; the old
  addresses redirect. Look: `#p=work&tab=mine`.
- **W1.2 «صندوق المهام»** `feat/work-inbox-project` — the hidden instant project becomes a named, pinned one (same
  `systemKey`, same service). **Trap:** «الشركة» gets none.
- **W1.3 stages** `feat/work-stage` — the column `stage` in one migration, the two data moves in ANOTHER (each with
  its `WHERE`). `columnLabel()` still shows each board's own name.
- **W1.4 «الطلبات»** `feat/work-requests-inbox` — approvals, assignment requests, department tickets, sheets waiting
  for approval; each row acts in place through the EXISTING services. Look: `#p=work&tab=req`.
- **W1.5 the project page** `feat/work-project-page` — tabs, breadcrumbs, no page reload on the board.
- **W1.6 duplicates marked** `feat/work-duplicates-marked` (D-W2) — ⚠️ + 🔧 on screen and a conversion; a routine is
  archived, never deleted.
- **W1.7 Today simplified** `feat/today-simple` — at most six cards; ONE team card.
- **W1.8 honest tabs** `fix/work-tabs-honest` (D-W3) — every tab's rule equals its page's rule. Until D-W3 is
  answered: the TABS require `directory.view` (honest), and no page is relaxed — a capability test pins that refusal.
- **W1.9 old tasks** `feat/work-stale-sweep` (D-W4) — the review list with bulk actions through the existing services
  (refused per task where the person cannot edit); «آلي» from the EXISTING `Task.apiTokenId`.
- **Traps:** every table stays; nothing is deleted; a quick task needs only a title.

### ✋ W1 — the owner's check
```
فحص الشغل:
1. «مهامي»: بتشوف مهامك من كل المساحات بكبسة وحدة.
2. مهمة سريعة بعنوان بس: بتنحط بـ«صندوق المهام»، وخاصة إذا إلها مسؤول.
3. «الطلبات»: طلب إسناد إلك بيبيّن، وبتقبله من نفس السطر.
4. أضف عمود للوحة: بدون ما تتحمّل الصفحة.
5. «مهام قديمة»: بتسكّر أو بتأرشف دفعة وحدة، وولا شي بينمسح.
```

---

## A1 + A2 — Permissions people understand, and ONE control panel

Spec: `A1-permissions-and-panels.md` (its first paragraph lists the tests that must stay green — run them all).
Strings: `ar.permissions-v2.json`, `ar.control-panel-v2.json`. Switches: `permissionTemplates`, `controlPanelV2`.
After: P0, N1.

- **A1.1 templates** `feat/permission-templates` — in `Organization.settings` (no migration); applied through the
  existing service. **Prove:** a template never gives more than the applier holds; a guest template is refused; an
  audit row. Look: `#p=admin&sec=people&o=person:m4`.
- **A1.2 the clear sheet** `feat/permissions-sheet` (D-A1) — areas in plain words; «شو بيقدر يعمل؟» from a pure
  `explainCapabilities` that agrees with `effectiveCapabilities` for every rank × switch (a test compares them).
  Until D-A1 is answered, `tasks.delete` only gets its hint «بيحتاج كمان يكون مدير المساحة»: the route's rule stays.
  **Trap:** hide only the capabilities still wired to nothing; update PHASE0-AUDIT R12 when you show one again.
- **A1.3 one meaning per rule** `fix/permission-consistency` (D-A2, D-A4, D-A5) — a partner's revocation takes effect
  on every surface the spec lists, one DB test per site (revoke → refused); `users.manage` = accounts only; ONE
  `ManagerPicker`. **STOP:** the "space manager" definition (D-A2) changes three pinned tests — leave
  `isSpaceManager` and those tests as they are until the owner answers. Who flips company switches and who purges
  stay as they are (D-A4).
- **A1.4 grouped switches** `feat/features-grouped` — `group` and `dependsOn` as pure metadata with their test; the
  two presets, each with a confirmation listing what changes. Look: `#p=admin&sec=feats`.
- **A2.1 one control panel** `feat/control-panel-v2` (D-A6) — existing parts MOVED, not rebuilt; a section a person may
  not open answers 404; «لوحتي» independent of the owner's board switch. Look: `#p=admin&sec=overview`.
- **A2.2 one settings page per space** `feat/space-settings` — existing dialogs become its tabs.
- **A2.3 one meaning of "my team"** `fix/team-scope` (D-A3) — in a NEW `src/server/policy/people-scope.ts` (the name
  `team-scope.ts` is taken and means something else); every number shows its scope.

### ✋ A2 — the owner's check
```
فحص الصلاحيات واللوحة:
1. اعمل حساب جديد بقالب ومساحات من شاشة وحدة.
2. «شو بيقدر يعمل؟»: لازم يطابق اللي بيصير فعلًا لما تجرّب بحسابه.
3. شيل صلاحية من شريك: لازم تنشال بكل مكان، مش بس بالدردشة.
4. لوحة تحكم وحدة باسم واحد، وما في رقم بيطلع مرتين بقيمتين.
5. كل عنوان قديم للّوحات بيحوّل للمكان الجديد.
```

---

## I1 — Fit to how the team works

Spec: `I1-integrations-and-fit.md`. Strings: `ar.integrations-fit.json`. All switches OFF when merged.

- **I1.1a the orders system's events** `feat/oms-events` (after Q1.0, Q1.3, Q1.4) — the contract is copied VERBATIM
  into `docs/contracts/oms-app-events.v1/` ONLY from the real files the owner brings from that system's session;
  until then the tests use `tests/fixtures/oms-events.provisional.json` (written from the spec, never called
  "copied", never in `docs/contracts/`) and the box about the contract stays unticked; the receiver verifies with the EXISTING `verifyZakiSignature`; the NEW
  table `InboundDelivery` (say why `IdempotencyRecord` cannot hold it; update PHASE0-AUDIT R2); rules per space; the
  by-EVENT ticket rule; the daily card with its five counts. **Prove:** the copied signed example verifies; an
  unsigned delivery, a wrong signature, an old timestamp, a replay and an oversized body are refused; `total`,
  `currency` and `city` never reach the database (the DB test reads the rows). **Trap:** an unsigned delivery is
  REFUSED; the raw body is never stored. **Owner:** 🔧 adds the receiver in the orders system.
- **I1.1b a door for other senders** `feat/door-messages` — `workspace-door.v1.md` is FROZEN: a NEW
  `docs/contracts/workspace-door.v2.md` with ONE endpoint `POST /api/v2/messages`; the permission `messages.write`;
  the customer-data guard; `Conversation.doorKey` with its unique index in the SAME migration. **Prove:** permission,
  idempotency, tenant isolation, the guard, v1 answers unchanged. Write the ordered prompts for the media buyer and
  n8n.
- **I1.2 space templates** `feat/space-templates` — pure data applied by the existing create service; the guide page
  «من تيليجرام لزاكي».
- **I1.3 expenses through approvals** `feat/expense-requests` (after W1.4) — form templates of the EXISTING approvals
  module; `cash.view` wired (update PHASE0-AUDIT R12). **Traps:** no approval of money by a chat message; order money
  stays in the orders system.
- **I1.4 the decisions log** and **I1.5 the Telegram bridge** — SKIP until the owner says yes (D-I1, D-I2).

---

## Z9 — Closing the plan

- **Branch** `docs/restructure-close`* · **After** every step above
- `COVERAGE.md` true row by row (each of the 36 requests points at merged work, or says honestly what is not done);
  `docs/PHASE0-AUDIT.md` rows updated; the guide's articles and tours match the screens; the list of old things still
  marked and waiting for the owner's «شيلها» (the old chat screen, the old menu, the old native chat, the old themes'
  default) written for him; the owner's summary rebuilt (Word + a phone-sized PDF, kept out of git).
- Tell the owner plainly what "100%" did not reach (`COVERAGE.md` «What the plan cannot promise»).
