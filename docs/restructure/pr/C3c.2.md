Base: `origin/main` (ed1f52c, includes C3b.2). Branch `feat/chat-silent-send`.

# C3c.2 — Send without sound: «ابعت بدون صوت» (`chatSilentSend`, ON)

## Definition of Done
- What must work:
  1. **Schema.** `ChatMessage.silent BOOLEAN NOT NULL DEFAULT false`, one additive migration (`20261123101500_chat_message_silent`). Existing rows read false.
  2. **The server sends nothing for a silent message.** `notify.ts` makes no bell row and no push (`pushNotification` writes the row and sends the push) for anybody: the DM's other person, a person who is @mentioned (the sender chose silence), the author of the message replied to. The message is still a message: the unread count (the badge) counts it and a mention stays among the person's unread mentions (both come from the message rows, not from the bell).
  3. **The other screen makes no sound.** `MessageDto.silent` (true only when it was), and `arrivalSoundOf` returns null for a silent newest message, a mention included.
  4. **The menu.** «ابعت بدون صوت» on the send button's menu: right-click on the computer, a long press on a phone (`send-menu.tsx`, `sendHoldOpensMenu`). A plain click and Enter still send. The menu is built so C3c.3's «جدول الإرسال» is one id in `SEND_MENU_ITEMS`, one line in `sendMenuItemsOf` and one label. Not offered while an edit is saved, with nothing to send, or with the switch off.
  5. **The flag survives the way a message travels.** The optimistic send, the outbox (stored, kept through a reload) and the request carry `silent`; every retry is silent; `clientId` idempotency is unchanged, and a retry that lost the flag finds the SAME silent message (the server answers with the stored row's flag, never makes a loud copy).
  6. **Switch** `chatSilentSend`, default ON. OFF: the route ignores the flag (an ordinary message, bell and all) and the menu entry is not drawn; messages already sent silent stay silent.
- Tests (new, all green): `tests/db/chat-silent-send.test.ts` (8: a silent DM makes no bell row yet counts as unread; a @mentioned person is not told but keeps the unread mention; a silent reply tells nobody; the retry and a retry that lost the flag; the switch off; a non-boolean flag is refused; two control tests: the same messages without the flag DO make a bell), appended to `tests/chat-v2-composer-model.test.ts` (+9: the menu's items, the long press rule, the menu drawn / not drawn, the request, the outbox store and retry, the optimistic send online and offline, the arrival sound) and `tests/features.test.ts` (+1).
- Run and green besides them: `chat-v2-composer-render`, `chat-v2-composer-seam`, `chat-v2-pane-model`, `chat-v2-pane-switch`, `chat-composer-bar`, `chat-outbox-queue`, `chat-outbox-send`, `chat-optimistic-send`, `chat-optimistic-composer`, `arabic-ui`, `chat-arabic`, `chat-v2-no-hex-guard`, `no-hardcoded-colors`, `migrations-lint`, `wording-arabic`, `wp-arabic2`; database: `chat-send-after-response`, `chat-send-idempotent-limit`, `chat-send-reads`, `chat-send-status`, `chat-notify-audience`, `chat-outbox-idempotency`, `chat-viewing-push`, `chat-mentions`, `chat-unread`, `link-previews`; `tsc --noEmit` and eslint clean on every file touched.
- Edge cases that matter: a mention and an «@الكل» are both silent (nobody is told); a retry after a timeout whose first attempt DID reach the server is the same silent message (no second row, no bell); a copy in the outbox from before a reload is still silent; `silent: "yes"` is a 422.
- Blockers: CI red · an old test red · a destructive migration (none: one nullable-free additive column with a default).

## The failing test, before the change
Written first. Before any code: `tests/features.test.ts` was red («chatSilentSend» not in `FEATURES`), `tests/chat-v2-composer-model.test.ts` could not import `send-menu.tsx` or `sendHoldOpensMenu` (no test ran), and the DB test file was written against the schema it needs. After the implementation the DB test was run with the one line `if (opts.silent === true) return;` of `notify.ts` switched off: four tests went red (the DM, the mention, the reply, the retry) while the two controls and the switch test stayed green, then the line was put back.

## What changed
- **Schema**: `prisma/schema.prisma` (`silent`), `prisma/migrations/20261123101500_chat_message_silent/`. `prisma generate` was run (EPERM on the engine file's rename: the shared `query_engine-windows.dll.node` is unchanged and in use; the generated client JS and types are updated).
- **Server**: `messages.ts` (`sendSchema.silent`, the switch read with `isFeatureOn`, the column written, the answer and a retry's answer marked, `silent` handed to the notifier), `notify.ts` (see the hot spot below), `dto.ts` (`MessageDto.silent`, `ConversationDto.silentSend`).
- **Client**: `outbox/send.ts`, `outbox/optimistic.ts`, `outbox/queue.ts` (the flag in the payload, the queue item, the stored copy), `use-composer.ts` (`submitSilent`, `silentSendOn`; `sendNow` keeps its signature: it calls `sendWith(…, silent)`, and the pinned source test of C2.5 stays green), `composer-surface.tsx` (the button inside `SendMenu`), `send-menu.tsx` (new), `hold-gesture.ts` (`SEND_HOLD_MS`, `SEND_HOLD_SLOP_PX`, `sendHoldOpensMenu`), `arrival-sound.ts`.
- **Registries (lines added only)**: `features.ts`, `ar.features.json`, `tests/features.test.ts`, `ar.chat-features.json` (2 keys `chatsilent.menu.*`; `dict.ts` already imports it), this README's tick, `C3-chat-features.md` (tick + a Built note).
- **Not touched**: `buildChatMessagePayload` (a file of the conversation screens): `silent` rides next to it in `postChatMessage`.

## HOT SPOT: `notify.ts`
`notify.ts` is also edited by C3b.1 (strip markers), C4.1 (per-type prefs) and M1a (push per message). This package changes it by ONE added option and ONE line:

```ts
  /** C3c.2 «ابعت بدون صوت» … */
  silent?: boolean;
}): Promise<void> {
  if (opts.silent === true) return;
```
at the top of `notifyMessageToAudience`, and `messages.ts` passes `silent: true` only for a silent message. Whoever merges after it: keep that early return ABOVE any new per-person logic (C4.1's preferences and M1a's per-message push must never run for a silent message).

## Switches
`chatSilentSend` (ON). Off: the route ignores the flag, the menu entry is not drawn; data stays.

## Decisions used
- **A «must read» message (`mustRead`) can be silent too.** The flag only removes the chat bell and push of the message itself; the reminders of `must-read.ts` are their own job and are not touched. The new composer has no must-read control, so this is only reachable by the API. Say if a must-read message should refuse the flag instead (one line in `sendMessage`).
- **The sender's own «sent» tick sound** (`playChatSound("sent")`) still plays on a silent send: the choice is about what OTHER people hear.
- **A silent message is not hidden anywhere**: the list row, the preview in the list and the unread number show it like any message. ⚠️ Silence is for the bell, the push and the sound only. 🔧 The switch's hint says so.

## Owner actions
- 🔧 Needs a real browser and a phone (not measured here): right-click on the send button opens the menu and does not send; a long press on a phone opens it (and the lift does not send); the menu sits beside the button and does not leave the screen; on Android the long press may also raise the system's own menu (the handler cancels it). Send one silent message to a second device: no sound, no push, the number on the app icon still goes up.

## Other repositories
none.

## Not done here (recorded)
- **The other screen cannot read `silent` yet.** The ONE exit of a message to a screen is `presentMessage` in `src/server/chat/redact.ts` (not in this package's paths). It needs two lines: `silent?: boolean` on `MessageRow`, and `if (row.silent) dto.silent = true;` after the DTO is built. Until then the sender's own answer and a retry carry `silent` (proven by the DB test), but a message read through the messages window or sync does not, so `arrivalSoundOf` cannot skip it on the recipient's device. The server side (no bell, no push, the badge) is complete and does not depend on it.
- **The switch does not reach the menu yet.** `topics.ts` (the header builder, next to `chatOutbox`) must set `silentSend: await isFeatureOn(ctx.orgId, "chatSilentSend")` on the header (`ConversationDto.silentSend` exists and `useComposer` reads it as «absent: on»). With the switch off the server already ignores the flag, so the entry would send an ordinary message until then.
- **The old chat screen still plays its arrival sound for a silent message** (`conversation-screen.tsx` calls `soundOfArrival` from `sounds.ts`; files of the old screen, not in this package's paths). The new pane is the one with the switch; the old screen reads no `silent` either (see the first line above).
- **The pending bubble** (`cache/pending.ts`) does not show that a message is silent; nothing in the spec asks for a mark.
- **No browser or phone test** of the gesture (the repo's unit tests run in Node): the pure rule (`sendHoldOpensMenu`), the menu's list and the drawn markup are tested; the touch timer and the swallowed click are in `send-menu.tsx` only.
- `docs/CODEMAP.md` is NOT regenerated or committed (the integrator does it).
- The full unit suite and the full database suite were not run (shared machine); the areas listed above were.
- **The independent review was NOT done by a subagent**: this worker had no way to start one (the review skill that was tried reviewed another checkout, `zaki-workspace`, so its answer is not used here). The diff was reviewed by its author against the checklist: the touch sequence (the timer's open, the phone's own `contextmenu`, the lift's click) was found and fixed in that pass (`openNow` keeps the swallow of the first call); the integrator should still give it a read-only look.
