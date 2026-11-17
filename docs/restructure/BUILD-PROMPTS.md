# Build instructions — how the builder runs this plan from the first step to the last

> **Who reads this.** The builder (Claude Sonnet 5.5 high, or any agent) at the START OF EVERY SESSION, before
> anything else. The owner reads §1 only. `AGENTS.md` wins over this file; `README.md` (rules R1–R16) comes next; then
> this file; then the phase file of the step. If two of them disagree, follow the higher one and say so in the report.
>
> **What this file is.** The standing instructions: what to paste, the working loop, the branch rule, how decisions
> are handled, when to stop, how to report. The work itself is in `BUILD-STEPS.md` (one card per step, in order) and
> in the phase files the cards point at.
>
> **What the plan is not.** It is not code and it was written from the code at `main@6e21483`. The code may have
> moved since. Where the plan names a file, a function or a test that is not there any more, the code is the truth:
> find what replaced it, do the step's INTENT, and write the difference under "noticed" in the step's PR file.

## 1. For the owner — the only things to paste

The owner is not a programmer. He starts a builder session in this repository and pastes ONE of these. Nothing else
is needed: every other instruction is in the files.

**(A) «كمّل البناء» — the normal one. Paste it at the start of every session:**

```
Read AGENTS.md, then docs/restructure/BUILD-PROMPTS.md, and follow its session protocol (§2) exactly.
Do the next step of the plan: the first unticked box of the checklist in docs/restructure/README.md whose
prerequisites are done. When it is completely done, go on to the next one, and keep going for as long as you can
finish each step completely. Stop only on a STOP condition of §6.
Never push, open a pull request, merge or deploy. Report to me in Levantine Arabic as §11 says.
```

**(B) One named step** (when the owner wants a specific one):

```
Read AGENTS.md, then docs/restructure/BUILD-PROMPTS.md, and follow its session protocol (§2) exactly.
Do step <ID> only (its card is in docs/restructure/BUILD-STEPS.md). Never push, open a pull request, merge or deploy.
Report to me in Levantine Arabic as §11 says.
```

**(C) «ارفع» — the owner allows the work to leave the machine:**

```
Read AGENTS.md and docs/restructure/BUILD-PROMPTS.md §4. I allow pushing now.
Push ONLY the oldest unmerged step branch and open its pull request (base main) with the text of its file in
docs/restructure/pr/. Wait for CI. If CI is red, fix it and tell me. Do not merge: I merge.
```

**(D) «اندمج» — after the owner merged a pull request:**

```
Read docs/restructure/BUILD-PROMPTS.md §4. I merged the pull request of step <ID>.
Update main, move the rest of the stack onto it as §4 says, run every gate again on the next step branch, push it
and open its pull request.
```

**(E) «شيك» — the owner looked at the live site and found something:**

```
Read AGENTS.md and docs/restructure/BUILD-PROMPTS.md. On the live site I saw this: <what he saw, in his words>.
Find the step it belongs to, write a failing test that shows it, fix the blockers only as new commits where §4 says
(the newest branch of the stack, or a new branch from main), run every gate, and report.
```

After step S0 (see `BUILD-STEPS.md`) the words «كمّل البناء» alone are enough: S0 adds a pointer to this file in
`AGENTS.md`.

## 2. The session protocol — do these in order, every session

1. **Orient.** Read `AGENTS.md` (all of it), `docs/restructure/README.md` (the rules R1–R16, the switch table, the
   checklist), this file, then the card of your step in `BUILD-STEPS.md`, then the section of the phase file the card
   names, then the rows of `DECISIONS.md` the card names. Do not read the other phase files: they are not your step.
2. **Find the step.** The first unticked box of README's checklist, read on the TIP OF THE STACK (the newest finished
   step branch; `main` once everything is merged). Two kinds of box are the owner's, not yours: `P0.0` and every `✋`.
   They are ticked only when his answer is recorded — pass over them when you choose the next step. Skip a step
   only when its card says it may be skipped (optional, or waiting for the owner), and say in the report that you
   skipped it and why.
