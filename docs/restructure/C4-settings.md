# C4 — Settings, the Telegram way («الإعدادات»)

> Prerequisites: C2 (and C3a for folders). Today a person's own settings are scattered: `/profile` (name, job title,
> bio, photo, password, hide last seen), the theme switch in the top bar, «الأرقام» in the avatar menu, the sounds
> toggle in the chat header, the menu order «ترتيب». Company switches are in `/settings` → «الميزات» (58 switches in one flat list).
> This phase gives each person ONE settings screen shaped like Telegram's, and moves nothing that belongs to the
> company into it (company settings are A2's job).

## 1. Where it lives

- Route `src/app/(app)/settings/me/page.tsx` («إعداداتي») with sub-pages `/settings/me/<section>`; on the computer a
  two-column page (sections list on the start side, the section on the end side); on the phone a list that pushes
  each section as a screen (Telegram Android). The current `/settings` (company) keeps its address and becomes A2's
  «إعدادات الشركة»; `/profile` redirects to `/settings/me/account` (the old address keeps working).
- Entry points: the avatar menu «إعداداتي», the phone drawer «الإعدادات», Ctrl+, (comma).

## 2. Storage

- The person's choices: `User.chatPrefs` (added in C3a.2; zod schema `src/lib/chat/prefs.ts`, every field optional
  with a default in code, so an empty object is a valid "all defaults").
