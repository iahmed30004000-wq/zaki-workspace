import { createElement } from "react";
import { readFileSync, readdirSync } from "node:fs";
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
import { PresetsBar } from "@/components/feature-switches/presets-bar";
import { COMPANY_CHAT_GROUP, ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS, FEATURE_GROUPS, FEATURE_META, type FeatureKey } from "@/lib/features";
import {
  FEATURE_GROUP_ORDER,
  FEATURE_PRESETS,
  SIMPLE_MODE_OFF,
  groupKeys,
  matchesSearch,
  missingParents,
  normalizeSearch,
  presetActive,
  presetChanges,
} from "@/lib/feature-groups";
import { AR } from "@/lib/i18n/dict";
import fragment from "@/lib/i18n/ar.permissions-v2.json";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const state = (over: Partial<Record<FeatureKey, boolean>> = {}): Record<FeatureKey, boolean> => {
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURES) out[key] = over[key] ?? FEATURE_DEFAULTS[key];
  return out;
};
const items = (over: Partial<Record<FeatureKey, boolean>> = {}) => FEATURES.map((key) => ({ key, on: over[key] ?? FEATURE_DEFAULTS[key] }));
const view = (over: Partial<Record<FeatureKey, boolean>> = {}, extra: { initialQuery?: string } = {}) => render(createElement(FeatureSwitches, { initial: items(over), ...extra }));
const name = (key: FeatureKey) => AR[`features.${key}.name`] as string;
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** the opening tag of one switch, by its label */
const switchTag = (markup: string, key: FeatureKey) => new RegExp(`<button[^>]*aria-label="${escape(name(key))}"[^>]*>`).exec(markup)?.[0] ?? "";

/** the `disabled` attribute itself (the class list carries `disabled:opacity-60` on every switch) */
const isDisabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

