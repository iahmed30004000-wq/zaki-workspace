import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/settings/me" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { AvatarMenu } from "@/components/shell/avatar-menu";
import { SettingsOneDoorContext } from "@/components/shell/nav-options";
import { ChatSection } from "@/components/settings-me/chat-section";
import { LanguageSection } from "@/components/settings-me/language-section";
import { SettingsFrame } from "@/components/settings-me/settings-frame";
import { SECTION_KEYS, companyGroupOf, sectionHintKey, sectionLabelKey, visibleSections } from "@/components/settings-me/sections";
import { SettingsTabs } from "@/components/space-settings/settings-tabs";
import { SPACE_SETTINGS_TABS, settingsTabLabelKey } from "@/components/space-settings/tabs";
import { SpacesBoard } from "@/components/spaces-board";
import { PanelFrame } from "@/components/control-panel/frame";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { getServerT } from "@/lib/i18n/server";
import { audienceOf } from "@/lib/guide/audience";
import { CURRENT_PHASE, FIRST_STEPS, ONE_DOOR_STEP_HREFS, oneDoorSteps, stepsFor } from "@/lib/guide/first-steps";
import { PANEL_V2_SECTIONS, panelHref } from "@/lib/control-panel";
import { oneDoorHref, panelSectionHref } from "@/lib/legacy-routes";