- Device-only choices (they differ per device on purpose, like Telegram's data settings): `localStorage` key
  `zk-device-prefs` (auto-download, text size override, cache size).
- Existing columns stay where they are and are edited from here: `User.name/jobTitle/bio/avatarUrl`, `theme`,
  `digits`, `themeSwitch`, `navOrder`, hide last seen (`src/server/services/last-seen.ts`).

## 3. Sections (step C4.1; the sessions list below is step C4.2)

Header card: big avatar, name, «@username», job title — tap opens «حسابي».

| Section | Items | Backed by |
|---|---|---|
| «حسابي» | photo, name, job title, bio, username (read-only unless `users.manage`), e-mail (read-only), change password | `/profile` form moved (`src/components/profile-form.tsx`), same routes |
| «الإشعارات والأصوات» | per type: الخاص · المواضيع · الإشارات «@» · الردود عليّ · المكالمات — each on/off, sound on/off, preview text on/off; in-app sounds; vibration (phone); badge count «كل الرسائل / بس اللي ما انقرت»; «استثناءات» = the list of muted chats with their unmute time; «أعد ضبط الإشعارات» | `chatPrefs.notifications` read by `src/server/chat/notify.ts` and `pushNotification` (a type switched off → no push; preview off → push says «رسالة جديدة» only) |
| «الخصوصية والأمان» | آخر ظهور: «الكل / ما حدا» (today's hide switch; the owner's `ownerHiddenOnline` rule unchanged); «الأجهزة والجلسات» (see below); كلمة السر; «قفل التطبيق» (a 4-digit local passcode for the installed app — device-only, LATER if M1 not done); «امسح ذاكرة المحادثات على هالجهاز» | existing services; sessions below |
| «الدردشة» | حجم الخط (5 steps); الخلفية (our 6 patterns × theme tint, or plain); شكل الفقاعات «فقاعات / كلاسيكي» (today the COMPANY switch `chatBubbles`: becomes the company default, the person may override); المظهر (the four themes + the two new ones of D1, and «تلقائي حسب الجهاز»); مفتاح الإرسال «إنتر / Ctrl+إنتر»; التفاعل السريع (pick the 6 quick reactions and the double-tap one); الأرقام «123 / ١٢٣» | `chatPrefs.chat`, `User.theme`, `User.digits` |
| «المجلدات» | the C3a.2 editor; show/hide the built-in tabs; order | `chatPrefs.folders` |
| «البيانات والتخزين» | تنزيل تلقائي للصور/الفيديو/الملفات «على الواي فاي / على بيانات الجوال» (device-only); حجم ذاكرة المحادثات + «امسح» (C1.5); جودة الصور المرسلة «عادية / عالية» (today `compress-image.ts` 1600 px) | `zk-device-prefs` |
| «الأجهزة» | the installed Android app(s) (`AppDevice`: name, last seen, «افصل» — today listed and unpaired in `src/components/app-link/app-link.tsx`, route `DELETE /api/me/app-devices/[id]` exists: move it here); browsers that receive notifications (`PushSubscription`: user agent, last used, «افصل» — NEW `DELETE /api/me/push/[id]`); «اطلع من كل الأجهزة» — NEW self route `POST /api/me/logout-everywhere` (bumps own `tokenVersion`; today only the admin route on others exists: `/api/organizations/[id]/members/[userId]/logout`) | existing tables |
| «اللغة والأرقام» | العربية (only language, shown for completeness) · الأرقام | `User.digits` |
| «القائمة» | today's «ترتيب» (`navOrder`) editor moved here; when D-N5 = company order, it becomes «خبّي الأماكن الاختيارية» only, with a visible ⚠️ line «الترتيب صار للشركة كلها» + 🔧 «اطلب من المدير يغيّره» | `User.navOrder` |
| «الاختصارات» | the C2 §8 table (read-only) | `src/lib/chat/shortcuts.ts` |
| «المساعدة» | «دليل زاكي», «شو الجديد», «تواصل مع الإدارة» (opens a DM with the owner or the support topic) | existing guide |

**Sessions («الجلسات»):** today a cookie cannot be ended alone (PHASE0-AUDIT R11). Minimal version in this phase: list
the devices above + «اطلع من كل الأجهزة». A real per-session list (table `UserSession`: id, user, created, last seen,
user agent, revokedAt; the cookie carries the session id; `currentUser()` refuses a revoked one) is planned as
C4.2 — additive, with its own DB tests (a revoked session gets 401 on the next request; the others keep working).

## 4. Company chat settings (step C4.3 — for the owner / `integrations.manage`; until A2 exists, put this group at the top of today's «الميزات» list in `/settings`)

Not in «إعداداتي». They are a section of A2's «إعدادات الشركة» → «الدردشة»: the chat-related switches grouped and
explained (chatBubbles default, chatOutbox, voiceNotes, voiceTranscript, messageTranslate, whiteboard, calls,
callNoiseFilter, quickChat, linkPreviews, chatLayoutV2, lastSeen, ownerHiddenOnline, chatRowMenu), each with a ⚠️/🔧
note where it has a risk.

## 5. Acceptance

- [ ] Every section reachable in ≤ 2 taps from the chat list (phone) and ≤ 2 clicks (computer).
- [ ] A notification type switched off produces no push (DB test on `notify.ts` with prefs), preview off sends the
      generic text (unit test of the payload builder).
- [ ] Text size and wallpaper apply live without reload and persist.
- [ ] `/profile` still works (redirect test); old preferences are read correctly.
- [ ] Strings in `src/lib/i18n/ar.settings-me.json`.

## 6. Built: C4.3 (2026-11-20)

- The group of section 4 is on today's «الميزات» list in `/settings`, first after the economy panel, titled «الدردشة» (owner only, like the whole list: the switch route refuses everybody else).
- It is data: `COMPANY_CHAT_GROUP` in `src/lib/features.ts` (key, `risk`, `note`); `FeatureSwitches` draws it and then the rest of the list. A1.4 replaces the flat list with groups and `dependsOn` and absorbs this array as its chat group; A2 moves the whole screen to «إعدادات الشركة» → «الدردشة».
- ⚠️/🔧 strings: `ar.settings-company-chat.json` (`companyChat.warn.<key>` / `companyChat.fix.<key>`), for voiceTranscript, messageTranslate, linkPreviews, lastSeen, ownerHiddenOnline. The model-sending ones say no customer data goes to an outside model.
- Not here: the person's own override of `chatBubbles` (C4.1, `chatPrefs.chat`).

## 7. Status of C4.1 (2026-11-20)

Built on `feat/settings-me`: every section of §3 except «قفل التطبيق» (LATER), «شو الجديد» and «خبّي الأماكن الاختيارية», with these differences from the table: «الإشعارات والأصوات» offers the five kinds with `on` and `preview` (the per-type sound, vibration and the badge count need `public/sw.js` and the unread code: not offered); «الدردشة» does not offer the bubble-shape override (the new chat does not read `chatBubbles`; the old screen reads it from `topics.ts`) and the double tap is stored but not yet wired to the messages (see `pr/C4.1.md`); «البيانات والتخزين» stores the automatic download per device but the chat's media parts do not ask for it yet. Everything is in `pr/C4.1.md`.
