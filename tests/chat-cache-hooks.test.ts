import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { useChatHeader, useChatList, useChatMessages, useChatRow, useChatSpace, useChatUnreadSummary } from "@/lib/chat/cache/selectors";
import { findRow, seedFromDevice, upsertRows } from "@/lib/chat/cache/writer";
import { installChatDefaults, shareChatData } from "@/lib/chat/cache/share";
import { LATEST, type ChatFolder, type ChatListDto, type ChatRowDto, type MessageDto, type MessagesData, type SpaceTopicsDto } from "@/lib/chat/cache/types";

(globalThis as { React?: typeof React }).React = React;

const at = (n: number) => `2026-11-16T10:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`;
const msg = (id: string, n: number): MessageDto => ({ id, kind: "TEXT", body: `نص ${id}`, deleted: false, edited: false, pinned: false, mine: false, authorId: "u2", authorName: "سلمى", createdAt: at(n), clientId: null, mentions: [], attachments: [], reactions: [] });
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({ id, kind: "DM", title: `محادثة ${id}`, emoji: null, space: null, lastMessage: null, unread: 0, mentionsUnread: 0, muted: false, pinnedByMe: false, archivedByMe: false, markedUnread: false, restricted: false, ...over });
const list = (...rows: ChatRowDto[]): ChatListDto => ({ scope: "all", spaceId: null, canOversee: false, rows });

