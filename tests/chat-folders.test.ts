import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_PREFS_KEY, saveChatPrefs, type ChatPrefsDto } from "@/lib/chat/cache/queries";
import {
  CHAT_PREFS_MAX_BYTES,
  chatFolderSchema,
  chatPrefsBytes,
  chatPrefsPatchSchema,
  chatPrefsSchema,
  foldersOfOrg,
  mergeChatPrefs,
  readChatPrefs,
  resolveChatPrefs,
  type ChatFolderDef,
} from "@/lib/chat/prefs";
import {
  addFolder,
  customIdOf,
  customTabKey,
  folderBadge,
  folderIncludes,
  folderRows,
  reorderFolders,
  newFolderId,
  removeFolder,
  renameFolder,
  spacesOfRows,
  tabKeyOf,
  tabsOf,
  toggleChat,
  toggleSpace,
  updateFolder,
} from "@/lib/chat/folders";
import type { ChatRowDto } from "@/lib/chat/cache/types";

/**
 * C3a.2 — the person's chat preferences (`User.chatPrefs`, ONE zod schema) and the folders made of them: a PURE filter over the rows of the C1 list
 * cache. Nothing here reads the network or the screen; a folder can only ever keep or drop rows it is handed, so it cannot name a conversation the
 * list did not already hold for this person.
 */

const folder = (over: Partial<ChatFolderDef> & { id: string }): ChatFolderDef => ({
  name: "شغل",
  include: { conversationIds: [], spaceIds: [] },
  exclude: {},
  ...over,
});
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
const ids = (rows: readonly ChatRowDto[]) => rows.map((r) => r.id);
const shape = { scope: "all" as const, spaceId: null };

describe("the prefs schema: an empty object is all defaults", () => {
  it("accepts {} and resolves every field to its default in code", () => {
    expect(chatPrefsSchema.safeParse({}).success).toBe(true);
    const all = resolveChatPrefs({});
    expect(all.folders).toEqual({});
    expect(all.tabs).toEqual({ hidden: [] });
    expect(all.voiceSpeed).toBe(1);
    expect(all.notifications).toEqual({});
    expect(all.chat).toEqual({});
  });

  it("a folder with only an id and a name is complete: the include and exclude boxes fill in", () => {
    const parsed = chatFolderSchema.parse({ id: "f1", name: "شغل" });
    expect(parsed).toEqual({ id: "f1", name: "شغل", include: { conversationIds: [], spaceIds: [] }, exclude: {} });
  });

  it("keeps room for the sections C4.1 fills and for the voice speed of C3b.4", () => {
    const ok = chatPrefsSchema.safeParse({ notifications: { dm: { on: true, sound: false } }, chat: { fontSize: 3 }, voiceSpeed: 1.5 });
    expect(ok.success).toBe(true);
    for (const speed of [1, 1.5, 2]) expect(chatPrefsSchema.safeParse({ voiceSpeed: speed }).success).toBe(true);
  });
});

