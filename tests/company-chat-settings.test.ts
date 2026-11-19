import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings",
}));

import { FeatureSwitches } from "@/components/feature-switches";
import { COMPANY_CHAT_GROUP, FEATURES, FEATURE_DEFAULTS, isFeatureKey, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import chatSettings from "@/lib/i18n/ar.settings-company-chat.json";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** the spec (C4-settings.md section 4), in its order */
const SPEC_ORDER = ["chatBubbles", "chatOutbox", "voiceNotes", "voiceTranscript", "messageTranslate", "whiteboard", "calls", "callNoiseFilter", "quickChat", "linkPreviews", "chatLayoutV2", "lastSeen", "ownerHiddenOnline", "chatRowMenu"] as const satisfies readonly FeatureKey[];
/** the ones with a risk: the server visits links, message text goes to a model, who is seen and when */
const RISKY = ["voiceTranscript", "messageTranslate", "linkPreviews", "lastSeen", "ownerHiddenOnline"] as const satisfies readonly FeatureKey[];

const items = (over: Partial<Record<FeatureKey, boolean>> = {}) => FEATURES.map((key) => ({ key, on: over[key] ?? FEATURE_DEFAULTS[key] }));
const view = (over: Partial<Record<FeatureKey, boolean>> = {}) => render(createElement(FeatureSwitches, { initial: items(over) }));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("C4.3: the company's chat settings group (data)", () => {
  it("lists the chat switches of the spec, in the spec's order, each a real switch, none twice", () => {
    expect(COMPANY_CHAT_GROUP.map((g) => g.key)).toEqual([...SPEC_ORDER]);
    for (const g of COMPANY_CHAT_GROUP) expect(isFeatureKey(g.key), g.key).toBe(true);
  });

  it("adds, renames and removes no switch: the list of switches is the one that was", () => {
    expect(new Set(FEATURES).size).toBe(FEATURES.length);
    for (const key of SPEC_ORDER) expect(FEATURES, key).toContain(key);
  });

  it("marks exactly the risky ones, and every ⚠️ has its 🔧 (a risk is marked, never removed)", () => {
    expect(COMPANY_CHAT_GROUP.filter((g) => g.risk).map((g) => g.key).sort()).toEqual([...RISKY].sort());
    for (const key of RISKY) {
      const warn = AR[`companyChat.warn.${key}`];
      const fix = AR[`companyChat.fix.${key}`];
      expect(warn, key).toMatch(/^⚠️ /);
      expect(fix, key).toMatch(/^🔧 /);
      expect(warn, key).toMatch(/[؀-ۿ]/);
      expect(fix, key).toMatch(/[؀-ۿ]/);
    }
    // nothing is warned that is not marked
    for (const g of COMPANY_CHAT_GROUP.filter((x) => !x.risk)) {
      expect(AR[`companyChat.warn.${g.key}`], g.key).toBeUndefined();
      expect(AR[`companyChat.fix.${g.key}`], g.key).toBeUndefined();
    }
  });

  it("says what each risk is: the server visits links; message text goes to a model, never a customer's data to an outside one; who is seen and when", () => {
    expect(AR["companyChat.warn.linkPreviews"]).toContain("السيرفر");
    expect(AR["companyChat.warn.linkPreviews"]).toContain("رابط");
    expect(AR["companyChat.warn.messageTranslate"]).toContain("نموذج");
    expect(AR["companyChat.warn.voiceTranscript"]).toContain("نموذج");
    for (const key of ["messageTranslate", "voiceTranscript"] as const) {
      expect(AR[`companyChat.warn.${key}`], key).toContain("اسم");
      expect(AR[`companyChat.fix.${key}`], key).toContain("جهازك");
    }
    expect(AR["companyChat.warn.lastSeen"]).toContain("آخر ظهور");
    expect(AR["companyChat.warn.ownerHiddenOnline"]).toContain("متصل");
  });

  it("«شكل الرسائل الحديث» is explained as the company's default (the group says so, in one place)", () => {
    expect(COMPANY_CHAT_GROUP.find((g) => g.key === "chatBubbles")?.note).toBe(true);
    expect(AR["companyChat.note.chatBubbles"]).toContain("الشركة");
    expect(COMPANY_CHAT_GROUP.filter((g) => g.note).map((g) => g.key)).toEqual(["chatBubbles"]);
  });

  it("the strings live in the new fragment only: Arabic, no Latin letters, Western digits, no tanween spelling, no key also in another file", () => {
    const entries = Object.entries(chatSettings as Record<string, string>);
    expect(entries.length).toBeGreaterThan(0);
    const features = JSON.parse(read("src/lib/i18n/ar.features.json")) as Record<string, string>;
    for (const [key, text] of entries) {
      expect(text, key).toMatch(/[؀-ۿ]/);
      expect(text, key).not.toMatch(/[A-Za-z]/);
      expect(text, key).not.toMatch(/[٠-٩]/);
      expect(text, key).not.toContain("ـاً");
      expect(AR[key], key).toBe(text);
      expect(features[key], key).toBeUndefined();
    }
  });
});

describe("C4.3: the group on «الميزات»", () => {
  it("comes first: after the economy panel, before every other switch, with its title", () => {
    const markup = view();
    const text = textOf(markup);
    expect(markup).toContain("data-company-chat-group");
    expect(markup.indexOf("data-economy-panel")).toBeLessThan(markup.indexOf("data-company-chat-group"));
    expect(text).toContain(AR["companyChat.title"] as string);
    const groupAt = markup.indexOf("data-company-chat-group");
    for (const key of FEATURES.filter((k) => !(SPEC_ORDER as readonly string[]).includes(k) && k !== "economyMode")) {
      expect(markup.indexOf(AR[`features.${key}.hint`] as string), key).toBeGreaterThan(groupAt);
    }
  });

  it("shows the 14 switches in the spec's order, each exactly once, with its explanation", () => {
    const markup = view();
    let last = -1;
    for (const key of SPEC_ORDER) {
      const hint = AR[`features.${key}.hint`] as string;
      expect(count(markup, hint), key).toBe(1);
      const at = markup.indexOf(hint);
      expect(at, key).toBeGreaterThan(last);
      last = at;
    }
    // the rest of the list starts after the whole group: «نتفرّج سوا» is not in the group
    expect(markup.indexOf(AR["features.watch.hint"] as string)).toBeGreaterThan(last);
  });

  it("prints the ⚠️ and its 🔧 under every risky switch, and under no other", () => {
    const text = textOf(view());
    for (const key of RISKY) {
      const warn = AR[`companyChat.warn.${key}`] as string;
      const fix = AR[`companyChat.fix.${key}`] as string;
      expect(count(text, warn), key).toBe(1);
      expect(count(text, fix), key).toBe(1);
      expect(text.indexOf(fix), key).toBe(text.indexOf(warn) + warn.length + 1);
    }
    expect(text).toContain(AR["companyChat.note.chatBubbles"] as string);
  });

  it("each risky explanation sits right under its own switch (not under the next one)", () => {
    const text = textOf(view());
    for (const key of RISKY) {
      const hintAt = text.indexOf(AR[`features.${key}.hint`] as string);
      const warnAt = text.indexOf(AR[`companyChat.warn.${key}`] as string);
      expect(warnAt, key).toBeGreaterThan(hintAt);
      // the next switch's name comes only after this switch's warning and fix
      const next = SPEC_ORDER[SPEC_ORDER.indexOf(key) + 1];
      if (next) expect(text.indexOf(AR[`features.${next}.hint`] as string), key).toBeGreaterThan(warnAt);
    }
  });

  it("keeps working as before: «وضع التوفير» still marks the group's held switches once each, and a switch still carries its own state", () => {
    const text = textOf(view({ economyMode: true }));
    for (const key of ["calls", "whiteboard", "callNoiseFilter", "quickChat", "lastSeen"] as const) {
      const at = text.indexOf(AR[`features.${key}.hint`] as string);
      expect(at, key).toBeGreaterThan(-1);
    }
    expect(count(text, AR["economy.held"] as string)).toBe(8);
    const markup = view({ chatOutbox: false });
    const name = (AR["features.chatOutbox.name"] as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(markup).toMatch(new RegExp(`aria-checked="false"[^>]*aria-label="${name}"`));
  });

  it("a key missing from the list it was given is skipped, not drawn empty", () => {
    const some = items().filter((f) => f.key !== "calls" && f.key !== "linkPreviews");
    const markup = render(createElement(FeatureSwitches, { initial: some }));
    expect(markup).not.toContain(AR["features.calls.hint"] as string);
    expect(markup).not.toContain(AR["companyChat.warn.linkPreviews"] as string);
    expect(markup).toContain(AR["features.whiteboard.hint"] as string);
  });

  it("uses theme tokens and logical directions only", () => {
    const tokens = classTokens(view({ economyMode: true }));
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t))).toEqual([]);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t))).toEqual([]);
  });

  it("nothing from the company moves into a person's settings: the page keeps the group inside the owner's block, and no «إعداداتي» file is touched", () => {
    const page = read("src/app/(app)/settings/page.tsx");
    const block = page.slice(page.indexOf("actor.isOwner ? (", page.indexOf("features-title") - 400));
    expect(block).toContain("<FeatureSwitches");
    expect(page).not.toMatch(/settings\/me/);
    expect(read("src/components/feature-switches.tsx")).not.toMatch(/settings\/me|chatPrefs/);
  });
});
