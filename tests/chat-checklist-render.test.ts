import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AttachMenu } from "@/components/chat/v2/composer/attach-menu";
import { ChecklistDialog } from "@/components/chat/v2/composer/checklist-dialog";
import { BubbleBody } from "@/components/chat/v2/bubble/bubble-body";
import { MessageItem } from "@/components/chat/message/message-item";
import { ChecklistView } from "@/components/chat/v2/bubble/bubble-checklist";
import { chatKeys } from "@/lib/chat/cache/keys";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ChecklistDto, ConversationHeaderDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C3c.1 — the checklist drawn on the server: the bubble (title, a box per item, who finished it and when, the progress, «+ أضف بند», the buttons only where the server
 * said), the composer's dialog, and the paperclip's new entry. The behaviour of every control is the server's and is proven in `tests/db/chat-checklists.test.ts`.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => undefined;
const inI18n = (node: React.ReactElement, client?: QueryClient) =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, client ? createElement(Queries, { client }, node) : node));

const list = (over: Partial<ChecklistDto> = {}): ChecklistDto => ({
  id: "cl1",
  othersCanAdd: false,
  othersCanTick: true,
  items: [
    { id: "i1", text: "كاسات", done: true, doneByName: "سلمى", doneAt: "2026-11-20T10:20:00.000Z", canEdit: false },
    { id: "i2", text: "صحون", done: false, canEdit: true },
    { id: "i3", text: "عصير", done: false, canEdit: false },
  ],
  done: 1,
  total: 3,
  canAdd: true,
  canTick: true,
  max: 30,
  ...over,
});

describe("the checklist in the bubble", () => {
  it("draws a box per item, the done one checked and struck with «خلّصها فلان · الوقت», the progress «1 من 3» and «+ أضف بند»", () => {
    const html = inI18n(createElement(ChecklistView, { checklist: list(), onAct: async () => true }));
    expect(html).toContain("data-checklist");
    expect([...html.matchAll(/role="checkbox"/g)]).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"/);
    expect(html).toContain("line-through");
    expect(html).toContain("خلّصها سلمى · ");
    expect(html).toMatch(/خلّصها سلمى · \d{2}:\d{2}/); // Western digits
    expect(html).toContain("1 من 3");
    expect(html).toContain("data-checklist-add");
    expect(html).toContain(AR["chatcl.add"]!);
    // the pencil and the bin only on the item I may change
    expect([...html.matchAll(new RegExp(AR["chatcl.edit"]!, "g"))]).toHaveLength(1);
    expect([...html.matchAll(new RegExp(AR["chatcl.remove"]!, "g"))]).toHaveLength(1);
  });

  it("with no right to tick the boxes are disabled; with no right to add there is no «+ أضف بند»", () => {
    const html = inI18n(createElement(ChecklistView, { checklist: list({ canTick: false, canAdd: false, items: list().items.map((i) => ({ ...i, canEdit: false })) }) }));
    expect([...html.matchAll(/role="checkbox"[^>]*disabled/g)]).toHaveLength(3);
    expect(html).not.toContain("data-checklist-add");
    expect(html).not.toContain(AR["chatcl.edit"]!);
    expect(html).toContain("1 من 3");
  });

  it("a guest's list says when it was finished and never by whom", () => {
    const html = inI18n(createElement(ChecklistView, { checklist: list({ canTick: false, canAdd: false, items: [{ id: "i1", text: "كاسات", done: true, doneAt: "2026-11-20T10:20:00.000Z", canEdit: false }] , done: 1, total: 1 }) }));
    expect(html).toMatch(/خلصت · \d{2}:\d{2}/);
    expect(html).not.toContain("خلّصها");
  });

  it("a full list offers no add and says so when others may add; «اعمل منها مهمة» only when the screen passes it", () => {
    const full = inI18n(createElement(ChecklistView, { checklist: list({ canAdd: false, total: 30, othersCanAdd: true }) }));
    expect(full).toContain("وصلت للحد: 30 بند");
    expect(full).not.toContain("data-checklist-make-task");
    const withTask = inI18n(createElement(ChecklistView, { checklist: list(), onMakeTask: noop }));
    expect(withTask).toContain("data-checklist-make-task");
    expect(withTask).toContain("اعمل منها مهمة");
  });

  it("an error is shown as an alert", () => {
    expect(inI18n(createElement(ChecklistView, { checklist: list(), error: "ما زبطت العملية" }))).toContain('role="alert"');
  });
});

