import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { NewWheel } from "@/components/shell/new-wheel";
import { NightDaySwitch } from "@/components/theme/night-day-switch";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { NEW_ACTIONS, NEW_HREF, newActionsFor, orderByLastUsed, type NewActionKey } from "@/lib/nav/new-actions";
import type { NavRole } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Themes = ThemeProvider as unknown as FunctionComponent<{ initialTheme?: string; children?: ReactNode }>;

function render(element: ReactElement, theme = "night"): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], { organizations: [] });
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, createElement(Themes, { initialTheme: theme }, element)))),
  );
}

const who = (role: NavRole, caps?: string[]) => ({ role, caps: caps ?? [...effectiveCapabilities({ role })] });

describe("«جديد»: what each person is offered", () => {
  it("the owner and an admin: all eight — مهمّة · مشروع · ملف · مستند · رسالة · نتفرّج سوا · مساحة · عضو", () => {
    for (const role of ["OWNER", "ADMIN"] as const) expect(newActionsFor(who(role)), role).toEqual([...NEW_ACTIONS]);
  });

  it("a lead or a member: no «مساحة» (only the owner and the admins open spaces by default) and no «عضو» (`users.manage`)", () => {
    for (const role of ["LEAD", "MEMBER"] as const) expect(newActionsFor(who(role)), role).toEqual(["task", "project", "doc", "document", "message", "watch"]);
  });

  it("…unless the owner switched «فتح مساحة» on for that person by name", () => {
    expect(newActionsFor(who("MEMBER", ["directory.view", "spaces.create"]))).toContain("space");
  });

  it("the switches decide, not the rank: a member without `spaces.create` gets no «مساحة», one given `users.manage` gets «عضو»", () => {
    expect(newActionsFor(who("MEMBER", ["directory.view"]))).not.toContain("space");
    expect(newActionsFor(who("MEMBER", ["spaces.create", "users.manage"]))).toContain("person");
  });

  it("«مستند» is a text document of the space: offered while «المستندات» is on and its tab is on the map, never with the switch off", () => {
    expect(NEW_HREF.document).toBe("/documents?new=document");
    expect(newActionsFor(who("MEMBER"))).toContain("document");
    expect(newActionsFor({ ...who("OWNER"), off: ["spaceDocs"] })).not.toContain("document");
    expect(newActionsFor({ ...who("OWNER"), off: ["spaceDocs"] })).toContain("doc");
    // «ملف» (an upload to the library) and «مستند» (a text document) are two different words on the wheel
    expect(AR["shell.new.doc"]).not.toBe(AR["shell.new.document"]);
  });

  it("an external partner (guest): nothing, whatever was stored for them", () => {
    expect(newActionsFor(who("GUEST"))).toEqual([]);
    expect(newActionsFor(who("GUEST", ["spaces.create", "users.manage"]))).toEqual([]);
  });

  it("the last action used comes first; an unknown or no-longer-offered one changes nothing", () => {
    const offered: NewActionKey[] = ["task", "project", "doc", "message", "space"];
    expect(orderByLastUsed(offered, "message")).toEqual(["message", "task", "project", "doc", "space"]);
    expect(orderByLastUsed(offered, "person")).toEqual(offered);
    expect(orderByLastUsed(offered, "nonsense")).toEqual(offered);
    expect(orderByLastUsed(offered, null)).toEqual(offered);
  });
});

describe("«جديد»: every action opens something real", () => {
  /** Every client source under src, to find who answers `?new=`. */
  const sources = (dir = path.join(ROOT, "src"), out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) sources(full, out);
      else if (/\.tsx?$/.test(name)) out.push(readFileSync(full, "utf8"));
    }
    return out;
  };
  const all = sources().join("\n");

  it("each page form it sends a person to answers its `?new=` value (useNewIntent)", () => {
    const sent = Object.values(NEW_HREF).filter((h): h is string => h !== null);
    expect(sent).toHaveLength(6);
    for (const href of sent) {
      const value = new URL(href, "http://x").searchParams.get("new");
      expect(all, href).toContain(`useNewIntent("${value}"`);
    }
  });

  it("«رسالة» and «مساحة» open the existing dialogs in place (the chat's and the space switcher's)", () => {
    expect(NEW_HREF.message).toBeNull();
    expect(NEW_HREF.space).toBeNull();
    const wheel = readFileSync(path.join(ROOT, "src/components/shell/new-wheel.tsx"), "utf8");
    expect(wheel).toContain("<NewDmDialog");
    expect(wheel).toContain("<WorkspaceCreateModal");
  });
});

