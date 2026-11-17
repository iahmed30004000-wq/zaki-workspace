# F0 — Connection hotfixes (ship right after P0, before the redesign)

> Small, independent fixes that make the live line («قوة الاتصال») reliable today, on the current screens. Each item
> is one commit with its failing-first test; the whole phase can be one branch `fix/realtime-reliability` or split.
> Every finding below was read in the code at `main@6e21483`.

## F0.1 The listener cursor (a real bug)

`src/server/realtime/listener.ts`:
- `state().lastId` starts at `0n` on boot, and `connectOnce()` awaits `replaySince(s.lastId)` → on every boot the
  process walks the whole `RealtimeEvent` table (48 h of events) before LISTEN is "ready";
- `ensureListener()` is awaited by `/api/rt` (`src/app/api/rt/route.ts`) → **every live stream waits for that walk
  after each deploy**;
- `loadAndDeliver()` (live notifications) never advances `lastId` → after a dropped LISTEN connection,
  `replaySince(lastId)` re-delivers **every event since boot** to every connected client, and each client refetches
  on each of them (a refetch storm).

Fix:
- [x] On the first connect: `lastId = (SELECT max(id) FROM "RealtimeEvent")` — no replay on boot (clients resume with
      their own `lastEventId`, the route already replays per client).
- [x] `loadAndDeliver` sets `state().lastId = max(state().lastId, row.id)`.
- [x] `ensureListener()` resolves as soon as `LISTEN` succeeded; the reconnect replay runs in the background.
- [x] Test (`tests/db/realtime-listener-cursor.test.ts`): with 3 old rows, a boot delivers nothing; 2 live events then a
      forced reconnect deliver each event exactly once; `/api/rt` does not wait for a replay.
- [x] ⚠️ `tests/db/realtime-notify.test.ts` ("on reconnect it replays events with an id greater than the last seen") stops
      and starts the listener with `connectListenerForTests()`, which resets `lastId` to `0n` — it relies on the replay
      from 0 at boot that this fix removes. 🔧 Add a test hook that drops ONLY the `pg` connection and keeps the state
      (`dropListenerConnectionForTests()`), use it in that test (a reconnect keeps `lastId` and replays what was written
      while disconnected), and keep `connectListenerForTests()` as a "boot" (state reset, `lastId = max(id)`). The
      test's intent ("nothing is lost on reconnect") stays and must pass.

## F0.2 Streams that end must close

`route.ts` `cleanup()` removes the client but never calls `controller.close()`: a stream evicted by the 5-per-user
cap or cut by the session check stays open and silent forever, and that tab never falls back to polling.
- [x] Send `event: bye\ndata: {"reason":"evicted"|"signed_out"}\n\n`, then `controller.close()`.
- [x] Client (`src/lib/realtime/use-realtime.ts`): on `bye` with `signed_out` → go to `/login`; with `evicted` → do NOT
      reconnect (reconnecting would evict another of the person's streams — ping-pong); switch that tab to the existing
      polling fallback at 60 s and show a small line «الاتصال المباشر مفتوح بمكان تاني». (C1.3 later shares one line
      per browser, which removes most evictions.)
- [x] Test: evicting a stream closes it.

## F0.3 A heartbeat the browser can see

The 25 s heartbeat is an SSE comment (`: hb`); browsers do not surface comments, so a half-open connection is never
noticed.
- [x] Server sends `event: ping\ndata: <epoch-ms>\n\n` every 25 s.
- [x] Client keeps a 60 s watchdog reset by any frame; on timeout it closes and reconnects.
- [x] Reconnect backoff gets ±30 % jitter (today `500 ms × failures`, capped at 10 s, no jitter).
- [x] The documented "pause after 60 s hidden" is not implemented (`paused` is never set): implement it (close after
      60 s hidden, resume with `lastEventId` on return) or delete the comment. Recommended: implement.

## F0.4 One list of event kinds

`RT_KINDS` in `route.ts` leaves out `call.changed`, `call.ring`, `whiteboard.changed`, `watch.changed`: after a
reconnect they arrive as `conversation.changed` (a missed ring stays missed).
- [x] Build `RT_KINDS` from `REALTIME_KINDS` (`src/server/realtime/emit.ts`) — one source.
- [x] Test: every `REALTIME_KINDS` value survives a replay with its own kind.

## F0.5 Read only what was seen

`conversation-screen.tsx` posts `/read?upTo=` after every fetch, also in a background tab → messages are marked read
on a tab nobody looks at, and the other person sees ✓✓.
- [x] Mark read only while `document.visibilityState === "visible"` and the window has focus; on return, mark once.
- [x] Push suppression (`src/server/chat/notify.ts` uses "has an open stream" as online): add a separate `isViewing(userId)`
      = a stream whose tab reported `visible` in the last 60 s, and use it ONLY for push suppression; keep `isOnline` for
      the presence dots. The client reports visibility changes with `POST /api/rt/visibility` `{ visible: boolean }`
      (session-authenticated, rate-limited, writes nothing to the database); the hub keeps it per stream.
- [x] Tests: a hidden tab does not mark read; a person with only hidden tabs gets the push.

## F0.6 Do not storm the chat list

`chat-home-client.tsx` refetches the whole home on every `message.*` event, with no debounce and no abort.
- [x] 300 ms debounce + `AbortController` (the old screen stays in service until C2 is switched on).

## F0.7 Retries do not eat the rate limit

`src/server/chat/messages.ts` counts the 30/min limit before the idempotency check → re-sends of the same `clientId`
use up the quota.
- [x] Check `(authorId, clientId)` first; an existing message returns 200 without counting.
- [x] Test.

## F0.8 Pagination that never skips

Keyset paging is on `createdAt` only (`src/server/chat/topics.ts`): two messages in the same millisecond can be skipped.
- [x] Order and page by `(createdAt, id)`; cursors carry both.
- [x] Test with two messages sharing a timestamp across a page boundary.

## F0.9 Health shows the live line

- [x] `/api/health` adds `realtime: "ok" | "down"` (listener connected); it does not change the HTTP status (the
      database stays the only 503 reason) — the owner sees it on the health check.

## Definition of done

All items merged with CI green; the owner's live check: open the chat on two devices, cut the network of one for a
minute, bring it back — no message missing, none twice, the other side's ✓✓ only after the message was really seen.
