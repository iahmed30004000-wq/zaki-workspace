Base: `origin/main` (0f40e36, includes C3c.3). Branch `feat/chat-channels-look`.

# C3c.4 — Channels look («قناة»)

No schema, no migration, no server change, no switch (it is a look on data the topic already has).

## Definition of Done
- What must work:
  1. A topic of type ANNOUNCEMENTS whose `postingPolicy` is ADMINS is a channel. In the list row it shows the megaphone (already drawn) AND the word «قناة» next to it. In the pane header the same word, with a megaphone, shows under the title before the space and the people.
  2. A person who cannot post in a channel sees «بس المشرفين بينشروا هون» instead of the composer. Who cannot post comes from the server's `me.canPost` (never from a client rank). A person with `me.canPost` true (a space admin or the owner) keeps the composer. Closed, muted, «شارك بالمحادثة» and the oversight line still come first, in the same order as before.
  3. The guest rule is unchanged (the server's policy still refuses a guest in announcements). A guest in announcements everybody may post in, or in announcements whose header does not say the policy, keeps the old line (`chatc.bar.announcements`).
  4. The old screen is not touched (see «Not done here» for the one shared function).
- Tests: `tests/chat-v2-list-preview.test.ts` (+5), `tests/chat-v2-pane-model.test.ts` (+7, including two header draws).
- Blockers: CI red · an old test red.

## The failing test, before the change
The new tests were written first and run against the old code: 6 failed (`rowChannelWord`, `channelOf` did not exist; `composerBarOf` answered `announcements` where a channel says «بس المشرفين بينشروا هون»). After the change both files are green (85 tests).

## What changed
- `src/lib/chat/row-preview.ts`: `isChannelTopic` (kind TOPIC, ANNOUNCEMENTS, policy ADMINS) and `rowChannelWord(row)` (the word, or null). The existing mark labels are untouched (the pinned «تنبيهات» label stays).
- `src/lib/chat/v2/pane/header-model.ts`: `channelOf(header)`.
- `src/lib/chat/v2/pane/composer-bar.ts`: a new bar `channel`; `composerBarOf` takes the optional `postingPolicy` of the header and answers `channel` only for ANNOUNCEMENTS with ADMINS, otherwise `announcements` as before.
- `src/components/chat/v2/list/chat-row.tsx`, `src/components/chat/v2/pane/pane-header.tsx`: draw the word (`data-row-channel`, `data-header-channel`).
- Registries (lines added only): `src/lib/i18n/ar.chat-features.json` (`chatch.word` «قناة», `chatc.bar.channel` «بس المشرفين بينشروا هون»; `dict.ts` already imports the file, so it needed no line), this folder's `README.md` tick and `C3-chat-features.md` tick and a Built note.

## Switches
None.

## Owner actions
- 🔧 Look at `#p=chat` in a browser and a phone: the announcements topic of a space shows the megaphone and «قناة» in the list and under the title in the pane; open it as an ordinary member and the line «بس المشرفين بينشروا هون» replaces the box; as the space admin the box is there. Not measured here (unit and server-render tests only).

## Other repositories
none.

## Not done here (recorded)
- ⚠️ **The list row has no `postingPolicy` field.** The list query reads the column (`src/server/chat/list.ts`) but `ChatRowDto` (`src/server/chat/dto.ts`) has no field for it, and those files are not this package's. So the row reads a row WITHOUT the field with the server's own default for an announcements topic («للمشرفين»). An announcements topic that a manager explicitly opened to everybody would still say «قناة» in the LIST (never in the header, which carries the policy and is exact). Fix in the owner of `list.ts`/`dto.ts`: add `postingPolicy?: PostingPolicy` to the row; `rowChannelWord` reads it already and nothing here changes.
- ⚠️ **`composerBarOf` is shared with the old screen** (`conversation-screen.tsx` imports it from `composer-bar.ts`, and its `ConversationDto` carries the policy too). So the old screen's reason line for a channel also changes to «بس المشرفين بينشروا هون» (its file is untouched; a separate old-screen text would need an edit of `composer-host.tsx` or `conversation-screen.tsx`, which are other packages' files). The pinned tests `chat-composer-bar`, `chat-v2-composer-render` and `chat-v2-pane-render` still pass unchanged (their announcements fixtures do not carry `ADMINS`).
- The text of the existing key `chatc.bar.announcements` is «هذا الموضوع للقراءة فقط», not «بس المشرفين بينشروا هون» as the plan's wording says; it cannot be changed from here (`ar.chat-conversation.json` is not this package's, and a duplicate key fails the encoding test), so the channel gets its own key `chatc.bar.channel`.
- The row's megaphone keeps its spoken label «تنبيهات» (a pinned test in `chat-v2-list-rows`), the visible word beside it says «قناة».
- No browser or phone test.
- `docs/CODEMAP.md` is not committed (the integrator regenerates it).

## Gates
`tsc --noEmit` clean; eslint clean on the seven touched source and test files. Tests run (own area and the pinned neighbours): `chat-v2-list-preview`, `chat-v2-pane-model`, `chat-v2-list-rows`, `chat-v2-pane-render`, `chat-v2-composer-render`, `chat-composer-bar`, `chat-v2-composer-seam`, `chat-v2-forum-render`, `chat-v2-no-hex-guard`, `no-hardcoded-colors`, `encoding-hygiene`, `arabic-ui`, `chat-arabic`, `wording-arabic`, `i18n-interpolation`, `wp-arabic2`: all green. No full suite, no build (shared `node_modules`).