/**
 * S3.3 — the duplicates the findings list (section A) are gone while «الإعدادات» is ONE door (switch `settingsOneDoor`): every thing has ONE home and the rest of its old entry
 * points are links. The rules that need a database (the walk of every old address, who finds what where) are in tests/db/settings-dedupe.test.ts. With the switch OFF nothing here
 * changes: the old tests stay green untouched.
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Door = SettingsOneDoorContext.Provider as unknown as FunctionComponent<{ value: boolean; children?: ReactNode }>;

function render(element: ReactElement, oneDoor = false): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, createElement(Door, { value: oneDoor }, element)))));
}
const SRC = path.resolve(__dirname, "../src");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] as string).replace(/&amp;/g, "&"));
const count = (html: string, needle: string) => html.split(needle).length - 1;
const { t } = getServerT();

// ───────────────────────────── (6) theme and digits: one home each ─────────────────────────────

describe("S3.3 · theme and digits have ONE home: «المظهر واللغة» of the person's own settings", () => {
  const USER = { name: "أحمد", username: "ahmad", email: null };
  const items = (html: string) => [...html.matchAll(/<(?:div|a)\b[^>]*role="menuitem"[^>]*>(.*?)<\/(?:div|a)>/gs)].map((m) => (m[1] as string).replace(/<[^>]*>/g, ""));
  const menu = (oneDoor: boolean) => render(createElement(AvatarMenu, { user: USER, rank: "OWNER", defaultOpen: true, portal: false }), oneDoor);

  it("the avatar menu loses the theme row (and its sheet): ONE row «الإعدادات» and sign out", () => {
    expect(items(menu(true))).toEqual([AR["settingsOneDoor.door"], AR["shell.avatar.logout"]]);
    expect(menu(true)).not.toContain(AR["theme.picker"] as string);
  });

  it("OFF the avatar menu is what it was: the theme row is there first", () => {
    expect(items(menu(false))[0]).toBe(AR["theme.picker"]);
  });

  it("the chat section no longer holds the theme (a link says where it went); the language section holds the theme and the digits", () => {
    const chat = render(createElement(ChatSection), true);
    expect(chat).not.toContain('id="c-theme"');
    expect(chat).not.toContain(AR["settingsMe.c.theme.auto"] as string);
    expect(hrefs(chat)).toContain("/settings/me/language");
    expect(chat).toContain(AR["settingsMe.c.theme.moved"] as string);
    // the font size, the wallpaper, the send key and the reactions stay where they were
    for (const id of ["c-font", "c-wallpaper", "c-sendkey", "c-quick", "c-doubletap"]) expect(chat, id).toContain(`id="${id}"`);

    const language = render(createElement(LanguageSection), true);
    expect(language).toContain('id="c-theme"');
    expect(language).toContain(AR["settingsMe.c.theme.auto"] as string);
    expect(language).toContain('id="l-digits"');
    expect(count(language, 'id="c-theme"')).toBe(1);
  });

  it("OFF both sections are exactly today's: the theme in the chat section, none in the language section", () => {
    const chat = render(createElement(ChatSection), false);
    expect(chat).toContain('id="c-theme"');
    expect(chat).not.toContain(AR["settingsMe.c.theme.moved"] as string);
    const language = render(createElement(LanguageSection), false);
    expect(language).not.toContain('id="c-theme"');
    expect(language).toContain('id="l-digits"');
  });

  it("the names follow: «المظهر واللغة» and the chat's line without «المظهر» (ON); the old names (OFF)", () => {
    expect(sectionLabelKey("language")).toBe("settingsMe.s.language");
    expect(sectionLabelKey("language", true)).toBe("settingsMe.s.language.one");
    expect(sectionHintKey("language", true)).toBe("settingsMe.s.language.one.hint");
    expect(sectionHintKey("chat", true)).toBe("settingsMe.s.chat.one.hint");
    expect(sectionHintKey("chat")).toBe("settingsMe.s.chat.hint");
    for (const key of SECTION_KEYS.filter((k) => k !== "language" && k !== "chat")) {
      expect(sectionLabelKey(key, true)).toBe(sectionLabelKey(key));
      expect(sectionHintKey(key, true)).toBe(sectionHintKey(key));
    }
    expect(AR["settingsMe.s.language.one"]).toBe("المظهر واللغة");
    expect(AR["settingsMe.s.chat.one.hint"]).not.toContain("المظهر");
    expect(AR["settingsMe.s.language.one.hint"]).toContain("المظهر");
  });

  it("the frame lists the section under the new name only while the door is ON", () => {
    const header = { name: "أحمد", username: "ahmad", jobTitle: null, avatarUrl: null };
    const frame = (oneDoor: boolean) => render(createElement(SettingsFrame, { header, sections: visibleSections({ foldersOn: true }) }, createElement("p", null, "المحتوى")), oneDoor);
    expect(frame(true)).toContain(AR["settingsMe.s.language.one"] as string);
    expect(frame(true)).not.toContain(`>${AR["settingsMe.s.language"]}<`);
    expect(frame(false)).toContain(`>${AR["settingsMe.s.language"]}<`);
    expect(frame(false)).not.toContain(AR["settingsMe.s.language.one"] as string);
  });
});

// ───────────────────────────── (7) the guide: only under «المساعدة» ─────────────────────────────

describe("S3.3 · the guide has no entry point of the first-steps card while «الإعدادات» is ONE door", () => {
  const everyone = audienceOf({ isExternal: false, caps: ["users.manage"] });
  const ids = (defs: readonly { id: string }[]) => defs.map((d) => d.id);

  it("OFF (the default) the steps are the registry's, «افتح الدليل» included", () => {
    expect(stepsFor(everyone, CURRENT_PHASE)).toEqual(stepsFor(everyone, CURRENT_PHASE, FIRST_STEPS, false));
    expect(ids(stepsFor(everyone, CURRENT_PHASE))).toContain("open-guide");
  });

  it("ON the step «افتح الدليل» is gone and «اختار ثيمك» leads to the home of the theme", () => {
    const steps = stepsFor(everyone, CURRENT_PHASE, FIRST_STEPS, true);
    expect(ids(steps)).not.toContain("open-guide");
    expect(steps.find((s) => s.id === "theme")?.href).toBe("/settings/me/language");
    expect(ONE_DOOR_STEP_HREFS["theme"]).toBe("/settings/me/language");
    // every other step is untouched, in the same order
    expect(ids(steps)).toEqual(ids(stepsFor(everyone, CURRENT_PHASE)).filter((id) => id !== "open-guide"));
    for (const step of steps) if (step.id !== "theme") expect(step.href).toBe(FIRST_STEPS.find((s) => s.id === step.id)?.href);
  });

  it("the helper changes only the registry it is given (it never mutates the module's list)", () => {
    const before = JSON.stringify(FIRST_STEPS);
    oneDoorSteps(FIRST_STEPS);
    expect(JSON.stringify(FIRST_STEPS)).toBe(before);
  });

  it("the service reads both switches and hands the registry the answer (the card needs no change)", () => {
    const service = read("server/services/first-steps.ts");
    expect(service).toContain('isFeatureOn(actor.orgId, "settingsOneDoor")');
    expect(service).toContain('isFeatureOn(actor.orgId, "controlPanelV2")');
    expect(service).toMatch(/stepsFor\(audience, opts\.phase \?\? CURRENT_PHASE, FIRST_STEPS, oneDoor\)/);
  });
});

// ───────────────────────────── (8) one meaning of «الناس» ─────────────────────────────

describe("S3.3 · «الناس» means the company's people; the other things have their own names", () => {
  it("the space's tab of people is «أعضاء المساحة» while the door is ON, «الناس» (today's word) otherwise", () => {
    expect(settingsTabLabelKey("people")).toBe("spset.tab.people");
    expect(settingsTabLabelKey("people", true)).toBe("spset.tab.people.one");
    for (const tab of SPACE_SETTINGS_TABS.filter((x) => x !== "people")) expect(settingsTabLabelKey(tab, true)).toBe(settingsTabLabelKey(tab));
    expect(AR["spset.tab.people.one"]).toBe("أعضاء المساحة");
    const strip = (oneDoor: boolean) => render(createElement(SettingsTabs, { spaceId: "s1", tabs: ["general", "people", "teams"] as never, current: "people" as never }), oneDoor);
    expect(strip(true)).toContain(`>${AR["spset.tab.people.one"]}<`);
    expect(strip(true)).not.toContain(`>${AR["spset.tab.people"]}<`);
    expect(strip(false)).toContain(`>${AR["spset.tab.people"]}<`);
  });

  it("the activity table of the people part is titled «نشاط الناس», not «الناس» (the part is the activity of the section «الناس»)", () => {
    expect(AR["cpv2.dd.people.activity_title"]).toBe("نشاط الناس");
    const board = read("components/owner-board/board.tsx");
    expect(board).toMatch(/export function PeopleTable\(\{ t, o, personHref, sortHref, title \}/);
    expect(board).toContain('title ?? t("ownerboard.people.title")');
    const sections = read("components/control-panel/sections/board-sections.tsx");
    expect(sections).toContain('title={part ? t("cpv2.dd.people.activity_title") : undefined}');
  });
});

// ───────────────────────────── (9) one name for the archive ─────────────────────────────

describe("S3.3 · «الأرشيف» is called «الأرشيف» in the one navigation and on its own page", () => {
  const Frame = PanelFrame as unknown as FunctionComponent<Record<string, unknown>>;
  const nav = ["overview", "people", "reports", "structure", "archive", "assistant"];
  const html = renderToStaticMarkup(createElement(Frame, { t, sections: nav, current: "archive", oneNav: true }, createElement("p", null, "جسم")));

  it("the navigation says «الأرشيف» and never «الأرشيف والرقابة»", () => {
    expect(AR["cpv2.dd.nav.archive"]).toBe("الأرشيف");
    expect(html).toMatch(/data-panel-section="archive"[^>]*>الأرشيف</);
    expect(html).not.toContain("الأرشيف والرقابة");
  });

  it("the other five entries keep the names of S3.2", () => {
    for (const key of nav.filter((k) => k !== "archive")) expect(html).toContain(AR[`cpone.nav.${key}`] as string);
  });

  it("OFF (the eleven-section list) the name is today's", () => {
    const old = renderToStaticMarkup(createElement(Frame, { t, sections: PANEL_V2_SECTIONS, current: "archive" }, createElement("p", null, "جسم")));
    expect(old).toContain("الأرشيف والرقابة");
  });

  it("the section's own title wears the same name while the door is ON", () => {
    const small = read("components/control-panel/sections/small-sections.tsx");
    expect(small).toContain('title={ctx.oneDoor ? t("cpv2.dd.nav.archive") : undefined}');
  });
});

// ───────────────────────────── (1)-(5) one home, links elsewhere ─────────────────────────────

describe("S3.3 · links inside the moved bodies point at their home, not back at the panel", () => {
  it("panelSectionHref: the settings sections and their parts are addresses of the settings frame while the door is ON", () => {
    expect(panelSectionHref("integrations", "ai", true)).toBe("/settings/me/integrations?part=ai");
    expect(panelSectionHref("integrations", "telegram", true)).toBe(oneDoorHref({ section: "integrations", part: "telegram" }));
    expect(panelSectionHref("features", undefined, true)).toBe("/settings/me/features");
    expect(panelSectionHref("features", undefined, false)).toBe(panelHref("features"));
    expect(panelSectionHref("integrations", "ai", false)).toBe(panelHref("integrations", "ai"));
    // what is not a setting keeps the panel's address
    expect(panelSectionHref("reports", undefined, true)).toBe(panelHref("reports"));
  });

  it("the integrations parts and the company's link to the switches use it, and the settings page tells the bodies the door is ON", () => {
    expect(read("components/control-panel/sections/integrations-section.tsx")).toContain('panelSectionHref("integrations", key, ctx.oneDoor === true)');
    expect(read("components/control-panel/sections/company-section.tsx")).toContain('panelSectionHref("features", undefined, ctx.oneDoor === true)');
    expect(read("app/(app)/settings/me/[section]/page.tsx")).toContain("oneDoor: true");
  });

  it("the spaces board of «إعدادات الشركة» is a list with a gear to each space's own settings: rename, archive, delete and the people are there, once", () => {
    const cards = [
      { id: "h", name: "الشركة", emoji: null, kind: "HQ", open: 1, overdue: 0, unread: 0, members: 3 },
      { id: "s1", name: "المبيعات", emoji: null, kind: "STANDARD", open: 2, overdue: 1, unread: 0, members: 4 },
    ];
    const board = (settingsLinks: boolean) => render(createElement(SpacesBoard as unknown as FunctionComponent<Record<string, unknown>>, { cards, hereId: null, manage: true, owner: true, settingsLinks }));
    const on = board(true);
    expect(hrefs(on)).toContain("/spaces/s1/settings");
    expect(on).not.toContain(`${AR["spaces.delete.open"]}: المبيعات`);
    expect(on).not.toContain(`${AR["spaces.card.actions"]}: المبيعات`);
    const off = board(false);
    expect(hrefs(off)).not.toContain("/spaces/s1/settings");
    expect(off).toContain(`${AR["spaces.card.actions"]}: المبيعات`);
    expect(off).toContain(`${AR["spaces.delete.open"]}: المبيعات`);
    expect(read("components/control-panel/sections/small-sections.tsx")).toContain("settingsLinks: ctx.oneDoor === true");
  });
});

// ───────────────────────────── the row «لوحة التحكم» in the settings frame ─────────────────────────────

describe("S3.3 · the control panel has its own place: the settings frame no longer carries a second door to it", () => {
  it("an OWNER or an ADMIN gets the company's sections and no row «لوحة التحكم» (their menu holds the place)", () => {
    expect(companyGroupOf(PANEL_V2_SECTIONS, "OWNER")).toEqual({ sections: ["company", "features", "integrations", "spaces"], panelLink: false });
    expect(companyGroupOf(["overview", "people", "reports", "accounts", "spaces", "integrations"], "ADMIN")).toEqual({ sections: ["integrations", "spaces"], panelLink: false });
    // an admin who holds nothing of the group has no group at all (S3.1 drew the row for them)
    expect(companyGroupOf(["reports"], "ADMIN")).toBeNull();
  });

  it("somebody whose menu has no such place keeps what S3.1 gave them", () => {
    expect(companyGroupOf(["integrations"], "LEAD")).toEqual({ sections: ["integrations"], panelLink: true });
    expect(companyGroupOf(["reports"], "LEAD")).toBeNull();
    expect(companyGroupOf([], "OWNER")).toBeNull();
  });
});

// ───────────────────────────── the rules of the interface ─────────────────────────────

describe("S3.3 · the new strings and classes follow the rules of the interface", () => {
  const KEYS = [
    "settingsMe.s.language.one",
    "settingsMe.s.language.one.hint",
    "settingsMe.s.chat.one.hint",
    "settingsMe.c.theme.moved",
    "spset.tab.people.one",
    "cpv2.dd.nav.archive",
    "cpv2.dd.people.activity_title",
  ];

  it("every new string is Arabic with no Latin word, no «ـاً» and Western digits only", () => {
    for (const key of KEYS) {
      const text = AR[key] as string;
      expect(text, key).toBeTruthy();
      expect(text, key).toMatch(/[؀-ۿ]/);
      expect(text, key).not.toMatch(/[A-Za-z]/);
      expect(text, key).not.toMatch(/ـاً|ً/);
      expect(text, key).not.toMatch(/[٠-٩]/);
    }
  });

  it("the files that were edited hold no hex colour, no tiny text and no raw palette class", () => {
    const files = [
      "components/shell/avatar-menu.tsx",
      "components/settings-me/chat-section.tsx",
      "components/settings-me/language-section.tsx",
      "components/settings-me/settings-frame.tsx",
      "components/settings-me/parts.tsx",
      "components/space-settings/settings-tabs.tsx",
      "components/spaces-board.tsx",
      "components/control-panel/frame.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(source, file).not.toMatch(/text-\[(10|11|10\.5)px\]/);
      expect(source, file).not.toMatch(/\b(bg-black|bg-white|text-white)\b/);
    }
  });

});