describe("A1.4: the groups as data", () => {
  it("every switch but «وضع التوفير» (its own panel) is in exactly one group, and the chat group comes first (C4.3)", () => {
    expect(FEATURE_GROUP_ORDER).toEqual(["chat", "work", "library", "people", "owner", "platform"]);
    expect([...FEATURE_GROUP_ORDER].sort()).toEqual([...FEATURE_GROUPS].sort());
    const all = FEATURE_GROUP_ORDER.flatMap((g) => groupKeys(g));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(FEATURES.filter((k) => k !== "economyMode").sort());
    for (const g of FEATURE_GROUP_ORDER) for (const key of groupKeys(g)) expect(FEATURE_META[key].group, key).toBe(g);
  });

  it("the chat group is C4.3's: its 14 keys in the spec's order, then the other chat switches", () => {
    const chat = groupKeys("chat");
    expect(chat.slice(0, COMPANY_CHAT_GROUP.length)).toEqual(COMPANY_CHAT_GROUP.map((g) => g.key));
    expect(chat.length).toBeGreaterThan(COMPANY_CHAT_GROUP.length);
  });

  it("«الوضع البسيط» turns OFF exactly these ten and nothing else", () => {
    expect([...SIMPLE_MODE_OFF]).toEqual(["okr", "checkins", "customFields", "taskRules", "taskRewards", "milestones", "taskLinks", "watch", "whiteboard", "timeTracking"]);
    const changes = presetChanges("simple", state());
    expect(changes.map((c) => c.key).sort()).toEqual([...SIMPLE_MODE_OFF].sort());
    for (const c of changes) expect(c.on, c.key).toBe(false);
    // goals, production, campaigns and CRM are permissions, not switches
    for (const word of ["goals", "production", "campaigns", "crm"]) expect(FEATURES as readonly string[]).not.toContain(word);
  });

  it("a key that is already off is not in the list of what changes", () => {
    const changes = presetChanges("simple", state({ okr: false, watch: false }));
    expect(changes.map((c) => c.key)).not.toContain("okr");
    expect(changes.map((c) => c.key)).not.toContain("watch");
    expect(changes.length).toBe(SIMPLE_MODE_OFF.length - 2);
  });

  it("«كل شي» brings back what «الوضع البسيط» switched off, and what the owner switched off by hand, and keeps the ones that start OFF as they are", () => {
    const afterSimple = state();
    for (const c of presetChanges("simple", state())) afterSimple[c.key] = c.on;
    const back = presetChanges("all", afterSimple);
    expect(back.map((c) => c.key).sort()).toEqual([...SIMPLE_MODE_OFF].sort());
    for (const c of back) expect(c.on, c.key).toBe(true);
    // restored: the state is the default state again
    const restored = { ...afterSimple };
    for (const c of back) restored[c.key] = c.on;
    expect(restored).toEqual(state());
    // nothing that starts OFF is switched on by «كل شي» (a model, a backup, a door, economy mode, a rollout switch)
    const everythingOff = state();
    for (const key of FEATURES) everythingOff[key] = false;
    const changes = presetChanges("all", everythingOff);
    expect(changes.map((c) => c.key).sort()).toEqual(FEATURES.filter((k) => FEATURE_DEFAULTS[k]).sort());
    for (const key of ["economyMode", "voiceTranscript", "messageTranslate", "dbBackup", "apiDoor", "externalGateway", "ownerHiddenOnline", "navV2", "themeV2Default"] as const) {
      expect(changes.map((c) => c.key), key).not.toContain(key);
    }
  });

  it("a preset never lists a key twice and only lists real switches", () => {
    for (const preset of FEATURE_PRESETS) {
      const keys = presetChanges(preset, state({ okr: false })).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(FEATURES as readonly string[]).toContain(key);
    }
  });

  it("knows which preset is in force", () => {
    expect(presetActive("all", state())).toBe(true);
    expect(presetActive("simple", state())).toBe(false);
    const simple = state();
    for (const key of SIMPLE_MODE_OFF) simple[key] = false;
    expect(presetActive("simple", simple)).toBe(true);
    expect(presetActive("all", simple)).toBe(false);
  });

  it("a switch needs its parents: the ones that are off are named, none when the parents are on", () => {
    expect(missingParents("chatAssistant", state())).toEqual(["ownerAssistant"]);
    expect(missingParents("chatAssistant", state({ ownerAssistant: true }))).toEqual([]);
    expect(missingParents("messageTranslate", state()).sort()).toEqual(["chatAssistant", "ownerAssistant"]);
    expect(missingParents("messageTranslate", state({ ownerAssistant: true, chatAssistant: true }))).toEqual([]);
    expect(missingParents("watch", state())).toEqual([]);
  });

  it("the search ignores the spelling variants of Arabic (hamza, ta marbuta, ya, vowel marks)", () => {
    expect(normalizeSearch("  الأهْدَاف ")).toBe(normalizeSearch("الاهداف"));
    expect(normalizeSearch("مساعدة")).toBe(normalizeSearch("مساعده"));
    expect(matchesSearch(["الأهداف والنتائج"], "اهداف")).toBe(true);
    expect(matchesSearch(["الأهداف والنتائج", "x"], "")).toBe(true);
    expect(matchesSearch(["الأهداف والنتائج"], "سبورة")).toBe(false);
    // every word must be found (in any of the texts)
    expect(matchesSearch(["السبورة", "رسم بالمحادثة"], "سبورة محادثة")).toBe(true);
    expect(matchesSearch(["السبورة", "رسم بالمحادثة"], "سبورة مهام")).toBe(false);
  });
});

