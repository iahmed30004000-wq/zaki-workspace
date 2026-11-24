import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { InfoMenu } from "@/components/chat/v2/info/info-menu";
import { AR } from "@/lib/i18n/dict";
import { render } from "./ui-render";

/** A person's page in Telegram's look (S6.4): rounded cards, three equal tiles, a pill of tabs, and the «⋮» with the few things that can really be done. */
const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const PANEL = read("src/components/chat/v2/info/info-panel.tsx");
const TABS = read("src/components/chat/v2/info/info-tabs.tsx");
const MUTE = read("src/components/chat/v2/info/info-mute.tsx");

describe("the «⋮» menu", () => {
  const html = render(React.createElement(InfoMenu, { userId: "u1", name: "سارة", onSearch: () => undefined }));
  it("is a round glass button at the corner, closed until pressed", () => {
    expect(html).toContain("data-info-menu");
    expect(html).toContain(`aria-label="${AR["chatui.info.menu"]}"`);
    expect(html).toContain("backdrop-blur-md");
    expect(html).not.toContain("data-info-menu-item");
  });
  it("offers only what the app can do: search, share the page's address, open the page", () => {
    const src = read("src/components/chat/v2/info/info-menu.tsx");
    for (const item of ["search", "share", "profile"]) expect(src).toContain(`data-info-menu-item="${item}"`);
    expect(src).not.toMatch(/block|delete|report/i);
    expect(src).toContain("navigator.share");
    expect(src).toContain("navigator.clipboard.writeText");
    expect(src).toContain('error.name === "AbortError"');
  });
});

describe("the panel under «شكل تيليجرام»", () => {
  it("draws the menu only for a person's private chat, never for «الرسائل المحفوظة», and only with the look on", () => {
    expect(PANEL).toContain('{tg && model.kind === "dm" && !saved && model.peerId ? <InfoMenu');
  });
  it("makes the cards rounded and inset, and the three tiles one row", () => {
    expect(PANEL).toContain("const tg = header.tgLook !== false;");
    expect(PANEL).toContain('tg ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"');
    expect(PANEL).toContain("mx-3 mt-2 rounded-2xl");
  });
  it("the mute row and the tabs take the same look from the same switch", () => {
    expect(PANEL).toContain("<MuteRow header={header} saved={saved} tg={tg} />");
    expect(MUTE).toContain("tg?: boolean");
    expect(TABS).toContain("rounded-full bg-surface-2 p-1");
  });
});
