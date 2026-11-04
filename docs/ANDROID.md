# The Android app

`android/` is a **native app** (Kotlin + Jetpack Compose) for `https://workspace.zakiai.io`. It talks to the site's own API with the same session
cookie the website uses (kept on the phone), so nothing of the site is duplicated on the server.

- **Native screens:** sign-in, the chat (list, conversation, send, read marks, calls start), the notifications.
- **Inside the app, in a web view** (same session, microphone/camera/file picker handled by the app): everything not native yet: «اليوم»،
  «المهام»، المشاريع، الملفات… and the call page. A new feature of the website appears here by itself when the site is deployed; only a
  new NATIVE screen or a change to a native one needs a new APK.
- **The live line** (`StreamService`, `/api/device/stream`): notifications and the full-screen ring of a call arrive even when the app is closed.
  Signing in registers the phone as a device of the person (`/api/me/app-devices`); signing out removes it.

Making a page native is adding a screen in `android/app/src/main/java/io/zakiai/workspace/` that calls the page's API route.

## How it is built

`.github/workflows/android.yml` builds it on a GitHub runner (JDK 17, Gradle 8.9, the runner's Android SDK):

- on a pull request that touches `android/`, `public/icons/` or the workflow: builds, publishes nothing;
- on `main` (same paths) or by hand: builds, keeps `zaki-workspace.apk` as a run artifact and publishes it as the release
  **`android-latest`**, the stable link for the phone:
  `https://github.com/iahmed30004000-wq/zaki-workspace/releases/download/android-latest/zaki-workspace.apk`.

## Installing

On the phone, open the link above, allow installs from the browser when asked, open the file. Every build is signed with the SAME key, so a newer build installs over the old one. The one exception is the first build with this key:
remove an app installed from an earlier build (it was signed with a throw-away key) once.

The key is a **repository secret**, never a file in git: `ANDROID_KEYSTORE_B64` (the key file, base64). The workflow writes it to
`android/zaki.p12` before building; without the secret it falls back to the debug key and warns. `.gitignore` keeps the file out of git.
Only the key's public fingerprint is in the repository (`public/.well-known/assetlinks.json`).

## Checked on an emulator

`.github/workflows/android-smoke.yml` builds the app, starts an Android emulator, installs it, opens it, tries a WRONG sign-in against the real site
(proving the round trip) and keeps the screenshots and the log as the run's artifact. It fails when the app crashes. It cannot sign in (no
account is ever used), so the screens after sign-in are checked by hand.

## Changing it

The package name is `io.zakiai.workspace` and must never change (it identifies the app on the phone). Raise `versionCode` and
`versionName` in `android/app/build.gradle` when the wrapper itself changes.
