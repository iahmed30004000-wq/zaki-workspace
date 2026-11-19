# C3 — The missing Telegram features, plus the owner's checklist

> Prerequisites: C2. Four sub-phases, each its own branch(es): C3a list features · C3b message features · C3c new
> message kinds (checklist, scheduled, silent) · C3d info panel and search. Order inside a sub-phase is free.
> Every table or column below was checked against `prisma/schema.prisma`: nothing existing already holds it
> (AGENTS.md «Extend, never rebuild»); where something close exists it is extended instead and named.

## C3a — List features

### C3a.1 Personal pin, archive, mark unread, mute presets
- [ ] Migration (additive): `ConversationMember` + `pinnedAt TIMESTAMP(3) NULL`, `archivedAt TIMESTAMP(3) NULL`,
      `markedUnread BOOLEAN NOT NULL DEFAULT false`. (The moderator's `Conversation.pinnedAt` / `archivedAt` stay what they
      are: for everybody. These are «لإلي بس».) `mutedUntil` already exists — reuse it.
- [ ] `PUT /api/chat/conversations/[id]/me` `{ pinned?, archived?, markedUnread?, mutedUntil? }` → service
      `setMyChatState` in `src/server/chat/read-state.ts`:
  - a row is upserted for an OPEN topic the person reads (same rule as `markRead`); for a restricted topic or a DM the
    row must already exist (no row = no audience = 404);
  - refused (404) while reading through oversight (no trace — the owner's rule);
  - personal pins: at most 10 per person (Telegram's limit 5–10), order kept in `UserChatOrder` scope `pins`.
- [ ] Opening a conversation clears `markedUnread`.
- [ ] An archived, NOT muted conversation comes back to the main list when a new message arrives after `archivedAt`
      (Telegram behaviour); a muted one stays archived.
- [ ] Tests: DB (rules above), render (row menu items, archived row).

### C3a.2 Folders
- [ ] Migration (additive): `User.chatPrefs JSONB NULL` — the person's chat preferences (also used by C4), validated
      by one zod schema in `src/lib/chat/prefs.ts`. Folders live in it: `folders: [{ id, name ≤ 12, emoji?, include:
      { dms?: bool, spaces?: bool, mentions?: bool, conversationIds: string[] ≤ 100, spaceIds: string[] ≤ 50 },
      exclude: { muted?: bool, read?: bool, archived?: bool } }] ≤ 10`, keyed by organization id.
- [ ] `GET/PUT /api/me/chat-prefs` (the person's own row only; zod; 64 KB cap).
- [ ] Filtering is client-side over the C1 list cache (`src/lib/chat/folders.ts`, pure, unit-tested).
- [ ] UI: folder tabs (C2) + «المجلدات» settings page (C4): create, rename, emoji, choose chats, reorder (drag).
- [ ] The built-in tabs «الكل · غير مقروء · خاص · المساحات · ذكروني» are not stored; the person may hide them.

### C3a.3 Saved messages («الرسائل المحفوظة»)
- [ ] A DM with oneself: `kind = "DM"`, `dmKey = "<me>|<me>"`, one `ConversationMember`. Service
      `openSavedMessages(ctx)` in `src/server/chat/dm.ts` (create-or-get, idempotent on `@@unique([orgId, dmKey])`).
- [ ] `loadConversationFacts`: for a self-DM, `dmOtherActive` = the viewer is ACTIVE.
- [ ] Forward to «المحفوظة» from the message menu; pinned on top of the list by default; Ctrl+0.
- [ ] Owner decision D-C3 (oversight of saved messages): recommended **same rule as every DM** (the transparency
      notice already says work chats are visible to the owner) and the info panel says so in one line.

## C3b — Message features

### C3b.1 Text formatting
- [ ] Stored as text in `body` (no schema change): `**عريض**`, `__مائل__`, `~~مشطوب~~`, `` `كود` ``, ```` ```كتلة``` ````,
      `||مخفي||` (spoiler), lines starting with `> ` (quote), `[نص](https://…)`, bare links auto-linked.
- [ ] One pure parser `src/lib/chat/format/parse.ts` → tokens → React elements (`render.tsx`). NO
      `dangerouslySetInnerHTML`. Links: `https:` / `http:` / `mailto:` only, `rel="noopener noreferrer"`,
      `target="_blank"`; internal links (`/chat/…`, `/tasks/…`) open in-app.
- [ ] Composer: selection toolbar + Ctrl+B / I / U / Shift+X / Shift+M / K.
- [ ] Previews in the list, notifications, search snippets and the AI paths strip the markers (`stripFormatting()`).
- [ ] Seen live: an assistant answer printed raw math markup (`\( … \)`, `\frac{…}`). The assistant's system text asks
      for plain text with no math markup, and the renderer shows any leftover markup as plain characters without the
      backslashes (no math library is added).
- [ ] Unit tests: every marker, nesting, unclosed markers, RTL/LTR mix, injection attempts (`<script>`,
      `javascript:` links, HTML entities), 10 000-character body under 5 ms.

### C3b.2 Link previews
- [ ] New table `LinkPreview` (`id`, `urlHash` unique, `url`, `title?`, `description?`, `siteName?`, `imageFileId?`,
      `status` OK|FAILED, `fetchedAt`) + `ChatMessage.previewId String?` (first link of the message). Nothing existing
      stores fetched page metadata.
- [ ] Fetch after the send commits (in-app scheduler or fire-and-forget with logging), through
      `src/server/net-guard.ts` (public https only, no redirects to private addresses, 3 s timeout, 512 KB cap, HTML only).
      Read `og:title`, `og:description`, `og:site_name`, `og:image` (image downloaded through the same guard, ≤ 1 MB,
      sniffed, stored with `ingest` as purpose `CHAT`, served only through the attachment proxy).
- [ ] New realtime kind `message.enriched` (add to `REALTIME_KINDS`; F0.4 makes replay carry it).
- [ ] Switch `linkPreviews` (default on); the sender can remove the preview (✕ in the composer before sending, and
      «شيل المعاينة» on own messages).
- [ ] ⚠️ The server visits the link (the site sees the server's address, never the person's). 🔧 Documented in the
      guide; links inside topics with an external partner still preview (no company data is sent).

### C3b.3 Albums and the media viewer
- [ ] Albums: a message with 2–10 pictures/videos renders a mosaic (1 full · 2 side by side · 3 one big + two · 4 a 2×2 ·
      5–10 rows of 2–3), from attachment `width/height` (pure layout function `src/lib/chat/album-layout.ts`, unit-tested).
- [ ] The composer can send up to 10 media in one message with one caption (today's attachment limit permitting —
      check `chatc.too_many_files` and raise it to 10 if lower).
- [ ] Media viewer (`src/components/chat/v2/media-viewer.tsx`): full screen over everything, ←/→ and swipe between the
      conversation's media, wheel/pinch zoom, double-tap zoom, download, «اعرض بالمحادثة», caption, Esc closes;
      videos with native controls. Uses `GET /api/chat/conversations/[id]/media` (C3d) for prev/next beyond the album.

### C3b.4 Voice notes
- [ ] Speed 1× / 1.5× / 2× (persisted in prefs), continue to the next unheard voice note, a mini player bar under the
      header while playing and scrolling away (Telegram).

### C3b.5 Multi-select and forwarding many
- [ ] «حدّد» enters selection: checkboxes on bubbles, a top bar with the count and actions «حوّل · انسخ · احذف ·
      اعمل مهمة». Esc leaves.
- [ ] `POST /api/chat/messages/forward` `{ messageIds ≤ 100, targetIds ≤ 10, withoutAuthor?: bool }` — reuses the
      existing `forwardMessage` rules per pair (target `canPost`, source `canRead`, polls excluded); one transaction per
      target; partial failure reported per target.
- [ ] `POST /api/chat/messages/delete` `{ ids ≤ 100 }` — reuses `deleteMessage` per id (own or moderator).
- [ ] «اعمل مهمة» from a selection: ONE task, title from the first message (`titleOf`), description = the selected
      messages quoted with author and time; `sourceMessageId` = the first; visibility per P0.3.

### C3b.6 Jump buttons and «مين شاف»
- [ ] `GET /api/chat/conversations/[id]/mentions?after=` → unread message ids mentioning me (the «@» button walks them). Built (`pr/C3b.6.md`): the door, the walk's hook `useMentionsWalk` in `floating.tsx`; ⚠️ the pane's `message-viewport.tsx` still has to call the hook (another package's file).
- [x] «مين شاف» in the message menu (topics): today's readers list in a small sheet. Already built in C2.6 (`pr/C2.6+C2.7.md`); checked in C3b.6, nothing added.

## C3c — New message kinds

### C3c.1 Checklist («قائمة مهام» — the owner's ask «ضيف خانة شيك ليست», 2026-11-16; D-C4)
Why new tables: a poll stores one choice per person (`PollVote`); a task step (`TaskStep`) needs a `Task`, which needs
a project, a board and a column — the heavy path a quick list in a chat must avoid. A chat checklist is items with
ONE shared done-state each.
- [ ] Migration (additive, a new table pair): `ChatChecklist` (`id`, `messageId` unique → `ChatMessage` cascade,
      `othersCanAdd` bool default false, `othersCanTick` bool default true, `createdAt`) and `ChatChecklistItem` (`id`,
      `checklistId` cascade, `text` ≤ 200, `position`, `addedById`, `doneById?`, `doneAt?`, `createdAt`;
      index `(checklistId, position)`). ≤ 30 items.
- [ ] `ChatMessage.kind` gains the value `CHECKLIST` (a text column — no enum change); the body is the title.
- [ ] Send: the message POST accepts `checklist: { items: string[1..30], othersCanAdd?, othersCanTick? }`.
- [ ] `POST /api/chat/messages/[id]/checklist/items` (add — the author, or anyone who may post when `othersCanAdd`);
      `PUT /api/chat/messages/[id]/checklist/items/[itemId]` `{ done }` (the author, or anyone who may post when
      `othersCanTick`); `PATCH …/[itemId]` `{ text }` and `DELETE` (the author of the list or of the item, moderators).
      Oversight readers cannot tick (no trace — same as polls).
- [ ] New realtime kind `checklist.changed` (ids only) → sync returns the presented message.
- [ ] Bubble: title, items with checkboxes, «خلّصها فلان · 10:20» under a done item, progress «3 من 5», «+ أضف بند»
      when allowed. List preview «☑️ العنوان (3/5)».
- [ ] Menu: «اعمل منها مهمة» → `createTask` with one `TaskStep` per item (existing steps service), done items marked
      done; the task links back (`sourceMessageId`).
- [ ] Attach menu entry «قائمة مهام»; a dialog like `PollDialog`.
- [ ] Tests: DB (who may add / tick / edit; oversight cannot; guest rules like polls; privacy matrix row), render.

### C3c.2 Send without sound
- [ ] `ChatMessage.silent BOOLEAN NOT NULL DEFAULT false`; `notify.ts` sends no push and no sound for it (unread and
      the badge still count). «ابعت بدون صوت» on the send button's menu.

### C3c.3 Scheduled messages
- [ ] New table `ScheduledChatMessage` (`id`, `orgId`, `conversationId`, `authorId`, `body`, `attachmentIds` JSON,
      `mentions` JSON, `replyToId?`, `silent`, `sendAt`, `status` PENDING|SENT|FAILED|CANCELLED, `messageId?`,
      `clientId` unique per author, `createdAt`). A separate table on purpose: a future message inside `ChatMessage` would
      need a "not yet" filter in every reader (≈ 60 queries) and one forgotten filter is a leak.
- [ ] A job in `src/server/jobs/` (the in-app runner, every 30 s, idempotent by `clientId`) sends due rows through
      the normal `sendMessage` service AS the author, re-checking `canPost` at send time (a person who lost access sends
      nothing: FAILED, and they are told in a system note to themselves).
- [ ] UI: «جدول الإرسال» (date + time picker, ≥ 1 minute, ≤ 365 days), a calendar icon in the composer when the
      conversation has scheduled messages → list with «ابعت هلّق» / «عدّل» / «احذف».
- [ ] Tests: DB (send at time, permission re-check, cancel), job idempotency.

### C3c.4 Channels («قناة»)
- [ ] No schema change: a topic of type ANNOUNCEMENTS with posting «للمشرفين» shows the megaphone icon and the word
      «قناة» in the list and the header; non-posters see «بس المشرفين بينشروا هون» instead of the composer (today's
      `chatc.bar.announcements`).

## C3d — Info panel tabs and search

- [ ] `GET /api/chat/conversations/[id]/media?kind=IMAGE|VIDEO|FILE|AUDIO|LINK&before=&limit=60` — attachments of
      non-deleted messages (and messages with a `previewId` for LINK), after `canRead`; never the files of a deleted
      message.
- [ ] Tab «الشغل»: tasks and tickets whose `sourceMessage.conversationId` is this conversation, filtered by P0.2 task
      visibility and ticket access.
- [ ] Tab «المثبّتة»: the pinned messages.
- [ ] List search (C2 header): one request `GET /api/search?scope=chat&q=` (extend `src/app/api/search/route.ts`) returning
      chats (topics/DMs/spaces by title), people (directory rules: guests get names only), messages (snippet, chat,
      date) — the existing Arabic folding search and its access rule (`src/server/chat/search.ts`).
- [ ] In-chat search: ↑/↓ between hits, «من:» person filter, date jump (calendar) — extend `conversation-search.tsx`.

## Feature switches (each new feature has its own, R7)

| Step | Switch key | Default |
|---|---|---|
| C3a.1 | `chatPersonalState` (personal pin / archive / mark unread) | on |
| C3a.2 | `chatFolders` | on |
| C3a.3 | `savedMessages` | on |
| C3b.1 | `chatFormatting` | on |
| C3b.2 | `linkPreviews` | on |
| C3b.3 | `chatAlbums` (albums + media viewer) | on |
| C3b.5 | `chatMultiSelect` | on |
| C3c.1 | `chatChecklists` | on |
| C3c.2 | `chatSilentSend` | on |
| C3c.3 | `chatScheduled` | on |

Each key: added to `FEATURES` and the defaults in `src/lib/features.ts`, its Arabic name and hint in the features
dictionary (`src/lib/i18n/ar.features.json`), checked by `tests/features.test.ts`; OFF = the routes answer 404 and the
controls are not drawn, data already made stays.

## Definition of done (per sub-phase)

- Every new table/column has its additive migration, `RELEASED.txt` untouched until deployed, `migrate diff` empty.
- Every new route: zod, `withApi`, a policy check, a DB test including a refusal case, a privacy-matrix row.
- Strings in `src/lib/i18n/ar.chat-features.json`; no Latin on screen.
- The C2 acceptance checks still pass.

## Built notes

### C3b.1 Text formatting (`feat/chat-formatting`, `pr/C3b-1.md`)
- Built: `src/lib/chat/format/` (`parse.ts` blocks and inline tokens + `stripFormatting`, `links.ts` the link tokenizer C3b.2 reuses, `math.ts`, `render.tsx`), the new bubble body, the composer's selection toolbar and shortcuts, and the stripping in the list row, push, search snippet, `buildChatPrompt`, translate and the digest. No schema.
- Decision: the chat has no underline marker, so Ctrl+U is bound to the spoiler (`||`). Say if it should be left unbound.
- Not wired by this package (files of other packages): the `chatFormatting` switch reaches `BubbleBody` (`formatting`) and `ComposerSurface` (`formatting`) as optional props that default to ON; `ConversationDto` + `topics.ts` + `message-bubble.tsx` + `composer-host.tsx` still have to pass it. Details in `pr/C3b-1.md`.

### C3b.3 Albums and the media viewer (`feat/chat-albums`, `pr/C3b-3.md`)
- Built: `src/lib/chat/album-layout.ts` (the pure mosaic, `takeRoom` for the tray), `src/components/chat/v2/media-viewer.tsx` (the viewer, `viewerItemsOf` the one source function, `MediaViewerProvider`), the bubble's mosaic and the lone picture's button, `albumBox` and the opt-in album estimate in `viewport/sizes.ts`, the tray's count line and the pick-time limit of ten. No schema.
- Decision: `estimateRowHeight(row, { albums: true })` is opt-in because C1.7's pinned test says two pictures stack. Say if the album should be the default (one test changes).
- Not wired by this package (files of other packages): `chatAlbums` reaches `BubbleMedia` as the optional `albums` prop (default ON); `message-bubble.tsx` + the header DTO must pass it, the pane must wrap the messages in `MediaViewerProvider` (the viewer then steps through the whole loaded conversation and can jump to the message), and `use-message-viewport.ts` must pass `{ albums }` to the estimate. C3d swaps the one source function for `GET …/media`.
