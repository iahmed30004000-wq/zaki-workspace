import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { CHAT_PREFS_KEY, type ChatPrefsDto } from "@/lib/chat/cache/queries";
import { chatKeys } from "@/lib/chat/cache/keys";
import { installChatDefaults } from "@/lib/chat/cache/share";
import type { ChatListDto } from "@/lib/chat/cache/types";
import { describe, expect, it } from "vitest";
import { FolderTabs } from "@/components/chat/v2/list/folder-tabs";
import { ChatFoldersSettings, FolderEditor } from "@/components/chat/v2/list/folder-editor";
import { addFolder, tabsOf, toggleChat, toggleSpace, updateFolder } from "@/lib/chat/folders";
import type { ChatFolderDef } from "@/lib/chat/prefs";
import { render, textOf } from "./ui-render";
import {
  folderBadge,
  folderKeyOf,
  foldersOf,
  forumItems,
  forumRows,
  isCompanyFolder,
  listRows,
  normalizeQuery,
  orderedRows,
  rowItems,
  rowMatches,
} from "@/lib/chat/list-folders";
import { summarizeUnread } from "@/lib/chat/cache/unread";
import type { ChatRowDto } from "@/lib/chat/cache/types";


/**
 * C2.2 — the folders are a PURE function over the cache's rows: no React, no network. Every rule the list column draws is pinned here.
 */
const at = (n: number) => `2026-11-17T10:${String(n).padStart(2, "0")}:00.000Z`;
const row = (id: string, over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id,
  kind: "DM",
  title: `محادثة ${id}`,
  emoji: null,
  space: null,
  lastMessage: null,
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  ...over,
});
const last = (n: number, over: Record<string, unknown> = {}) => ({ id: `m${n}`, authorName: "سلمى", preview: `نص ${n}`, kind: "TEXT" as const, at: at(n), mine: false, ...over });
const shapeAll = { scope: "all" as const, spaceId: null };
const ids = (rows: readonly ChatRowDto[]) => rows.map((r) => r.id);

const rows: ChatRowDto[] = [
  row("space1", { kind: "SPACE", title: "مبيعات", space: { id: "space1", name: "مبيعات" }, unread: 3, mentionsUnread: 1, lastMessage: last(9), topicChips: [{ id: "t1", title: "الطلبات", emoji: "📦", unread: 3 }] }),
  row("dm1", { title: "أحمد", unread: 2, lastMessage: last(8) }),
  row("dm2", { title: "سارة", lastMessage: last(7) }),
  row("grp1", { kind: "GROUP", title: "فريق التصميم", muted: true, unread: 1, lastMessage: last(6) }),
  row("space2", { kind: "SPACE", title: "تصنيع", space: { id: "space2", name: "تصنيع" }, lastMessage: last(5) }),
  row("old", { title: "مؤرشفة عندي", archivedByMe: true, unread: 4 }),
];

describe("the folders on offer", () => {
  it("«الكل · غير مقروء · خاص · المساحات · ذكروني», in that order, for everybody", () => {
    expect(foldersOf({ canOversee: false }).map((f) => f.key)).toEqual(["all", "unread", "dm", "spaces", "mentions"]);
  });

  it("«كل الشركة» ONLY when the server said canOversee — and after the others", () => {
    expect(foldersOf({ canOversee: true }).map((f) => f.key)).toEqual(["all", "unread", "dm", "spaces", "mentions", "company"]);
    expect(foldersOf({ canOversee: false }).map((f) => f.key)).not.toContain("company");
  });

  it("a guest has no private chats and never the company: no «خاص», no «كل الشركة», even if canOversee were true", () => {
    expect(foldersOf({ canOversee: true, guest: true }).map((f) => f.key)).toEqual(["all", "unread", "spaces", "mentions"]);
  });

  it("every folder has an Arabic label key", () => {
    for (const f of foldersOf({ canOversee: true })) expect(f.labelKey).toMatch(/^chatui\.folder\./);
  });

  it("a remembered folder that is no longer on offer (the oversight was taken away) falls back to the first", () => {
    const offered = foldersOf({ canOversee: false });
    expect(folderKeyOf("company", offered)).toBe("all");
    expect(folderKeyOf("dm", offered)).toBe("dm");
    expect(folderKeyOf(undefined, offered)).toBe("all");
    expect(isCompanyFolder("company")).toBe(true);
    expect(isCompanyFolder("all")).toBe(false);
  });
});

