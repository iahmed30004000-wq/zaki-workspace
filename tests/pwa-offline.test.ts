import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/offline/route";
import { AR } from "@/lib/i18n/dict";
import { offlineHtml } from "@/lib/pwa/offline-page";
import { buildIdFrom, SHELL_MAX_FILES, shellFilesFrom } from "@/lib/pwa/build-id";
import { conversationOfUrl } from "@/lib/pwa/notifications";

/**
 * M1a — the offline page, the build fingerprint the cache is named from, and the pieces that read addresses. Every new string is Arabic with Western digits.
 */
const ROOT = path.resolve(__dirname, "..");

describe("the offline page", () => {
  it("says the owner's sentence: «ما في نت — الرسائل اللي بتكتبها رح تنبعت لما يرجع»", () => {
    expect(AR["mobile.offline.message"]).toBe("ما في نت — الرسائل اللي بتكتبها رح تنبعت لما يرجع");
    expect(offlineHtml()).toContain("ما في نت — الرسائل اللي بتكتبها رح تنبعت لما يرجع");
  });

  it("is ONE self-contained right-to-left document: no external file, no image, no font, no person's data", () => {
    const html = offlineHtml();
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).not.toMatch(/<link\b|<img\b|src=|@import|url\(/i);
    // it follows the device's light or dark mode with the browser's own colours (no hex)
    expect(html).toContain("color-scheme: light dark");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/userId|session|csrf|token/i);
  });

  it("is served as HTML by /offline, statically, and asked again every time by the browser", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe(offlineHtml());
    expect(readFileSync(path.join(ROOT, "src/app/offline/route.ts"), "utf8")).toContain('dynamic = "force-static"');
  });

  it("the worker asks for the same address, and its own small page says the very same sentence", () => {
    const worker = readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
    expect(worker).toContain('var OFFLINE_URL = "/offline"');
    expect(worker).toContain(`var OFFLINE_MESSAGE = "${AR["mobile.offline.message"]}";`);
  });

  it("when the network comes back the page reloads the address that was asked for (a deep link from a notification is not lost)", () => {
    expect(offlineHtml()).toContain("location.reload()");
    expect(offlineHtml()).not.toContain('location.href = "/"');
  });
});

describe("the build's fingerprint", () => {
  it("is the hash in the build's own script names; none in development", () => {
    expect(buildIdFrom(["/_next/static/chunks/webpack-1a2b3c4d5e6f7a8b.js", "/_next/static/chunks/main-app-9f8e7d6c5b4a3210.js?v=1"])).toBe("1a2b3c4d5e6f7a8b");
    expect(buildIdFrom(["https://zaki.test/_next/static/chunks/main-app-9f8e7d6c5b4a3210.js"])).toBe("9f8e7d6c5b4a3210");
    expect(buildIdFrom(["/_next/static/chunks/main-app.js?v=1700000000000", "/_next/static/chunks/app/layout.js"])).toBeNull();
    expect(buildIdFrom([])).toBeNull();
  });

  it("the shell's files are this site's hashed files, fonts and icons, as paths, once each, never a page or /api/", () => {
    const origin = "https://zaki.test";
    const files = shellFilesFrom(
      [
        "/_next/static/chunks/a.js?x=1",
        "https://zaki.test/_next/static/chunks/a.js",
        "/_next/static/css/b.css",
        "/fonts/reem-kufi-var.woff2",
        "/icons/icon-192.png",
        "/api/chat/list",
        "/chat",
        "https://cdn.test/_next/static/chunks/evil.js",
        "http://[bad",
      ],
      origin,
    );
    expect(files).toEqual(["/_next/static/chunks/a.js", "/_next/static/css/b.css", "/fonts/reem-kufi-var.woff2", "/icons/icon-192.png"]);
    const many = Array.from({ length: SHELL_MAX_FILES + 50 }, (_, i) => `/_next/static/chunks/c${i}.js`);
    expect(shellFilesFrom(many, origin)).toHaveLength(SHELL_MAX_FILES);
  });
});

describe("a notification's page", () => {
  it("names the conversation, wrapped in /go or not; a forum, a task and junk name none", () => {
    expect(conversationOfUrl("/chat/c1?m=m1")).toBe("c1");
    expect(conversationOfUrl(`/go?space=s&next=${encodeURIComponent("/chat/c2?m=m")}`)).toBe("c2");
    for (const none of ["/chat", "/chat/s/space", "/tasks/t1", "/go?space=s", null, undefined, ""]) expect(conversationOfUrl(none), String(none)).toBeNull();
  });
});

describe("the strings", () => {
  const mine = Object.entries(AR).filter(([key]) => key.startsWith("mobile."));

  it("exist, are Arabic, carry no Latin letter and no tanween on an alef (the project's dictionary rules)", () => {
    expect(mine.length).toBeGreaterThanOrEqual(20);
    for (const [key, value] of mine) {
      expect(value, key).toMatch(/[؀-ۿ]/);
      expect(value, key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toMatch(/ـاً/);
      expect(value, key).not.toMatch(/[٠-٩]/);
    }
  });

  it("every string a pwa component or page reads exists", () => {
    const sources = ["src/components/pwa/push-banner.tsx", "src/components/pwa/share-picker.tsx", "src/components/pwa/install-hint.tsx", "src/lib/pwa/offline-page.ts", "src/app/share/page.tsx"];
    for (const file of sources) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      for (const [, key] of text.matchAll(/["'`]((?:mobile|pwa)\.[a-z_.]+)["'`]/g)) expect(AR[key!], `${file}: ${key}`).toBeTruthy();
    }
  });
});
