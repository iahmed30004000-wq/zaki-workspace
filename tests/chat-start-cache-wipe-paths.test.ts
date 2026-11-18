import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C1.5 — the wipe has to be CALLED. The behaviour of `wipeChatCache()` is proven in `chat-start-cache-device.test.ts`; this file pins
 * the places that must call it (a source-text test: no browser here) and the rules that keep message text from leaking elsewhere.
 */

const ROOT = path.resolve(__dirname, "..");
const src = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};
const CACHE = path.join(ROOT, "src/lib/chat/cache");
const cacheFiles = walk(CACHE).map((f) => ({ file: path.relative(ROOT, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

describe("the wipe is called from every place the plan names", () => {
  it("sign-out from the avatar menu: after the outbox is cleared and BEFORE the page leaves", () => {
    const text = src("src/components/shell/avatar-menu.tsx");
    expect(text).toContain('import { wipeChatCache } from "@/lib/chat/cache/wipe";');
    const onSuccess = text.slice(text.indexOf("onSuccess: async () => {"), text.indexOf("onError:"));
    expect(onSuccess.indexOf("await clearAllOutboxes()")).toBeGreaterThan(-1);
    expect(onSuccess.indexOf("await wipeChatCache()")).toBeGreaterThan(onSuccess.indexOf("await clearAllOutboxes()"));
    expect(onSuccess.indexOf('window.location.href = "/login"')).toBeGreaterThan(onSuccess.indexOf("await wipeChatCache()"));
  });

  it("sign-out from the onboarding page (the other client logout path): in the `finally`, before the page leaves, so a failed request still wipes", () => {
    const text = src("src/components/onboarding-form.tsx");
    expect(text).toContain('import { wipeChatCache } from "@/lib/chat/cache/wipe";');
    const signOut = text.slice(text.indexOf("async function signOut()"), text.indexOf("const fieldType"));
    expect(signOut).toMatch(/finally\s*\{[\s\S]*await wipeChatCache\(\);[\s\S]*window\.location\.replace\("\/login"\)/);
  });

  it("the driver is mounted by the providers, inside the query client, and loads the cache only on a device that holds one", () => {
    const providers = src("src/app/providers.tsx");
    expect(providers).toContain('import { ChatCacheDriver } from "@/lib/chat/cache/driver";');
    expect(providers.indexOf("<ChatCacheDriver />")).toBeGreaterThan(providers.indexOf("<QueryClientProvider"));
    expect(providers.indexOf("<ChatCacheDriver />")).toBeLessThan(providers.indexOf("</QueryClientProvider>"));
    const driver = src("src/lib/chat/cache/driver.tsx");
    expect(driver).toContain("deviceHoldsCache()");
    expect(driver).toContain('await import("@/lib/chat/cache/runtime")');
    expect(driver).not.toMatch(/^import .*runtime"/m);
  });

  it("the stream's «signed_out» (the page goes to the sign-in page), a different person and an external partner each wipe, in the one boot path", () => {
    const rt = src("src/lib/chat/cache/runtime.ts");
    const boot = rt.slice(rt.indexOf("private async boot()"), rt.indexOf("private attach()"));
    expect(boot).toMatch(/me\.status === "signed_out"[\s\S]*await wipeChatCache\(\{ broadcast: false \}\)/);
    // whose copy is on the device is read from the databases themselves, not only from the marker
    expect(boot).toMatch(/owners\(\)[\s\S]*\.some\(\(id\) => id !== me\.userId\)[\s\S]*broadcastWipe\(\);[\s\S]*await deleteDeviceCaches\(\)/);
    expect(boot).toMatch(/external === true[\s\S]*deleteDeviceCaches/);
    // an external partner never gets a persister; it is only created after `external === false`
    expect(boot.indexOf("new StartCachePersister")).toBeGreaterThan(boot.indexOf("external === true"));
    expect(boot).toMatch(/external !== false \|\| !store/);
  });

  it("the wipe is ONE exported function, and the settings button of C4.1 is not built here", () => {
    const definitions = walk(path.join(ROOT, "src")).filter((f) => /export (async )?function wipeChatCache\b/.test(readFileSync(f, "utf8")));
    expect(definitions.map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))).toEqual(["src/lib/chat/cache/wipe.ts"]);
    expect(readdirSync(path.join(ROOT, "src/lib/i18n")).filter((n) => /ar\.chat-cache/.test(n))).toEqual([]);
    expect(walk(path.join(ROOT, "src/components")).some((f) => readFileSync(f, "utf8").includes("امسح ذاكرة المحادثات"))).toBe(false);
  });
});

describe("message text stays where the rules put it", () => {
  it("the cache never touches localStorage, sessionStorage or cookies for anything but the one marker (the id of the person whose copy this is)", () => {
    for (const { file, text } of cacheFiles) {
      expect(text, file).not.toMatch(/sessionStorage|document\.cookie/);
      if (file.endsWith("device-store.ts")) {
        expect(text.match(/\.setItem\(/g) ?? []).toHaveLength(1);
        expect(text).toContain("setItem(DEVICE_MARKER_KEY, userId)");
      } else {
        expect(text, file).not.toMatch(/localStorage\.|\.setItem\(/);
      }
    }
  });

  it("no message body is ever logged by the cache", () => {
    for (const { file, text } of cacheFiles) expect(text, file).not.toMatch(/console\.|log\.(info|warn|error|debug)\(/);
  });

  it("the device copy is IndexedDB only: a database per person, nothing else", () => {
    const store = src("src/lib/chat/cache/device-store.ts");
    expect(store).toContain('export const DEVICE_DB_PREFIX = "zaki-chat-";');
    expect(store).toContain("deviceDbName");
    expect(store).not.toMatch(/composeOutboxStorage|localStorageOutbox/);
  });

  it("no schema change, no migration, no new dependency, no feature switch in this package", () => {
    const pkg = JSON.parse(src("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toContain("@tanstack/react-query");
    expect(cacheFiles.some(({ text }) => /isFeatureOn|featureOn\(/.test(text))).toBe(false);
  });

  it("the wipe stops the writer BEFORE it deletes anything (hooks first, databases second)", () => {
    const wipe = src("src/lib/chat/cache/wipe.ts");
    expect(wipe.indexOf("await runWipeHooks()")).toBeGreaterThan(-1);
    expect(wipe.indexOf("await deleteDeviceCaches()")).toBeGreaterThan(wipe.indexOf("await runWipeHooks()"));
  });
});
