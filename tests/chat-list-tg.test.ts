import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { FolderTabs } from "@/components/chat/v2/list/folder-tabs";
import { listMenuItemsOf } from "@/lib/chat/v2/list-menu";
import { AR } from "@/lib/i18n/dict";
import { classTokens, render } from "./ui-render";

/** The chat list in Telegram's look (S6.6): the folders as a pill, and the main «⋮» menu of the list. */
const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const FOLDERS = [
  { key: "all", labelKey: "chatui.folders.all" },
  { key: "unread", labelKey: "chatui.folders.unread" },
];

describe("the folder strip", () => {
  it("is what it was without the look: underlined tabs on a hairline", () => {
    const html = render(React.createElement(FolderTabs, { folders: FOLDERS, active: "all", badges: { unread: 3 }, onChange: () => undefined }));
    const tokens = classTokens(html);
    expect(tokens).toContain("border-b");
    expect(tokens).toContain("after:h-0.5");
    expect(html).not.toContain("data-folders-pill");
    expect(html).toContain("data-folder-badge");
  });
  it("is one rounded pill with the folder you are in as a filled chip, under the look", () => {
    const html = render(React.createElement(FolderTabs, { folders: FOLDERS, active: "all", badges: { unread: 3 }, onChange: () => undefined, pill: true }));
    expect(html).toContain("data-folders-pill");
    const tokens = classTokens(html);
    expect(tokens).toContain("rounded-full");
    expect(tokens).not.toContain("border-b");
    expect(tokens).not.toContain("after:h-0.5");
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain("data-folder-badge");
  });
});

describe("listMenuItemsOf", () => {
  it("offers the theme, the contacts and the saved messages to everyone who may use private chats", () => {
    expect(listMenuItemsOf({ guest: false, canGroup: true })).toEqual(["theme", "contacts", "group", "saved"]);
  });
  it("leaves the group out where the person may not open one", () => {
    expect(listMenuItemsOf({ guest: false, canGroup: false })).toEqual(["theme", "contacts", "saved"]);
  });
  it("gives an external partner the theme only: no directory, no private chats, no saved messages", () => {
    expect(listMenuItemsOf({ guest: true, canGroup: false })).toEqual(["theme"]);
  });
});

describe("where the look reaches the list", () => {
  const LAYOUT = read("src/app/(app)/chat/layout.tsx");
  const SHELL = read("src/components/chat/v2/shell/chat-shell.tsx");
  const COLUMN = read("src/components/chat/v2/list/chat-list-column.tsx");
  const PHONE = read("src/components/chat/v2/phone/list-bar.tsx");
  const HEADER = read("src/components/chat/v2/list/list-header.tsx");
  it("the company's switch goes layout → shell → column, and absent means off", () => {
    expect(LAYOUT).toContain('isFeatureOn(actor.orgId, "tgLook")');
    expect(SHELL).toContain("tgLook?: boolean");
    expect(COLUMN).toContain("tgLook?: boolean");
    expect(COLUMN).toContain("pill={tgLook === true}");
  });
  it("the menu sits in the phone's bar and in the computer's header, only under the look", () => {
    expect(COLUMN).toContain("tgLook === true ? { menu: <ListMenu");
    expect(PHONE).toContain("menu?: React.ReactNode");
    expect(HEADER).toContain("menu?: React.ReactNode");
  });
  it("every word the menu shows is in the dictionary", () => {
    for (const key of ["chatui.listmenu.label", "chatui.listmenu.day", "chatui.listmenu.night", "chatui.listmenu.contacts", "chatui.listmenu.group", "chatui.listmenu.saved"]) expect(AR[key], key).toBeTruthy();
  });
});
