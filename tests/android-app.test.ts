import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The Android wrapper: what must never drift (the address it opens, its identity, its icon) and that it carries no secret. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the Android app (native: Kotlin + Compose)", () => {
  it("talks to exactly the production site, opens its links, and is named «زاكي»", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:host="workspace.zakiai.io"');
    expect(manifest).toContain('android:name=".MainActivity"');
    expect(read("android/app/src/main/java/io/zakiai/workspace/Config.java")).toContain('BASE = "https://workspace.zakiai.io"');
    expect(read("android/app/src/main/res/values/strings.xml")).toContain("<string name=\"app_name\">زاكي</string>");
  });

  it("keeps one stable identity and asks only for what the live line and the call screen need", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain("applicationId 'io.zakiai.workspace'");
    expect(gradle).toContain("namespace 'io.zakiai.workspace'");
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
    // no backup: the key of the pairing must never be copied off the phone
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it("is a real app: native screens, a live line, a call screen, and it only ever opens addresses of the site", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    for (const name of [".StreamService", ".CallActivity", ".BootReceiver", ".DeclineReceiver"]) expect(manifest, name).toContain(`android:name="${name}"`);
    expect(manifest).toContain('android:foregroundServiceType="remoteMessaging"');
    const dir = "android/app/src/main/java/io/zakiai/workspace/";
    for (const f of ["MainActivity.kt", "LoginScreen.kt", "ChatScreens.kt", "OtherScreens.kt", "Api.kt", "WebHost.kt"]) expect(existsSync(join(process.cwd(), dir + f)), f).toBe(true);
    // the app's own web view keeps every address that is not the site out of its window
    expect(read(dir + "WebHost.kt")).toContain("Config.BASE");
    const config = read(dir + "Config.java");
    expect(config).toContain('path.startsWith("//")');
    const service = read(dir + "StreamService.java");
    expect(service).toContain("/api/device/stream");
    expect(service).toContain("Authorization");
    // writes carry the site's own origin, as the website's pages do (the server's origin guard)
    expect(read(dir + "Api.kt")).toContain('.header("Origin", Config.BASE)');
  });

  it("stays smooth: answers are parsed off the screen's thread, typing redraws only the box, and a web page exists only while it is open", () => {
    const dir = "android/app/src/main/java/io/zakiai/workspace/";
    const api = read(dir + "Api.kt");
    expect(api).toContain("withContext(Dispatchers.Default) { json.decodeFromString<T>(text) }");
    // no answer is decoded anywhere else (that would put the parsing back on the screen's thread)
    expect(api.match(/json.decodeFromString/g)).toHaveLength(1);
    const chat = read(dir + "ChatScreens.kt");
    expect(chat).toContain("private fun Composer(");
    expect(chat).not.toContain("imePadding()");
    expect(read(dir + "Models.kt").match(/@Immutable/g)?.length).toBeGreaterThanOrEqual(10);
    // three tabs only; the web view is made by MainActivity.webHost() on demand and destroyed on release
    expect(read(dir + "AppState.kt")).toContain("enum class Tab { CHAT, NOTES, MORE }");
    const main = read(dir + "MainActivity.kt");
    expect(main).toContain("private fun webHost(): WebHost =");
    expect(main).toContain("web?.destroy()");
    expect(main).not.toContain("web = WebHost(");
  });

  it("has its icons, and its colour is the site's theme colour", () => {
    for (const d of ["mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"]) expect(existsSync(join(process.cwd(), `android/app/src/main/res/${d}/ic_launcher.png`)), d).toBe(true);
    const colors = read("android/app/src/main/res/values/colors.xml");
    expect(colors).toContain("#050F1F");
  });

  it("is built by its own workflow and publishes only from main", () => {
    const wf = read(".github/workflows/android.yml");
    expect(wf).toContain("gradle -p android assembleRelease");
    expect(wf).toContain("if: github.ref == 'refs/heads/main'");
    expect(wf).toContain("android-latest");
    // the key lives in the gradle file and the repository, never in the workflow, and no private key is pasted anywhere as text
    expect(wf).not.toMatch(/storePassword|keyPassword|BEGIN (RSA |EC )?PRIVATE KEY/);
    expect(read("docs/ANDROID.md")).toContain("android-latest");
  });

  it("signs every build with ONE fixed key and the site proves it owns the app (so Chrome hides its bar)", () => {
    // the key itself is never in git: the workflow writes it from a repository secret
    expect(existsSync(join(process.cwd(), "android/zaki.p12"))).toBe(false);
    expect(read(".gitignore")).toContain("android/zaki.p12");
    expect(read(".github/workflows/android.yml")).toContain("secrets.ANDROID_KEYSTORE_B64");
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain("signingConfigs.zaki");
    const links = JSON.parse(read("public/.well-known/assetlinks.json"));
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(links[0].target.namespace).toBe("android_app");
    expect(links[0].target.package_name).toBe("io.zakiai.workspace");
    expect(links[0].target.sha256_cert_fingerprints).toHaveLength(1);
    expect(links[0].target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