describe("the message body", () => {
  const qc = () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.header("c1"), makeHeader({ id: "c1", me: { ...makeHeader().me, canMakeWork: true, canMakeTask: true } }) as ConversationHeaderDto);
    return client;
  };
  const body = (message: ReturnType<typeof makeMessage>, client = qc()) => inI18n(createElement(BubbleBody, { message, mentionNames: [], conversationId: "c1", orderChips: false }), client);

  it("draws the title bold and the list under it; «اعمل منها مهمة» for a person who may make work (the header says so) while it is not a task yet", () => {
    const html = body(makeMessage({ kind: "CHECKLIST" as never, body: "مشتريات الحفلة", checklist: list() }));
    expect(html).toContain("data-checklist-title");
    expect(html).toContain("مشتريات الحفلة");
    expect(html).toContain("data-checklist");
    expect(html).toContain("data-checklist-make-task");
    // it already became a task: the chip says so, the button goes
    const made = body(makeMessage({ kind: "CHECKLIST" as never, body: "مشتريات الحفلة", checklist: list(), work: [{ kind: "task", id: "t1" }] }));
    expect(made).not.toContain("data-checklist-make-task");
    // no header in the cache (the quick screens): no button either
    expect(body(makeMessage({ kind: "CHECKLIST" as never, body: "مشتريات", checklist: list() }), new QueryClient())).not.toContain("data-checklist-make-task");
  });

  it("a deleted checklist draws the deleted line and no list; a plain message draws no list", () => {
    const deleted = body(makeMessage({ kind: "CHECKLIST" as never, body: null, deleted: true }));
    expect(deleted).toContain(AR["chatc.deleted"]!);
    expect(deleted).not.toContain("data-checklist");
    expect(body(makeMessage())).not.toContain("data-checklist");
  });
});

describe("the old screen", () => {
  it("shows a CHECKLIST message as its title text, with no list and nothing broken (it has no idea of the kind)", () => {
    const message = makeMessage({ kind: "CHECKLIST" as never, body: "مشتريات الحفلة", mine: false, checklist: list() });
    const html = renderToStaticMarkup(createElement(MessageItem, { message, canModerate: false, onReact: noop, onAction: noop }));
    expect(html).toContain("مشتريات الحفلة");
    expect(html).not.toContain("data-checklist");
    expect(html).not.toContain("كاسات");
  });
});

describe("the composer's dialog and the paperclip", () => {
  it("the dialog has a title, two items to start with, «+ أضف بند», the two choices (others tick is on) and one send button; a form of its own", () => {
    const html = inI18n(createElement(ChecklistDialog, { open: true, conversationId: "c1", onClose: noop, onCreated: noop, portal: false }));
    expect(html).toContain("data-checklist-form");
    expect(html).toContain(AR["chatcl.dialog.title"]!);
    expect(html).toContain('id="checklist-title"');
    expect(html).toContain('id="checklist-item-0"');
    expect(html).toContain('id="checklist-item-1"');
    expect(html).not.toContain('id="checklist-item-2"');
    expect(html).toContain("data-checklist-add-item");
    expect(html).toContain(AR["chatcl.dialog.others_add"]!);
    expect(html).toMatch(/type="checkbox"[^>]*checked=""[^>]*\/>الكل بيقدر يعلّم البنود/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""[^>]*\/>الكل بيقدر يضيف بنود/);
    // nothing can be sent before a title and an item are written
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).toContain(AR["chatcl.dialog.create"]!);
    // closed: nothing
    expect(inI18n(createElement(ChecklistDialog, { open: false, conversationId: "c1", onClose: noop, onCreated: noop, portal: false }))).not.toContain("data-checklist-form");
  });

  it("the paperclip menu draws its trigger and, for the item list it was given, one entry each; «قائمة مهام» is run by the menu itself", () => {
    const trigger = inI18n(createElement(AttachMenu, { items: ["media", "file", "poll", "checklist"], disabled: false, onPick: noop }));
    expect(trigger).toContain("data-attach-menu");
    const src = readFileSync(path.resolve(__dirname, "../src/components/chat/v2/composer/attach-menu.tsx"), "utf8");
    expect(src).toContain('id === "checklist" ? setChecklistOpen(true) : onPick(id)');
    expect(src).toContain('checklist: "chatcl.menu"');
    // a new list lands in the cache through the writer and the pane goes to the newest message
    expect(src).toContain("appendMessage(qc, conversationId, message)");
    expect(src).toContain("commands.toNewest()");
    expect(AR["chatcl.menu"]).toBe("قائمة مهام");
  });
});