function render(qc: QueryClient, probe: () => unknown): unknown {
  const Probe = () => createElement("pre", null, JSON.stringify(probe() ?? null));
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  const text = html.replace(/^<pre>/, "").replace(/<\/pre>$/, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return JSON.parse(text);
}

const filled = () => {
  const qc = new QueryClient();
  installChatDefaults(qc); // what the runtime and every query option do before the first write: a query keeps the sharing it was built with
  qc.setQueryData(chatKeys.list(), list(row("a", { unread: 2, lastMessage: { id: "m", authorName: "س", preview: "x", kind: "TEXT", at: at(9), mine: false } }), row("b", { kind: "GROUP" }), row("s1", { kind: "SPACE", unread: 4, mentionsUnread: 1, space: { id: "s1", name: "مبيعات" } })));
  return qc;
};

describe("the read selectors paint from the cache at once", () => {
  it("useChatList(folder): the rows of the folder and their unread numbers, with no request needed to have them", () => {
    const qc = filled();
    const view = (folder: ChatFolder) => render(qc, () => { const v = useChatList(folder); return { ids: v.rows.map((r) => r.id), unread: v.unread, pending: v.isPending, scope: v.scope }; }) as { ids: string[]; unread: { messages: number; chats: number; mentions: number }; pending: boolean; scope: string };
    expect(view("all")).toMatchObject({ ids: ["a", "b", "s1"], pending: false, scope: "all" });
    expect(view("unread").ids).toEqual(["a", "s1"]);
    expect(view("dm").ids).toEqual(["a", "b"]);
    expect(view("spaces").ids).toEqual(["s1"]);
    expect(view("mentions").ids).toEqual(["s1"]);
    expect(view("unread").unread).toEqual({ messages: 6, chats: 2, mentions: 1 });
  });

  it("data that came from the device (stale, fetched at 0) paints on the very first render", () => {
    const qc = new QueryClient();
    seedFromDevice(qc, { list: list(row("a", { unread: 1 })), conversations: [{ id: "a", header: { id: "a", title: "محادثة a" } as never, messages: [msg("m1", 1), msg("m2", 2)], hasOlder: true, readers: [] }] });
    expect(render(qc, () => useChatList().rows.map((r) => r.id))).toEqual(["a"]);
    const m = render(qc, () => { const v = useChatMessages("a"); return { ids: v.messages.map((x) => x.id), older: v.hasOlder, newer: v.hasNewer, pending: v.isPending }; }) as { ids: string[]; older: boolean; newer: boolean; pending: boolean };
    expect(m).toEqual({ ids: ["m1", "m2"], older: true, newer: false, pending: false });
    expect(render(qc, () => useChatHeader("a").data?.id)).toBe("a");
  });

  it("useChatMessages flattens the windows oldest first, once each; the older/newer flags come from the first and the last window", () => {
    const qc = new QueryClient();
    const d: MessagesData = {
      pages: [
        { messages: [msg("a", 1), msg("b", 2)], hasOlder: true, hasNewer: false, firstUnreadId: "b", readers: [] },
        { messages: [msg("b", 2), msg("c", 3)], hasOlder: false, hasNewer: true, firstUnreadId: null, readers: [] },
      ],
      pageParams: [LATEST, LATEST],
    };
    qc.setQueryData(chatKeys.messages("c1"), d);
    expect(render(qc, () => { const v = useChatMessages("c1"); return { ids: v.messages.map((x) => x.id), older: v.hasOlder, newer: v.hasNewer, unreadAt: v.firstUnreadId }; })).toEqual({ ids: ["a", "b", "c"], older: true, newer: true, unreadAt: "b" });
  });

  it("no id, no read: a screen with nothing open reads nothing", () => {
    const qc = new QueryClient();
    expect(render(qc, () => useChatRow(null))).toBeNull();
    expect(render(qc, () => { const v = useChatMessages(null); return { n: v.messages.length, pending: v.isPending }; })).toEqual({ n: 0, pending: true });
  });

  it("useChatRow(id): the row, wherever the cache holds it (the list, or a forum view)", () => {
    const qc = filled();
    const forum: SpaceTopicsDto = { space: { id: "s1", name: "مبيعات", emoji: null, canModerate: false, canCreateTopic: false }, rows: [row("t1", { kind: "TOPIC", title: "عام", space: { id: "s1", name: "مبيعات" } })] };
    qc.setQueryData(chatKeys.space("s1"), forum);
    expect(render(qc, () => useChatRow("a")?.title)).toBe("محادثة a");
    expect(render(qc, () => useChatRow("t1")?.title)).toBe("عام");
    expect(render(qc, () => useChatRow("nope"))).toBeNull();
    expect(render(qc, () => useChatSpace("s1").rows.map((r) => r.id))).toEqual(["t1"]);
  });

  it("a row subscribes to ITSELF: when another row changes, this row is the very same object (so only the changed row renders again)", () => {
    const qc = filled();
    const before = findRow(qc, "a")!;
    const b = findRow(qc, "b")!;
    upsertRows(qc, [{ ...b, unread: 5, lastMessage: { id: "n", authorName: "س", preview: "y", kind: "TEXT", at: at(50), mine: false } }]);
    expect(findRow(qc, "b")!.unread).toBe(5);
    expect(findRow(qc, "a")).toBe(before);
  });

  it("sharing by id: a message list that gets an older window in front keeps every message object it had", () => {
    const m = (id: string, n: number) => msg(id, n);
    const old = { pages: [{ messages: [m("c", 3), m("d", 4)], hasOlder: true, hasNewer: false, firstUnreadId: null, readers: [] }], pageParams: [LATEST] };
    const next = { pages: [{ messages: [m("a", 1), m("b", 2)], hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [] }, old.pages[0]], pageParams: [LATEST, LATEST] };
    const shared = shareChatData(old, JSON.parse(JSON.stringify(next))) as typeof next;
    expect(shared.pages[1]!.messages[0]).toBe(old.pages[0]!.messages[0]);
    expect(shared.pages[1]!.messages[1]).toBe(old.pages[0]!.messages[1]);
    // nothing changed at all: the very same data
    expect(shareChatData(old, JSON.parse(JSON.stringify(old)))).toBe(old);
    // a list whose rows were only reordered: every row object is the one it was
    const rows = [row("a"), row("b"), row("c")];
    const reordered = shareChatData({ rows, scope: "all" }, JSON.parse(JSON.stringify({ rows: [rows[2], rows[0], rows[1]], scope: "all" }))) as { rows: ChatRowDto[] };
    expect(reordered.rows).toEqual([rows[2], rows[0], rows[1]]);
    expect(reordered.rows[0]).toBe(rows[2]);
    expect(reordered.rows[1]).toBe(rows[0]);
  });

  it("the unread summary: per folder (the tabs) and per space (the switcher), from the same cache", () => {
    const qc = filled();
    const s = render(qc, () => { const v = useChatUnreadSummary(); return v ? { all: v.byFolder.all.messages, unread: v.byFolder.unread.chats, space: v.bySpace["s1"]?.messages, total: v.total.messages } : null; });
    expect(s).toEqual({ all: 6, unread: 2, space: 4, total: 6 });
    // not asked for: no summary (the shell does not pay for it)
    expect(render(new QueryClient(), () => useChatUnreadSummary({ enabled: false }) ?? "none")).toBe("none");
  });
});
