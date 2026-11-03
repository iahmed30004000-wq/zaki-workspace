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

On the phone, open the link above, allow installs from the browser when asked, open the file. ⚠️ The file is signed with the runner's
debug key, so **each build has its own key**: to install a newer build, remove the old app first. 🔧 A fixed release key makes updates
install over the old app: generate a key once (`keytool -genkeypair ...`), keep it as a repository secret, and sign `assembleRelease` with it.
That is the owner's step (a key is never typed by anybody else).

## The address bar

Chrome hides the address bar of a Trusted Web Activity only when the site proves it belongs to the app (Digital Asset Links:
`/.well-known/assetlinks.json` with the app's signing fingerprint). With the changing debug key it cannot, so the app opens the site
with a thin Chrome bar on top. Everything works; the bar goes away once a fixed release key is used and its fingerprint is published.

## Changing it

The package name is `io.zakiai.workspace` and must never change (it identifies the app on the phone). Raise `versionCode` and
`versionName` in `android/app/build.gradle` when the wrapper itself changes.