describe("A1.4: «الميزات» draws groups", () => {
  it("six groups with their headers, in the order chat, work, library, people, owner, platform, each switch once", () => {
    const markup = view();
    const order = [...markup.matchAll(/data-feature-group="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual([...FEATURE_GROUP_ORDER]);
    for (const g of FEATURE_GROUPS) expect(textOf(markup)).toContain(AR[`featureGroups.group.${g}`] as string);
    for (const key of FEATURES.filter((k) => k !== "economyMode")) expect(count(markup, AR[`features.${key}.hint`] as string), key).toBe(1);
    // the C4.3 chat group is that section, not a second one
    expect(count(markup, "data-company-chat-group")).toBe(1);
    expect(markup).toMatch(/data-feature-group="chat"[^>]*data-company-chat-group|data-company-chat-group[^>]*data-feature-group="chat"/);
  });

  it("each switch is in the section of its own group", () => {
    const markup = view();
    const starts = FEATURE_GROUP_ORDER.map((g) => markup.indexOf(`data-feature-group="${g}"`));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (const key of FEATURES.filter((k) => k !== "economyMode")) {
      const at = markup.indexOf(AR[`features.${key}.hint`] as string);
      const g = FEATURE_GROUP_ORDER.indexOf(FEATURE_META[key].group);
      expect(at, key).toBeGreaterThan(starts[g] as number);
      if (g + 1 < starts.length) expect(at, key).toBeLessThan(starts[g + 1] as number);
    }
  });

  it("«وضع التوفير» keeps its own panel and is not in any group", () => {
    const markup = view();
    expect(markup).toContain("data-economy-panel");
    expect(count(markup, AR["features.economyMode.hint"] as string)).toBe(0);
    expect(count(markup, `aria-label="${name("economyMode")}"`)).toBe(1);
    expect(textOf(markup)).toContain(AR["economy.title"] as string);
    for (const key of ECONOMY_FORCED_OFF) expect(markup).toContain(name(key));
  });

  it("has a search box with its label, and draws every switch while it is empty", () => {
    const markup = view();
    expect(markup).toMatch(/<input[^>]*type="search"/);
    expect(markup).toContain(`placeholder="${AR["featureGroups.search.placeholder"]}"`);
    expect(markup).toContain(`aria-label="${AR["featureGroups.search.label"]}"`);
    expect(textOf(markup)).not.toContain(AR["featureGroups.search.none"] as string);
  });

  it("a search keeps only the switches that match (by name or by what it says), and the groups left empty are not drawn", () => {
    const markup = view({}, { initialQuery: "سبورة" });
    expect(markup).toContain(AR["features.whiteboard.hint"] as string);
    expect(markup).not.toContain(AR["features.okr.hint"] as string);
    expect(markup).not.toContain(AR["features.libraryDrive.hint"] as string);
    expect(markup).toContain('data-feature-group="chat"');
    expect(markup).not.toContain('data-feature-group="library"');
    expect(markup).not.toContain('data-feature-group="people"');
    // the economy panel and the presets stay
    expect(markup).toContain("data-economy-panel");
  });

  it("a search that finds nothing says so", () => {
    const markup = view({}, { initialQuery: "زززززز" });
    expect(textOf(markup)).toContain(AR["featureGroups.search.none"] as string);
    expect(markup).not.toContain("data-feature-group=");
  });

  it("a search by a group's name shows that group", () => {
    const markup = view({}, { initialQuery: "المكتبة" });
    expect(markup).toContain('data-feature-group="library"');
    expect(markup).toContain(AR["features.libraryDrive.hint"] as string);
  });

  it("a child shows «بيحتاج: …» and its switch is disabled while its parent is off", () => {
    // «مساعد المالك» is off by default, so «قراءة الدردشات للمساعد» needs it
    const markup = view();
    const text = textOf(markup);
    expect(text).toContain((AR["featureGroups.needs"] as string).replace("{names}", name("ownerAssistant")));
    expect(isDisabled(switchTag(markup, "chatAssistant"))).toBe(true);
    // a parent that is on: the note is gone and the child can be switched
    const on = view({ ownerAssistant: true });
    expect(textOf(on)).not.toContain((AR["featureGroups.needs"] as string).replace("{names}", name("ownerAssistant")));
    expect(isDisabled(switchTag(on, "chatAssistant"))).toBe(false);
    // two parents: both are named
    const two = textOf(view());
    expect(two).toContain((AR["featureGroups.needs"] as string).replace("{names}", `${name("ownerAssistant")}، ${name("chatAssistant")}`));
  });

  it("a child that is ON while its parent is off keeps the note but can still be switched OFF (nothing traps the owner)", () => {
    const markup = view({ chatAssistant: true });
    expect(textOf(markup)).toContain((AR["featureGroups.needs"] as string).replace("{names}", name("ownerAssistant")));
    expect(isDisabled(switchTag(markup, "chatAssistant"))).toBe(false);
    expect(switchTag(markup, "chatAssistant")).toContain('aria-checked="true"');
  });

  it("a switch without parents is never disabled by this", () => {
    const markup = view();
    expect(isDisabled(switchTag(markup, "watch"))).toBe(false);
    expect(isDisabled(switchTag(markup, "ownerAssistant"))).toBe(false);
  });

  it("keeps the risk lines of C4.3 and the generic model warning where they were", () => {
    const text = textOf(view({ autoTickets: true }));
    for (const key of ["voiceTranscript", "messageTranslate", "linkPreviews", "lastSeen", "ownerHiddenOnline"] as const) {
      expect(count(text, AR[`companyChat.warn.${key}`] as string), key).toBe(1);
      expect(count(text, AR[`companyChat.fix.${key}`] as string), key).toBe(1);
    }
    expect(count(text, AR["features.model_warn"] as string)).toBe(2);
  });

  it("uses theme tokens, logical directions and no tiny text", () => {
    const markup = view({ economyMode: true });
    const tokens = classTokens(markup);
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t))).toEqual([]);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t))).toEqual([]);
    expect(tokens.filter((t) => /^text-\[(10|11)px\]$/.test(t))).toEqual([]);
  });
});

