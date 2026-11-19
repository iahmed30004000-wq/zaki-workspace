# C2 — The chat screen, rebuilt to the Telegram layout (web: computer and phone)

> Prerequisites: P0 merged, D1 (design tokens + primitives) merged, C1 (chat engine) merged. Read
> `telegram-parity.md` for the feature list. This file is the SCREEN spec: layout, components, interactions,
> shortcuts and the acceptance checks. It changes no permission and no server rule.

## 0. Principles

1. **Telegram's layout and gestures, Zaki's rules.** Every action is still decided by the server (`me.canPost`,
   `canModerate`, the message-menu registry `src/components/chat/message/message-menu-registry.ts`). The new screen
   reads the same DTO flags; it never adds a door the server would close.
2. **One chat UI for computer, phone browser, installed app and the Android app** (M1 wraps it). No second chat UI.
3. **Arabic, right-to-left, theme tokens only.** Everything that is "left/right" in Telegram's LTR layout is
   mirrored with logical properties (`start/end`, `ps/pe`, `ms/me`, `rounded-s*/e*`). No hex colours (D1 adds the chat
   tokens). Strings go to a new fragment `src/lib/i18n/ar.chat-ui.json` (no key in two files — `tests/encoding-hygiene.test.ts`).
4. **Old screen kept, marked, behind a switch** (AGENTS.md: a feature is marked, never removed): feature key
   `chatLayoutV2` (default ON after the owner's live check). While OFF, `/chat` renders today's `ChatHomeClient`; the
   old components stay in the tree until the owner decides (`DECISIONS.md` D-C1).
5. **Fast by construction:** the list never unmounts while switching chats, every list is virtualized, rows and
   bubbles are memoized and read from the C1 cache by id, the composer never re-renders the message list.

## 1. Routes and the persistent layout

```
src/app/(app)/chat/layout.tsx        NEW  server: pageActor + feature check → <ChatShell>{children}</ChatShell>
src/app/(app)/chat/page.tsx          CHANGE  renders nothing in the main pane but the empty state (computer), the list (phone)
src/app/(app)/chat/[id]/page.tsx     CHANGE  keeps keepInSpace(...) then renders <ConversationPane id=… focus=?m />
src/app/(app)/chat/s/[spaceId]/page.tsx  NEW  forum view of one space (topics list) in the list column
src/app/(app)/chat/[id]/info/page.tsx    NEW  phone only: the info screen (computer opens the side panel instead)
```

- The App Router keeps `layout.tsx` mounted between `/chat/a` and `/chat/b`: the list column lives in the layout,
  so switching chats re-renders only the conversation pane. Use `<Link prefetch>` on rows and `router.push` with
  `scroll: false`.
- `/chat/[id]` for a topic of another space still enters that space first (`keepInSpace`) — unchanged behaviour.
- Inside `/chat/**` the global app sidebar collapses to the slim rail (N1); on the phone the global bottom bar is
  hidden inside a conversation (full screen, like Telegram).

## 2. Computer layout (≥ 1024 px) — right to left

```
┌────┬──────────────────────┬───────────────────────────────────┬──────────────────┐
│rail│ chat list (360 px,   │ conversation                      │ info panel        │
│64px│ drag 300–480, saved) │ header · pinned bar · messages ·  │ (360 px, toggled  │
│    │ search · folders ·   │ composer                          │ by the header)    │
│    │ rows                 │                                   │                  │
└────┴──────────────────────┴───────────────────────────────────┴──────────────────┘
```

- 768–1023 px: rail + list + conversation; the info panel opens as an overlay sheet from the end side.
- < 768 px: one screen at a time (§4).
- The list width is saved per person (localStorage `zk-chat-list-w`).

## 3. The chat list column

Component tree (new folder `src/components/chat/v2/`):

```
ChatListColumn
 ├ ListHeader        search field «بحث» (Ctrl+F when the list has focus) · new-message pencil (computer)
 ├ FolderTabs        «الكل · غير مقروء · خاص · المساحات · ذكروني · …مجلداتي» with unread badges (C3 adds custom folders)
 ├ ArchivedRow       «المؤرشفة» collapsible row on top (C3), hidden when empty
 ├ VirtualRows       @tanstack/react-virtual, row height 72 px (phone 76 px), overscan 8
 │   ├ SpaceRow      a forum: space avatar/emoji, name + people icon, time, topic chips line, unread
 │   ├ TopicRow      only inside the forum view and in search results
 │   ├ DmRow         person avatar + online dot, name, time + ticks, preview / typing / draft, unread
 │   └ SavedRow      «الرسائل المحفوظة» (C3)
 └ NewMessageFab     phone only (bottom END corner: the left in this right-to-left layout)
```

**Row anatomy (all kinds)** — line 1: title (semibold when unread), small icons after it (🔇 bell-off when muted,
lock when private, megaphone for an announcements topic), time at the end (today `HH:MM`, this week the day name,
older `d/M`), own-last-message ticks. Line 2: preview — `فلان: النص` in topics, plain in DMs; replaced by «عم يكتب…»
(accent) while somebody types, by «مسودة: …» (danger) when a local draft exists; a picture shows «📷 صورة», a voice
note «🎤 رسالة صوتية (0:12)», a poll «📊 …», a checklist «☑️ …». Trailing: unread pill (accent; `bg-muted` when
muted), «@» badge when I am mentioned, reaction badge, pin icon when pinned and nothing unread.

**SpaceRow second line** (the owner's Telegram screenshot): up to three chips of the most recently active topics
(`# عنوان` with its emoji, unread ones first, bold when unread) followed by the newest message `فلان: …`. Clicking
the row opens the forum view `/chat/s/[spaceId]` in the list column (slides over the list, back arrow returns);
clicking a chip opens that topic directly.

**Forum view header:** back arrow · space avatar · name · «42 عضو» · ⋮ (space info, members, «موضوع جديد» for
moderators, «اقرأ الكل»). Topic rows: topic emoji in a coloured circle, title, time, preview, unread, lock /
megaphone icons. Order: personal pins, moderator pins, then activity (the person's «ترتيب» order from
`UserChatOrder` still wins when they set one — keep `src/lib/chat/order.ts`).

**Row menu** (right-click on computer, long-press on phone): «ثبّت / فك التثبيت» (personal), «اكتم» › «ساعة · 8
ساعات · يومين · للأبد», «علّم كمقروء / كغير مقروء», «أرشف», «أضف لمجلد» (C3), and for moderators the existing
topic items (pin for everybody, archive topic, settings), and the owner's «حذف نهائي» (existing purge, unchanged
confirmation).

**Selected row** (computer): accent background, `text-accent-fg` texts; keyboard ↑/↓ moves the selection when the
list has focus, Enter opens.

**Data:** rows come from C1's list cache (`useChatList(folder)`), each row component subscribes to its own row by id
(`useChatRow(id)`), so a new message re-renders one row and moves it, never the whole list.

## 4. Phone layout (< 768 px) — the Telegram Android pattern

- **List screen:** top app bar 56 px: «☰» (opens the app drawer from N1: profile, spaces switcher, «اليوم»,
  «الشغل», «المكتبة», «نتفرّج سوا», «الإدارة», «الإعدادات», «دليل زاكي»), title (the current folder or «زاكي»),
  search icon (expands to a full-width field). Folder tabs under it. Rows. FAB «✏️» at the bottom end (the left).
- **Conversation screen:** full screen (no global bottom bar), header with back arrow; opens with a 200 ms slide from
  the start edge; swipe from the start edge goes back (pointer events; respect `prefers-reduced-motion`).
- **Info screen:** `/chat/[id]/info`.
- Safe areas: `env(safe-area-inset-*)` on the header and the composer only (keep the existing safe-area classes).
- Touch targets ≥ 44 px (existing rule).

## 5. The conversation pane

```
ConversationPane
 ├ ConversationHeader   back (phone) · avatar · title · subtitle · actions (🔍, 📞/🎥 when calls on, ⋮)
 ├ PinnedBar            existing behaviour (tap = jump to the pinned message and cycle)
 ├ CallBar              «مكالمة جارية · انضم» when a call of this conversation is live
 ├ MessageViewport      virtualized, reverse (newest at the bottom), wallpaper behind
 │   ├ StickyDateChip   the date of the top visible message, floating
 │   ├ UnreadSeparator  «رسائل غير مقروءة» at the first unread (only on opening)
 │   ├ MessageBubble    (memo by id)
 │   ├ ServiceLine      join / pin / topic changes as centered chips (today's system lines); a run of call lines
 │   │                  («بلّش مكالمة» / «خلصت المكالمة» — seen live: a dozen in a row) folds into ONE chip «6 مكالمات» that opens the list
 │   └ PendingBubble    outbox items (existing component restyled: clock icon, red «!» when failed)
 ├ JumpButtons          «↓» with unread counter · «@» with unread mentions counter
 ├ SelectionBar         replaces the composer in multi-select (C3)
 └ Composer
```

**Header subtitle:** DM: «متصل الآن» / «آخر ظهور …» (`src/lib/chat/conversation/last-seen-line.ts`) / «عم يكتب…»;
topic: «اسم المساحة · 42 عضو» or «🔒 خاص · 4» (P0.4) or «عم يكتب فلان…». Clicking the title toggles the info panel.

**Header ⋮ menu:** «اكتم الإشعارات» ›, «ابحث» , «الصبورة» (switch `whiteboard`), «نتفرّج سوا» (switch `watch`),
«لخّصلي» (shown when the header DTO's `digest` flag is true — today's `detail.digest`), «معلومات المحادثة», and for moderators «إعدادات الموضوع»
(existing `TopicSettingsDialog`, restyled as a panel page), «أغلق الموضوع», «أرشف الموضوع».

**Bubble** (`src/components/chat/v2/message-bubble.tsx`, built from today's `message-item.tsx` logic, not a rewrite of
the rules):
- own messages at the inline end (left in RTL) — as today; incoming at the start with the avatar at the bottom of a
  run (topics only); sender name coloured by `avatarHue(name)` on the first bubble of a run (topics only);
- a tail on the LAST bubble of a run (CSS mask; `rounded-ee-sm` / `rounded-es-sm` for the tail corner);
- footer inside the bubble, at the end: «معدّلة», time `HH:MM` (`dir="ltr"` tabular), ticks for own messages;
- reply block: 3 px accent bar + author + one-line snippet; click → jump (`around`) + 2 s highlight;
- forwarded header «محوّلة من فلان»;
- reactions as chips under the content (mine outlined in accent); click toggles;
- media: see C3 for albums/viewer; images reserve their box from `width/height` (no layout jump), `loading="lazy"`;
- a message mentioning me keeps today's warn tint;
- notes (moderators), «صارت مهمة/تذكرة» chips, translations and transcripts stay where they are today, restyled.

**Message menu** (right-click / long-press; hover on computer shows a small reaction button and «↩»):
1. a quick reactions bar on top (6 emojis from settings + «⌄» opening the full picker);
2. the registry items, in Telegram order: «رد» · «نسخ» · «نسخ الرابط» (`/chat/<id>?m=<msg>`) · «ثبّت» · «حوّل» ·
   «حدّد» (C3) · «عدّل» · «احذف» (danger) — then ours: «اعمل مهمة» · «اعمل تذكرة» · «ذكّرني» · «ملاحظة» · «ترجم» ·
   «اقرأ النص» · «حوّل الصوت لنص» · «مين شاف» (topics: today's reader list).
   Add the new ids to `MessageMenuId` and to `messageMenuItems` with their `available` rules (copy link: anybody who
   reads; select: anybody who reads). The registry stays the ONE source.

**Gestures and shortcuts in the viewport:** double-click (computer) = reply; double-tap (phone) = quick reaction
(setting); swipe a bubble toward the start edge (phone) = reply (M1); Esc cancels reply/edit/selection; ↑ in an empty
composer edits my last text message.

## 6. The composer

```
[😊 emoji] [ textarea «رسالة» (auto-grow to 10 lines) ] [📎] [🎤 ⇄ ➤]
```

- Emoji: `frimousse` picker (already a dependency) in a popover (computer) / bottom sheet (phone); recent emojis in
  localStorage.
- 📎 attach menu: «صورة أو فيديو» · «ملف» · «استطلاع» (existing `PollDialog`) · «قائمة مهام» (C3 checklist).
- Paste an image → a send dialog with preview, caption, «ابعتها كملف» toggle (Telegram's send-photo dialog);
  dropping files on the pane shows two drop zones «ابعت كصور» / «ابعت كملفات».
- 🎤 when empty, ➤ when there is text or an attachment. Right-click / long-press on ➤: «ابعت بدون صوت» and
  «جدول الإرسال» (C3).
- Recording: hold on phone (slide to cancel, slide up to lock), click-to-start / click-to-stop on computer; keep the
  existing recorder (`src/lib/chat/voice-recorder.ts`) and upload path.
- Reply / edit bar above the input with ✕ (existing state, restyled).
- Mentions «@» autocomplete and «@الكل» (existing `src/lib/chat/conversation/mentions.ts`).
- Enter sends, Shift+Enter new line (existing `enterSends`); setting «Ctrl+إنتر للإرسال» (C4).
- Typing is broadcast as today (`useTyping`); the draft is saved per conversation (`src/lib/chat/composer-draft.ts`).
- When the person cannot post, the composer area shows today's reason line or the owner's «شارك بالمحادثة»
  (`composerBarOf` — keep the function and its tests).

**Carried over from Q1 (built on the old screen first — nothing of it may be lost here):** the «/» menu and its «⚡»
button in the composer; the CARD bubble (product, order state, notice) with «افتح الكرت»; an order number shown as a
chip; the ticket chip under a message and the «✅ انحلّت» reply; «قرأت ✓» with «قرأ 7 من 10» on a must-read message; the
hints of Q1.7; the menu items «🎫 مشكلة» and «اسألي مشرفتك» (added to the registry). The acceptance list (§10) gets one
render test for each.

## 7. The info panel / screen

Header: big avatar, title, subtitle. Buttons row: «🔔 الإشعارات» (mute menu), «🔍 بحث», «📞 اتصال».
- DM: username, job title, bio, «افتح الملف الشخصي» (`/u/[id]`).
- Topic: space name, audience («كل أعضاء المساحة (42)», «المقطع: …», «🔒 خاص — الأسماء»), member list for
  restricted topics, moderators' buttons (settings, close, archive).
- Tabs (C3 fills them): «الوسائط» · «الملفات» · «الروابط» · «الصوتيات» · «الشغل» (tasks/tickets made from this chat) ·
  «المثبّتة».

## 8. Keyboard shortcuts (computer)

| Keys | Action |
|---|---|
| Ctrl+K | the app's palette (unchanged) |
| Ctrl+F | search in the open conversation (list search when the list has focus) |
| Alt+↑ / Alt+↓ | previous / next chat in the list |
| Alt+Shift+↑ / ↓ | previous / next UNREAD chat |
| Ctrl+1 … Ctrl+9 | folder 1…9 |
| Ctrl+0 | saved messages (C3) |
| Esc | close panel / cancel reply or edit / leave selection / back to list (phone keyboard) |
| ↑ (empty composer) | edit my last message |
| Ctrl+B / I / U / Shift+X / Shift+M / K | bold / italic / underline / strike / mono / link (C3) |
| Ctrl+Shift+? | the shortcuts sheet |

Register them in one module `src/lib/chat/shortcuts.ts` (pure map + a hook), listed in settings (C4).

⚠️ On screen (hints, the shortcuts sheet, tooltips) only «Ctrl» and «Esc» may appear in Latin: `tests/arabic-ui.test.ts`
allows exactly those key names and caps its allow-list below 14 entries. 🔧 Write the other keys in Arabic letters —
«ألت», «شيفت», «إنتر» — and arrows as ↑ ↓; do not extend the allow-list (that needs the owner).

## 9. Motion and feel

- Row move on new message: FLIP animation 150 ms; bubble appear 120 ms fade-up; reaction pop 150 ms; list ⇄
  conversation slide 200 ms (phone). All disabled under `prefers-reduced-motion` (`motion-reduce:` classes, as today).
- Sounds: keep `src/lib/chat/sounds.ts` (own sounds), setting in C4.

## 10. Acceptance checks (the PR's Definition of Done)

- [ ] Switching between two cached chats on the computer paints the new conversation in < 100 ms (Performance panel,
      4× CPU throttle in the PR description) and never reloads the list (React DevTools: no list unmount).
- [ ] Scrolling 1 000 loaded messages stays smooth (no frame > 50 ms in a 5 s recording).
- [ ] Opening a chat with unread messages lands on «رسائل غير مقروءة»; scrolling up loads older pages without a jump.
- [ ] A new message from somebody else moves its row to the top and updates the preview without refetching the list
      (Network panel: only the C1 delta request).
- [ ] Phone (375×812): list → chat slide, swipe back, composer above the keyboard, no horizontal scroll.
- [x] Every string comes from `ar.chat-ui.json`; `tests/arabic-ui.test.ts`, `tests/encoding-hygiene.test.ts`,
      theme contrast tests green; no hex colour in `src/components/chat/v2/**` (add a guard test). _(checked by tests; C2.8)_
- [x] The privacy matrix (`tests/db/privacy-matrix.test.ts`) and every existing chat test stay green. _(C2.8: run green on this branch)_
- [x] Render tests for: row kinds (space with chips, DM typing, draft, muted, mention), bubble runs and tails, menu
      items by permission (reuse the registry tests), composer states (empty → mic, text → send, cannot post → reason).
- [x] `chatLayoutV2` OFF renders the old screen unchanged (one render test). _(`chat-v2-shell-render`, `chat-v2-switch-combinations`)_

> The five boxes above that need a browser (paint under 100 ms at 4× throttle, 1 000 messages smooth, the unread landing and older pages with no jump, the row move with only the C1 delta, the phone: slide, swipe back, composer above the keyboard, no horizontal scroll) are NOT ticked: they are the owner's list in `pr/C2.8.md`, never written as measured.

## 11. Steps (step IDs are NOT the section numbers above; one branch each, small commits, each green)

- [x] C2.1 `ChatShell` + `layout.tsx` + empty state, behind `chatLayoutV2` (old screen when off).
- [x] C2.2 `ChatListColumn` with virtual rows reading C1's list cache; folders «الكل/غير مقروء/خاص/المساحات/ذكروني», plus
      «كل الشركة» for oversight holders only (today's «كل الشركة» toggle, `canOversee`).
- [x] C2.3 Forum view `/chat/s/[spaceId]`.
- [x] C2.4 `ConversationPane` header + viewport (virtualized, reverse) + bubbles + service lines + sticky dates + unread
      separator + jump buttons.
- [x] C2.5 Composer (emoji, attach menu, paste/drop, mic/send toggle) — reuse the existing upload/outbox code.
- [x] C2.6 Message menu (quick reactions + registry) + hover actions + shortcuts.
- [x] C2.7 Info panel (DM / topic, members) — media tabs are filled in C3.
- [x] C2.8 Phone screens and motion (`pr/C2.8.md`).
- [x] C2.9 Restyle calls UI entry points (call bar, ring) to the new tokens (`pr/C2.8.md`).

**Switch combinations:** `chatLayoutV2` and `navV2` (N1) are independent. With `navV2` OFF the chat's list column sits
next to today's sidebar and the phone keeps today's bottom bar (the list screen shows no «☰»); with both ON it is the
target layout. A render test covers the four combinations. **Space switching:** until N1.3 lands, opening a topic of
another space still enters it (`keepInSpace`, today's behaviour); with D-N2 = one list, N1.3 removes that switch for
chat.
