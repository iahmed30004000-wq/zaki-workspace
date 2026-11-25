import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The Android app (docs/ANDROID.md, docs/restructure/M2-native-app.md): what must never drift — the address it talks to, its identity,
 * its permissions, how it keeps the session, the live line and the call ring — and that it carries no secret.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SRC = "android/app/src/main/java/io/zakiai/workspace/";
const GRADLE = "android/app/build.gradle.kts";

function kotlinFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(process.cwd(), p)).isDirectory()) out.push(...kotlinFiles(p));
    else if (/\.(kt|java)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the Android app (fully native: Kotlin + Compose, Hilt, Room, WorkManager)", () => {
  it("the real app talks to exactly the production site, opens its links, and is named «زاكي»", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:host="workspace.zakiai.io"');
    expect(manifest).toContain('android:name=".MainActivity"');
    const gradle = read(GRADLE);
    expect(gradle).toMatch(/create\("prod"\)[\s\S]*?BASE_URL", "\\"https:\/\/workspace\.zakiai\.io\\""/);
    // the local test copy has its own id: it installs beside the real app and never replaces it
    expect(gradle).toMatch(/create\("staging"\)[\s\S]*?applicationIdSuffix = "\.staging"/);
    expect(read(SRC + "Config.java")).toContain("BASE = BuildConfig.BASE_URL");
    expect(read("android/app/src/main/res/values/strings.xml")).toContain('<string name="app_name">زاكي</string>');
  });

  it("keeps one stable identity and asks only for what the live line and the calls need", () => {
    const gradle = read(GRADLE);
    expect(gradle).toContain('applicationId = "io.zakiai.workspace"');
    expect(gradle).toContain('namespace = "io.zakiai.workspace"');
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(permissions.sort()).toEqual([
      "android.permission.CAMERA",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING",
      "android.permission.INTERNET",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.RECORD_AUDIO",
      "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      "android.permission.USE_FULL_SCREEN_INTENT",
    ]);
    // no backup of any kind: the session, the pairing key and the cached chats never leave the phone
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    const rules = read("android/app/src/main/res/xml/data_extraction_rules.xml");
    for (const domain of ["root", "file", "database", "sharedpref"]) expect(rules.match(new RegExp(`domain="${domain}"`, "g"))).toHaveLength(2);
  });

  it("speaks HTTPS only; plain HTTP to the local copy exists in the staging flavor alone", () => {
    const main = read("android/app/src/main/res/xml/network_security_config.xml");
    expect(main).toContain('cleartextTrafficPermitted="false"');
    expect(main).not.toContain("10.0.2.2");
    expect(main).not.toContain('cleartextTrafficPermitted="true"');
    expect(read("android/app/src/staging/res/xml/network_security_config.xml")).toContain("10.0.2.2");
  });

  it("keeps the session encrypted on the phone, and moves the old plain one in without signing anybody out", () => {
    const jar = read(SRC + "core/net/EncryptedCookieJar.kt");
    expect(jar).toContain("EncryptedSharedPreferences.create(");
    expect(jar).toContain('LEGACY_FILE = "zaki-cookies"');
    expect(jar).toContain("context.deleteSharedPreferences(LEGACY_FILE)");
    // no other file keeps a cookie or the session in plain prefs
    for (const f of kotlinFiles("android/app/src/main/java")) {
      if (f.endsWith("EncryptedCookieJar.kt")) continue;
      expect(read(f), f).not.toMatch(/getSharedPreferences\("zaki-cookies"/);
    }
  });

  it("is a real app: a live line, a call screen, and every write carries the site's own origin", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    for (const name of [".StreamService", ".CallActivity", ".BootReceiver", ".DeclineReceiver", ".ZakiApplication"]) expect(manifest, name).toContain(`android:name="${name}"`);
    expect(manifest).toContain('android:foregroundServiceType="remoteMessaging"');
    const config = read(SRC + "Config.java");
    expect(config).toContain('path.startsWith("//")');
    const service = read(SRC + "StreamService.java");
    expect(service).toContain("/api/device/stream");
    expect(service).toContain("Authorization");
    const net = read(SRC + "core/net/NetworkModule.kt");
    expect(net).toContain('.header("Origin", origin())');
    expect(net).toContain("fun origin(): String = Config.BASE");
  });

  it("is native: one activity of Compose screens; the site's page survives only in the marked, temporary bridge", () => {
    for (const f of ["MainActivity.kt", "ZakiApplication.kt", "ui/Root.kt", "feature/shell/Shell.kt", "feature/chat/ChatListScreen.kt", "feature/chat/ConversationScreen.kt", "feature/auth/Auth.kt", "feature/settings/Settings.kt", "core/db/Db.kt", "core/sync/Workers.kt", "core/crash/Crash.kt"]) {
      expect(existsSync(join(process.cwd(), SRC + f)), f).toBe(true);
    }
    const withWebView = kotlinFiles("android/app/src/main/java").filter((f) => /\bWebView\(/.test(read(f)));
    expect(withWebView).toEqual([`${SRC}feature/web/WebBridge.kt`]);
    const bridge = read(SRC + "feature/web/WebBridge.kt");
    expect(bridge).toContain("⚠️ TEMPORARY");
    expect(bridge).toContain("🔧");
    expect(bridge).toContain("uri.host == Uri.parse(Config.BASE).host");
    // the page says so on screen, the warning and its fix together
    expect(bridge).toContain("WarnFix(T.webWarn, T.webFix)");
  });

  it("sends a message through the outbox with the server's idempotency key, so a retry never doubles it, and only in its writer's name", () => {
    const workers = read(SRC + "core/sync/Workers.kt");
    // the write runs on the application's scope (leaving the screen never loses it), with the clientId the server honours
    expect(workers).toContain("val send = draft(clientId).copy(clientId = clientId)");
    expect(workers).toContain("api.sendMessage(item.target, json.decodeFromString(ChatSend.serializer(), item.payload))");
    expect(workers).toContain("ownerId = user.id.orEmpty()");
    // a new message never waits behind an old run's retry delay
    expect(workers).toContain("ExistingWorkPolicy.REPLACE");
    // rows another person wrote on this phone are dropped, never sent
    expect(workers).toContain("outbox.dropOthers(me)");
    // every message of the composer (a reply, files, a voice note, a poll, a list) goes through the outbox
    const vms = read(SRC + "feature/chat/ChatViewModels.kt");
    expect(vms).toContain("outbox.sendChat(id) { clientId ->");
    expect(vms).toContain("fun sendRich(draft: (String) -> ChatSend) { outbox.sendChat(id, draft) }");
    const db = read(SRC + "core/db/Db.kt");
    expect(db).toContain("@PrimaryKey val clientId: String");
    expect(db).toContain("val sentAt: Long? = null");
  });

  it("the chat follows the site's live line with ids only, catches up through the sync feed, and stops at a sign-out", () => {
    const live = read(SRC + "core/live/LiveLine.kt");
    expect(live).toContain('"/api/rt?tab=android"');
    expect(live).toContain('header("Last-Event-ID", it)');
    expect(live).toContain("api.sync(after = after)");
    // a sign-out ends the line and forgets where it was
    expect(live).toMatch(/if \(gate == Gate\.SIGNED_OUT\) \{[\s\S]*?cursor = null[\s\S]*?lastEventId = null/);
    // a frame's words are never read: only its kind and ids
    expect(live).not.toMatch(/str\("body"\)|str\("preview"\)/);
    const store = read(SRC + "feature/chat/ChatStore.kt");
    expect(store).toContain("if (it == Gate.SIGNED_OUT) clear()");
    // pictures and the session: the site's own addresses are fetched with the app's client (its cookie), never handed to a browser
    expect(read(SRC + "ZakiApplication.kt")).toContain(".callFactory { http.get() }");
  });

  it("an expired session keeps the person's own unsent messages; signing out on purpose removes them", () => {
    const session = read(SRC + "core/Session.kt");
    expect(session).toContain("wipe(failure.message, keepOutbox = true)");
    expect(session).toContain("wipe(null, keepOutbox = false)");
    // an answer still on its way never refills the cache after a sign-out
    expect(session).toContain("cache.bump()");
    expect(read(SRC + "core/Cache.kt")).toContain("if (startedIn == generation)");
  });

  it("the encrypted session is opened off the main thread: the splash stays until the gate is known", () => {
    const jar = read(SRC + "core/net/EncryptedCookieJar.kt");
    // the Keystore and the decryption run on a thread of their own, started at once; every reader waits for it
    expect(jar).toContain('Thread({ load(context) }, "zaki-cookies")');
    expect(jar).toContain("loaded.await()");
    expect(jar).not.toMatch(/private val prefs: SharedPreferences\? = runCatching \{ open\(context\) \}/);
    const session = read(SRC + "core/Session.kt");
    expect(session).toContain("MutableStateFlow(Gate.STARTING)");
    expect(session).not.toContain("MutableStateFlow(if (jar.hasSession())");
    const main = read(SRC + "MainActivity.kt");
    expect(main).toContain("setKeepOnScreenCondition { session.gate.value == Gate.STARTING }");
  });

  it("a crash report never carries an exception's message (it can hold what the person typed)", () => {
    const crash = read(SRC + "core/crash/Crash.kt");
    expect(crash).toContain("SafeTrace.headline(error, thread.name), SafeTrace.stack(error)");
    expect(crash).not.toMatch(/error\.message/);
    expect(crash).not.toContain("stackTraceToString()");
  });

  it("has its icons, its colour is the site's theme colour, and its release is shrunk", () => {
    for (const d of ["mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"]) expect(existsSync(join(process.cwd(), `android/app/src/main/res/${d}/ic_launcher.png`)), d).toBe(true);
    expect(read("android/app/src/main/res/values/colors.xml")).toContain("#050F1F");
    expect(read(GRADLE)).toMatch(/release \{[\s\S]*?isMinifyEnabled = true/);
  });

  it("is built and unit-tested by its own workflow and publishes only from main", () => {
    const wf = read(".github/workflows/android.yml");
    expect(wf).toContain("gradle -p android testStagingDebugUnitTest assembleProdRelease");
    expect(wf).toContain("android/app/build/outputs/apk/prod/release/app-prod-release.apk");
    expect(wf).toContain("if: github.ref == 'refs/heads/main'");
    expect(wf).toContain("android-latest");
    // the key lives in the gradle file and the repository, never in the workflow, and no private key is pasted anywhere as text
    expect(wf).not.toMatch(/storePassword|keyPassword|BEGIN (RSA |EC )?PRIVATE KEY/);
    expect(read("docs/ANDROID.md")).toContain("android-latest");
  });

  it("signs every build with ONE fixed key and the site proves it owns the app", () => {
    expect(existsSync(join(process.cwd(), "android/zaki.p12"))).toBe(false);
    expect(read(".gitignore")).toContain("android/zaki.p12");
    expect(read(".github/workflows/android.yml")).toContain("secrets.ANDROID_KEYSTORE_B64");
    const gradle = read(GRADLE);
    expect(gradle).toContain('signingConfigs.getByName("zaki")');
    const links = JSON.parse(read("public/.well-known/assetlinks.json"));
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(links[0].target.namespace).toBe("android_app");
    expect(links[0].target.package_name).toBe("io.zakiai.workspace");
    expect(links[0].target.sha256_cert_fingerprints).toHaveLength(1);
    expect(links[0].target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it("never builds a debug-signed APK over the real one: a key file without both passwords stops the workflow, and the passwords come from the environment", () => {
    const flow = read(".github/workflows/android.yml");
    const keyStep = flow.slice(flow.indexOf("Put the signing key in place"), flow.indexOf("Build and test"));
    expect(keyStep).toContain("secrets.ANDROID_KEYSTORE_PASSWORD");
    expect(keyStep).toContain("secrets.ANDROID_KEY_PASSWORD");
    expect(keyStep).toMatch(/-z "\$KEYSTORE_PASSWORD"[\s\S]*exit 1/);
    const gradle = read(GRADLE);
    expect(gradle).toContain('System.getenv("ANDROID_KEYSTORE_PASSWORD")');
    expect(gradle).toContain('System.getenv("ANDROID_KEY_PASSWORD")');
    expect(gradle).not.toMatch(/(store|key)Password = "/);
  });
});
