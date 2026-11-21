import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { NEW_MESSAGE_HREF, NEW_MESSAGE_INTENT, NEW_HREF, NEW_PARAM } from "@/lib/nav/new-actions";

/**
 * M1a — what the installed app adds to the manifest: the icon's shortcuts and the share target. `tests/pwa-manifest.test.ts` keeps pinning the rest (the
 * start page included: D-N1 is unanswered, so the app still opens where the site opens today).
 */
const m = manifest();
const ROOT = path.resolve(__dirname, "..");

describe("shortcuts: what a long press on the app icon offers", () => {
  const shortcuts = m.shortcuts ?? [];

  it("«رسالة جديدة» opens the chat with the new-chat dialog ready, «مهامي» opens the person's tasks", () => {
    expect(shortcuts.map((s) => [s.name, s.url])).toEqual([
      ["رسالة جديدة", "/chat?new=message"],
      ["مهامي", "/my-work"],
    ]);
  });

  it("the message shortcut is the one intent address the chat serves", () => {
    expect(NEW_MESSAGE_HREF).toBe(`/chat?${NEW_PARAM}=${NEW_MESSAGE_INTENT}`);
    // the wheel still opens the dialog in place: its action has no address of its own
    expect(NEW_HREF.message).toBeNull();
  });

  it("every shortcut stays inside the app's scope, has an Arabic name and an icon under /icons/", () => {
    for (const s of shortcuts) {
      expect(s.url.startsWith(m.scope ?? "/"), s.name).toBe(true);
      expect(s.name).toMatch(/[؀-ۿ]/);
      expect(s.name).not.toMatch(/[A-Za-z]/);
      for (const icon of s.icons ?? []) expect(icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
    }
    // Android shows at most four; two are offered
    expect(shortcuts.length).toBeLessThanOrEqual(4);
  });

  it("the page «مهامي» opens exists", () => {
    expect(() => readFileSync(path.join(ROOT, "src/app/(app)/my-work/page.tsx"))).not.toThrow();
  });
});

describe("share_target: the phone's share sheet lists «زاكي»", () => {
  const target = m.share_target as unknown as { action: string; method: string; enctype?: string; params: Record<string, unknown> };

  it("is a GET to /share with the title, the text and the address, and NO files yet", () => {
    expect(target.action).toBe("/share");
    expect(target.method.toUpperCase()).toBe("GET");
    expect(target.params).toEqual({ title: "title", text: "text", url: "url" });
    expect(target.params).not.toHaveProperty("files");
  });

  it("is inside the scope, and the page it names exists outside the app frame", () => {
    expect(target.action.startsWith(m.scope ?? "/")).toBe(true);
    expect(() => readFileSync(path.join(ROOT, "src/app/share/page.tsx"))).not.toThrow();
  });
});

describe("what did not move (D-N1 is unanswered)", () => {
  it("start_url, scope, id and the names are today's", () => {
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("/");
    expect(m.name).toBe("Zaki Workspace");
    expect(m.short_name).toBe("زاكي");
    expect(m.display).toBe("standalone");
  });
});
