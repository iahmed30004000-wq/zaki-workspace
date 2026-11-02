import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { CommandPalette, isPaletteShortcut, paletteCommands } from "@/components/command-palette";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { buildNav, type NavSubject } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, element)));

const who = (role: NavSubject["role"]): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })] });
const navOf = (role: NavSubject["role"]) => buildNav(who(role));

describe("Ctrl/⌘ + K opens the palette whatever the keyboard layout", () => {
  const press = (over: Partial<Parameters<typeof isPaletteShortcut>[0]>) =>
    isPaletteShortcut({ key: "k", code: "KeyK", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

  it("with the Arabic layout the K key types «ن»: the physical key decides", () => {
    expect(press({ key: "ن", code: "KeyK", ctrlKey: true })).toBe(true);
    expect(press({ key: "ن", code: "KeyK", metaKey: true })).toBe(true);
  });

  it("with the English layout, Ctrl+K and ⌘K", () => {
    expect(press({ key: "k", ctrlKey: true })).toBe(true);
    expect(press({ key: "K", metaKey: true })).toBe(true);
  });

  it("not without Ctrl/⌘, and not with Alt (AltGr on some layouts) or Shift (the browser's own tools)", () => {
    expect(press({ key: "ن" })).toBe(false);
    expect(press({ key: "k" })).toBe(false);
    expect(press({ key: "ن", ctrlKey: true, altKey: true })).toBe(false);
    expect(press({ key: "K", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press({ key: "ل", code: "KeyG", ctrlKey: true })).toBe(false);
  });
});

describe("the palette's places and tabs come from the person's map", () => {
  const hrefs = (role: NavSubject["role"]) => paletteCommands(navOf(role)).map((c) => c.href);

  it("the owner can jump to every place and every tab, plus the guide and the profile", () => {
    const owner = hrefs("OWNER");
    for (const href of ["/", "/chat", "/my-work", "/projects", "/list", "/calendar", "/goals", "/ideas", "/production", "/departments", "/crm", "/files", "/members", "/owner", "/automation", "/telegram", "/settings", "/guide", "/profile"]) {
      expect(owner, href).toContain(href);
    }
    // «التقارير» is a section of «لوحة التحكم» (/owner) for the owner: the palette reaches it through that tab
    expect(owner).not.toContain("/analytics");
    expect(new Set(owner).size).toBe(owner.length);
  });

  it("a guest is offered chat and their own work, but no other internal areas", () => {
    const guest = hrefs("GUEST");
    for (const href of ["/", "/chat", "/my-work", "/projects", "/list", "/calendar", "/guide", "/profile"]) expect(guest, href).toContain(href);
    for (const href of ["/files", "/members", "/crm", "/production", "/departments", "/goals", "/ideas", "/settings", "/analytics"]) expect(guest, href).not.toContain(href);
  });

  it("a plain member is offered the goals and the ideas (the tabs are for staff)", () => {
    const member = hrefs("MEMBER");
    for (const href of ["/goals", "/ideas"]) expect(member, href).toContain(href);
  });

  it("a plain member reaches the team, but not the settings or the integrations", () => {
    const member = hrefs("MEMBER");
    expect(member).toContain("/members");
    for (const href of ["/settings", "/automation", "/telegram", "/analytics"]) expect(member, href).not.toContain(href);
  });

  it("a tab carries its place as the second line, and every word is in the dictionary", () => {
    const commands = paletteCommands(navOf("OWNER"));
    const projects = commands.find((c) => c.href === "/projects");
    expect(projects).toMatchObject({ labelKey: "nav.projects", subKey: "nav.place.work" });
    for (const c of commands) {
      expect(AR[c.labelKey], c.labelKey).toBeTruthy();
      if (c.subKey) expect(AR[c.subKey], c.subKey).toBeTruthy();
    }
    // a place called by its single tab does not repeat its own name underneath («لوحتي» is switched off here, so «الفريق» is alone)
    const alone = buildNav({ role: "MEMBER", caps: [...who("MEMBER").caps].filter((c) => c !== "board.self") });
    const team = paletteCommands(alone).find((c) => c.href === "/members");
    expect(team?.subKey).toBeUndefined();
  });
});

describe("the palette on screen", () => {
  const closed = () => render(createElement(CommandPalette, { nav: navOf("OWNER") }));
  const open = (role: NavSubject["role"] = "OWNER") => render(createElement(CommandPalette, { nav: navOf(role), defaultOpen: true, portal: false }));

  it("closed: one Arabic button that says it opens a dialog, with the shortcut hint for a keyboard", () => {
    const html = closed();
    expect(html).toContain(`aria-label="${AR["pal.open"]}"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Ctrl K");
    expect(html).not.toContain('role="dialog"');
  });

  it("open: a real dialog (Radix) named in Arabic, with the search box and the places of the map", () => {
    const html = open();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(AR["pal.open"]);
    expect(html).toContain(`placeholder="${AR["pal.placeholder"]}"`);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    for (const key of ["nav.place.today", "nav.place.chat", "nav.projects", "nav.tab.automation", "nav.tab.team"]) expect(html, key).toContain(AR[key] as string);
    // the dimming layer is the theme's scrim, not a palette colour
    expect(html).toContain("bg-scrim/60");
  });

  it("open for a guest: chat and their own work are present; internal areas stay hidden", () => {
    const html = open("GUEST");
    expect(html).toContain(AR["nav.tab.myWork"]);
    expect(html).toContain(`>${AR["nav.place.chat"]}<`);
    for (const key of ["nav.files", "nav.tab.team", "nav.crm", "nav.goals", "nav.ideas"]) expect(html, key).not.toContain(`>${AR[key]}<`);
  });

  it("theme tokens only, logical CSS only, no English word, every option and button named in Arabic", () => {
    for (const html of [closed(), open(), open("GUEST")]) {
      const tokens = classTokens(html);
      expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
      expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
      expect(textOf(html).replace(/Ctrl|Esc|Zaki Workspace/g, "")).not.toMatch(/[A-Za-z]{2,}/);
      for (const [whole, inner] of html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)) {
        const named = /[؀-ۿ]/.test(textOf(inner as string)) || /aria-label="[^"]*[؀-ۿ]/.test(whole);
        expect(named, whole.slice(0, 120)).toBe(true);
      }
    }
  });

  it("the source: the shortcut reads the physical key, and no hard-coded colour is left", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "src", "components", "command-palette.tsx"), "utf8");
    expect(source).toContain('"KeyK"');
    expect(source).not.toMatch(/\b(?:bg|text|border)-(?:black|white)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    expect(source).not.toMatch(PALETTE_COLOUR);
  });
});
