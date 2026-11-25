# The Android app

`android/` is a **fully native app** (Kotlin + Jetpack Compose) for `https://workspace.zakiai.io` — the owner's decision of 2026-11-24
(D-M1, `docs/restructure/M2-native-app.md`): every section becomes a native screen, phase by phase, built like the OMS app «Zaki Orders».
It talks to the site's own API with the same session cookie the website uses, so nothing of the site is duplicated on the server.

**How it is built (N0, the foundation):**

| Piece | Where | What it does |
|---|---|---|
| Hilt | `ZakiApplication.kt`, `core/**/…Module` | one graph: network, database, session, workers |
| Network | `core/net/` | Retrofit + OkHttp + kotlinx.serialization on the site's routes; the `Origin` header the site's guard wants; every failure as an Arabic sentence (`ApiResult.kt`) |
| Session | `core/net/EncryptedCookieJar.kt`, `core/Session.kt` | the site's cookie, **encrypted** on the phone (the plain file of the app before 4.0 is moved in once, nobody is signed out); sign-in, onboarding, sign-out wipes everything |
| Cache | `core/db/Db.kt` (Room) | each screen opens with its last answer, even offline |
| Outbox | `core/db/Db.kt`, `core/sync/Workers.kt` | a message written offline waits and is sent later with its `clientId` — the server's idempotency key — so it never arrives twice |
| Crash reports | `core/crash/Crash.kt` → `POST /api/client-errors` | crashes and frozen screens are kept on the phone and sent to the server's log once somebody is signed in |
| Look | `ui/theme/Palettes.kt` (**generated** from the site's palettes: `npx tsx scripts/build-android-palettes.mjs`), `ui/theme/Theme.kt` | the site's eight themes, Plex / Reem Kufi, right to left |
| Lock | `core/Platform.kt` (`AppLock`) | optional fingerprint lock (cold start, and after five minutes away) |
| Shell | `feature/shell/` | drawer with the person and the spaces (switching = the site's own `/go`), three tabs, the «بدون اتصال» bar, links from notifications |
| The live line | `StreamService`, `Notifier`, `CallActivity` (Java) | notifications and the full-screen ring of a call even when the app is closed (`/api/device/stream`, the key from `/api/me/app-devices`) |

- **Native screens now:** sign-in, the onboarding (own password + transparency notice), the shell, the chat list and conversation (with the
  outbox), the notifications, the settings (theme, lock, the ringing phone's permissions, the app's health, sign-out).
- ⚠️ **Not native yet** — «اليوم», «مهامي», المشاريع، التقويم، الملفات… and the call page open the site's page INSIDE the app, with a line on
  screen that says so (`feature/web/WebBridge.kt`). 🔧 Each phase of M2 makes its sections native and removes them from the bridge; the bridge
  itself is deleted with the last phase. Nothing the team uses today disappears in between.

**Flavors:** `prod` talks to `https://workspace.zakiai.io` (the APK the phones get); `staging` talks to a local copy of the site at
`http://10.0.2.2:3100` (the emulator's address of the build machine; `npm run dev -- -p 3100`), has its own id (`io.zakiai.workspace.staging`,
installed beside the real app) and is the only build allowed plain HTTP (`src/staging/res/xml/network_security_config.xml`).

Making a page native is adding a screen under `android/app/src/main/java/io/zakiai/workspace/feature/` that calls the page's API route, and
removing its path from the bridge.

## How it is built

`.github/workflows/android.yml` runs its unit tests and builds it on a GitHub runner (JDK 17, Gradle 8.9, the runner's Android SDK):
`gradle -p android testStagingDebugUnitTest assembleProdRelease` (the release is shrunk by R8, `app/proguard-rules.pro`).

- on a pull request that touches `android/`, `public/icons/` or the workflow: builds, publishes nothing;
- on `main` (same paths) or by hand: builds, keeps `zaki-workspace.apk` as a run artifact and publishes it as the release
  **`android-latest`**, the stable link for the phone:
  `https://github.com/iahmed30004000-wq/zaki-workspace/releases/download/android-latest/zaki-workspace.apk`.

## Installing

On the phone, open the link above, allow installs from the browser when asked, open the file. Every build is signed with the SAME key, so a newer build installs over the old one. The one exception is the first build with this key:
remove an app installed from an earlier build (it was signed with a throw-away key) once.

The key is a **repository secret**, never a file in git: `ANDROID_KEYSTORE_B64` (the key file, base64), with its two passwords
`ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` (also repository secrets: this repository is public, so no password is ever written in a
file, and `npm run scan:secrets` fails on a Gradle file that does). The workflow writes the key file to
`android/zaki.p12` before building and hands the passwords to Gradle through the environment; without the file or either password it falls back to the debug key and warns. `.gitignore` keeps the file out of git.
Only the key's public fingerprint is in the repository (`public/.well-known/assetlinks.json`).

## Checked on an emulator

`.github/workflows/android-smoke.yml` builds the app, starts an Android emulator, installs it, opens it, tries a WRONG sign-in against the real site
(proving the round trip) and keeps the screenshots and the log as the run's artifact. It fails when the app crashes. It cannot sign in (no
account is ever used), so the screens after sign-in are checked by hand.

## Changing it

The package name is `io.zakiai.workspace` and must never change (it identifies the app on the phone). Raise `versionCode` and
`versionName` in `android/app/build.gradle.kts` with every build that is handed out. Versions of the libraries live once, in
`android/gradle/libs.versions.toml`. After a palette of the site changes, run `npx tsx scripts/build-android-palettes.mjs`
(`tests/android-palettes.test.ts` fails until you do).
