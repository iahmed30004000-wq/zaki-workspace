# The Android app

`android/` is a **Trusted Web Activity**: the site, full screen, in the phone's own Chrome, with its own icon and name («زاكي»).
Nothing of the site is copied into it, so every page, feature and update comes from `https://workspace.zakiai.io` and the wrapper changes
only when its icon, name or colour changes.

Why a Trusted Web Activity and not a WebView: it is the phone's real Chrome, so web push, the microphone and camera of calls, the speech
recognition of the guide and the installed-app behaviour all work exactly as in the browser. A WebView has none of speech recognition,
push or screen sharing.

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

## The address bar

Chrome hides the address bar of a Trusted Web Activity only when the site proves it belongs to the app (Digital Asset Links). The proof is
`public/.well-known/assetlinks.json`, served by the site itself (the middleware lets it through without a sign-in), with the SHA-256
fingerprint of the app key and the package name. If the key is ever replaced, the fingerprint there must be replaced too
(`tests/android-app.test.ts` checks its shape). Chrome checks it when the app opens, so the site must be deployed before the new app is tried.

## Changing it

The package name is `io.zakiai.workspace` and must never change (it identifies the app on the phone). Raise `versionCode` and
`versionName` in `android/app/build.gradle` when the wrapper itself changes.
