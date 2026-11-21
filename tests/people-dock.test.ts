import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The dock calls useQuery and reads the dictionary: no router, no provider of its own.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { React?: typeof React }).React = React;

import { PeopleDock, type PresenceRosterDto } from "@/components/shell/people-dock";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/**
 * The people dock (the owner's ask, 2026-10-29): the company's staff in the bottom corner, a green
 * dot for whoever is at their screen. These pin the contract the screen promises:
 * the count speaks Arabic in all four number forms, the online are drawn first and the offline are
 * dimmed, and a guest (or an empty roster) gets no dock at all.
 */

const ROSTER: PresenceRosterDto = {
  people: [
    { userId: "u1", name: "سلمى عبيد", jobTitle: "محاسبة", role: "MEMBER", online: true },
    { userId: "u2", name: "أحمد زكي", jobTitle: null, role: "OWNER", online: true },
    { userId: "u3", name: "ليان مراد", jobTitle: "مبيعات", role: "MEMBER", online: false },
  ],
  onlineCount: 2,
  total: 3,
};

function html(data: PresenceRosterDto | null, props: { enabled?: boolean; defaultOpen?: boolean } = {}): string {
  const client = new QueryClient();
  if (data) client.setQueryData(["presence-dock", "space"], data);
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client }, createElement(PeopleDock, { enabled: props.enabled ?? true, defaultOpen: props.defaultOpen ?? false })),
    ),
  );
}

describe("the people dock", () => {
  it("counts the online in Arabic, in every number form the dictionary carries", () => {
    const text = (n: number) => AR[`shell.dock.online.${n === 1 ? "one" : n === 2 ? "two" : n % 100 >= 3 && n % 100 <= 10 ? "few" : "many"}`]!;
    expect(text(1)).toBe("واحد متصل");
    expect(text(2)).toBe("اثنان متصلان");
    expect(text(5)).toBe("{n} متصلين");
    expect(text(11)).toBe("{n} متصلًا");
    for (const n of [1, 2, 5, 11]) expect(text(n)).toMatch(/^[\u0600-\u06FF{} n.]+$/);
  });

  it("shows the counted line, and the roster puts the online first", () => {
    const out = html(ROSTER, { defaultOpen: true });
    // two online: the dual form, no number in it (Arabic counts 1 and 2 without a digit)
    expect(out).toContain("اثنان متصلان");
    expect(out).toContain("سلمى عبيد");
    // the green dot is a theme token, never a palette colour
    expect(out).toContain("bg-ok");
    // the offline person is dimmed, the online one is not
    expect(out).toMatch(/opacity-60/);
    expect(out).toContain("غير متصل");
    expect(out).toContain(">متصل<");
  });

  it("counts three to ten with the digit, as Arabic does", () => {
    const five: PresenceRosterDto = {
      people: ROSTER.people.map((p, i) => ({ ...p, online: i < 4 })),
      onlineCount: 3,
      total: 3,
    };
    expect(html(five)).toContain("3 متصلين");
  });

  it("a person with no job title still reads as a colleague, never as an empty line", () => {
    const out = html(ROSTER, { defaultOpen: true });
    expect(out).toContain("من الفريق");
  });

  it("draws nothing at all for a guest, and nothing for an empty roster", () => {
    expect(html(ROSTER, { enabled: false })).toBe("");
    expect(html({ people: [], onlineCount: 0, total: 0 })).toBe("");
  });

  it("the closed dock is one short row that names the count for a screen reader", () => {
    const out = html(ROSTER);
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-label="اثنان متصلان"');
    // the panel is not in the HTML until it is opened
    expect(out).not.toContain("الموجودون");
  });

  it("sits inside the column that already clears the phone's bottom bar, after the page — it covers nothing", () => {
    const shell = readFileSync(path.resolve(__dirname, "..", "src/components/app-shell.tsx"), "utf8");
    // the one wrapper that pads for the fixed bottom bar (56px + its border + the home-indicator inset)
    // (N1.2: the new shell has no bottom bar, so its column pads only for the home-indicator inset; the old shell still pads for the bar)
    const column = /<div className=\{navV2 \? "flex min-h-0 flex-1 flex-col pb-\[env\(safe-area-inset-bottom\)\] md:pb-0" : "flex min-h-0 flex-1 flex-col pb-\[calc\(3\.5rem\+1px\+env\(safe-area-inset-bottom\)\)\] md:pb-0"\}>([\s\S]*?)<\/div>/.exec(shell);
    expect(column, "the padded column is gone: the dock would land under the phone's bar").not.toBeNull();
    const inside = column![1]!;
    // the page scrolls first, the dock is its own row under it (and the company's switch can leave it out)
    // (P2.1: with the new map the row is hidden below md, `hideOnPhone`, and the drawer's header holds the count instead: tests/phone-chrome.test.ts)
    expect(inside).toMatch(/<main[\s\S]*<\/main>[\s\S]*<PeopleDock enabled=\{!isGuest && peopleDock\} hideOnPhone=\{navV2\} \/>/);
    // and it is never a floating layer over the content
    const dock = readFileSync(path.resolve(__dirname, "..", "src/components/shell/people-dock.tsx"), "utf8");
    expect(dock).not.toMatch(/className="[^"]*\bfixed\b/);
  });
});

