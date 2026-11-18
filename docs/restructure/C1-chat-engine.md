# C1 — The chat engine: cache, deltas, history, speed

> Prerequisites: P0, F0. This phase changes how chat data moves; the screens of C2 sit on top of it. It must not
> change who may read what: every new endpoint goes through `src/server/policy/conversation.ts` and the redaction
> rules of `src/server/chat/redact.ts`, and `tests/db/privacy-matrix.test.ts` gains rows for each.

## Why (measured from the code at `main@6e21483`)

| Today | Where | Cost |
|---|---|---|
| Live frames carry ids only; every frame makes every open screen refetch | `src/server/realtime/hub.ts`, `src/components/chat/conversation/conversation-screen.tsx` (`useRealtime → refresh`), `chat-home-client.tsx` | One message in a topic with 10 viewers ≈ 800 database calls (refetch ≈ 30 calls each, read mark, refetch after the read event, visibility checks). |
| A conversation fetch ≈ 30 mostly sequential calls; `isFeatureOn` re-reads `Organization.settings` 7 times | `src/server/chat/topics.ts` `conversationDetail`, `src/server/services/features.ts` | Slow open, slow refetch. |
| Only the newest 40 messages are ever shown (`oldestId` is returned but never used) | `src/lib/chat/conversation/client.ts` `conversationDetailUrl`, `topics.ts` | No history. |
| No client cache (`fetch` + `useState`, `cache: "no-store"`); RSC round trip then client fetch | chat components | Every open is a cold load. |
| Chat home: N+1 (3 queries per topic, a count per DM) | `src/server/chat/home.ts`, `src/server/chat/dm.ts` | Slow list. |
| Send path awaits ~20 queries + notifications before answering | `src/server/chat/messages.ts`, `src/server/chat/notify.ts` | The tick appears late. |
| Fan-out checks each connected client one by one (~8 calls each), awaits delivered marks inside the loop | `hub.ts`, `canReadConversation` | Latency grows with people online. |
| One EventSource per tab, polls for unread / presence / bell / workspaces, quick chat polls every 4 s | `use-realtime.ts`, `quick-chat.tsx`, `people-dock.tsx` | Battery, data, server load. |

Target («زي تيليجرام»): opening a cached chat paints in < 100 ms; a new message reaches an open screen in < 300 ms
on a good line; a message burst costs O(viewers) small requests, not O(viewers × 30); a reconnect loses and
duplicates nothing.

## C1.1 Data additions (additive migrations only)

- [ ] Migration A: `Conversation.lastMessageAt TIMESTAMP(3) NULL` + index `("orgId","lastMessageAt")`. Written in the
      `sendMessage` transaction (and on delete of the newest message: recompute in the same transaction).
- [ ] Migration B (data, separate): `UPDATE "Conversation" c SET "lastMessageAt" = m.max FROM (SELECT "conversationId",
      max("createdAt") AS max FROM "ChatMessage" WHERE "deletedAt" IS NULL GROUP BY 1) m WHERE m."conversationId" = c.id
      AND c."lastMessageAt" IS NULL;` (has a WHERE; safe to repeat).
- [ ] Index `ChatMessage ("conversationId","createdAt","id")` for the `(createdAt, id)` cursor (F0.8).

## C1.2 Server endpoints (thin routes, logic in `src/server/chat/*`)

| Route | Service | Returns |
|---|---|---|
| `GET /api/chat/list?spaceId=` | extend `src/server/chat/home.ts` with `chatList(ctx, { spaceId? })` (keep `chatHome` for the old screen). Without `spaceId`: every space and DM of the person (D-N2 "one list"); with it: one space, as today (D-N2 "each space is an account"). Build both; the switch `chatOneList` picks. | `ChatListDto`: one row per DM / space (forum) / saved messages; per row `id, kind, title, emoji/avatar, lastMessage {id, authorName, preview, kind, at, mine, status}, unread, mentionsUnread, muted, pinnedByMe, archivedByMe, markedUnread, restricted, topicChips[≤3]` (spaces). ONE SQL with `LATERAL` joins for last message + unread + mentions (no loop). Permission rule = today's home rules + P0.1. |
| `GET /api/chat/spaces/[spaceId]/topics` | `src/server/chat/space-topics.ts` | the forum view rows (same row shape, kind TOPIC). The route file exists with POST only (used by `new-topic-dialog.tsx`): add GET there. |
| `GET /api/chat/conversations/[id]/header` | split from `conversationDetail` | title, emoji, kind, space, audience, me-flags (`canPost`, `canModerate`, …), member count, pinned list, feature flags. |
| `GET /api/chat/conversations/[id]/messages?before=&after=&around=&limit=50` | split from `conversationDetail` | `{ messages, hasOlder, hasNewer, firstUnreadId }`, cursor `(createdAt,id)`. |
| `GET /api/chat/sync?after=<eventId>&limit=500` | NEW `src/server/chat/sync.ts` | the delta feed (below). |
| `GET /api/chat/conversations/[id]` | unchanged | kept for the old screen and the Android app until M1. |

