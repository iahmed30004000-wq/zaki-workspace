# C3 — The missing Telegram features, plus the owner's checklist

> Prerequisites: C2. Four sub-phases, each its own branch(es): C3a list features · C3b message features · C3c new
> message kinds (checklist, scheduled, silent) · C3d info panel and search. Order inside a sub-phase is free.
> Every table or column below was checked against `prisma/schema.prisma`: nothing existing already holds it
> (AGENTS.md «Extend, never rebuild»); where something close exists it is extended instead and named.

## C3a — List features

### C3a.1 Personal pin, archive, mark unread, mute presets
- [x] Migration (additive): `ConversationMember` + `pinnedAt TIMESTAMP(3) NULL`, `archivedAt TIMESTAMP(3) NULL`,
      `markedUnread BOOLEAN NOT NULL DEFAULT false`. (The moderator's `Conversation.pinnedAt` / `archivedAt` stay what they
      are: for everybody. These are «لإلي بس».) `mutedUntil` already exists — reuse it.
- [x] `PUT /api/chat/conversations/[id]/me` `{ pinned?, archived?, markedUnread?, mutedUntil? }` → service
      `setMyChatState` in `src/server/chat/read-state.ts`:
  - a row is upserted for an OPEN topic the person reads (same rule as `markRead`); for a restricted topic or a DM the
    row must already exist (no row = no audience = 404);
  - refused (404) while reading through oversight (no trace — the owner's rule);
  - personal pins: at most 10 per person (Telegram's limit 5–10), order kept in `UserChatOrder` scope `pins`.
- [x] Opening a conversation clears `markedUnread`.
- [x] An archived, NOT muted conversation comes back to the main list when a new message arrives after `archivedAt`
      (Telegram behaviour); a muted one stays archived.
- [x] Tests: DB (rules above), render (row menu items, archived row).

### C3a.2 Folders
- [x] Migration (additive): `User.chatPrefs JSONB NULL` — the person's chat preferences (also used by C4), validated
      by one zod schema in `src/lib/chat/prefs.ts`. Folders live in it: `folders: [{ id, name ≤ 12, emoji?, include:
      { dms?: bool, spaces?: bool, mentions?: bool, conversationIds: string[] ≤ 100, spaceIds: string[] ≤ 50 },
      exclude: { muted?: bool, read?: bool, archived?: bool } }] ≤ 10`, keyed by organization id.
- [x] `GET/PUT /api/me/chat-prefs` (the person's own row only; zod; 64 KB cap).
- [x] Filtering is client-side over the C1 list cache (`src/lib/chat/folders.ts`, pure, unit-tested).
- [ ] UI: folder tabs (C2) + «المجلدات» settings page (C4): create, rename, emoji, choose chats, reorder (drag). Built: `FolderTabs`
      (custom tabs), `FolderEditor` and the connected `ChatFoldersSettings`; NOT yet mounted: the list column and C4.1's page (`pr/C3a.2.md`).
- [x] The built-in tabs «الكل · غير مقروء · خاص · المساحات · ذكروني» are not stored; the person may hide them.

### C3a.3 Saved messages («الرسائل المحفوظة»)
- [x] A DM with oneself: `kind = "DM"`, `dmKey = "<me>|<me>"` (no space suffix: it is the person's, one per company, listed in every space), one `ConversationMember`. Service
      `openSavedMessages(ctx)` in `src/server/chat/dm.ts` (create-or-get, idempotent on `@@unique([orgId, dmKey])`; the loser of a race reads the winner's row). Door: `POST /api/chat/dm` `{ saved: true }`.
- [x] `loadConversationFacts`: for a self-DM, `dmOtherActive` = the viewer is ACTIVE (and not a guest).
- [x] Forward to «المحفوظة» from the message menu (registry id `saved`, v2 only); pinned on top of the list by default (C3a.1's `pinnedAt`, a person may unpin); Ctrl+0 (`savedShortcutOf`).
- [ ] No call button / no typing indicator / no ticks on a self-DM: built for the list row and the info panel; NOT for the pane header's call button, the composer's typing line and the single ✓ on my own message (`pr/C3a.3.md`).
- [x] Owner decision D-C3 (oversight of saved messages): built as the recommended default, **same rule as every DM** (switch `savedMessages` ON; the owner's answer is still pending) (the transparency
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
- [x] New table `LinkPreview` (`id`, `urlHash` unique, `url`, `title?`, `description?`, `siteName?`, `imageFileId?`,
      `status` OK|FAILED, `fetchedAt`) + `ChatMessage.previewId String?` (first link of the message). Nothing existing
      stores fetched page metadata.
- [x] Fetch after the send commits (in-app scheduler or fire-and-forget with logging), through
      `src/server/net-guard.ts` (public https only, no redirects to private addresses, 3 s timeout, 512 KB cap, HTML only).
      Read `og:title`, `og:description`, `og:site_name`, `og:image` (image downloaded through the same guard, ≤ 1 MB,
      sniffed, stored with `ingest` as purpose `CHAT`, served only through the attachment proxy).
- [x] New realtime kind `message.enriched` (add to `REALTIME_KINDS`; F0.4 makes replay carry it).
- [ ] Switch `linkPreviews` (default on); the sender can remove the preview (✕ in the composer before sending, and
      «شيل المعاينة» on own messages).
- [x] ⚠️ The server visits the link (the site sees the server's address, never the person's). 🔧 Documented in the
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
- [x] Speed 1× / 1.5× / 2× (persisted in prefs), continue to the next unheard voice note, a mini player bar under the
      header while playing and scrolling away (Telegram). Built (`pr/C3b-4.md`): `voiceSpeed` of `User.chatPrefs` (the field C3a.2 reserved), `src/lib/chat/voice-queue.ts` (pure `nextUnheard` + the shared engine), `VoicePlayer` plays through the engine, `voice-mini-player.tsx` mounted in `conversation-pane.tsx`. «Heard» is per device and per session (the server keeps no heard mark).

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
- [x] `ChatMessage.silent BOOLEAN NOT NULL DEFAULT false`; `notify.ts` sends no push and no sound for it (unread and
      the badge still count). «ابعت بدون صوت» on the send button's menu.

### C3c.3 Scheduled messages
- [x] New table `ScheduledChatMessage` (`id`, `orgId`, `conversationId`, `authorId`, `body`, `attachmentIds` JSON,
      `mentions` JSON, `replyToId?`, `silent`, `sendAt`, `status` PENDING|SENT|FAILED|CANCELLED, `messageId?`,
      `clientId` unique per author, `createdAt`). A separate table on purpose: a future message inside `ChatMessage` would
      need a "not yet" filter in every reader (≈ 60 queries) and one forgotten filter is a leak.
- [x] A job in `src/server/jobs/` (the in-app runner, every 30 s, idempotent by `clientId`) sends due rows through
      the normal `sendMessage` service AS the author, re-checking `canPost` at send time (a person who lost access sends
      nothing: FAILED, and they are told in a system note to themselves).
- [x] UI: «جدول الإرسال» (date + time picker, ≥ 1 minute, ≤ 365 days), a calendar icon in the composer when the
      conversation has scheduled messages → list with «ابعت هلّق» / «عدّل» / «احذف».
- [x] Tests: DB (send at time, permission re-check, cancel), job idempotency.

### C3c.4 Channels («قناة»)
- [x] No schema change: a topic of type ANNOUNCEMENTS with posting «للمشرفين» shows the megaphone icon and the word
      «قناة» in the list and the header; non-posters see «بس المشرفين بينشروا هون» instead of the composer (today's
      `chatc.bar.announcements`).
      Built (C3c.4): `isChannelTopic` (row-preview.ts), `rowChannelWord` (list row), `channelOf` (header), `composerBarOf` returns the new
      `channel` bar (key `chatc.bar.channel`, «بس المشرفين بينشروا هون») only for ANNOUNCEMENTS with `postingPolicy` ADMINS and `me.canPost` false.
      The old key `chatc.bar.announcements` ("هذا الموضوع للقراءة فقط") stays for announcements everybody may post in (a guest never posts there).

## C3d — Info panel tabs and search

- [x] `GET /api/chat/conversations/[id]/media?kind=IMAGE|VIDEO|FILE|AUDIO|LINK&before=&limit=60` — attachments of
      non-deleted messages (and messages with a `previewId` for LINK), after `canRead`; never the files of a deleted
      message.
- [x] Tab «الشغل»: tasks and tickets whose `sourceMessage.conversationId` is this conversation, filtered by P0.2 task
      visibility and ticket access.
- [x] Tab «المثبّتة»: the pinned messages.
- [x] List search (C2 header): one request `GET /api/search?scope=chat&q=` (extend `src/app/api/search/route.ts`) returning
      chats (topics/DMs/spaces by title), people (directory rules: guests get names only), messages (snippet, chat,
      date) — the existing Arabic folding search and its access rule (`src/server/chat/search.ts`).
- [x] In-chat search: ↑/↓ between hits, «من:» person filter, date jump (calendar) — extend `conversation-search.tsx`.

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
| C3c.1 | `chatChecklists` | off |
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

### C3d Info-panel tabs, the list's search and the in-chat search (`feat/chat-info-search`, `pr/C3d.md`)
- Built: `GET …/media?kind=&before=&limit=` and `?counts=1` and `GET …/media/work` (`src/server/chat/media.ts`: never the file of a deleted message, the owner too; the work tab by P0.2's task rule and the ticket door's rule, a guest none; read-only, so the silent eye leaves no trace), the info panel's six tabs (drawn only when they have data), the media viewer reading the route (`mergeViewerItems`), `GET /api/search?scope=chat&q=` → `{ chats, people, messages }` (the existing folding search and reading rule; the directory rule for people: a guest gets names only) shown as a panel under the list's field and the phone's bar, and the in-chat search's ↑/↓, «من:» and date jump (`conversation-search.tsx` extended, the old screen unchanged). No schema, no new switch.
- Decision: the in-chat search goes through `/api/search?scope=chat&conversationId=` because the old per-conversation route is another package's file; a guest never gets the «الشغل» tab.
- Not wired by this package (files of other packages): `pending-search.ts` is untouched (nothing needed it); `message-bubble.tsx` still has to pass `albums` (C3b.3). Details in `pr/C3d.md`.

### C3b.2 Link previews (`feat/link-previews`, `pr/C3b-2.md`)
- Built: the table `LinkPreview` + `ChatMessage.previewId`, `src/server/chat/link-preview.ts` (the guarded fetch, the tag parser, the after-send step), `message.enriched` (sync returns the presented message), `DELETE …/messages/[id]/preview` (author only) and `GET …/preview/image` (the only way the picture is served), the DTO `preview`, the switch `linkPreviews` (ON), the guide's warning, the card `LinkPreviewCard`, the composer's ✕ line, the menu id `removePreview`. Switch OFF: no fetch, no card from send and sync, the routes 404, the data stays.
- Decision: the picture is stored with `ingest` as `CHAT` and then tagged `LINKPREVIEW`, because `purgeOrphanUploads` deletes every unclaimed `CHAT` file after 24 hours. A one-line `purgeOrphanUploads` change (skip files a `LinkPreview` points at) would let it stay `CHAT`; say if you prefer that.
- Not wired by this package (files of other packages): `topics.ts` (the messages window) must pass `linkPreviews` in its viewer so the switch hides cards there too; `message-bubble.tsx` must draw `<LinkPreviewCard preview={message.preview} />`; `menu-host.tsx` must run `removePreview` (DELETE); `use-composer.ts` must send `noPreview` while `ComposerSurface` reports `onNoPreviewChange(true)`. Details in `pr/C3b-2.md`.

### C3a.1 Personal pin, archive, mark unread, mute presets (`feat/chat-personal-state`, `pr/C3a.1.md`)
- Built: the three columns, `PUT …/me` (`setMyChatState`), the flags in the ONE list query and the sync rows, one event for the person alone, the row menu items and the mute presets, the «الأرشيف» tab, the pins' order, the forum view's rules, the sidebar number that leaves out an archived chat. Switch `chatPersonalState` (ON).
- Decision: a pin of a never-opened open topic makes the row with the read mark at «now» (as `markRead` does), so its old history stops counting as unread for that person; the alternative would put a whole topic's history into the sidebar number. Say if it should be the other way.
- Not built (files of other packages): the personal mute does not stop a push yet (`notify.ts`); pins cannot be dragged (`scopeSchema` of `src/lib/chat/order.ts` does not accept `pins`); the C1.2 «`removed` for people dropped without a row» gap. Details in `pr/C3a.1.md`.

### C3a.2 Folders (`feat/chat-folders`, `pr/C3a.2.md`)
- Built: the additive column `User.chatPrefs` and its ONE zod schema (`src/lib/chat/prefs.ts`: folders by company id, `tabs.hidden`, room for C4.1's `notifications` and `chat` and C3b.4's `voiceSpeed`), `GET/PUT /api/me/chat-prefs` (a PATCH, the caller's own row, 64 KB), the pure filter and tab logic (`src/lib/chat/folders.ts`), the custom tabs in `FolderTabs`, the reusable `FolderEditor` and the connected `ChatFoldersSettings`, switch `chatFolders` (ON).
- Decision: the exclusions (muted · read · archived) take out of everything a folder holds, chats picked by hand included; a chat the person archived is in a folder unless the folder excludes the archive (the editor makes new folders exclude it). Say if a hand-picked chat should survive the exclusions.
- Not wired by this package (files of other packages): `chat-list-column.tsx` must call `useChatPrefs` + `tabsOf` + `folderRows` / `folderBadge` (six lines, in `pr/C3a.2.md`), and C4.1's «المجلدات» page must mount `ChatFoldersSettings`. In the one-list shape a topic is folded into its space's row, so a topic is reached through its space (the picker offers private chats and groups; whole spaces are a separate list).

### C3c.2 Send without sound (`feat/chat-silent-send`, `pr/C3c.2.md`)
- Built: `ChatMessage.silent` (one additive migration), `sendSchema.silent` (honoured only while `chatSilentSend` is on), `notify.ts` (`silent`: no bell row, no push, a mention included; unread counts and the mention list come from the message rows and are untouched), `MessageDto.silent` + `arrivalSoundOf` (no arrival sound), the flag carried by the optimistic send, the outbox (kept through a reload and every retry) and the request, `send-menu.tsx` (right-click, long press; one item now, built so C3c.3's «جدول الإرسال» is one id and one line), `useComposer.submitSilent`.
- Hot spot: `notify.ts` is also edited by C3b.1, C4.1 and M1a. This package adds ONE option (`silent`) and ONE early return at the top of `notifyMessageToAudience`; nothing else in the file moves.
- Not wired by this package (files of other packages): `redact.ts` (`presentMessage`) must set `dto.silent = true` for a row with `silent` and `MessageRow` must carry `silent?: boolean` (the answer to the SENDER is already marked by `messages.ts`; every other reader goes through `presentMessage`, so the other screen's sound rule cannot see it until then); `topics.ts` must set `silentSend` on the conversation header next to `chatOutbox` (`isFeatureOn(ctx.orgId, "chatSilentSend")`), or the menu entry stays on when the switch is off (the server still ignores the flag then). Details in `pr/C3c.2.md`.

### C3c.3 Scheduled messages (`feat/chat-scheduled`, `pr/C3c.3.md`)
- Built: the table `ScheduledChatMessage` + its status enum (one additive migration; the extra columns `noPreview` and `failReason` beside the spec's list), `src/server/chat/scheduled.ts` (the author's own list / create / edit / cancel / send-now, and `deliverScheduled`: the claim with `FOR UPDATE SKIP LOCKED`, the normal `sendMessage` AS the author with the clientId `sch:<id>`, the permission re-check, FAILED + a bell note), `src/server/jobs/chat-scheduled.ts` (called FIRST in the scheduler's locked tick, so it runs in the worker with `JOBS_IN_WORKER=1`), the routes `GET/POST /api/chat/conversations/[id]/scheduled`, `PATCH/DELETE /api/chat/scheduled/[id]`, `POST /api/chat/scheduled/[id]/send`, the send menu's «جدول الإرسال», the dialog (date + time in the company's zone), the list with «ابعت هلّق» / «عدّل» / «احذف» and the calendar icon. Switch `chatScheduled` (ON).
- Decisions: a row more than a day late when the job reaches it is FAILED (not sent) and its author is told; the words of a sent or cancelled row are blanked; a message with files must go out within 24 hours of the upload (the 24-hour orphan purge and the claim window; `attachments.ts` is not this package's); finished rows are removed after 30 days.
- Not wired by this package (files of other packages): `tests/chat-v2-composer-seam.test.ts` pins the composer's doors to the old three and now needs `/api/chat/conversations` and `/api/chat/scheduled` in its list (details in `pr/C3c.3.md`); the conversation header could carry the switch and the number of waiting rows so the composer needs no request of its own.