describe("«جديد»: the wheel itself", () => {
  const actions: NewActionKey[] = ["task", "project", "doc", "message", "space", "person"];
  const html = render(createElement(NewWheel, { actions, defaultOpen: true, portal: false }));

  it("is a dialog named by its question, with every action named in Arabic and a 1-6 key", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain(AR["shell.new.title"]);
    actions.forEach((key, i) => {
      const button = new RegExp(`<button[^>]*aria-keyshortcuts="${i + 1}"[^>]*>.*?${AR[`shell.new.${key}`]}</button>`, "s");
      expect(html, key).toMatch(button);
    });
    expect(html).toContain(`aria-label="${AR["ui.close"]}"`);
  });

  it("on a phone: a bottom sheet over the home indicator, the actions a 3-column grid of thumb-sized cells", () => {
    const panel = /<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? "";
    expect(panel).toMatch(/\bbottom-0\b/);
    expect(panel).toContain("pb-[calc(1rem+env(safe-area-inset-bottom))]");
    expect(html).toMatch(/<ul[^>]*class="grid grid-cols-3[^"]*"/);
    for (const [tag] of html.matchAll(/<button[^>]*class="zk-wheel-item[^"]*"[^>]*>/g)) expect(tag).toMatch(/\bmin-h-20\b/);
  });

  it("on a computer: the ring hangs from the END side under the button — never a centring translate, which RTL throws off the screen (GLM #3)", () => {
    const panel = /<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? "";
    expect(panel).toMatch(/\bsm:end-4\b/);
    expect(panel).toMatch(/\bsm:size-\[330px\]/);
    // the code, not the comment that tells the story of the bug
    const source = readFileSync(path.join(ROOT, "src/components/shell/new-wheel.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/translate-x-1\/2|start-1\/2/);
    // each action sits at its share of the turn, whatever the number offered
    expect(html).toMatch(/--n:\s*6/);
    for (let i = 0; i < actions.length; i++) expect(html).toMatch(new RegExp(`--i:\\s*${i}\\b`));
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toMatch(/@media \(min-width: 640px\) \{\s*\.zk-wheel-item \{[^}]*inset: 0;[^}]*margin: auto;[^}]*rotate\(calc\(var\(--i\) \* 1turn \/ var\(--n\)\)\)/);
  });

  it("the button: 44px, gold with the scrim's text, a dialog trigger, «n» as its shortcut", () => {
    const opener = /<button[^>]*aria-label="جديد"[^>]*>/.exec(html)?.[0] ?? "";
    expect(opener).toMatch(/\bsize-11\b/);
    expect(opener).toContain('aria-haspopup="dialog"');
    expect(opener).toContain('aria-keyshortcuts="N"');
  });

  it("with nothing offered, nothing is drawn", () => {
    const empty = render(createElement(NewWheel, { actions: [], defaultOpen: true, portal: false }));
    expect(empty).not.toContain('role="dialog"');
    expect(empty).not.toContain("<button");
  });

  it("theme tokens only, logical CSS only, no English on screen", () => {
    const tokens = classTokens(html);
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
    expect(textOf(html)).not.toMatch(/[A-Za-z]{2,}/);
  });
});

describe("«ليل / نهار»", () => {
  const pressed = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);

  it("presses the side that is painted: «ليل» on night, «نهار» on day", () => {
    expect(pressed(render(createElement(NightDaySwitch), "night"))).toEqual([AR["shell.theme.night"]]);
    expect(pressed(render(createElement(NightDaySwitch), "day"))).toEqual([AR["shell.theme.day"]]);
  });

  it("presses neither on «إسلامي ملحمي» or «ساحل النيون»: it never lies about the look", () => {
    for (const theme of ["islamic-epic", "neon-coast"]) expect(pressed(render(createElement(NightDaySwitch), theme)), theme).toEqual([]);
  });

  it("each side is a 44px button named in Arabic (its word shows from sm, its icon always)", () => {
    const html = render(createElement(NightDaySwitch));
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toMatch(/\bmin-h-11\b.*\bmin-w-11\b/);
    expect(html).toContain(`aria-label="${AR["shell.theme.aria"]}"`);
  });
});
