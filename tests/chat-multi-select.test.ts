import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { MessageBubble } from "@/components/chat/v2/message-bubble";
import { MessageMenuV2, type MessageMenuV2Props } from "@/components/chat/v2/menu/message-menu-v2";
import { SelectionBar } from "@/components/chat/v2/menu/selection-bar";
import { PaneActionsProvider } from "@/components/chat/v2/pane/pane-actions";
import { PaneHeader } from "@/components/chat/v2/pane/pane-header";
import { MenuHost } from "@/components/chat/v2/pane/seams/menu-host";
import { ViewportRow, type RowEnv } from "@/components/chat/v2/pane/viewport-row";
import { menuFor, messageMenuItems, V2_MENU_ORDER } from "@/components/chat/message/message-menu-registry";
import {
  SELECT_MAX,
  copyTextOf,
  deletableOf,
  escapeLeavesSelection,
  forwardableOf,
  isSelectable,
  MULTI_SELECT_PROBE,
  resolveMultiSelect,
  orderedSelection,
  selectionActionsOf,
  selectionStore,
} from "@/lib/chat/selection";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { askKindOf, menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { quickReactionsOf } from "@/lib/chat/v2/menu/quick-reactions";
import { fmtShort, fmtTime } from "@/lib/format";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C3b.5 — «حدّد»: the selection model (pure), the one registry's `select` id, the bubble's check, the bar, the header that swaps to the bar, the Esc rule and the
 * switch. The doors are proven against a real database in `tests/db/chat-multi-select.test.ts`.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Actions = PaneActionsProvider as unknown as FunctionComponent<{ conversationId: string; jumpTo: () => void; toNewest: () => void; children?: ReactNode }>;
const Menus = MenuHost as unknown as FunctionComponent<{ header: ConversationHeaderDto; members: never[]; children?: ReactNode }>;
const noop = () => undefined;
const read = (path: string) => readFileSync(path, "utf8");

afterEach(() => selectionStore.reset());

const messages: MessageDto[] = [
  makeMessage({ id: "m1", authorName: "سلمى", body: "الأولى", createdAt: "2026-11-01T08:30:00.000Z" }),
  makeMessage({ id: "m2", authorName: "أنا", mine: true, body: "الثانية", createdAt: "2026-11-01T08:31:00.000Z" }),
  makeMessage({ id: "m3", kind: "POLL", authorName: "سلمى", body: "استطلاع؟", createdAt: "2026-11-01T08:32:00.000Z" }),
  makeMessage({ id: "m4", deleted: true, body: null, authorName: "سلمى", createdAt: "2026-11-01T08:33:00.000Z" }),
  makeMessage({ id: "m5", kind: "SYSTEM", body: null, authorName: "النظام", createdAt: "2026-11-01T08:34:00.000Z" }),
  makeMessage({ id: "pending:x", mine: true, body: "لسا ما وصلت", createdAt: "2026-11-01T08:35:00.000Z" }),
];

describe("the selection model", () => {
  it("only a message the server has, that is not deleted and not a system line can be selected", () => {
    expect(messages.filter(isSelectable).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("begins with the message the menu was opened on, toggles, and leaves when the last one is unselected", () => {
    selectionStore.attach("c1", true);
    selectionStore.begin("m1");
    expect(selectionStore.get()).toMatchObject({ active: true, conversationId: "c1", ids: ["m1"] });
    expect(selectionStore.toggle("m2")).toBe("added");
    expect(selectionStore.get().ids).toEqual(["m1", "m2"]);
    expect(selectionStore.toggle("m1")).toBe("removed");
    expect(selectionStore.toggle("m2")).toBe("removed");
    expect(selectionStore.get()).toMatchObject({ active: false, ids: [] });
  });

  it("holds at most 100 and says so (the server holds the same cap)", () => {
    expect(SELECT_MAX).toBe(100);
    selectionStore.attach("c1", true);
    selectionStore.begin("id0");
    for (let i = 1; i < SELECT_MAX; i++) expect(selectionStore.toggle(`id${i}`)).toBe("added");
    expect(selectionStore.get().ids).toHaveLength(100);
    expect(selectionStore.toggle("one-more")).toBe("full");
    expect(selectionStore.get().ids).toHaveLength(100);
  });

  it("begins nothing while the switch is off, and a selection of one conversation is dropped when another opens", () => {
    selectionStore.attach("c1", false);
    selectionStore.begin("m1");
    expect(selectionStore.get().active).toBe(false);
    selectionStore.attach("c1", true);
    selectionStore.begin("m1");
    selectionStore.toggle("m2");
    selectionStore.attach("c2", true);
    expect(selectionStore.get()).toMatchObject({ active: false, ids: [], open: "c2" });
    expect(selectionStore.get().enabled).toBe(true);
  });

  it("switching it off at run time ends a selection that was open", () => {
    selectionStore.attach("c1", true);
    selectionStore.begin("m1");
    selectionStore.attach("c1", false);
    expect(selectionStore.get()).toMatchObject({ active: false, enabled: false });
  });

  it("a viewport that goes away takes the switch and any selection with it, and attaching the same thing again tells nobody", () => {
    let calls = 0;
    const off = selectionStore.subscribe(() => (calls += 1));
    selectionStore.attach("c1", true);
    const afterFirst = calls;
    selectionStore.attach("c1", true);
    expect(calls).toBe(afterFirst);
    selectionStore.begin("m1");
    selectionStore.detach("another");
    expect(selectionStore.get().active).toBe(true);
    selectionStore.detach("c1");
    expect(selectionStore.get()).toMatchObject({ active: false, enabled: false, open: null });
    off();
  });

  it("the batch doors are written down once with the screen's other doors", async () => {
    const { doors } = await import("@/lib/chat/v2/pane/message-actions");
    expect(doors.forwardMany(["a", "b"], ["t"], true)).toEqual({ path: "/api/chat/messages/forward", method: "POST", body: { messageIds: ["a", "b"], targetIds: ["t"], withoutAuthor: true } });
    expect(doors.removeMany(["a"])).toEqual({ path: "/api/chat/messages/delete", method: "POST", body: { ids: ["a"] } });
  });

  it("the selected messages come back in the conversation's order, whatever order they were picked in, and a message that left the window is dropped", () => {
    expect(orderedSelection(["m2", "m1", "gone"], messages).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("forward: polls are left out and counted, a deleted message never gets here", () => {
    const picked = orderedSelection(["m1", "m2", "m3"], messages);
    const { forward, skipped } = forwardableOf(picked);
    expect(forward.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(skipped).toBe(1);
  });

  it("delete: my own, or any of them for a moderator; never one already deleted", () => {
    const picked = orderedSelection(["m1", "m2", "m3"], messages);
    expect(deletableOf(picked, false).map((m) => m.id)).toEqual(["m2"]);
    expect(deletableOf(picked, true).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("copy: author and time above the words of each message, blank line between, in the conversation's order (Western digits)", () => {
    const text = copyTextOf(orderedSelection(["m2", "m1"], messages));
    // the clock is the device's own (`fmtTime`), 24 hours with Western digits
    expect(text).toBe(`سلمى، ${fmtTime("2026-11-01T08:30:00.000Z")}\nالأولى\n\nأنا، ${fmtTime("2026-11-01T08:31:00.000Z")}\nالثانية`);
    expect(text).toMatch(/^سلمى، \d{2}:\d{2}\nالأولى\n\nأنا، \d{2}:\d{2}\nالثانية$/);
    expect(copyTextOf([])).toBe("");
  });

  it("copy leaves out a message with no words (a voice note) rather than printing an empty quote", () => {
    const voice = makeMessage({ id: "v", kind: "VOICE", body: "", createdAt: "2026-11-01T08:40:00.000Z" });
    expect(copyTextOf([messages[0]!, voice])).toBe(`سلمى، ${fmtTime("2026-11-01T08:30:00.000Z")}\nالأولى`);
  });

  it("the bar's four actions by what is selected: «اعمل مهمة» needs the right to make work and words, «احذف» needs something I may delete", () => {
    const picked = orderedSelection(["m1", "m2"], messages);
    expect(selectionActionsOf(picked, { canModerate: false, canMakeTask: true })).toEqual({ forward: true, copy: true, delete: true, task: true });
    expect(selectionActionsOf([messages[0]!], { canModerate: false, canMakeTask: true }).delete).toBe(false);
    expect(selectionActionsOf([messages[0]!], { canModerate: true, canMakeTask: true }).delete).toBe(true);
    expect(selectionActionsOf(picked, { canModerate: false, canMakeTask: false }).task).toBe(false);
    expect(selectionActionsOf([messages[2]!], { canModerate: false, canMakeTask: true }).forward).toBe(false);
    const voiceOnly = [makeMessage({ id: "v", kind: "VOICE", body: "" })];
    expect(selectionActionsOf(voiceOnly, { canModerate: false, canMakeTask: true })).toMatchObject({ copy: false, task: false });
    expect(selectionActionsOf([], { canModerate: true, canMakeTask: true })).toEqual({ forward: false, copy: false, delete: false, task: false });
  });

  it("Esc leaves the selection unless the focus is in a field or a dialog or a menu is open (their own Esc comes first)", () => {
    expect(escapeLeavesSelection({ active: true, editable: false, overlayOpen: false })).toBe(true);
    expect(escapeLeavesSelection({ active: true, editable: true, overlayOpen: false })).toBe(false);
    expect(escapeLeavesSelection({ active: true, editable: false, overlayOpen: true })).toBe(false);
    expect(escapeLeavesSelection({ active: false, editable: false, overlayOpen: false })).toBe(false);
  });

  it("the company's switch reaches the screen through the header when it carries one, else through the door's answer, and while that is unknown it is OFF", () => {
    const withSwitch = (value: boolean) => ({ ...makeHeader(), chatMultiSelect: value }) as ConversationHeaderDto;
    // the header's word wins, either way
    expect(resolveMultiSelect(withSwitch(true), false)).toBe(true);
    expect(resolveMultiSelect(withSwitch(false), true)).toBe(false);
    // no word in the header: the probe decides (200 on, 404 off), and nothing known yet (or a failed ask) is off — never a check for a company that turned it off
    expect(resolveMultiSelect(makeHeader(), true)).toBe(true);
    expect(resolveMultiSelect(makeHeader(), false)).toBe(false);
    expect(resolveMultiSelect(makeHeader(), undefined)).toBe(false);
  });

  it("when the header says nothing the door is asked once, and only its 404 means off", async () => {
    expect(MULTI_SELECT_PROBE).toBe("/api/chat/messages/delete");
    expect(read("src/lib/chat/selection.ts")).toContain("enabled: !known");
    expect(read("src/lib/chat/selection.ts")).toContain("res.status === 404");
  });

  it("copy names the day too when the selection spans more than one", () => {
    const next = makeMessage({ id: "n", authorName: "سلمى", body: "بعد يومين", createdAt: "2026-11-03T08:30:00.000Z" });
    const text = copyTextOf([messages[0]!, next]);
    expect(text).toContain(`سلمى، ${fmtShort("2026-11-01T08:30:00.000Z")} ${fmtTime("2026-11-01T08:30:00.000Z")}\nالأولى`);
    expect(text).toContain(`سلمى، ${fmtShort("2026-11-03T08:30:00.000Z")} ${fmtTime("2026-11-03T08:30:00.000Z")}\nبعد يومين`);
  });
});

describe("«حدّد» in the ONE registry", () => {
  const ctx = (over: Partial<ReturnType<typeof menuContextV2>> = {}) => ({ ...menuContextV2(makeMessage(), bubbleFactsOf(makeHeader()), { readerCount: 0, askKind: false }), ...over });

  it("is an id of the registry with its words, offered on the new screen only while the screen can select, and never on the old one", () => {
    expect(messageMenuItems.map((i) => i.id as string)).toContain("select");
    expect(AR["chatsel.menu.select"]).toBe("حدّد");
    expect(menuFor(ctx({ canSelect: true })).map((a) => a.id)).toContain("select");
    expect(menuFor(ctx()).map((a) => a.id)).not.toContain("select");
    // the old screen and the quick chat build their context without `surface`: they never receive an id they cannot run
    const old = { ...ctx({ canSelect: true }), surface: undefined };
    expect(menuFor(old).map((a) => a.id)).not.toContain("select");
  });

  it("sits right after «حوّل» (and «حوّل للمحفوظة»), Telegram's place, and the order still has a place for every id", () => {
    const after = V2_MENU_ORDER.indexOf("saved");
    expect(V2_MENU_ORDER.indexOf("select")).toBe(after + 1);
    expect([...V2_MENU_ORDER].sort()).toEqual(messageMenuItems.map((i) => i.id).sort());
  });

  it("is not offered on a deleted message, a system line, or to the owner reading silently (the whole menu is closed there)", () => {
    expect(menuFor(ctx({ canSelect: true, deleted: true }))).toEqual([]);
    expect(menuFor(ctx({ canSelect: true, kind: "SYSTEM" }))).toEqual([]);
    expect(menuFor(ctx({ canSelect: true, oversight: true }))).toEqual([]);
  });

  it("the open menu draws the item once the store says the screen can select, and draws none before", () => {
    const draw = () => {
      const props: MessageMenuV2Props = { context: ctx(), quick: quickReactionsOf(), onAction: noop, onReact: noop, sheetOpen: false, onSheetOpenChange: noop, menuOpen: true, onMenuOpenChange: noop, portal: false };
      return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(MessageMenuV2, props))));
    };
    expect(draw()).not.toContain('data-menu-item="select"');
    selectionStore.attach("c1", true);
    const html = draw();
    expect(html).toContain('data-menu-item="select"');
    expect(html).toContain(">حدّد<");
  });
});

describe("the bubble while selecting", () => {
  const header = makeHeader();
  const facts = bubbleFactsOf(header);
  const bubble = (select: ReactElement["props"] | undefined, message = makeMessage()) =>
    renderToStaticMarkup(
      createElement(
        Translations,
        { initial: "ar" },
        createElement(MessageBubble, { message, conversationId: "c1", facts, start: true, end: true, mentionNames: [], onReact: noop, onJump: noop, menu: () => createElement("i", { "data-menu-slot": "" }), hover: createElement("i", { "data-hover-slot": "" }), ...(select ? { select } : {}) }),
      ),
    );

  it("draws a check on the message (a checkbox with a name, ticked when selected) and no menu or hover buttons", () => {
    const html = bubble({ on: true, selected: true, toggle: noop });
    expect(html).toContain("data-select-check");
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain(`aria-label="${AR["chatsel.check"]}"`);
    expect(html).toContain("data-selected");
    expect(html).not.toContain("data-menu-slot");
    expect(html).not.toContain("data-hover-slot");
  });

  it("an unselected message has an unticked check; with no selection nothing is drawn and the menu is where it was", () => {
    expect(bubble({ on: true, selected: false, toggle: noop })).toContain('aria-checked="false"');
    const plain = bubble(undefined);
    expect(plain).not.toContain("data-select-check");
    expect(plain).toContain("data-menu-slot");
    expect(bubble({ on: false, selected: false, toggle: noop })).not.toContain("data-select-check");
  });

  it("a deleted message and a poll-less system line draw no check (they cannot be selected)", () => {
    expect(bubble({ on: true, selected: false, toggle: noop }, makeMessage({ deleted: true, body: null }))).not.toContain("data-select-check");
  });

  it("the row passes the selection down: a message row gets the check, a day chip and a system line do not", () => {
    const env: RowEnv = {
      conversationId: "c1",
      facts,
      mentionNames: [],
      readersByMessage: new Map(),
      openCalls: noop,
      pending: { retry: noop, discard: noop, copy: noop, edit: noop },
      select: { on: true, selected: new Set(["m1"]), toggle: noop },
    };
    const row = (message: MessageDto) =>
      renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Actions, { conversationId: "c1", jumpTo: noop, toNewest: noop }, createElement(Menus, { header, members: [] }, createElement(ViewportRow, { row: { type: "message", message, index: 0 } as never, env, start: true, end: true, highlighted: false }))))));
    const html = row(makeMessage({ id: "m1" }));
    expect(html).toContain("data-select-check");
    expect(html).toContain('aria-checked="true"');
    expect(row(makeMessage({ id: "m9" }))).toContain('aria-checked="false"');
    expect(row(makeMessage({ id: "m8", kind: "SYSTEM", body: null }))).not.toContain("data-select-check");
  });
});

describe("the bar", () => {
  const bar = (over: Partial<Parameters<typeof SelectionBar>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(Translations, { initial: "ar" }, createElement(SelectionBar, { count: 3, can: { forward: true, copy: true, delete: true, task: true }, onForward: noop, onCopy: noop, onDelete: noop, onTask: noop, onClose: noop, ...over })),
    );

  it("says the count and has the four actions in the spec's order, and a close", () => {
    const html = bar();
    expect(html).toContain("data-selection-bar");
    expect(html).toContain("3 رسائل محدّدة");
    expect([...html.matchAll(/data-selection-action="(\w+)"/g)].map((m) => m[1])).toEqual(["forward", "copy", "delete", "task"]);
    for (const key of ["chatsel.bar.forward", "chatsel.bar.copy", "chatsel.bar.delete", "chatsel.bar.task"]) expect(html).toContain(AR[key]!);
    expect(AR["chatsel.bar.forward"]).toBe("حوّل");
    expect(AR["chatsel.bar.copy"]).toBe("انسخ");
    expect(AR["chatsel.bar.delete"]).toBe("احذف");
    expect(AR["chatsel.bar.task"]).toBe("اعمل مهمة");
    expect(html).toContain("data-selection-close");
    expect(html).toContain(`aria-label="${AR["chatsel.bar.close"]}"`);
  });

  it("in the saved chat «حوّل» is not drawn (the other three are), and the host decides that from the header", () => {
    const html = bar({ hideForward: true });
    expect(html).not.toContain('data-selection-action="forward"');
    expect([...html.matchAll(/data-selection-action="(\w+)"/g)].map((m) => m[1])).toEqual(["copy", "delete", "task"]);
    expect(read("src/components/chat/v2/menu/selection-bar.tsx")).toContain("hideForward={isSavedHeader(header)}");
  });

  it("the count has its Arabic forms", () => {
    expect(bar({ count: 1 })).toContain("رسالة وحدة محدّدة");
    expect(bar({ count: 2 })).toContain("رسالتين محدّدتين");
    expect(bar({ count: 12 })).toContain("12 رسالة محدّدة");
  });

  it("an action that does not apply is a disabled button, never missing and never a second menu", () => {
    const html = bar({ can: { forward: false, copy: true, delete: false, task: true } });
    expect(html).toMatch(/data-selection-action="forward"[^>]*\sdisabled=""/);
    expect(html).toMatch(/data-selection-action="delete"[^>]*\sdisabled=""/);
    expect(html).not.toMatch(/data-selection-action="copy"[^>]*\sdisabled=""/);
  });

  it("a busy bar disables everything", () => {
    const html = bar({ busy: true });
    expect([...html.matchAll(/data-selection-action="\w+"[^>]*\sdisabled=""/g)]).toHaveLength(4);
  });
});

describe("the header", () => {
  const header = makeHeader();
  const draw = () =>
    renderToStaticMarkup(
      createElement(
        Translations,
        { initial: "ar" },
        createElement(Queries, { client: new QueryClient() }, createElement(Actions, { conversationId: header.id, jumpTo: noop, toNewest: noop }, createElement(Menus, { header, members: [] }, createElement(PaneHeader, { header, people: null, watch: false, system: false })))),
      ),
    );

  it("is the normal header until something is selected, and the bar takes its place while something is", () => {
    selectionStore.attach(header.id, true);
    expect(draw()).not.toContain("data-selection-bar");
    expect(draw()).toContain("data-header-title");
    selectionStore.begin("m1");
    const html = draw();
    expect(html).toContain("data-selection-bar");
    expect(html).not.toContain("data-header-title");
    // the header keeps its place in the pane: the bar is inside it
    expect(html).toContain("data-pane-header");
  });

  it("a selection of ANOTHER conversation never shows here", () => {
    selectionStore.attach("some-other", true);
    selectionStore.begin("m1");
    expect(draw()).not.toContain("data-selection-bar");
  });
});

describe("what the files say (pins for what a DOM-less test cannot see)", () => {
  it("the menu runs «حدّد» itself, from the registry's id, and the host's list is not a second menu", () => {
    const menu = read("src/components/chat/v2/menu/message-menu-v2.tsx");
    expect(menu).toContain('id === "select"');
    expect(menu).toContain("selectionStore");
    // no second list of items anywhere in the new files
    for (const file of ["src/components/chat/v2/menu/selection-bar.tsx", "src/components/chat/v2/menu/selection-dialogs.tsx", "src/lib/chat/selection.ts"]) {
      expect(read(file), file).not.toContain("messageMenuItems");
      expect(read(file), file).not.toContain("DropdownMenuItem");
    }
  });

  it("the viewport owns the switch and the row's checks; the header owns the bar; Esc is taken before the shell's", () => {
    const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");
    expect(viewport).toContain("useMultiSelectSwitch(header)");
    expect(viewport).toContain("useSelection");
    expect(read("src/components/chat/v2/pane/pane-header.tsx")).toContain("SelectionBarHost");
    const bar = read("src/components/chat/v2/menu/selection-bar.tsx");
    expect(bar).toMatch(/addEventListener\("keydown"[^)]*true\)/);
    expect(bar).toContain("stopPropagation");
  });

  it("every selection door says its switch before anything else is read or written", () => {
    for (const file of ["src/app/api/chat/messages/forward/route.ts", "src/app/api/chat/messages/delete/route.ts"]) {
      const source = read(file);
      expect(source, file).toContain('assertFeatureOn(ctx.orgId, "chatMultiSelect")');
      expect(source, file).toContain("withApi");
      expect(source, file).toContain("parseJson");
    }
    expect(read("src/server/chat/make-work.ts")).toContain('"chatMultiSelect"');
  });
});
