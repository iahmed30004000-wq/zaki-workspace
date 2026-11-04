import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The Android wrapper: what must never drift (the address it opens, its identity, its icon) and that it carries no secret. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the Android app (a Trusted Web Activity)", () => {
  it("opens exactly the production site, in the phone's Chrome, and is named «زاكي»", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:value="https://workspace.zakiai.io/"');
    expect(manifest).toContain('android:host="workspace.zakiai.io"');
    expect(manifest).toContain("com.google.androidbrowserhelper.trusted.LauncherActivity");
    expect(read("android/app/src/main/res/values/strings.xml")).toContain("<string name=\"app_name\">زاكي</string>");
  });

  it("keeps one stable identity and asks for nothing but the network and notifications", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain("applicationId 'io.zakiai.workspace'");
    expect(gradle).toContain("namespace 'io.zakiai.workspace'");
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(permissions.sort()).toEqual(["android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS"]);
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