describe("what each folder shows", () => {
  const show = (folder: "all" | "unread" | "dm" | "spaces" | "mentions", extra: { query?: string } = {}) => ids(listRows(rows, { ...shapeAll, folder, ...extra }));

  it("all: every row except the ones the person archived for themselves (C3a.1: the server fills archivedByMe; only the «الأرشيف» tab shows those)", () => {
    expect(show("all")).toEqual(["space1", "dm1", "dm2", "grp1", "space2"]);
  });
  it("unread: the rows with something unread, muted ones included", () => {
    expect(show("unread")).toEqual(["space1", "dm1", "grp1"]);
  });
  it("dm: private chats and groups", () => {
    expect(show("dm")).toEqual(["dm1", "dm2", "grp1"]);
  });
  it("spaces: space rows (and topic rows of the one-space shape)", () => {
    expect(show("spaces")).toEqual(["space1", "space2"]);
    const topics = [row("a", { kind: "TOPIC" }), row("b")];
    expect(ids(listRows(topics, { scope: "space", spaceId: "s", folder: "spaces" }))).toEqual(["a"]);
  });
  it("mentions: rows where somebody mentioned me and I have not read it", () => {
    expect(show("mentions")).toEqual(["space1"]);
  });
  it("a row marked unread by hand (C3a) counts as unread even with no message count", () => {
    const marked = [row("x", { markedUnread: true })];
    expect(ids(listRows(marked, { ...shapeAll, folder: "unread" }))).toEqual(["x"]);
  });
  it("does not change the rows it is given", () => {
    const copy = JSON.stringify(rows);
    listRows(rows, { ...shapeAll, folder: "unread", query: "أحمد" });
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("the badges on the tabs", () => {
  const summary = summarizeUnread(rows);
  it("count the CHATS with something waiting (muted ones too, grey), «ذكروني» counts the mentions, the company has none", () => {
    expect(folderBadge(summary, "all")).toBe(3);
    expect(folderBadge(summary, "unread")).toBe(3);
    expect(folderBadge(summary, "dm")).toBe(2);
    expect(folderBadge(summary, "spaces")).toBe(1);
    expect(folderBadge(summary, "mentions")).toBe(1);
    expect(folderBadge(summary, "company")).toBe(0);
    expect(folderBadge(undefined, "all")).toBe(0);
  });
});

describe("search: only what the row already shows", () => {
  it("normalizes the typed words", () => {
    expect(normalizeQuery("   مبيعات   اليوم  ")).toBe("مبيعات اليوم");
    expect(normalizeQuery("x".repeat(300)).length).toBe(100);
  });
  it("finds by title, spelling-tolerant (أ ا إ)", () => {
    expect(ids(listRows(rows, { ...shapeAll, folder: "all", query: "احمد" }))).toEqual(["dm1"]);
  });
  it("finds a space by its topic chips and a private chat by the space chip it carries", () => {
    expect(ids(listRows(rows, { ...shapeAll, folder: "all", query: "الطلبات" }))).toEqual(["space1"]);
    const chipped = [row("p", { title: "زبون", space: { id: "s", name: "مبيعات" } })];
    expect(ids(listRows(chipped, { ...shapeAll, folder: "all", query: "مبيعات" }))).toEqual(["p"]);
  });
  it("finds by the preview and the author the row shows", () => {
    expect(ids(listRows(rows, { ...shapeAll, folder: "all", query: "نص 6" }))).toEqual(["grp1"]);
    expect(rowMatches(rows[0]!, "سلمى")).toBe(true);
  });
  it("a deleted message has no text to find", () => {
    const gone = row("g", { lastMessage: last(1, { preview: null }) });
    expect(rowMatches(gone, "نص")).toBe(false);
  });
  it("cannot find a conversation the server did not put in the list: a restricted topic the person is outside of is not in `rows`, so no query names it", () => {
    // the DTO the person got has no such row; the function can only filter, never add
    expect(ids(listRows(rows, { ...shapeAll, folder: "all", query: "سري" }))).toEqual([]);
  });
  it("combines with the folder", () => {
    expect(ids(listRows(rows, { ...shapeAll, folder: "unread", query: "سارة" }))).toEqual([]);
    expect(ids(listRows(rows, { ...shapeAll, folder: "dm", query: "سارة" }))).toEqual(["dm2"]);
  });
});

describe("the person's own order (UserChatOrder) wins when it is set", () => {
  const chats = [row("a", { kind: "SPACE" }), row("b"), row("c", { kind: "SPACE" }), row("d"), row("e")];

  it("without a saved order the rows keep the server's order", () => {
    expect(ids(orderedRows(chats, shapeAll, {}))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("the saved `dm` order permutes the private chats among the places they hold: the spaces between them do not move", () => {
    const out = orderedRows(chats, shapeAll, { dm: ["e", "d", "b"] });
    expect(ids(out)).toEqual(["a", "e", "c", "d", "b"]);
  });

  it("an id the list does not know and a row the saved order does not know are harmless", () => {
    expect(ids(orderedRows(chats, shapeAll, { dm: ["zzz", "d"] }))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("the one-space shape reads `dm:<spaceId>` and `space:<spaceId>`; the other shape's scopes are not read", () => {
    const topics = [row("t1", { kind: "TOPIC", pinned: true }), row("t2", { kind: "TOPIC" }), row("t3", { kind: "TOPIC" }), row("d1"), row("d2")];
    const shape = { scope: "space" as const, spaceId: "s1" };
    const out = orderedRows(topics, shape, { "space:s1": ["t3", "t2", "t1"], "dm:s1": ["d2", "d1"] });
    // the pinned topic keeps its group (it is alone in it), the two unpinned ones swap; the chats swap
    expect(ids(out)).toEqual(["t1", "t3", "t2", "d2", "d1"]);
    expect(ids(orderedRows(topics, shape, { dm: ["d2", "d1"], "space:other": ["t3", "t2", "t1"] }))).toEqual(["t1", "t2", "t3", "d1", "d2"]);
  });

  it("the person's own pin (C3a) floats first and keeps its group under a saved order", () => {
    const pinned = [row("a"), row("b", { pinnedByMe: true }), row("c")];
    expect(ids(orderedRows(pinned, shapeAll, {}))).toEqual(["b", "a", "c"]);
    expect(ids(orderedRows(pinned, shapeAll, { dm: ["c", "a", "b"] }))).toEqual(["b", "c", "a"]);
  });

  it("the order is applied to the whole list before the folder narrows it", () => {
    const all = listRows(chats, { ...shapeAll, folder: "dm", orders: { dm: ["e", "d", "b"] } });
    expect(ids(all)).toEqual(["e", "d", "b"]);
  });
});

describe("the forum view's topics", () => {
  const topic = (id: string, over: Partial<ChatRowDto> = {}) => row(id, { kind: "TOPIC", ...over });
  const topics = [topic("p", { pinned: true }), topic("a"), topic("b"), topic("z", { archived: true }), topic("y", { archived: true })];

  it("the managers' pin first (the server's order), then the rest, the archived ones last", () => {
    expect(ids(forumRows(topics, "s1"))).toEqual(["p", "a", "b", "z", "y"]);
  });
  it("the person's own order of THIS space wins inside each group", () => {
    expect(ids(forumRows(topics, "s1", { "space:s1": ["b", "a", "p"] }))).toEqual(["p", "b", "a", "z", "y"]);
    expect(ids(forumRows(topics, "s1", { "space:other": ["b", "a"] }))).toEqual(["p", "a", "b", "z", "y"]);
  });
  it("searches the topics", () => {
    const named = [topic("a", { title: "الطلبات" }), topic("b", { title: "الشحن" })];
    expect(ids(forumRows(named, "s1", {}, "شحن"))).toEqual(["b"]);
  });
  it("the items fold the archived ones under one section line with their count", () => {
    const items = forumItems(forumRows(topics, "s1"));
    expect(items.map((i) => i.type)).toEqual(["row", "row", "row", "section", "row", "row"]);
    expect(items[3]).toMatchObject({ type: "section", count: 2 });
    expect(forumItems(forumRows(topics.slice(0, 3), "s1")).some((i) => i.type === "section")).toBe(false);
  });
  it("row keys are unique even when a space and a conversation share nothing but their kind", () => {
    const keys = rowItems(rows).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ───────────────────────────── C3a.1: my own pin, archive and mark ─────────────────────────────
describe("C3a.1 — the archive folder", () => {
  it("«الأرشيف» is offered only when the person has an archived chat, after the built-in tabs and before «كل الشركة»", () => {
    expect(foldersOf({ canOversee: false, archived: true }).map((f) => f.key)).toEqual(["all", "unread", "dm", "spaces", "mentions", "archived"]);
    expect(foldersOf({ canOversee: true, archived: true }).map((f) => f.key)).toEqual(["all", "unread", "dm", "spaces", "mentions", "archived", "company"]);
    expect(foldersOf({ canOversee: false, archived: false }).map((f) => f.key)).not.toContain("archived");
    expect(foldersOf({ canOversee: false, guest: true, archived: true }).map((f) => f.key)).toEqual(["all", "unread", "spaces", "mentions", "archived"]);
    expect(foldersOf({ canOversee: false, archived: true }).find((f) => f.key === "archived")!.labelKey).toBe("chatui.folder.archived");
  });

  it("it shows ONLY the archived chats; every other folder still leaves them out; the archive tab has no number", () => {
    expect(ids(listRows(rows, { ...shapeAll, folder: "archived" }))).toEqual(["old"]);
    expect(ids(listRows(rows, { ...shapeAll, folder: "all" }))).not.toContain("old");
    expect(ids(listRows(rows, { ...shapeAll, folder: "unread" }))).not.toContain("old");
    expect(folderBadge(summarizeUnread(rows), "archived")).toBe(0);
  });

  it("a person who un-archived their last chat is sent back to the first folder (the tab is gone)", () => {
    expect(folderKeyOf("archived", foldersOf({ canOversee: false }))).toBe("all");
    expect(folderKeyOf("archived", foldersOf({ canOversee: false, archived: true }))).toBe("archived");
  });

  it("search works inside it, like in any folder", () => {
    expect(ids(listRows(rows, { ...shapeAll, folder: "archived", query: "مؤرشفة" }))).toEqual(["old"]);
    expect(ids(listRows(rows, { ...shapeAll, folder: "archived", query: "سارة" }))).toEqual([]);
  });
});

describe("C3a.1 — the person's own pins keep their own order", () => {
  const chats = [row("a"), row("b", { pinnedByMe: true }), row("c"), row("d", { pinnedByMe: true }), row("e", { pinnedByMe: true })];

  it("the pins float first, in the order of the person's `pins` list (the newest pin on top); a pin the list does not know goes after the known ones", () => {
    expect(ids(orderedRows(chats, shapeAll, { pins: ["e", "b", "d"] }))).toEqual(["e", "b", "d", "a", "c"]);
    expect(ids(orderedRows(chats, shapeAll, { pins: ["d"] }))).toEqual(["d", "b", "e", "a", "c"]);
    expect(ids(orderedRows(chats, shapeAll, {}))).toEqual(["b", "d", "e", "a", "c"]);
  });

  it("an id of `pins` that is not pinned (any more) floats nothing", () => {
    expect(ids(orderedRows(chats, shapeAll, { pins: ["a", "c", "e"] }))).toEqual(["e", "b", "d", "a", "c"]);
  });

  it("the pins do not disturb the saved order of the other chats", () => {
    expect(ids(orderedRows(chats, shapeAll, { pins: ["e", "b", "d"], dm: ["c", "a"] }))).toEqual(["e", "b", "d", "c", "a"]);
  });
});

describe("C3a.1 — the forum view", () => {
  const topic = (id: string, over: Partial<ChatRowDto> = {}) => row(id, { kind: "TOPIC", ...over });

  it("a topic I archived for myself goes down with the moderators' archived ones, under the «المؤرشفة» line; a topic I pinned goes first", () => {
    const topics = [topic("p", { pinned: true }), topic("a"), topic("mine", { archivedByMe: true }), topic("z", { archived: true }), topic("star", { pinnedByMe: true })];
    expect(ids(forumRows(topics, "s1"))).toEqual(["star", "p", "a", "mine", "z"]);
    const items = forumItems(forumRows(topics, "s1"));
    expect(items.map((i) => i.type)).toEqual(["row", "row", "row", "section", "row", "row"]);
    expect(items[3]).toMatchObject({ type: "section", count: 2 });
  });
});

// ───────────────────────────── C3a.2: the person's own folders ─────────────────────────────
const mineFolders: ChatFolderDef[] = [
  { id: "a", name: "عمل", emoji: "💼", include: { dms: true, conversationIds: [], spaceIds: [] }, exclude: { archived: true } },
  { id: "b", name: "بيت", include: { conversationIds: ["dm2"], spaceIds: ["s2"] }, exclude: {} },
];

describe("C3a.2 — the folder tabs draw the person's own folders", () => {
  it("the five built-in tabs and then the person's folders with their emoji and name, the badge on a folder, one tab selected", () => {
    const html = render(createElement(FolderTabs, { folders: tabsOf({ canOversee: false, folders: mineFolders }), active: "f:a", badges: { "f:a": 4 }, onChange: () => {} }));
    expect(textOf(html)).toBe("الكل غير مقروء خاص المساحات ذكروني 💼 عمل 4 بيت");
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*data-folder="f:a"/);
    expect(html.match(/data-folder-custom=""/g)).toHaveLength(2);
  });

  it("a built-in tab the person hid is not drawn", () => {
    const html = render(createElement(FolderTabs, { folders: tabsOf({ canOversee: false, folders: mineFolders, hidden: ["unread", "mentions"] }), active: "all", badges: {}, onChange: () => {} }));
    expect(textOf(html)).toBe("الكل خاص المساحات 💼 عمل بيت");
  });

  it("the name is drawn as text: markup typed into a folder's name stays text", () => {
    const sneaky: ChatFolderDef[] = [{ id: "x", name: "<b>x</b>", include: { conversationIds: [], spaceIds: [] }, exclude: {} }];
    const html = render(createElement(FolderTabs, { folders: tabsOf({ canOversee: false, folders: sneaky }), active: "all", badges: {}, onChange: () => {} }));
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("still a strip of tabs a keyboard reaches: every tab is a button with a role", () => {
    const html = render(createElement(FolderTabs, { folders: tabsOf({ canOversee: false, folders: mineFolders }), active: "all", badges: {}, onChange: () => {} }));
    expect(html.match(/role="tab"/g)).toHaveLength(7);
    expect(html.match(/<button/g)).toHaveLength(7);
  });
});

describe("C3a.2 — the connected editor C4.1 mounts (prefs + the list cache)", () => {
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
  const draw = (prefs: ChatPrefsDto | null, list: ChatRowDto[] = []) => {
    const qc = new QueryClient();
    installChatDefaults(qc);
    if (prefs) qc.setQueryData(CHAT_PREFS_KEY, prefs);
    qc.setQueryData(chatKeys.list(), { scope: "all", spaceId: null, canOversee: false, rows: list } satisfies ChatListDto);
    return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: qc }, createElement(ChatFoldersSettings, {}))));
  };

  it("says it is loading before the prefs have come", () => {
    expect(textOf(draw(null))).toContain("عم يحمّل");
  });

  it("with the company's switch off it says the folders are off and draws no editor", () => {
    const html = draw({ prefs: {}, orgId: "org1", foldersOn: false });
    expect(textOf(html)).toContain("المجلدات مطفية عند شركتك");
    expect(html).not.toContain("data-folder-editor");
  });

  it("draws the editor with the active company's folders only and the built-in tabs' checkboxes", () => {
    const html = draw({ prefs: { folders: { org1: mineFolders, org2: [{ id: "z", name: "غريب", include: { conversationIds: [], spaceIds: [] }, exclude: {} }] }, tabs: { hidden: ["mentions"] } }, orgId: "org1", foldersOn: true });
    expect(html).toContain("data-folder-editor");
    expect(html.match(/data-folder-id="/g)).toHaveLength(2);
    expect(textOf(html)).not.toContain("غريب");
    expect(/<input[^>]*data-builtin-tab="mentions"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(/<input[^>]*data-builtin-tab="all"[^>]*>/.exec(html)?.[0]).toContain("checked");
  });
});

describe("C3a.2 — the folder editor (C4.1 mounts it on «المجلدات»)", () => {
  const chats: ChatRowDto[] = [
    row("dm1", { title: "أحمد" }),
    row("dm2", { title: "سارة" }),
    row("space1", { kind: "SPACE", title: "مبيعات", space: { id: "s1", name: "مبيعات" } }),
    row("topic1", { kind: "TOPIC", title: "الطلبات", space: { id: "s1", name: "مبيعات" } }),
    row("space2", { kind: "SPACE", title: "تصنيع", space: { id: "s2", name: "تصنيع" } }),
  ];
  /** the opening tag of the one input that carries this attribute */
  const input = (html: string, attr: string) => new RegExp(`<input[^>]*${attr}[^>]*>`).exec(html)?.[0] ?? "";
  const editor = (props: Record<string, unknown> = {}) => render(createElement(FolderEditor, { folders: mineFolders, onChange: () => {}, chats, ...props } as never));

  it("lists the folders in order, each with a grip, its name and a delete button; one «مجلد جديد» button", () => {
    const html = editor();
    expect(html).toContain("data-folder-editor");
    expect(html.match(/data-folder-id="/g)).toHaveLength(2);
    expect(textOf(html)).toContain("عمل");
    expect(textOf(html)).toContain("بيت");
    expect(html.match(/data-folder-grip/g)).toHaveLength(2);
    expect(html.match(/data-folder-delete/g)).toHaveLength(2);
    expect(textOf(html)).toContain("مجلد جديد");
    expect(html).not.toMatch(/data-folder-add=""[^>]* disabled=""/);
  });

  it("says so when there is nothing yet", () => {
    expect(textOf(editor({ folders: [] }))).toContain("ما عندك مجلدات لسا");
  });

  it("the add button is off at ten folders and says why", () => {
    let ten: ChatFolderDef[] = [];
    for (let i = 0; i < 10; i++) ten = addFolder(ten, { id: `f${i}`, name: `م${i}` });
    const html = editor({ folders: ten });
    expect(html).toMatch(/data-folder-add=""[^>]* disabled=""/);
    expect(textOf(html)).toContain("وصلت لأقصى عدد: 10 مجلدات");
  });

  it("an open folder shows its name (12 characters at most), the rules and the exclusions", () => {
    const html = editor({ initiallyOpen: "a" });
    expect(html).toContain("data-folder-detail");
    expect(input(html, 'value="عمل"')).toMatch(/maxlength="12"/i);
    for (const word of ["المحادثات الخاصة", "المساحات", "اللي ذكروني فيها", "المكتومة", "المقروءة", "المؤرشفة"]) expect(textOf(html)).toContain(word);
    // «خاص» is on, the archive is excluded, the rest are off
    expect(input(html, 'data-rule="dms"')).toContain("checked");
    expect(input(html, 'data-rule="exclude-archived"')).toContain("checked");
    expect(input(html, 'data-rule="exclude-muted"')).not.toContain("checked");
    expect(input(html, 'data-rule="spaces"')).not.toContain("checked");
  });

  it("offers the chats to pick (not the spaces' own rows), ticks the chosen ones, and the spaces to pick whole", () => {
    const html = editor({ initiallyOpen: "b" });
    expect(html.match(/data-chat-pick="/g)).toHaveLength(3);
    expect(html).not.toContain('data-chat-pick="space1"');
    expect(input(html, 'data-chat-pick="dm2"')).toContain("checked");
    expect(input(html, 'data-chat-pick="dm1"')).not.toContain("checked");
    expect(html.match(/data-space-pick="/g)).toHaveLength(2);
    expect(input(html, 'data-space-pick="s2"')).toContain("checked");
    expect(input(html, 'data-space-pick="s1"')).not.toContain("checked");
    for (const title of ["أحمد", "سارة", "الطلبات", "تصنيع"]) expect(textOf(html)).toContain(title);
  });

  it("a pick that is not among the rows the person sees is only counted, never named", () => {
    const stale = toggleChat(toggleSpace(mineFolders, "b", "gone-space"), "b", "gone-chat");
    const html = editor({ folders: stale, initiallyOpen: "b" });
    expect(textOf(html)).toContain("اختيارات مش ظاهرة إلك هلأ: 2");
    expect(html).not.toContain("gone-chat");
  });

  it("while the list has not loaded (or failed), no pick is called unavailable and nothing can be cleared", () => {
    const stale = toggleChat(toggleSpace(mineFolders, "b", "gone-space"), "b", "gone-chat");
    const html = editor({ folders: stale, initiallyOpen: "b", chats: [], chatsLoaded: false });
    expect(textOf(html)).not.toContain("مش ظاهرة إلك هلأ");
    expect(html).not.toContain("شيلها من المجلد");
  });

  it("the built-in tabs can be hidden: one checkbox per tab (shown = ticked), «خاص» not for a guest", () => {
    const html = editor({ hiddenTabs: ["unread"], onHiddenTabsChange: () => {} });
    expect(html.match(/data-builtin-tab="/g)).toHaveLength(5);
    expect(input(html, 'data-builtin-tab="unread"')).not.toContain("checked");
    expect(input(html, 'data-builtin-tab="all"')).toContain("checked");
    expect(editor({ hiddenTabs: [], onHiddenTabsChange: () => {}, guest: true }).match(/data-builtin-tab="/g)).toHaveLength(4);
    expect(editor()).not.toContain("data-builtin-tab");
  });

  it("every button has a name a screen reader can say (a label, or its own words)", () => {
    const html = editor({ initiallyOpen: "a", hiddenTabs: [], onHiddenTabsChange: () => {} });
    for (const tag of html.match(/<button[^>]*>/g) ?? []) {
      expect(tag, tag).toMatch(/aria-label=|data-folder-add|data-folder-open/);
    }
  });

  it("an emoji picked in the editor is kept on the folder", () => {
    const next = updateFolder(mineFolders, "b", { emoji: "🏠" });
    expect(next[1]!.emoji).toBe("🏠");
  });
});
