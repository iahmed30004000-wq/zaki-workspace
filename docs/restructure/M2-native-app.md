# M2 — The fully native Android app

> The owner (2026-11-24), answering D-M1: «اريده كله يكون اصلي ومافيه صفحات ويب … احترافي مثل التطبيقات الحقيقية القوية».
> The whole app is native (Kotlin + Jetpack Compose); no web view for any section. The model is the OMS app «Zaki Orders»
> (`zaki-orders-android`, built 2026-11-22): Hilt, Room cache, Retrofit, WorkManager outbox, DataStore, biometric lock,
> crash reports, staging/prod flavors, a signed release build.
>
> This replaces the D-M1 recommendation in `M1-mobile-app.md` (one web chat in both). M1a (the installed site) stays as it is.

## Fixed constraints

- **Same app on the phones.** Package `io.zakiai.workspace` never changes; the signing key stays the repository secret
  (`docs/ANDROID.md`), so every new build installs over the installed one. `versionCode` goes up with every build.
- **Same place, same pipeline.** The code stays in `android/`; `.github/workflows/android.yml` and `android-smoke.yml`
  keep building it (paths updated for the new Gradle files).
- **Extend, never rebuild — on the server.** The app calls the API routes the website already calls. A server change is
  made only where the phone needs something the site does not (listed per phase), in its own small PR with a test.
- **Mark, never remove.** Native pieces of today's app that work (`StreamService`, `CallActivity`, `Notifier`,
  `BootReceiver`, `DeclineReceiver`) are moved into the new structure, not dropped.
- **Authorization stays on the server.** The app hides nothing it is not allowed to see by itself; it shows what the
  API returns. A guest never sees a price because the server never sends one.
- **Arabic, right to left, Zaki's look.** The themes come from the site's tokens (`tg-night`, `tg-day`, the D1 palette),
  translated once into Compose colours. No Telegram asset.

## Architecture (same as the OMS app)

```
android/
  settings.gradle.kts · build.gradle.kts · gradle/libs.versions.toml
  app/src/main/java/io/zakiai/workspace/
    App.kt                    Hilt application, WorkManager factory, crash handler
    core/net/                 OkHttp (persistent encrypted cookie jar, Origin header, retry), Retrofit + kotlinx.serialization,
                              ApiError mapping (auth.onboarding_required, 401 → sign-in, 403, 404, 429)
    core/db/                  Room: cache tables per feature + the outbox (pending writes with an idempotency key)
    core/sync/                WorkManager: outbox sender, periodic refresh; the live line (StreamService, /api/rt) pushes changes
    core/prefs/               DataStore: current space, theme, lock, last-seen
    core/ui/                  theme (colours, Plex/Reem Kufi fonts, shapes), RTL, common pieces (avatar, badge, empty, error ⚠️/🔧)
    core/security/            biometric lock, screenshot flag for private chats (setting)
    feature/auth/             sign-in, first-sign-in password change, transparency notice
    feature/shell/            drawer + bottom tabs, space switcher, search
    feature/chat/ · feature/today/ · feature/tasks/ · feature/projects/ · feature/boards/ · feature/files/
    feature/notifications/ · feature/calls/ · … one package per section
  app/src/test/               unit tests (mappers, outbox, reducers)
  app/src/androidTest/        Compose UI tests on the emulator
```

Flavors: `staging` (the local copy at `10.0.2.2:3000`) and `prod` (`https://workspace.zakiai.io`).

## Phases (built back to back; each one a branch + PR, merged by the owner)

| Phase | What becomes native | Server needs | Done when |
|---|---|---|---|
| **N0 Foundation** | New Gradle/Hilt/Room/Retrofit skeleton, sign-in + onboarding, shell (drawer, tabs, space switcher), theme, biometric lock, crash reports, the existing live line + call ring + notifications moved in. Until a section's phase lands, its tab shows «قريبًا» (no web view). | A crash-report door if none exists (`/api/client-errors`, as in the OMS) | Builds in CI, signs in on the emulator against the local copy, survives offline start |
| **N1 Chat** | List with folders, archive, pins, search; conversation with bubbles, reply/forward/edit/delete, reactions, read marks, typing; attachments (photos with editor, files, voice notes), albums, polls, checklists; groups, topics, bots, saved messages; offline send through the outbox | Whatever the web chat reads in one call that the phone needs in pages (cursor paging) | Every chat feature of the web works on the phone; sending offline delivers once, never twice |
| **N2 Today & tasks** | «اليوم», «مهامي», task details, steps, comments, assign (with the rank rule's request flow), due dates, reminders | — | Same results as the site for the same person |
| **N3 Projects & boards** | Spaces, projects, Kanban with drag and drop, cards, labels, milestones, goals | — | Drag on the phone = drag on the site |
| **N4 Files & notifications** | Library with upload/download (Drive proxy as today), previews, notification centre with actions | — | Upload resumes after a lost connection |
| **N5 Calls** | Native voice/video calls (WebRTC) replacing the call page | — | A call between the app and the site connects both ways |
| **N6 The rest** | Approvals, calendar, CRM, tickets, ideas, documents, knowledge, campaigns, check-ins, time, development, manufacturing, owner panels, settings, members | Per section | No section left without a native screen |

## Gates for every Android PR

- `./gradlew :app:testStagingDebugUnitTest :app:assembleProdRelease` green on the PR (CI).
- The smoke workflow green (install, open, wrong sign-in round trip, no crash).
- On the local emulator against the local copy (never production): the phase's checks above, with screenshots in the PR.
- ⚠️ A real phone (camera, fingerprint, background notifications) is not covered by the emulator. 🔧 The owner checks each
  phase on his phone after the build is published; the PR says «مش مفحوص على جوال حقيقي» until then.