describe("A1.4: the two presets", () => {
  const bar = (over: Partial<Record<FeatureKey, boolean>> = {}, pending?: "simple" | "all") =>
    render(createElement(PresetsBar, { items: items(over), onApply: async () => {}, initialPending: pending }));

  it("are two buttons at the top, «الوضع البسيط» and «كل شي», with what each does; nothing is asked until one is pressed", () => {
    const markup = bar();
    const text = textOf(markup);
    expect(text).toContain("الوضع البسيط");
    expect(text).toContain("كل شي");
    expect(text).toContain(AR["featureGroups.presets.simple.desc"] as string);
    expect(text).toContain(AR["featureGroups.presets.all.desc"] as string);
    expect(markup).not.toContain("data-preset-confirm");
    expect(count(markup, "data-preset=")).toBe(2);
  });

  it("they are the first thing of the list, before the economy panel and the groups", () => {
    const markup = view();
    expect(markup.indexOf("data-presets")).toBeGreaterThan(-1);
    expect(markup.indexOf("data-presets")).toBeLessThan(markup.indexOf("data-economy-panel"));
    expect(markup.indexOf("data-presets")).toBeLessThan(markup.indexOf("data-feature-group="));
  });

  it("«الوضع البسيط» asks first: it lists the ten that will be switched off, with the ⚠️ and its 🔧, and says nothing is deleted", () => {
    const markup = bar({}, "simple");
    const text = textOf(markup);
    expect(markup).toContain("data-preset-confirm");
    for (const key of SIMPLE_MODE_OFF) expect(count(text, `${name(key)}`) >= 1, key).toBe(true);
    expect(text).toContain(AR["featureGroups.confirm.to_off"] as string);
    expect(text).not.toContain(AR["featureGroups.confirm.to_on"] as string);
    expect(text).toContain(AR["featureGroups.confirm.warn.simple"] as string);
    expect(text).toContain(AR["featureGroups.confirm.fix.simple"] as string);
    expect(text.indexOf(AR["featureGroups.confirm.fix.simple"] as string)).toBe(text.indexOf(AR["featureGroups.confirm.warn.simple"] as string) + (AR["featureGroups.confirm.warn.simple"] as string).length + 1);
    expect(text).toContain(AR["featureGroups.confirm.kept"] as string);
    // goals, production, campaigns and CRM are permissions: the line says so, and that this button does not hide their tabs
    expect(text).toContain(AR["featureGroups.confirm.tabs.simple"] as string);
    expect(text).toContain(AR["featureGroups.confirm.go"] as string);
    expect(text).toContain(AR["featureGroups.confirm.cancel"] as string);
  });

  it("the list is only what would change: a switch that is already off is not in it", () => {
    const text = textOf(bar({ okr: false }, "simple"));
    const confirm = text.slice(text.indexOf(AR["featureGroups.confirm.to_off"] as string));
    expect(confirm).not.toContain(name("okr"));
    expect(confirm).toContain(name("checkins"));
  });

  it("«كل شي» lists what comes back on, and has no list to switch off", () => {
    const markup = bar({ okr: false, whiteboard: false, chatBubbles: false }, "all");
    const text = textOf(markup);
    const confirm = text.slice(text.indexOf(AR["featureGroups.confirm.to_on"] as string));
    for (const key of ["okr", "whiteboard", "chatBubbles"] as const) expect(confirm, key).toContain(name(key));
    expect(text).not.toContain(AR["featureGroups.confirm.to_off"] as string);
    expect(text).toContain(AR["featureGroups.confirm.warn.all"] as string);
    expect(text).toContain(AR["featureGroups.confirm.fix.all"] as string);
    expect(text).not.toContain(AR["featureGroups.confirm.tabs.simple"] as string);
  });

  it("when nothing would change it says so and offers no «أكّد»", () => {
    const markup = bar({}, "all");
    const text = textOf(markup);
    expect(text).toContain(AR["featureGroups.confirm.none"] as string);
    expect(text).not.toContain(AR["featureGroups.confirm.go"] as string);
  });

  it("marks the preset that is in force", () => {
    expect(textOf(bar())).toContain(AR["featureGroups.presets.active"] as string);
    const off: Partial<Record<FeatureKey, boolean>> = {};
    for (const key of SIMPLE_MODE_OFF) off[key] = false;
    const text = textOf(bar(off));
    expect(count(text, AR["featureGroups.presets.active"] as string)).toBe(1);
    expect(text.indexOf(AR["featureGroups.presets.active"] as string)).toBeGreaterThan(text.indexOf("الوضع البسيط"));
    expect(text.indexOf(AR["featureGroups.presets.active"] as string)).toBeLessThan(text.indexOf("كل شي"));
  });
});