3. **Find where things stand.** `git status`, `git branch --list`, `git log --oneline -15`. A step branch that exists
   and is unfinished is continued, never restarted. Uncommitted changes that are not yours: stop and ask. (At S0 the
   untracked `docs/restructure/` IS the plan: commit it.)
   **The baseline, once per session before the first change:** the machine has Node 22 (what CI uses), the packages
   installed with `npm ci` (never `npm install`), a `.env` made from `.env.example` as `AGENTS.md` says, and the
   local database for `test:db`. Run the seven gates on the branch you start from. A gate that is red BEFORE you
   changed anything is written under "noticed" and reported — it is not yours to fix inside the step, and nothing
   is weakened to make it green.
4. **Branch.** Follow §4 (the base rule). One step = one branch = one agent.
5. **Check the plan against the code.** For every file, function, table, column, route and test the card and the spec
   name, confirm with a search that it exists and does what the plan says. Write what differs in the PR file under
   "noticed". Search for what already does the job before adding anything (R9).
6. **Write the Definition of Done first** in `docs/restructure/pr/<ID>.md` (template in §10): what must work · the
   tests · the edge cases that matter · the blockers. Review later checks against that and nothing else.
7. **Test first.** Write the test that fails for the right reason, run it, keep the red output for the PR file. An
   access rule is proven in `tests/db/` against a real database. Then write the smallest change that makes it green.
8. **Gates, in this order, before every commit:** `npm run typecheck` · `npm run lint` · `npm test` ·
   `node scripts/lint-migrations.mjs` · `npm run test:db` · `npm run scan:secrets` · `npm run build`. A gate you could
   not run is reported as NOT RUN with the reason — never as passed.
   If `npm run test:db` cannot run (no local database): bring it up as `AGENTS.md` says (`docker compose up db -d`,
   `TEST_DATABASE_ADMIN_URL`), once. If it still cannot run, STOP at any step whose card lists a database test: that
   test IS the step's proof, and a step is never ticked unproven.
9. **Review your own diff** with the list of §8 before you call the step done.
10. **Close the step in its own branch:** tick its boxes in the phase file and in README's checklist, add a row to
    README's progress log, finish the PR file (red run pasted, "noticed, not fixed", owner actions, switches, how to
    turn it back). Small commits, each green. Do not push.
11. **Report** to the owner as §11 says.
12. **Go on to the next step** (the owner's standing instruction in `AGENTS.md`: phases run back to back) unless a STOP
    condition of §6 applies or you cannot finish the next step completely in what is left of the session. Never leave
    a step half done without saying exactly what is left in its PR file under "left to do".

At the END OF A PHASE (the last step of P0, F0, Q1, D1, C1, F1, N1, C2, C3, C4, M1, W1, A1+A2, I1): run the
independent review of §7 before starting the next phase.

## 3. What a step may and may not change

- Only what the card and its spec section ask for. Anything else you notice goes under "noticed, not fixed" in the PR
  file, with the file and line — it is not fixed in the same branch.
- **Never remove a feature, a screen, a route, a table, a column or a test.** The new thing goes behind its feature
  switch (R7), the old thing keeps working and is marked ⚠️ + 🔧 on screen. Old addresses keep answering.
- **Never weaken a test to make it pass.** A test that pins a privacy or security rule changes only with the owner's
  recorded answer (R14). A test that pins an old BEHAVIOUR the step replaces is rewritten to pin the new behaviour,
  and the PR file says which test, what it pinned before, what it pins now.
- **Never edit another system's repository** (the orders system, the media buyer, n8n, the replies system). What they
  must change is written as ONE ordered prompt per repository in `docs/restructure/ordered-prompts/<repo>-<ID>.md`
  (§9). The Workspace side always has a stated fallback until they change.
- **No new dependency** unless an installed one cannot do it (R11); say why in the PR file.
- **Migrations** are additive, one concern per folder, never against a shared database, never a reset (R4).

## 4. Branches — one straight stack, and what happens when the owner says «ارفع»

Nothing leaves the machine until the owner says so, and phases run back to back. So finished steps pile up locally,
as ONE straight line of branches in build order. (`AGENTS.md` and README R1 say "from an up-to-date `main`"; step S0
adds this stacking rule to `AGENTS.md`, because the owner asked for the build to continue without waiting.)

- **Base of a new step branch:** the last finished step branch — always, whatever the card's "After" says. "After"
  only names what must already be inside that line. When everything is merged, the base is `main` (after
  `git fetch origin && git merge origin/main`). Never fork sideways from an older branch: every branch ticks the
  same checklist, so two forks would conflict.
- A box counts for the next step as soon as it is ticked on the branch that step is built on. It counts for the
  owner when that branch is merged.
- Write the base in the PR file's first line: `Base: <branch>` (drop that line when the text is pasted into the
  pull request: there the first lines are the Definition of Done).