Rules for all of them: read `Organization.settings` once per request (a request-scoped memo passed to
`isFeatureOn`, or a `Map` on the ctx object), run independent queries with `Promise.all`, present messages ONLY
through the existing presenter (`src/server/chat/dto.ts` + `redact.ts`), so a deleted message, a note, a revision
and the owner-only fields stay exactly as private as today.

**The sync feed** (Telegram's "get difference"):
```ts
type SyncDto = {
  cursor: string;               // the newest RealtimeEvent.id included
  reset?: true;                 // `after` older than the 48 h retention, or a gap: the client reloads list + open chat
  messages: MessageDto[];       // created / edited / reacted / pinned / poll-voted / deleted (tombstone) — presented for THIS viewer
  reads: { conversationId: string; userId: string; lastReadAt: string }[];
  delivered: { conversationId: string; userId: string; lastDeliveredAt: string }[];
  rows: ChatRowDto[];           // list rows whose summary changed
  removed: string[];            // conversations this viewer can no longer read (left, made private, offboarded peer)
};
```
- Read `RealtimeEvent` rows `id > after AND orgId = ctx.orgId ORDER BY id LIMIT 500`.
- Decide visibility for ALL conversations of the batch in ONE query (the set of ids the viewer may read — reuse the
  SQL shape of `unread.ts`, extended with restricted/team/DM rules and P0.1's oversight), never one `canRead` per row.
- Hydrate the touched messages in one `findMany({ where: { id: { in } }, include: messageInclude() })`.
- `typing`, `call.ring` and other ephemeral kinds are NOT in sync (they live on the stream only).
- DB tests (`tests/db/chat-sync.test.ts`): never returns a message of a conversation the viewer cannot read (restricted
  topic, other people's DM, other team, other org); a topic made private → its id in `removed` for the dropped people;
  a deleted message comes back as a tombstone without its text (unless the viewer is an oversight holder reading the
  archive — not through sync); `after` older than retention → `reset`.

**Carried over from Q1 (it ships before this phase, on the old screen):** the new endpoints and the sync feed present
the CARD message kind (its content resolved per viewer — a guest never gets a price), the order-number chips, the
ticket chip of a message, and `ackRequired` with who has read; `ticket.changed` is a realtime kind like the others
(F0.4's one list); the `/` recall routes keep working unchanged. `tests/db/chat-sync.test.ts` gets a case for each.

## C1.3 The live line

- [x] Frames stay small: `id: <eventId>` + `{kind, conversationId, messageId, spaceId, userId, callId}` (no content on
      the wire, as today — the public repo documents the format; content only travels through authorized REST).
- [x] Hub fan-out (one lookup of at most four queries however many people, not literally one query: `pr/C1.3.md`): per event, compute the readers among the CONNECTED users of that org with one query, write to
      them in parallel; batch `markDeliveredForUser` (debounce 1 s per user) outside the loop; `membership.changed`
      clears the policy cache of that org only.
- [x] One line per browser (⚠️ needs a real browser to see: `pr/C1.3.md` «Owner actions»): the first tab takes a Web Lock (`navigator.locks.request("zk-rt", …)`) and owns the
      EventSource; it re-broadcasts frames over `BroadcastChannel("zk-rt")`; when it closes, another tab takes the
      lock. Fallback (no Web Locks): one EventSource per tab, as today. Keep the public `useRealtime(handler)` API so
      the other features (calls, whiteboard, watch, bell) keep working unchanged.
- [x] Drive badges and presence from frames (⚠️ the bell's 30 s poll stays: its non-chat notifications have no frame, `pr/C1.3.md`) (unread changes come from sync; presence from a `presence.changed` frame the
      hub sends when a user's first stream opens / last one closes — **stream-only, like `typing`**: not a
      `RealtimeEvent` row, not in `REALTIME_KINDS`, not replayed). Remove the 30 s polls only after the frame path is proven
      (keep a 5 min safety refresh on focus).
- [x] Quick chat (`src/components/shell/quick-chat.tsx`) stops polling every 4 s and uses the cache + frames (frames now; the cache is C1.4's).

## C1.4 The client cache (TanStack Query — already the app's data library)

- [ ] Keys: `["chat","list"]`, `["chat","space",spaceId]`, `["chat","conv",id,"header"]`,
      `["chat","conv",id,"messages"]` (an infinite query: pages are windows of 50; `getPreviousPageParam` = older
      cursor, `getNextPageParam` = newer cursor when opened around a message).
- [ ] ONE module owns every write to these keys: `src/lib/chat/cache/` (`applySync(sync)`, `appendMessage`,
      `replaceMessage`, `tombstone`, `applyReads`, `upsertRows`, `removeConversation`). Components never call
      `setQueryData` on chat keys (guard test `tests/chat-cache-writer.test.ts`, source text).
- [ ] Frames → `scheduleSync()` (coalesces frames for 120 ms, one `GET /api/chat/sync?after=cursor` at a time, chains
      while `messages.length === limit`). Reconnect, focus after > 60 s hidden, and coming online also call it.
- [ ] Unread counts per row, per folder and per space are derived from the cache; the server's numbers win whenever a
      list refresh arrives.
- [ ] Prefetch: hovering a row for 150 ms (computer) prefetches header + first page; at startup the first page of the 3
      most recent unread chats.

## C1.5 Persistence for an instant start

- [ ] IndexedDB database `zaki-chat-<userId>` (pattern: `src/lib/chat/outbox/storage.ts`): the list, the header + last
      50 messages of the 30 most recent conversations, the sync cursor. Hydrate on start (the list shows at once), then
      sync. Cap 20 MB, least-recently-opened evicted.
- [ ] ⚠️ Message text is kept on the device. 🔧 Wiped on sign-out (`/api/auth/logout` client path), on a different user
      signing in, and by «امسح ذاكرة المحادثات» in C4; never kept for a guest (external partner) account.

## C1.6 History, unread landing, jump

- [ ] Opening a conversation: if it has unread messages, load `around=firstUnreadId` and show the separator there;
      otherwise the newest page.
- [ ] Scrolling within one screen of the top loads the previous page; within one screen of the bottom (when not at the
      newest) loads the next page.
- [ ] Jump to a message (reply quote, pinned bar, search hit, link `?m=`): `around`, then bidirectional paging, a
      «↓ آخر الرسائل» button returns to the newest window.
- [ ] Memory cap: keep at most 10 pages per conversation in the cache; drop pages far from the viewport.

## C1.7 The message viewport (virtualized)

- [ ] `@tanstack/react-virtual` (already a dependency): dynamic heights with `measureElement`, `overscan: 10`,
      stable `getItemKey = message.id`.
- [ ] Prepending older pages keeps the visible message in place (record the first visible item's offset before the
      prepend, restore after measuring).
- [ ] Keep today's "where does the newest message leave the view" rules — `onNewest()` and `isAtBottom()` in
      `src/lib/chat/conversation/client.ts` and their tests — they are correct and owner-approved.
- [ ] Images reserve their box from `width/height`; voice/waveform rows have a fixed height.

## C1.8 Sending, receipts, typing

- [ ] Optimistic bubble on the FIRST attempt (today it appears only from the server's answer): the composer writes a
      pending item to the cache with its `clientId`; the answer (or sync) replaces it in place; failures hand it to the
      outbox (existing `src/lib/chat/outbox/`), shown with a red «!» and «أعد المحاولة».
- [ ] The send route answers right after the transaction commits; notifications and push run after the response
      (`queueMicrotask`/the in-app scheduler, with error logging), never blocking the sender.
- [ ] Read marks: `POST /read?upTo=` only when visible + focused (F0.5) and only when the newest read message changed;
      the other clients apply the `reads` delta from sync (no refetch).
- [ ] Typing: cache the policy facts of `(user, conversation)` for 30 s in the typing route (today ~12 calls per ping).

## C1.9 Per-request efficiency (also benefits every page)

These three items are the same as F1.1, F1.2 and F1.8. Do them ONCE — here if F1 has not run yet (then tick them in
F1 too), otherwise skip:
- [ ] `react` `cache()` around `currentUser` (`src/server/auth.ts`), `requireActor` (`src/server/policy/actor.ts`),
      `pageUser` / `pageActor` (`src/app/(app)/_access.tsx`) and `currentSpace` for server components (they run 2–3 times
      per page today, `src/app/(app)/layout.tsx`).
- [ ] `isFeatureOn` / `actorFeatureOn`: one settings read per request.
- [ ] `src/server/db.ts`: pin the Prisma client to `globalThis` in production too (one pool per process).

## Definition of done

- [ ] A recorded comparison in the PR (same topic, 10 open tabs, one message): database calls before / after (target
      < 60), time to first paint of a cached chat (< 100 ms), time from send to ✓ on localhost (< 150 ms).
- [ ] History scrolls back to the first message of a 5 000-message topic without a jump.
- [ ] Network cut for 2 minutes, then back: no missing, no duplicate message (manual + `tests/db/chat-sync.test.ts`).
- [ ] All old chat tests green; new DB tests for list, topics, header, messages paging (tiebreak), sync privacy.