describe("A1.4: the strings and the files", () => {
  const entries = Object.entries(fragment as Record<string, string>).filter(([key]) => key.startsWith("featureGroups."));

  it("the new strings are Arabic, Western digits, no Latin letters (placeholders aside), no tanween spelling, and are the dictionary's", () => {
    expect(entries.length).toBeGreaterThan(20);
    for (const [key, text] of entries) {
      expect(text, key).toMatch(/[؀-ۿ]/);
      expect(text.replace(/\{[^{}]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(text, key).not.toMatch(/[٠-٩]/);
      expect(text, key).not.toContain("ـاً");
      expect(AR[key], key).toBe(text);
    }
  });

  it("no key is also in another fragment", () => {
    const dir = path.join(ROOT, "src/lib/i18n");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "ar.permissions-v2.json")) {
      const other = JSON.parse(read(`src/lib/i18n/${file}`)) as Record<string, string>;
      for (const [key] of entries) expect(other[key], `${key} in ${file}`).toBeUndefined();
    }
  });

  it("every ⚠️ line of the confirmations has its 🔧 line", () => {
    for (const preset of FEATURE_PRESETS) {
      expect(AR[`featureGroups.confirm.warn.${preset}`], preset).toMatch(/^⚠️ /);
      expect(AR[`featureGroups.confirm.fix.${preset}`], preset).toMatch(/^🔧 /);
    }
  });

  it("the new components hold no English text and no colour of their own", () => {
    const dir = path.join(ROOT, "src/components/feature-switches");
    const files = readdirSync(dir).map((f) => `src/components/feature-switches/${f}`);
    expect(files.length).toBeGreaterThan(0);
    for (const file of [...files, "src/components/feature-switches.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-(?:black|white)\b/);
      expect(source, file).not.toMatch(/text-\[1[01]px\]/);
      expect(source, file).not.toMatch(/\b(?:ml|mr|pl|pr)-\d/);
    }
  });
});
