# Telegram parity matrix — what Zaki chat has, changes, adds and keeps

> Reference for phases C1–C4, M1, I1 and Q1. "Telegram" below means the behaviour people know from Telegram Desktop / Web A /
> Android. We copy the **experience and the layout**, never Telegram's name, logo, artwork, wallpapers, sticker sets or
> sounds: every icon is `lucide-react`, every pattern and sound is our own (credited in `public/brand/CREDITS.md`).
> The screen never says "Telegram" (and never any Latin word: `tests/arabic-ui.test.ts`).

Status column: **HAVE** (exists, keep as is) · **CHANGE** (exists, rebuilt to Telegram behaviour) · **ADD** (missing) ·
**EXTRA** (ours, Telegram has nothing like it — keep and fit into the Telegram layout) · **LATER** (not in this plan) ·
**NO** (decided against, with the reason).

## 1. Layout and navigation

| Feature | Status | Phase | Notes |
|---|---|---|---|
| Two/three-pane desktop: list + conversation + info panel | ADD | C2 | Today: `/chat` is a page of cards and `/chat/[id]` a separate page (`max-w-3xl`) with «رجوع». |
| Persistent chat list while switching chats | ADD | C2 | `src/app/(app)/chat/layout.tsx` keeps the list mounted. |
| Phone: list screen ⇄ conversation screen with slide animation and swipe-back | CHANGE | C2/M1 | |
| Forum groups (a space = a forum, its topics = forum topics) | CHANGE | C2 | Today each space is a card with all topics expanded. Telegram 11 style: the space is ONE row whose second line shows the latest topic chips (the owner's screenshot). |
| Folders (tabs on top of the list) + custom folders | ADD | C3 | «الكل · غير مقروء · خاص · المساحات · ذكروني» + user folders. |
| Archived chats (per person) | ADD | C3 | Different from a moderator archiving a topic (that stays). |
| Pinned chats (per person, drag order) | CHANGE | C3 | Today: moderator pin + `UserChatOrder` order. Add a personal pin; keep both. |
| Saved messages (chat with myself) | ADD | C3 | |
| Chat info side panel with shared media/files/links/voice tabs | ADD | C2/C3 | |
| Global search (chats, people, messages) at the top of the list | CHANGE | C2 | Today: command palette (Ctrl+K) + per-conversation search. Keep both; add the list search. |
| Empty main pane «اختار محادثة» on the wallpaper | ADD | C2 | |
| Keyboard shortcuts (Telegram Desktop set) | ADD | C2 | List in `C2-chat-ui.md` §8. |

## 2. Chat list rows

| Feature | Status | Phase |
|---|---|---|
| Avatar, title, time, preview «فلان: …», unread pill | CHANGE | C2 |
| Muted (grey pill + bell-off icon) | CHANGE | C2 |
| Mention badge «@» and reaction badge | ADD | C2 |
| Typing in the row («عم يكتب…») | ADD | C2 |
| Draft in the row («مسودة: …» in danger colour) | ADD | C2 |
| Own last message ticks ✓ / ✓✓ in the row | ADD | C2 |
| Mark as unread / read | ADD | C3 |
| Swipe actions on phone (archive / pin) | ADD | M1 |
| Right-click / long-press row menu | CHANGE | C2 | today «⋯» row menu (`chatRowMenu`) |
| Lock icon for private topics, people icon for team topics | ADD | P0.4 |

## 3. Conversation

| Feature | Status | Phase | Notes |
|---|---|---|---|
| Infinite history (scroll up loads older) | ADD | C1 | **Today only the newest 40 messages are ever shown** (`conversationDetailUrl(id)` without `before`). |
| Open at the first unread with a «رسائل غير مقروءة» separator | ADD | C1/C2 | |
| Live updates applied as deltas (no full refetch) | CHANGE | C1 | Today every event refetches 40 messages + detail. |
| Virtualized message list | ADD | C1 | `@tanstack/react-virtual` is already a dependency, unused. |
| Bubbles with tails, grouped runs, sender colours | CHANGE | C2 | Runs exist (`src/lib/chat/group.ts`). |
| Floating sticky date chip | CHANGE | C2 | Separators exist. |
| Reply with quote preview + jump to original | CHANGE | C2 | Reply exists; add the jump + highlight. |
| Forward (one / many, to several chats) | CHANGE | C3 | One exists. |
| Multi-select mode (forward, copy, delete, make task) | ADD | C3 | |
| Edit (↑ edits the last own message) | CHANGE | C2 | Edit exists. |
| Delete for everyone | HAVE | — | Tombstone + owner archive (`src/server/chat/redact.ts`). |
| Pin + pinned bar cycling | HAVE | — | |
| Reactions: quick bar on long-press / hover, full picker | CHANGE | C2 | Reactions exist; add the picker (`frimousse` + `emojibase-data` already dependencies, unused). |
| Double-tap / double-click quick reaction | ADD | C2 | Configurable in settings. |
| Swipe to reply (phone) | ADD | M1 | |
| Scroll-to-bottom button with counter | HAVE | — | |
| Mentions button «@» jumping through unread mentions | ADD | C2 | |
| Seen-by list in topics | HAVE | — | reader avatars exist; show as a menu item «مين شاف». |
| DM ticks sent / delivered / read | HAVE | — | |
| Typing indicator | HAVE | — | |
| Online / last seen | HAVE | — | plus «خبّي آخر ظهور». |
| Text formatting (bold, italic, strike, code, pre, spoiler, quote, link) | ADD | C3 | Markdown subset stored in `body`, rendered safely. |
| Link previews | ADD | C3 | Server fetch through `src/server/net-guard.ts`. |
| Emoji picker in the composer | ADD | C2 | `frimousse`. |
| Paste image / drag & drop files with «صورة / ملف» drop zones | ADD | C2 | |
| Albums (several pictures as one grid message) | CHANGE | C3 | Attachments already have `position`. |
| Media viewer (full screen, swipe, zoom, download) | ADD | C3 | |
| Voice notes with waveform | HAVE | — | |
| Voice speed 1× / 1.5× / 2×, play next automatically | ADD | C3 | |
| Hold-to-record, slide to cancel, lock | CHANGE | C2/M1 | Hold exists. |
| Round video messages | LATER | — | Low value for work. |
| Scheduled messages | ADD | C3 | Needs the in-app job runner (`src/server/jobs/`). |
| Send without sound | ADD | C3 | |
| Polls | HAVE | — | |
| Checklists (tick list inside a message, others tick/add) | ADD | C3 | The owner's ask «ضيف خانة شيك ليست» (2026-11-16). |
| Stickers / GIFs | NO | — | Not needed for work; heavy. |
| Secret chats / self-destruct | NO | — | Conflicts with the owner's archive and transparency notice. |
| Channels | CHANGE | C3 | = a topic of type «إعلانات» (posting: admins). Show it with a megaphone icon and «قناة» wording in the list. |
| Bots with inline buttons | ADD | I1 | Integration cards from the OMS / media buyer / n8n with link buttons (`I1-integrations-and-fit.md`). |
| Message threads (comments) | LATER | — | Replies + topics cover it. |
| Bot commands «/» and Business quick replies | ADD | Q1 | «/منتج» (product card), «/آراء» (customer reviews), «/رد» (approved answers), «/طلب» (order status), «/مشكلة» (ticket). |

## 4. Calls

| Feature | Status | Notes |
|---|---|---|
| Voice / video calls, group calls, meetings | HAVE | LiveKit self-hosted (`docs/CALLS-SERVER.md`). Restyle the call screen in C2 to the Telegram call look. |
| Full-screen ring on Android | HAVE | `StreamService`. |

## 5. Settings (personal) — `C4-settings.md`

| Telegram section | Status | Zaki today |
|---|---|---|
| My account (photo, name, username, bio) | CHANGE | `/profile` (name, job title, bio, photo, password, hide last seen). |
| Notifications and sounds (per type, sound, preview, badge, exceptions) | ADD | only the per-chat mute and a sounds toggle in the header. |
| Privacy and security (last seen, who can call, sessions, password, passcode lock) | ADD | hide last seen, password; R11 "sessions list" planned in Phase 5 of the old roadmap. |
| Data and storage (auto-download, cache size, clear cache) | ADD | — |
| Chat settings (text size, wallpaper, bubbles, theme, send key, quick reaction) | ADD | theme switch + company switch `chatBubbles`. |
| Folders | ADD | — |
| Devices | CHANGE | Android devices are listed and unpaired in `src/components/app-link/app-link.tsx`; push subscriptions have no screen; no self «اطلع من كل الأجهزة». |
| Language / digits | HAVE | «الأرقام: ١٢٣». |
| Keyboard shortcuts list | ADD | — |
| Help | HAVE | «دليل زاكي». |

## 6. EXTRA — ours, keep and place

| Feature | Where it goes in the new layout |
|---|---|
| Message → task / ticket («اعمل منها مهمة») | message menu + multi-select; the chat info panel tab «الشغل» lists what was made from this chat. |
| «ذكّرني» on a message | message menu. |
| Internal note (moderators) | message menu; note chip under the bubble (moderators only). |
| Translate, voice transcript, read text from image | message menu (switches as today). |
| Whiteboard «الصبورة» | header ⋮ menu + info panel. |
| «نتفرّج سوا» | header ⋮ menu; the session's topic opens in the same layout. |
| Topic summary (digest) | header ⋮ menu «لخّصلي». |
| Owner archive and silent oversight | unchanged rules (P0.1), a list folder «كل الشركة» for oversight holders only. |
| Topic types (tasks, ideas, follow-up, announcements) | icon + wording in the list; behaviour unchanged. |
| Polls with deadline / anonymous | attach menu. |
| Offline outbox with retry | the pending bubble (clock icon) + the failed bubble (red !) like Telegram. |
| Assistant contact | a normal DM row («المساعد»). |
