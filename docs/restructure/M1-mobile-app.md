# M1 — The phone app looks and behaves like Telegram on Android

> Prerequisites: C2 (the phone layout of the chat), C1 (cache), D1/N1 (tokens and the drawer). The owner
> (2026-11-16): «بدي لما ينزلوا نسخة كروم كـ APK تكون شبه التلي، لأنو متعودين عليه، شبهه بنسبة 100٪، طبعًا بتحط
> وركسبيس». Two ways people install it today, both covered:
> - **M1a — installed from Chrome** («تثبيت التطبيق» in the sidebar → Chrome builds a WebAPK): the site itself.
> - **M1b — the native Android app** (`android/`, Kotlin + Compose, `docs/ANDROID.md`): native chat screens that POLL
>   (list every 15 s, conversation every 5 s, `ChatScreens.kt`) + a web view for the rest + the live line
>   (`StreamService`) for notifications and the full-screen call ring.
>
> Decision D-M1 (recommended): **ONE chat UI — the C2 web chat — in both.** The native app keeps what only native
> code can do (the live line, the ring, notifications with actions, the share sheet, system bars) and shows the web
> UI for everything else. A second, native copy of a Telegram-like chat would have to follow every web feature
> (checklists, polls, albums, privacy rules) and would always lag. The native chat screens are kept, marked, behind
> an in-app switch «الدردشة القديمة» (AGENTS.md: mark, never remove), default OFF.

## 1. The look (applies to both — it IS the C2 phone layout)

Telegram-Android anatomy, in Zaki's identity (name «زاكي», our logo, our colours from D1, no Telegram asset):
- **List screen:** app bar 56 dp: «☰», title (current folder, or «زاكي»), 🔍. Folder tabs under it with an
  underline indicator. Rows 72 dp: 54 dp round avatar, title + time, preview + badges. FAB «✏️» at the bottom end (the left, in this right-to-left layout); it hides
  when scrolling down and returns when scrolling up. The app bar gets its shadow only after scrolling.