- Branch names are on the cards. One branch per step; the F0 phase is one branch with one commit per item; a card
  that names two branches is built as two steps.
- **A fix found later** (the independent review of §7, or the owner's «شيك») is a NEW commit on the newest branch of
  the stack, named `fix(<ID>): …` — or a new branch from `main` when everything is merged. Never rewrite or amend a
  lower branch of the stack.
- **When the owner says «ارفع»:** push ONLY the oldest unmerged branch and open its pull request (base `main`) with
  the text of its PR file. If the `gh` tool is missing, push, then give the owner the branch name and the PR file:
  he opens the request on the site. Wait for CI. Red or conflicting is never merged; fix with a new commit.
- **When the owner says a pull request is merged:** `git fetch origin`; move the whole rest of the stack onto the
  new `main` in one go from the newest branch — `git checkout <newest>` then
  `git rebase --update-refs --onto origin/main <merged branch>` (it moves every branch in between too; if the
  installed git is too old for `--update-refs`, rebase the branches one by one, oldest first, each `--onto` the new
  tip of the one below). Run every gate on the next step branch, push it, open its pull request. The branches above
  it were never pushed, so nothing needs a forced push.
- The owner merges, deploys and checks the live site. The builder never does.
- If two builders work at once (README "Order"), each keeps its own straight stack on its track's files and never
  touches the other's branches.

## 5. Decisions — how to build while an answer is waiting

`DECISIONS.md` lists 36 waiting decisions, each with a recommended default. The rule:

- Build the **recommended default**, behind the step's feature switch, and mark the place on screen «بانتظار المالك»
  where the choice is visible. A waiting decision never blocks a step.
- Ask each question ONCE, in the step's report, in Levantine Arabic, the recommended answer first. The moment you
  ask, write «انسأل <التاريخ>» in that row's answer column of `DECISIONS.md` (so the next session knows); the moment
  he answers, write the answer and its date there. Do not ask again.
- **A default that would change an existing test waits for the answer** (`DECISIONS.md`, first lines). These need
  more care than "build the default":

| Decision | Why it is special | What to build until he answers |
|---|---|---|
| D-N2 (one chat list, or one list per space) | reverses the owner's decision of 2026-10-25 if "one list" is chosen | BOTH shapes (C1.2 serves both); the switch `chatOneList` stays OFF = today's behaviour |
| D-N3 («الشركة» holds no projects) | the recommended answer KEEPS his earlier decision | keep it; never add projects to «الشركة» |
| D-A2 (who is a space manager) | changing it changes three pinned tests | everything else of A1.3; leave `isSpaceManager` and its tests as they are until he answers |
| D-D1 (the new look becomes the default) | changes what everybody sees and a pinned test | both themes selectable; `themeV2Default` stays OFF; the manifest test keeps its assertions and gains a case for the switch ON |
| D-P2 (a new task with an assignee is private by default) | may turn an existing task test red | offer the control; if the default turns an old test red, keep SPACE as the default until he answers |
| D-N1 (the site and the app open on the chat) | `tests/pwa-manifest.test.ts` pins `start_url` | the setting exists and is unset = today's behaviour; the manifest's `start_url` does not change until he answers |
| D-W3 (departments, tickets and campaigns open to all staff) | a capability test pins the refusal without `directory.view` | make the TABS honest (they require `directory.view`); relax no page until he answers |
| D-A1 (who may delete a task) | changes a route's rule | the hint «بيحتاج كمان يكون مدير المساحة» only; the route's rule does not change until he answers |

- D-A4 says "leave as is": do not touch who flips company switches or who purges.
- D-Q3, D-I1, D-I2 are optional features: their steps (Q1.8, I1.4, I1.5) are SKIPPED until he says yes.
- The four answered rows at the top of `DECISIONS.md` are facts, not defaults.

## 6. STOP conditions — stop the step, report, wait

Stop when any of these is true (README R14, widened):

1. A test that pins a privacy or security rule would have to change.
2. A step would reverse an earlier decision of the owner, or needs an answer beyond its default (§5 table).
3. A migration would need `ALLOWED_DESTRUCTIVE.txt`, or any tool offers to reset, drop or wipe a database (answer no).
4. Anything could send a customer's name, number or address to an external model, or show a price to an external
   partner, or put a secret, a staff name, a private address or a live-account detail into a tracked file.
5. Money logic would change (wallets, cash, approvals of money) beyond what the card says.
6. The step needs something only the owner can do (§12) and has no fallback written on its card.
7. A gate is red and two honest attempts did not fix it — report the output, do not paper over it.
8. The code is so different from the plan that the step's intent is unclear.
9. Uncommitted work that is not yours is in the tree, or the branch you need was changed by somebody else.
10. `npm run test:db` cannot run and the step's proof is a database test (§2, step 8).

These are NOT reasons to stop: a waiting decision that has a default; an owner check ✋ (see §6a); a renamed file; a
missing owner action that has a fallback; the end of a step (go on to the next).

### 6a. What ✋ means while building

✋ gates **switching the phase on for everybody**, not writing the next step. At a ✋: finish the phase, run the
independent review, send the owner the check list of that ✋ (in `BUILD-STEPS.md`, already in Arabic), and go on
building the next phase. The phase's switches stay OFF until he answers «شيك»; then tick the ✋ box.

**P0 is the exception:** it has no switch to hold it back (it closes a real exposure). It is merged and deployed as
soon as CI is green and the owner says so; the five checks of ✋P0 are its LIVE check after that deploy, and a check
that fails comes back through prompt (E).

## 7. The independent review at the end of each phase

`AGENTS.md`: a phase ends only when every gate is green and an independent review has been answered.

- Start a FRESH reviewer (a subagent with no memory of the build). Give it: the phase file, the PR files of the
  phase's steps, and the diff of the phase (`git diff <base>...<last step branch>`). Do not give it your conclusions.
- Ask it for: defects against each Definition of Done; any place a person could read, count or be notified about
  something the rules hide from them; any feature removed instead of marked; any English on screen; any migration
  that is not additive; any secret or customer value.
- Check every finding in the code before acting. Fix blockers only, each with a failing test first, as NEW commits
  on the newest branch of the stack (§4). Write the findings and what you did about each in
  `docs/restructure/pr/<PHASE>-review.md`, committed there too.
- If no subagent tool exists in the session, say so in the report: the owner will ask for the review separately.

## 8. Review your own diff — the list

- [ ] Every new read path filters by the server's rules: `canRead` / `hasOversight` (chat), `taskVisibleWhere` /
      `canSeeTask` / `taskVisibleSql` (tasks), `requireWorkspace` / `accessibleWorkspaceIds` (spaces), `assertCan`
      (capabilities). No route compares a role name. A COUNT that includes hidden rows is a leak too.
- [ ] Every people query filters `status: "ACTIVE"` (or carries `// all-statuses: <reason>`).
- [ ] The owner (and an oversight reader) leaves no trace: no membership row, no "seen", no notification, no tick, no
      vote, no acknowledgement.
- [ ] A guest (external partner) gets no price, no staff directory, no customer record, and never writes.
- [ ] Privacy-matrix rows added for every new read path (`tests/db/privacy-matrix.test.ts`, after P0.5).
- [ ] Every string comes from `t()` and lives in the phase's own fragment; no key in two files; Western digits;
      no Latin outside the two allow-lists; errors travel as machine keys with their Arabic string.
- [ ] Colours from theme tokens only; no hex, no raw palette class; generated CSS rebuilt when tokens changed.
- [ ] The new thing is behind its switch; with the switch OFF the old screen and the old tests behave as before;
      the switch has its Arabic name and hint and `tests/features.test.ts` knows it.
- [ ] Route handlers are thin: zod, `withApi`, a service in `src/server/services/` or `src/server/chat/`.
- [ ] Pages get their user from `pageUser()` / `pageActor()`, never `currentUser()`.
- [ ] Migrations: additive; one concern per folder; an enum value alone in its folder; data moves separate, with
      `WHERE`, safe to repeat; `RELEASED.txt` untouched; `prisma migrate diff` empty; UTF-8 without BOM.
- [ ] A new environment variable is in `.env.example` and the README table.
- [ ] A new realtime kind is in `REALTIME_KINDS` (the one list of F0.4).
- [ ] No `window.location.reload()`, no new polling where the live line can tell.
- [ ] Nothing of Next 15/16 (`params` is not a promise here).
- [ ] Tests use invented values only («زبون تجريبي», a number like `0700000000`); no real name, number or address.
- [ ] No secret anywhere, including the PR file and commit messages.
- [ ] `docs/PHASE0-AUDIT.md` row updated when the step closes one (R16); `COVERAGE.md` still true.

## 9. Ordered prompts for other repositories

When a step needs another system to change (Q1.0 and I1.1 need the orders system), write
`docs/restructure/ordered-prompts/<repo>-<ID>.md`:

- first lines: which repository, why, and that it is executed THERE by that system's own session, never from here;
- the changes in the order they must be done, each small and additive in that system's own style;
- the contract (schema + one example) whose source is that repository — it is copied here verbatim later, never
  edited here;
- no secret, no private address, no customer value;
- what the Workspace does until the change lands (the fallback).

Tell the owner in the report: «في تعليمة جاهزة لنظام الطلبات — بتنلصق بجلسته».

## 10. The PR file — `docs/restructure/pr/<ID>.md`

One file per branch, named after the branch's first step: `pr/P0.1.md`; the F0 branch → `pr/F0.md`; a card with
two steps on one branch (`F1.1 + F1.2`) → `pr/F1.1.md`. The file is committed on its branch.

```
Base: <branch>
# <ID> — <title>

## Definition of Done
- What must work: …
- Tests: … (new) · … (must stay green)
- Edge cases that matter: …
- Blockers: CI red · an old test red · a secret exposed · a destructive migration · a published contract broken ·
  customer data to an external model · money logic changed without the owner · a feature removed instead of marked

## The failing test, before the change
<the red output, trimmed>

## What changed
- …

## Switches
<key> — default <ON|OFF> — what OFF looks like — how to turn it back

## Decisions used
D-… — built the default: … (waiting) | answered on <date>: …

## Owner actions
🔧 … (before merge | before switching on | none)

## Other repositories
ordered-prompts/<file> | none

## Noticed
- different from the plan: …
- noticed, not fixed: … (file:line)

## Left to do
none | …
```

## 11. The report to the owner — Levantine Arabic, no English word, results only

Short. What is now true, what he must do, what is risky. A risk is ⚠️ with its fix 🔧 under it. No file names, no
tool names, no step walk-through. Use this shape:

```
خلصت: <اسم الخطوة بكلمات عادية>.

شو صار:
- …

شو بدها منك:
- 🔧 …        (أو: ولا شي)

⚠️ <خطر إن وجد>
🔧 <حلّه>

سؤال واحد إذا لزم: <السؤال> — اقتراحي: <الجواب المقترح>

ما انرفع ولا اندمج شي. الفحوصات: <كلها خضرا | اللي ما اشتغل وليش>.
```

Never write "done" for something not verified: say what was run and what was not.

## 12. What only the owner can do — ask once, at the right step

| When | 🔧 The owner does | Until then the builder |
|---|---|---|
| before anything | reads `DECISIONS.md` (or accepts the defaults) | builds the defaults (§5) |
| P0.0 | decides who keeps the OWNER rank; makes sure no owner-rank account is on a temporary password; keeps a plain member account for testing | builds P0.1–P0.5 anyway |
| before P0.2 is DEPLOYED | runs the read-only `npx prisma migrate status` from the app container and sends the output | writes and tests the migration locally; the PR file says "do not deploy before the status check" |
| P0.6 | changes BOTH keystore passwords, stores the new ones as CI secrets | prepares the branch; never writes any value |
| any time | says «ارفع», merges, deploys, checks live | keeps stacking branches (§4) |
| Q1.0 | issues the orders-system token with the three scopes and pastes it in «التكاملات»; pastes the ordered prompt in that system's session | builds against the copied contract example; shows ⚠️ «مش موصول» + 🔧 on the card |
| Q1.0 and I1.1a | brings the contract example of the orders system's door, and of its order events, from that system's own session (the ordered prompt asks for them) | tests against a PROVISIONAL example under `tests/fixtures/`, named `*.provisional.json`, written from the phase file — never placed in `docs/contracts/` and never called "copied" |
| Q1.2 | installs the new Android build | the web keeps working; the app's three buttons say what is missing |
| after D1 | reviews the gallery, picks the accent, switches `themeV2Default` | leaves it OFF |
| each ✋ | looks at the live site, says «شيك», switches the phase's switches on | leaves them OFF, keeps building |
| I1.1a | adds this system as a receiver in the orders system | the receiver is built and tested with the copied signed example |
| F1.9 | flips the worker service in the deployment panel | the scheduler keeps running in the app process |

## 13. The machine and the commands

- The gates and the local database for `test:db` are described in `AGENTS.md` («Gates», «Running the database tests
  locally»). The harness makes and drops its own throw-away database and refuses any host but localhost.
- A new migration: `npx prisma migrate dev --create-only --name <name>` against the LOCAL throw-away database; read the
  SQL; commit it. Never `migrate dev` or `migrate reset` against a shared database. If a tool offers a reset: no.
- On Windows: write files as UTF-8 without a byte-order mark (PowerShell 5.1 `>` writes UTF-16 — never create SQL or
  JSON with it); enable long paths for git; keep line endings as the repository has them.
- After changing theme tokens: `npm run themes:css` and `npm run decor:css` (the first one needs its own runner:
  use the npm scripts, not `node` directly).
- **What the builder cannot verify alone — say so, never write it as measured:** the Android code (`android/` has no
  local build here; it is proven by the Android workflows on GitHub, which run only after «ارفع» — until that run
  is green the Android step is reported «مش مفحوص» and its box stays unticked); anything that needs a browser's
  performance panel, a throttled processor, a real phone or screenshots (C2 §10, F1's before / after, M1's
  side-by-side pictures). Record what the terminal CAN show (the build's route table, the number of database calls
  counted inside a test, server timing in a test) and list the rest under "Owner actions" for the ✋.
- Long commands (build, db tests) run in the background or with a generous timeout; never claim a result before it
  arrives.

## 14. The look — the approved preview

`docs/restructure/mockup/index.html` is the preview the owner approved on 2026-11-16 («مزبوط»). Open it in a browser;
the bar on top switches computer / phone and light / dark, and «جولة» jumps to each screen. The cards name the
address to open for each step (for example `mockup/index.html#p=chat&c=problems`, add `&m=phone` for the phone).

- It shows the LOOK AND FEEL: proportions, density, where things sit, what a row / bubble / sheet looks like.
- It is **not code to copy**: it is plain script with fixed colours and invented data. Build with the project's
  components, `t()`, theme tokens (D1) and the server's rules.
- Where the preview and a phase file differ, **the phase file wins** (the preview is smaller than the plan: for
  example it has no «اليوم» place and fewer folder tabs).
- Every name, number, product detail and message in it is invented.
