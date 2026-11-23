import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeChatPrefs, type ChatPrefs } from "@/lib/chat/prefs";

/**
 * Every settings screen saves ONLY its own section of the person's prefs (a PATCH): changing the wallpaper must never carry, and so never replace, the folders or
 * the hidden tabs. The screens build their patch from the prefs in the cache at the moment of the save; this pins that none of them ever names another section.
 */
const DIR = path.join(__dirname, "..", "src", "components", "settings-me");
const SCREENS = readdirSync(DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

describe("the settings screens save only their own section", () => {
  it("no settings screen names the folders or the tabs of the list in a save", () => {
    for (const file of SCREENS) {
      const source = readFileSync(path.join(DIR, file), "utf8");
      for (const call of source.matchAll(/save\(\s*\(?[a-z]*\)?\s*=>\s*\(?\{([^}]*)\}/g)) {
        expect(call[1], `${file}: ${call[0]}`).not.toMatch(/\b(folders|tabs)\b/);
      }
    }
  });

  it("the wallpaper screen builds {chat} and nothing else", () => {
    const source = readFileSync(path.join(DIR, "chat-section.tsx"), "utf8");
    const saves = [...source.matchAll(/save\(\(p\) => \(\{ (\w+):/g)].map((m) => m[1]);
    expect(saves.length).toBeGreaterThan(3);
    expect(new Set(saves)).toEqual(new Set(["chat"]));
  });

  it("applied to prefs that hold folders and tabs, a wallpaper patch leaves both", () => {
    const before: ChatPrefs = { folders: { org1: [{ id: "f1", name: "عمل", include: { conversationIds: [], spaceIds: [] }, exclude: {} }] }, tabs: { hidden: ["mentions"] }, voiceSpeed: 2 };
    const after = mergeChatPrefs(before, { chat: { wallpaper: "sea" } });
    expect(after.folders).toEqual(before.folders);
    expect(after.tabs).toEqual(before.tabs);
    expect(after.voiceSpeed).toBe(2);
    expect(after.chat).toEqual({ wallpaper: "sea" });
  });
});