- **Drawer** (from «☰», swipe from the start edge): header with avatar, name, «@username», a chevron that expands the
  spaces switcher (like Telegram's accounts list, each space with its unread count); then «اليوم», «الشغل»,
  «المكتبة», «نتفرّج سوا», «الإدارة», «الرسائل المحفوظة», «الإعدادات», «دليل زاكي»; at the bottom the theme moon/sun.
- **Conversation:** app bar with back arrow, avatar, title, subtitle, 📞, ⋮; the wallpaper; bubbles with tails; the
  composer pinned above the keyboard (`interactive-widget=resizes-content` in the viewport meta; `visualViewport`
  fallback); swipe-to-reply on a bubble; long-press opens the reactions bar + menu with a light vibration
  (`navigator.vibrate(10)`); swipe from the start edge goes back.
- **Row gestures:** swipe a row → archive (with «تراجع» snackbar for 5 s); long-press a row → selection mode for
  several chats (pin, mute, archive, mark read).
- **Pull down at the top of the list** reveals the «المؤرشفة» row (Telegram's hidden archive).
- **Ripples** on rows and buttons (CSS, `motion-reduce` off), 48 dp minimum targets.
- **Sheets** instead of popovers on the phone: attach menu, mute options, message menu (bottom sheet when it does not
  fit), emoji picker.

## 2. M1a — the installed site (Chrome WebAPK / installed app)

- [ ] `src/app/manifest.ts`: `name: "زاكي"`, `short_name: "زاكي"`, `display: "standalone"`, `start_url: "/chat?src=app"`
      (the app opens on the chats, like Telegram — D-N1 decides the default page for the browser), `theme_color` /
      `background_color` from the default theme (D1), maskable icons (existing `public/icons/`), `shortcuts`:
      «رسالة جديدة» (`/chat?new=message` — add a `?new=message` intent: today the «جديد» action `message` in `src/lib/nav/new-actions.ts` has none), «مهامي» (`/my-work`), and `share_target` (`action: "/share"`, GET with `title`,
      `text`, `url`) — files LATER.
- [ ] `/share` page: «ابعت لـ…» chat picker (C1 list cache) → opens the chosen conversation with the text in the
      composer (never auto-sends).
- [ ] Service worker (`public/sw.js`, today push + click only, no cache): precache the app shell (the built JS/CSS of
      the chat route, fonts, icons) with a versioned cache named from the build id; network-first for HTML, cache-first
      for hashed `/_next/static/*`, no caching of `/api/*` (data lives in C1's IndexedDB); an offline page «ما في نت —
      الرسائل اللي بتكتبها رح تنبعت لما يرجع». Registered at sign-in for everybody (today only from call/bell buttons).
- [ ] Push permission asked from the chat at the right moment (first DM opened, or a banner «فعّل الإشعارات لتوصلك
      الرسائل والجهاز مسكّر»), not only from the bell.
- [ ] App badge: `navigator.setAppBadge(unreadTotal)` / `clearAppBadge()` from the C1 cache.
- [ ] Notifications per message, grouped by conversation (`tag = conversationId`, `renotify` on new ones), with the
      sender's name and a preview (respecting C4's preview switch); a DM pushes each message, not only the first unread
      (today: only the first of an unread run, `src/server/chat/notify.ts`).
- [ ] The install button («تثبيت التطبيق») uses `beforeinstallprompt` where available and shows the Android/iOS steps
      otherwise; iOS note: web push only works after «أضف إلى الشاشة الرئيسية» (iOS 16.4+).

## 3. M1b — the native Android app becomes a Telegram-shaped shell

`android/app/src/main/java/io/zakiai/workspace/`:
- [ ] `MainActivity.kt`: ONE full-screen `WebHost` on `/chat` becomes the default (the web UI draws the Telegram
      chrome). The Compose `NavigationBar` (bottom bar) AND the native chat screens stay in the code behind ONE in-app
      setting «الشكل القديم» (OFF by default; ON = today's app exactly), shown on the app's settings screen with ⚠️ «هاد
      الشكل القديم، رح ينشال لما المدير يقرر» + 🔧 «رجّع للشكل الجديد»; marked in `docs/ANDROID.md`.
- [ ] `WebHost.kt`:
  - hardware/gesture back → a JS bridge call `window.zakiApp?.back()` that closes the top sheet/drawer or goes back in
    the chat stack; when it returns `false`, `webView.goBack()`; at the root, the app goes to the background (Telegram).
  - system bars follow the theme: the web page calls `ZakiNative.setBars(colorHex, darkIcons)` (a `@JavascriptInterface`
    with a strict colour regex) when the theme changes.
  - `WebSettings`: cache mode default, `setSupportZoom(false)`, text zoom from C4's text size, `mediaPlaybackRequiresUserGesture=false`
    for voice notes, file chooser (exists) + camera capture.
  - keep the session cookie (exists); preload the WebView at process start for an instant open.
- [ ] Notifications (`Notifier.java`, `StreamService.java`):
  - channels: «الخاص», «المواضيع», «الإشارات», «المكالمات» (users change sound/vibration per channel in Android settings);
  - one notification per conversation with `MessagingStyle` (sender, text), grouped; actions «رد» (RemoteInput → `POST
    /api/chat/conversations/:id/messages` with a `clientId`, through the app's own session, as `Api.kt` already does)
    and «علّم كمقروء»;
  - a tap opens `/chat/<id>` in the web view;
  - the launcher badge = unread total (from the stream's notes);
  - keep the full-screen ring (`CallActivity.java`) — restyle it to the Telegram call screen (avatar, name, «عم يرن…»,
    swipe/answer/decline) in D1's colours.
- [ ] Share sheet: an `ACTION_SEND` intent filter (text/plain) → opens `/share?text=…` in the web view.
- [ ] The three bridges of Q1.2 (`ZakiNative.copyText`, `saveImage`, `shareImages`) and its download listener already
      exist by now — keep them, with their checks (this site's pages only, size cap, clean file names).
- [ ] `versionCode` / `versionName` raised (`android/app/build.gradle`), and P0.6 done before the first new release.
- [ ] `.github/workflows/android-smoke.yml` still passes (it checks the wrong-login round trip); add a screenshot of the
      web chat inside the app to the run's artifacts.

## 4. Acceptance

- [ ] On a mid-range Android phone (owner's device), installed from Chrome AND from the APK: cold start to the chat
      list < 1.5 s with a warm cache; opening a chat < 300 ms; no browser UI visible; back gesture behaves like
      Telegram (sheet → chat → list → background).
- [ ] With the app closed: a DM arrives as a grouped notification with reply and mark-read; replying from the
      notification sends once (idempotent `clientId`).
- [ ] Side-by-side screenshots (Telegram vs Zaki) of: list, drawer, conversation, message menu, attach sheet,
      settings — attached to the PR, reviewed by the owner («شيك»).
- [ ] Nothing in the app says "Telegram"; icons and patterns are ours (`public/brand/CREDITS.md` updated).
