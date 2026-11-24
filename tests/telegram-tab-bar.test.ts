import * as React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { React?: typeof React }).React = React;

import { I18nProvider } from "@/lib/i18n";
import { TelegramTabBar, TG_TABS, tgTabOf } from "@/components/shell/telegram-tab-bar";
import { AR } from "@/lib/i18n/dict";
import { FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { classTokens, textOf } from "./ui-render";

/** «شريط تيليجرام السفلي» (the switch `tgTabBar`, OFF by default): Telegram's four tabs along the bottom of a phone. Off: the shell is exactly what it was. */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");
const draw = (pathname: string, chatUnread = 0) =>
  renderToStaticMarkup(React.createElement(I18nProvider, { locale: "ar", children: React.createElement(TelegramTabBar, { pathname, chatUnread, user: { name: "سارة", avatarUrl: null } }) } as never));

describe("the four tabs", () => {
  it("are chats, contacts, settings and profile, each an existing page", () => {
    expect(TG_TABS.map((t) => t.key)).toEqual(["chats", "contacts", "settings", "profile"]);
    expect(TG_TABS.map((t) => t.href)).toEqual(["/chat", "/members", "/settings/me", "/profile"]);
    for (const tab of TG_TABS) expect(AR[tab.labelKey], tab.key).toBeTruthy();
  });

  it("the page tells which tab is current, and a page of no tab marks none", () => {
    expect(tgTabOf("/chat")).toBe("chats");
    expect(tgTabOf("/chat/abc?m=1")).toBe("chats");
    expect(tgTabOf("/members")).toBe("contacts");
    expect(tgTabOf("/u/someone")).toBe("contacts");
    expect(tgTabOf("/settings/me/chat")).toBe("settings");
    expect(tgTabOf("/profile")).toBe("profile");
    expect(tgTabOf("/tasks")).toBeNull();
    expect(tgTabOf("/chatty")).toBeNull();
  });
});

describe("the bar", () => {
  it("draws the four tabs in a glass pill, marks the current one, and wears the unread number on the chats", () => {
    const html = draw("/chat", 7);
    expect(html).toContain("data-tg-tab-bar");
    for (const key of ["chats", "contacts", "settings", "profile"]) expect(html).toContain(`data-tg-tab="${key}"`);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(textOf(html)).toContain(AR["tgbar.chats"]);
    expect(textOf(html)).toContain("7");
    const tokens = classTokens(html);
    expect(tokens).toContain("backdrop-blur-md");
    expect(tokens).toContain("rounded-3xl");
    // the press animation stops with reduced motion
    expect(tokens).toContain("motion-reduce:transition-none");
  });

  it("with nothing unread there is no badge, and it hides while a conversation is open (the frame's own rule) and on a computer", () => {
    expect(draw("/members", 0)).not.toContain("data-badge");
    const tokens = classTokens(draw("/members"));
    expect(tokens).toContain("md:hidden");
    expect(tokens.some((t) => t.includes("group-has-[[data-frame-bars=hide-all]]/frame:max-md:hidden"))).toBe(true);
  });
});

describe("the shell", () => {
  it("draws it only with the switch, never for a guest, in place of the places bar, and pads the page for it; with the switch off nothing changes", () => {
    const shell = SRC("components/app-shell.tsx");
    expect(shell).toContain("tgTabBar = false");
    expect(shell).toContain("tgTabBar && !isGuest ? null : (");
    expect(shell).toContain("{tgTabBar && !isGuest ? <TelegramTabBar");
    expect(shell).toContain('tgTabBar && !isGuest ? "flex min-h-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0"');
    // the old paddings are still the ones for the switch off
    expect(shell).toContain('"flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] md:pb-0"');
    expect(SRC("app/(app)/layout.tsx")).toContain("tgTabBar={on.tgTabBar && !actor.isExternal}");
  });

  it("the switch is OFF by default (it changes how people move around), in the chat group, with its words and the ⚠️ and the 🔧", () => {
    expect(FEATURE_DEFAULTS.tgTabBar).toBe(false);
    expect(FEATURE_META.tgTabBar).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(AR["features.tgTabBar.hint"]).toContain("⚠️");
    expect(AR["features.tgTabBar.hint"]).toContain("🔧");
  });
});