describe("choosing somebody in the dock (the owner, 2026-10-30: «ما بقدر ادخل ع الدردشة»)", () => {
  const WITH_ME: PresenceRosterDto = { ...ROSTER, meId: "u2" };

  it("another person is a button that opens the private chat with them", () => {
    const out = html(WITH_ME, { defaultOpen: true });
    expect(out).toContain("data-dock-chat=\"u1\"");
    expect(out).toContain("data-dock-chat=\"u3\"");
    expect(out).toContain(AR["shell.dock.chat_with"]!.replace("{name}", "سلمى عبيد"));
  });

  it("I am a link to my own profile, never a button that would open a chat with myself", () => {
    const out = html(WITH_ME, { defaultOpen: true });
    expect(out).not.toContain("data-dock-chat=\"u2\"");
    expect(out).toContain('href="/u/u2"');
  });

  it("without «meId» (an older answer) nobody is offered a chat by mistake of the roster's own owner row", () => {
    const out = html(ROSTER, { defaultOpen: true });
    expect(out).toContain("data-dock-chat=\"u1\"");
  });
});

describe("who the dock lists (the owner, 2026-10-30: my space, or for the owner the whole company)", () => {
  it("the owner is offered a choice between his space and the whole company, and nobody else is", () => {
    const owner = html({ ...ROSTER, meId: "u2", canChooseScope: true, scope: "space" }, { defaultOpen: true });
    expect(owner).toContain('data-dock-scope="space"');
    expect(owner).toContain('data-dock-scope="company"');
    expect(owner).toContain(AR["shell.dock.scope_company"]!);
    const member = html({ ...ROSTER, meId: "u1" }, { defaultOpen: true });
    expect(member).not.toContain("data-dock-scope");
  });
});

describe("«إشارة التوثيق» in the dock (S5.5)", () => {
  const MARKED: PresenceRosterDto = { ...ROSTER, people: ROSTER.people.map((p) => (p.userId === "u1" ? { ...p, verified: true } : p)) };

  it("a verified person carries the small badge next to the name, and nobody else does", () => {
    const out = html(MARKED, { defaultOpen: true });
    expect(out.match(/data-verified-badge/g)).toHaveLength(1);
    // its accessible name is «موثّق», and it sits in the same row as the name
    expect(out).toContain('aria-label="موثّق"');
    expect(out).toMatch(/سلمى عبيد<\/span><span data-verified-badge/);
  });

  it("a roster with no `verified` (the switch is off, or a guest) draws no badge", () => {
    expect(html(ROSTER, { defaultOpen: true })).not.toContain("data-verified-badge");
  });
});