describe("the prefs schema: bad shapes are refused", () => {
  const bad = (value: unknown) => chatPrefsSchema.safeParse(value).success;
  const org = (list: unknown) => ({ folders: { orgA: list } });

  it("not an object, an unknown key, a wrong type", () => {
    expect(bad(null)).toBe(false);
    expect(bad([])).toBe(false);
    expect(bad("x")).toBe(false);
    expect(bad({ userId: "someone-else" })).toBe(false);
    expect(bad({ voiceSpeed: 3 })).toBe(false);
    expect(bad({ voiceSpeed: "2" })).toBe(false);
    expect(bad({ notifications: [] })).toBe(false);
    expect(bad({ chat: "loud" })).toBe(false);
    expect(bad({ tabs: { hidden: ["company"] } })).toBe(false);
    expect(bad({ tabs: { hidden: ["dm", "dm"] } })).toBe(false);
  });

  it("a folder name is 1 to 12 characters, trimmed, with no control characters", () => {
    expect(bad(org([{ id: "a", name: "ا".repeat(12) }]))).toBe(true);
    expect(bad(org([{ id: "a", name: "ا".repeat(13) }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "   " }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "ab\ncd" }]))).toBe(false);
    expect(bad(org([{ id: "a" }]))).toBe(false);
  });

  it("a name cannot read backwards or vanish: bidi overrides and zero-width spaces are refused (the joiner letters of Persian and Arabic stay)", () => {
    expect(bad(org([{ id: "a", name: "ab\u202Ecd" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "\u200B\u200B" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "ab\u2066cd" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "می\u200Cخواهم" }]))).toBe(true);
  });

  it("an emoji is optional, short, and not letters or digits", () => {
    expect(bad(org([{ id: "a", name: "x", emoji: "📦" }]))).toBe(true);
    expect(bad(org([{ id: "a", name: "x", emoji: "👨‍👩‍👧" }]))).toBe(true);
    expect(bad(org([{ id: "a", name: "x", emoji: "" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "x", emoji: "abc" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "x", emoji: "12" }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "x", emoji: "📦".repeat(9) }]))).toBe(false);
  });

  it("at most 10 folders per company, with distinct ids", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `م${i}` }));
    expect(bad(org(many(10)))).toBe(true);
    expect(bad(org(many(11)))).toBe(false);
    expect(bad(org([{ id: "same", name: "أ" }, { id: "same", name: "ب" }]))).toBe(false);
  });

  it("at most 100 chats and 50 spaces in a folder; the lists are plain ids", () => {
    const include = (conversationIds: string[], spaceIds: string[] = []) => org([{ id: "a", name: "x", include: { conversationIds, spaceIds } }]);
    const n = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`);
    expect(bad(include(n(100)))).toBe(true);
    expect(bad(include(n(101)))).toBe(false);
    expect(bad(include([], n(50)))).toBe(true);
    expect(bad(include([], n(51)))).toBe(false);
    expect(bad(include(["has space"]))).toBe(false);
    expect(bad(include(["<script>"]))).toBe(false);
    expect(bad(include(["x".repeat(65)]))).toBe(false);
    expect(bad(org([{ id: "a", name: "x", include: { dms: "yes" } }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "x", include: { everything: true } }]))).toBe(false);
    expect(bad(org([{ id: "a", name: "x", exclude: { muted: 1 } }]))).toBe(false);
  });

  it("the company key is a plain id, and a person is in a handful of companies, not hundreds", () => {
    expect(bad({ folders: { "bad key!": [] } })).toBe(false);
    expect(bad({ folders: { __proto__x: [] } })).toBe(false);
    const wide = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`org${i}`, []]));
    expect(bad({ folders: wide })).toBe(false);
  });

  it("repeated chat ids collapse to one", () => {
    const parsed = chatPrefsSchema.parse(org([{ id: "a", name: "x", include: { conversationIds: ["c1", "c1", "c2"] } }]));
    expect(parsed.folders?.["orgA"]?.[0]?.include.conversationIds).toEqual(["c1", "c2"]);
  });

  it("the size cap is 64 KB of stored JSON", () => {
    expect(CHAT_PREFS_MAX_BYTES).toBe(64 * 1024);
    expect(chatPrefsBytes({})).toBe(2);
    expect(chatPrefsBytes({ notifications: { note: "ب" } })).toBeGreaterThan(chatPrefsBytes({ notifications: { note: "b" } }));
    const big = { chat: { blob: "x".repeat(CHAT_PREFS_MAX_BYTES) } };
    expect(chatPrefsBytes(big)).toBeGreaterThan(CHAT_PREFS_MAX_BYTES);
  });
});

describe("reading what is stored forgives, writing is strict", () => {
  it("a stored value that is not an object reads as no prefs", () => {
    for (const junk of [null, undefined, "x", 5, [], true]) expect(readChatPrefs(junk)).toEqual({});
  });

  it("a damaged folder is dropped and the good ones, the other companies and the other sections stay", () => {
    const stored = {
      folders: { orgA: [{ id: "ok", name: "سليم" }, { id: "bad", name: "ا".repeat(40) }, "junk"], orgB: "nope", orgC: [{ id: "c", name: "ج" }] },
      voiceSpeed: 2,
      unknownFromTheFuture: true,
      notifications: [],
    };
    const read = readChatPrefs(stored);
    expect(read.folders?.["orgA"]?.map((f) => f.id)).toEqual(["ok"]);
    expect(read.folders?.["orgB"]).toBeUndefined();
    expect(read.folders?.["orgC"]?.map((f) => f.id)).toEqual(["c"]);
    expect(read.voiceSpeed).toBe(2);
    expect("unknownFromTheFuture" in read).toBe(false);
    expect("notifications" in read).toBe(false);
  });

  it("an 11th folder in the stored value is cut, not an error", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, name: `م${i}` }));
    expect(readChatPrefs({ folders: { orgA: eleven } }).folders?.["orgA"]).toHaveLength(10);
  });

  it("foldersOfOrg answers the company's list, or none", () => {
    const prefs = readChatPrefs({ folders: { orgA: [{ id: "a", name: "أ" }] } });
    expect(foldersOfOrg(prefs, "orgA").map((f) => f.id)).toEqual(["a"]);
    expect(foldersOfOrg(prefs, "orgB")).toEqual([]);
    expect(foldersOfOrg({}, "orgA")).toEqual([]);
  });
});

describe("a save is a patch: the sections not named stay, null puts one back to its default", () => {
  const start = readChatPrefs({ folders: { orgA: [{ id: "a", name: "أ" }], orgB: [{ id: "b", name: "ب" }] }, voiceSpeed: 2, chat: { fontSize: 3 } });
  const patch = (value: unknown) => chatPrefsPatchSchema.parse(value);

  it("a section named is replaced whole, the others stay", () => {
    const next = mergeChatPrefs(start, patch({ voiceSpeed: 1.5 }));
    expect(next.voiceSpeed).toBe(1.5);
    expect(next.chat).toEqual({ fontSize: 3 });
    expect(next.folders).toEqual(start.folders);
    expect(mergeChatPrefs(start, patch({ chat: { fontSize: 5 } })).chat).toEqual({ fontSize: 5 });
  });

  it("null removes a section (back to its default)", () => {
    const next = mergeChatPrefs(start, patch({ voiceSpeed: null, chat: null }));
    expect("voiceSpeed" in next).toBe(false);
    expect("chat" in next).toBe(false);
    expect(resolveChatPrefs(next).voiceSpeed).toBe(1);
  });

  it("folders merge per company: one company's list is replaced, the other is untouched", () => {
    const next = mergeChatPrefs(start, patch({ folders: { orgA: [{ id: "a2", name: "جديد" }] } }));
    expect(next.folders?.["orgA"]?.map((f) => f.id)).toEqual(["a2"]);
    expect(next.folders?.["orgB"]?.map((f) => f.id)).toEqual(["b"]);
    const gone = mergeChatPrefs(start, patch({ folders: { orgA: null } }));
    expect(gone.folders?.["orgA"]).toBeUndefined();
    expect(gone.folders?.["orgB"]).toBeDefined();
    const none = mergeChatPrefs(gone, patch({ folders: { orgB: null } }));
    expect("folders" in none).toBe(false);
  });

  it("an empty list for a company is the same as null: the company's entry goes, so what is answered never differs from what is read back", () => {
    const next = mergeChatPrefs(start, patch({ folders: { orgA: [] } }));
    expect(next.folders?.["orgA"]).toBeUndefined();
    expect(next.folders?.["orgB"]).toBeDefined();
    expect("folders" in mergeChatPrefs(next, patch({ folders: { orgB: [] } }))).toBe(false);
    expect(readChatPrefs(next)).toEqual(next);
  });

  it("an empty patch changes nothing, and the patch keeps the schema's limits", () => {
    expect(mergeChatPrefs(start, patch({}))).toEqual(start);
    expect(chatPrefsPatchSchema.safeParse({ folders: { orgA: [{ id: "a", name: "ا".repeat(13) }] } }).success).toBe(false);
    expect(chatPrefsPatchSchema.safeParse({ userId: "x" }).success).toBe(false);
  });
});

describe("what a folder holds", () => {
  const rows: ChatRowDto[] = [
    row("dm1", { title: "أحمد", unread: 2 }),
    row("dm2", { title: "سارة" }),
    row("grp", { kind: "GROUP", title: "فريق", muted: true, unread: 1 }),
    row("space1", { kind: "SPACE", title: "مبيعات", space: { id: "s1", name: "مبيعات" }, mentionsUnread: 1, unread: 2 }),
    row("topic1", { kind: "TOPIC", title: "الطلبات", space: { id: "s1", name: "مبيعات" } }),
    row("space2", { kind: "SPACE", title: "تصنيع", space: { id: "s2", name: "تصنيع" } }),
    row("old", { title: "قديمة", archivedByMe: true, unread: 3 }),
    row("chipped", { title: "زبون", space: { id: "s2", name: "تصنيع" } }),
  ];
  const holds = (f: ChatFolderDef) => ids(rows.filter((r) => folderIncludes(r, f)));
  const inc = (over: Partial<ChatFolderDef["include"]>) => folder({ id: "f", include: { conversationIds: [], spaceIds: [], ...over } });

  it("a folder that includes nothing shows nothing", () => {
    expect(holds(folder({ id: "f" }))).toEqual([]);
    expect(holds(folder({ id: "f", exclude: { muted: true } }))).toEqual([]);
  });

  it("«خاص»: private chats and groups; «المساحات»: spaces and their topics; «ذكروني»: a mention waiting", () => {
    expect(holds(inc({ dms: true }))).toEqual(["dm1", "dm2", "grp", "old", "chipped"]);
    expect(holds(inc({ spaces: true }))).toEqual(["space1", "topic1", "space2"]);
    expect(holds(inc({ mentions: true }))).toEqual(["space1"]);
  });

  it("chats picked by hand, and whole spaces (the space's row, its topics and the chats that carry its chip)", () => {
    expect(holds(inc({ conversationIds: ["dm2", "topic1"] }))).toEqual(["dm2", "topic1"]);
    expect(holds(inc({ spaceIds: ["s1"] }))).toEqual(["space1", "topic1"]);
    expect(holds(inc({ spaceIds: ["s2"] }))).toEqual(["space2", "chipped"]);
  });

  it("the rules add up: a row in any of them is in", () => {
    expect(holds(inc({ mentions: true, conversationIds: ["dm2"], spaceIds: ["s2"] }))).toEqual(["dm2", "space1", "space2", "chipped"]);
  });

  it("the exclusions take out of everything the folder holds, chats picked by hand too", () => {
    const base = { dms: true, conversationIds: ["grp", "old"] };
    expect(holds(folder({ id: "f", include: { ...base, conversationIds: base.conversationIds, spaceIds: [] }, exclude: { muted: true } }))).toEqual(["dm1", "dm2", "old", "chipped"]);
    expect(holds(folder({ id: "f", include: { ...base, conversationIds: base.conversationIds, spaceIds: [] }, exclude: { read: true } }))).toEqual(["dm1", "grp", "old"]);
    expect(holds(folder({ id: "f", include: { ...base, conversationIds: base.conversationIds, spaceIds: [] }, exclude: { archived: true } }))).toEqual(["dm1", "dm2", "grp", "chipped"]);
  });

  it("a chat the person archived is in a folder unless the folder says no (the built-in tabs never show it)", () => {
    expect(holds(inc({ conversationIds: ["old"] }))).toEqual(["old"]);
    expect(holds(folder({ id: "f", include: { conversationIds: ["old"], spaceIds: [] }, exclude: { archived: true } }))).toEqual([]);
  });

  it("a marked-unread row counts as unread (it is not «read»)", () => {
    const marked = row("m", { markedUnread: true });
    expect(folderIncludes(marked, folder({ id: "f", include: { conversationIds: ["m"], spaceIds: [] }, exclude: { read: true } }))).toBe(true);
  });

  it("a folder listing a chat the person can no longer read shows nothing for it: the list cache never holds it, and nothing is named", () => {
    const f = inc({ conversationIds: ["gone-1", "gone-2", "dm1"], spaceIds: ["gone-space"] });
    const out = folderRows(rows, f, shape);
    expect(ids(out)).toEqual(["dm1"]);
    // every row that comes out is one of the rows that went in (the filter makes no row of its own)
    for (const r of out) expect(rows).toContain(r);
    expect(folderRows([], f, shape)).toEqual([]);
  });

  it("rows come out in the list's order, with the search applied, and the input is not changed", () => {
    const copy = JSON.stringify(rows);
    const f = inc({ dms: true });
    expect(ids(folderRows(rows, f, shape))).toEqual(["dm1", "dm2", "grp", "old", "chipped"]);
    expect(ids(folderRows(rows, f, shape, { query: "احمد" }))).toEqual(["dm1"]);
    expect(JSON.stringify(rows)).toBe(copy);
  });

  it("the person's own pin floats a chat to the top of the folder, as in the list", () => {
    const pinned = [row("a"), row("b", { pinnedByMe: true })];
    expect(ids(folderRows(pinned, inc({ dms: true }), shape))).toEqual(["b", "a"]);
  });

  it("the number on the tab counts the chats with something waiting, muted ones too, archived ones never", () => {
    expect(folderBadge(rows, inc({ dms: true }))).toBe(2);
    expect(folderBadge(rows, inc({ dms: true, spaces: true }))).toBe(3);
    expect(folderBadge(rows, folder({ id: "f" }))).toBe(0);
    expect(folderBadge(rows, inc({ conversationIds: ["old"] }))).toBe(0);
  });

  it("lists the spaces the rows belong to once each, for the editor's picker", () => {
    expect(spacesOfRows(rows)).toEqual([
      { id: "s1", name: "مبيعات" },
      { id: "s2", name: "تصنيع" },
    ]);
  });
});

describe("the tabs the person is offered", () => {
  const keys = (tabs: { key: string }[]) => tabs.map((t) => t.key);
  const mine = [folder({ id: "a", name: "عمل", emoji: "💼" }), folder({ id: "b", name: "بيت" })];

  it("by default: the five built-in tabs, in order, and no custom ones", () => {
    expect(keys(tabsOf({ canOversee: false }))).toEqual(["all", "unread", "dm", "spaces", "mentions"]);
  });

  it("the custom folders come after the built-in tabs in the order of their list, then the archive, then «كل الشركة»", () => {
    expect(keys(tabsOf({ canOversee: true, archived: true, folders: mine }))).toEqual(["all", "unread", "dm", "spaces", "mentions", "f:a", "f:b", "archived", "company"]);
  });

  it("the custom tab carries its own name and emoji, the built-in ones a dictionary key", () => {
    const tabs = tabsOf({ canOversee: false, folders: mine });
    const custom = tabs.find((t) => t.key === "f:a")!;
    expect(custom.label).toBe("عمل");
    expect(custom.emoji).toBe("💼");
    expect(custom.labelKey).toBeUndefined();
    expect(tabs[0]!.labelKey).toBe("chatui.folder.all");
    expect(tabs[0]!.label).toBeUndefined();
  });

  it("the person may hide a built-in tab; nothing is deleted, and a hidden tab is not offered", () => {
    expect(keys(tabsOf({ canOversee: false, hidden: ["unread", "mentions"] }))).toEqual(["all", "dm", "spaces"]);
  });

  it("everything hidden and nothing of their own: «الكل» stays, so the strip is never empty", () => {
    expect(keys(tabsOf({ canOversee: false, hidden: ["all", "unread", "dm", "spaces", "mentions"] }))).toEqual(["all"]);
    expect(keys(tabsOf({ canOversee: false, hidden: ["all", "unread", "dm", "spaces", "mentions"], folders: mine }))).toEqual(["f:a", "f:b"]);
  });

  it("a guest has no private chats: «خاص» is not offered", () => {
    expect(keys(tabsOf({ canOversee: false, guest: true }))).toEqual(["all", "unread", "spaces", "mentions"]);
  });

  it("a remembered tab that is gone (deleted folder, hidden tab) falls back to the first", () => {
    const tabs = tabsOf({ canOversee: false, folders: mine, hidden: ["all"] });
    expect(tabKeyOf("f:a", tabs)).toBe("f:a");
    expect(tabKeyOf("f:zzz", tabs)).toBe("unread");
    expect(tabKeyOf("all", tabs)).toBe("unread");
    expect(tabKeyOf(undefined, tabs)).toBe("unread");
    expect(tabKeyOf("x", [])).toBe("all");
  });

  it("a folder key is the folder's id behind a prefix, both ways", () => {
    expect(customTabKey("a")).toBe("f:a");
    expect(customIdOf("f:a")).toBe("a");
    expect(customIdOf("all")).toBeNull();
    expect(customIdOf("f:")).toBeNull();
  });
});

describe("editing the folders (the editor's moves)", () => {
  const blank = (id: string) => addFolder([], { id, name: id });

  it("adds a folder with the defaults a person wants: nothing in it yet, the archive out", () => {
    const [made] = addFolder([], { id: "f1", name: "عمل" });
    expect(made).toEqual({ id: "f1", name: "عمل", include: { conversationIds: [], spaceIds: [] }, exclude: { archived: true } });
    expect(chatFolderSchema.safeParse(made).success).toBe(true);
  });

  it("refuses an 11th folder by returning the list as it was; trims and cuts the name to 12", () => {
    let list: ChatFolderDef[] = [];
    for (let i = 0; i < 10; i++) list = addFolder(list, { id: `f${i}`, name: `م${i}` });
    expect(list).toHaveLength(10);
    expect(addFolder(list, { id: "f10", name: "زيادة" })).toBe(list);
    const [long] = addFolder([], { id: "x", name: `   ${"ا".repeat(20)}   ` });
    expect([...long!.name]).toHaveLength(12);
    expect(addFolder([], { id: "x", name: "   " })).toEqual([]);
  });

  it("a second folder with the same id is not added", () => {
    const list = blank("a");
    expect(addFolder(list, { id: "a", name: "تاني" })).toBe(list);
  });

  it("renames (trimmed, cut at 12; an empty name changes nothing) and sets or clears the emoji", () => {
    const list = blank("a");
    expect(renameFolder(list, "a", "  جديد ")[0]!.name).toBe("جديد");
    expect([...renameFolder(list, "a", "ب".repeat(30))[0]!.name]).toHaveLength(12);
    expect(renameFolder(list, "a", "   ")).toBe(list);
    expect(renameFolder(list, "nope", "x")).toBe(list);
    const withEmoji = updateFolder(list, "a", { emoji: "📦" });
    expect(withEmoji[0]!.emoji).toBe("📦");
    const cleared = updateFolder(withEmoji, "a", { emoji: undefined });
    expect("emoji" in cleared[0]!).toBe(false);
  });

  it("puts the folders in the order a drag hands over; an unknown id is ignored and a folder not named keeps its place after the named ones", () => {
    let list: ChatFolderDef[] = [];
    for (const id of ["a", "b", "c"]) list = addFolder(list, { id, name: id });
    expect(reorderFolders(list, ["c", "a", "b"]).map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(reorderFolders(list, ["b", "ghost", "b"]).map((f) => f.id)).toEqual(["b", "a", "c"]);
    expect(reorderFolders(list, ["c"]).map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(reorderFolders(list, []).map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(reorderFolders(list, ["a", "b", "c"])).toBe(list);
    // the folders themselves are the same objects, only their places change
    expect(reorderFolders(list, ["c", "b", "a"])[0]).toBe(list[2]);
  });

  it("removes a folder", () => {
    let list: ChatFolderDef[] = [];
    for (const id of ["a", "b"]) list = addFolder(list, { id, name: id });
    expect(removeFolder(list, "a").map((f) => f.id)).toEqual(["b"]);
    expect(removeFolder(list, "nope")).toBe(list);
  });

  it("ticks and unticks a chat or a space, within 100 chats and 50 spaces", () => {
    let list = blank("a");
    list = toggleChat(list, "a", "c1");
    list = toggleChat(list, "a", "c2");
    expect(list[0]!.include.conversationIds).toEqual(["c1", "c2"]);
    list = toggleChat(list, "a", "c1");
    expect(list[0]!.include.conversationIds).toEqual(["c2"]);
    list = toggleSpace(list, "a", "s1");
    expect(list[0]!.include.spaceIds).toEqual(["s1"]);

    let full = blank("a");
    for (let i = 0; i < 100; i++) full = toggleChat(full, "a", `c${i}`);
    expect(full[0]!.include.conversationIds).toHaveLength(100);
    expect(toggleChat(full, "a", "c100")).toBe(full);
    expect(toggleChat(full, "a", "c5")[0]!.include.conversationIds).toHaveLength(99);
    let wide = blank("a");
    for (let i = 0; i < 50; i++) wide = toggleSpace(wide, "a", `s${i}`);
    expect(toggleSpace(wide, "a", "s50")).toBe(wide);
  });

  it("every move leaves a list the schema accepts", () => {
    let list: ChatFolderDef[] = [];
    for (const id of ["a", "b", "c"]) list = addFolder(list, { id, name: id });
    list = toggleChat(list, "b", "x1");
    list = reorderFolders(list, ["c", "a", "b"]);
    list = updateFolder(list, "a", { include: { ...list[2]!.include, dms: true } });
    expect(chatPrefsSchema.safeParse({ folders: { org: list } }).success).toBe(true);
  });

  it("makes ids that are valid and not taken", () => {
    const taken = new Set(["f-aaaa"]);
    const made = newFolderId(taken, () => 0.5);
    expect(made).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(taken.has(made)).toBe(false);
    const a = newFolderId(new Set());
    const b = newFolderId(new Set());
    expect(a).not.toBe(b);
  });
});

describe("saving from the screen: shown at once, sent one after another, taken back when refused", () => {
  const dto = (prefs: ChatPrefsDto["prefs"]): ChatPrefsDto => ({ prefs, orgId: "org1", foldersOn: true });
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const sent: { body: unknown; done: (res: Response) => void }[] = [];
  const stub = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => sent.push({ body: JSON.parse(String(init.body)), done: resolve }))),
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    sent.length = 0;
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const cached = (qc: QueryClient) => qc.getQueryData<ChatPrefsDto>(CHAT_PREFS_KEY);
  const f1: ChatFolderDef = { id: "f1", name: "عمل", include: { conversationIds: [], spaceIds: [] }, exclude: {} };

  it("the change is in the cache before the server has answered, and the server's answer then replaces it", async () => {
    stub();
    const qc = new QueryClient();
    qc.setQueryData(CHAT_PREFS_KEY, dto({ voiceSpeed: 2 }));
    const saving = saveChatPrefs(qc, { folders: { org1: [f1] } });
    expect(cached(qc)?.prefs).toEqual({ voiceSpeed: 2, folders: { org1: [f1] } });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ folders: { org1: [f1] } });
    sent[0]!.done(ok(dto({ voiceSpeed: 2, folders: { org1: [f1] } })));
    expect((await saving).prefs.folders?.["org1"]).toHaveLength(1);
    expect(cached(qc)?.prefs).toEqual({ voiceSpeed: 2, folders: { org1: [f1] } });
  });

  it("two quick saves go out one after the other, and an older answer never overwrites a newer change", async () => {
    stub();
    const qc = new QueryClient();
    qc.setQueryData(CHAT_PREFS_KEY, dto({}));
    const first = saveChatPrefs(qc, { folders: { org1: [f1] } });
    const second = saveChatPrefs(qc, { tabs: { hidden: ["unread"] } });
    // both show at once
    expect(cached(qc)?.prefs).toEqual({ folders: { org1: [f1] }, tabs: { hidden: ["unread"] } });
    await settle();
    expect(sent).toHaveLength(1);
    sent[0]!.done(ok(dto({ folders: { org1: [f1] } })));
    await first;
    // the first answer does not know the second change yet: the screen keeps it
    expect(cached(qc)?.prefs.tabs).toEqual({ hidden: ["unread"] });
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toEqual({ tabs: { hidden: ["unread"] } });
    sent[1]!.done(ok(dto({ folders: { org1: [f1] }, tabs: { hidden: ["unread"] } })));
    await second;
    expect(cached(qc)?.prefs).toEqual({ folders: { org1: [f1] }, tabs: { hidden: ["unread"] } });
  });

  it("a save the server refused throws, and the screen goes back to what the server holds (the cache is marked to be read again)", async () => {
    stub();
    const qc = new QueryClient();
    qc.setQueryData(CHAT_PREFS_KEY, dto({ voiceSpeed: 2 }));
    const saving = saveChatPrefs(qc, { voiceSpeed: 1.5 });
    expect(cached(qc)?.prefs.voiceSpeed).toBe(1.5);
    await settle();
    sent[0]!.done(new Response(JSON.stringify({ error: "validation.failed" }), { status: 422 }));
    await expect(saving).rejects.toMatchObject({ status: 422 });
    expect(qc.getQueryState(CHAT_PREFS_KEY)?.isInvalidated).toBe(true);
  });

  it("a refused save does not stop the one behind it", async () => {
    stub();
    const qc = new QueryClient();
    qc.setQueryData(CHAT_PREFS_KEY, dto({}));
    const first = saveChatPrefs(qc, { voiceSpeed: 2 });
    const second = saveChatPrefs(qc, { voiceSpeed: 1.5 });
    await settle();
    sent[0]!.done(new Response("{}", { status: 500 }));
    await expect(first).rejects.toBeTruthy();
    await settle();
    expect(sent).toHaveLength(2);
    sent[1]!.done(ok(dto({ voiceSpeed: 1.5 })));
    expect((await second).prefs.voiceSpeed).toBe(1.5);
  });
});
