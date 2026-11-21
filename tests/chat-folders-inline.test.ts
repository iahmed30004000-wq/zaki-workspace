import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { FolderRail, FolderTabs } from "@/components/chat/v2/list/folder-tabs";
import { FolderEditor } from "@/components/chat/v2/list/folder-editor";
import { FolderSheet, saveFolderDraft } from "@/components/chat/v2/list/folder-sheet";
import {
  folderMenuOffers,
  foldersHolding,
  pickableChats,
  setChatInFolder,
  tabsOf,
  upsertFolder,
  withPickedTopics,
  folderRows,
  addFolder,
} from "@/lib/chat/folders";
import { MAX_FOLDER_CHATS, MAX_FOLDERS, type ChatFolderDef } from "@/lib/chat/prefs";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { classTokens, render, textOf } from "./ui-render";

/**
 * S5.3 — folders from INSIDE the chat: «+» at the end of the strip, one small sheet (name, emoji, pick chats with a search, ONE «حفظ» = ONE save), a
 * long press / right click on a tab, «أضف لمجلد» in a row's menu, and ONE TOPIC of the current space pickable (its id is kept in
 * `include.conversationIds`). The moves are pure; the screens are drawn on the server here (no browser); what the server lets a person read is the list's
 * business: a folder only keeps or drops rows it is handed.
 */
const read = (path: string) => readFileSync(path, "utf8");
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
const topic = (id: string, title: string, over: Partial<ChatRowDto> = {}) => row(id, { kind: "TOPIC", title, space: { id: "s1", name: "مبيعات" }, ...over });
const ids = (rows: readonly ChatRowDto[]) => rows.map((r) => r.id);
const folder = (id: string, over: Partial<ChatFolderDef> = {}): ChatFolderDef => ({ id, name: `م${id}`, include: { conversationIds: [], spaceIds: [] }, exclude: {}, ...over });

describe("ONE topic of the current space can be picked (the picker and the folder view)", () => {
  const dms = [row("dm1", { title: "أحمد" }), row("space1", { kind: "SPACE", title: "مبيعات", space: { id: "s1", name: "مبيعات" } })];
  const topics = [topic("t1", "الطلبات"), topic("t2", "الشحن")];

  it("the picker offers the private chats and the topics, never a space's own row; a topic the list already holds is not doubled", () => {
    expect(ids(pickableChats(dms, topics))).toEqual(["dm1", "t1", "t2"]);
    expect(ids(pickableChats([...dms, topic("t1", "الطلبات")], topics))).toEqual(["dm1", "t1", "t2"]);
    expect(ids(pickableChats(dms, []))).toEqual(["dm1"]);
  });

  it("only TOPIC rows come from the space's own view; any other kind in it is ignored", () => {
    expect(ids(pickableChats([], [row("x", { kind: "DM" }), topic("t1", "الطلبات")]))).toEqual(["t1"]);
  });

  it("a topic id is kept in include.conversationIds like any chat", () => {
    const list = addFolder([], { id: "a", name: "طلبات" });
    const next = setChatInFolder(list, "a", "t1", true);
    expect(next[0]!.include.conversationIds).toEqual(["t1"]);
    expect(setChatInFolder(next, "a", "t1", false)[0]!.include.conversationIds).toEqual([]);
  });

  it("the folder view adds a picked topic of the current space to the list's rows (the one-list shape holds none), and ONLY the picked ones", () => {
    const f = folder("a", { include: { conversationIds: ["t1"], spaceIds: [] } });
    const rows = withPickedTopics(dms, topics, [f]);
    expect(ids(rows)).toEqual(["dm1", "space1", "t1"]);
    expect(ids(folderRows(rows, f, { scope: "all", spaceId: null }))).toEqual(["t1"]);
  });

  it("a topic the person can no longer read is simply not among the rows handed in: the folder shows nothing for it and names nothing", () => {
    const f = folder("a", { include: { conversationIds: ["t1", "t-private"], spaceIds: [] } });
    const rows = withPickedTopics(dms, topics, [f]);
    expect(ids(folderRows(rows, f, { scope: "all", spaceId: null }))).toEqual(["t1"]);
    expect(JSON.stringify(rows)).not.toContain("t-private");
  });

  it("a row the list already holds is never replaced by the space's copy", () => {
    const mine = topic("t1", "الطلبات", { unread: 3 });
    const rows = withPickedTopics([mine], [topic("t1", "الطلبات", { unread: 0 })], [folder("a", { include: { conversationIds: ["t1"], spaceIds: [] } })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unread).toBe(3);
  });

  it("nothing is added when no folder lists a topic", () => {
    expect(withPickedTopics(dms, topics, [folder("a")])).toBe(dms);
  });
});

describe("upsertFolder: the one save of the sheet", () => {
  it("adds a new folder at the end, trims and cuts the name to 12", () => {
    const next = upsertFolder([folder("a")], { ...folder("b"), name: "  اسم طويل جدا جدا جدا  " });

    expect(next.map((f) => f.id)).toEqual(["a", "b"]);
    expect([...next[1]!.name]).toHaveLength(12);
    expect(next[1]!.name).toBe(next[1]!.name.trim());
  });

  it("replaces an existing folder in place (an edit keeps the folder's place and its other rules)", () => {
    const old = folder("a", { include: { dms: true, conversationIds: ["x"], spaceIds: ["s9"] }, exclude: { muted: true } });
    const next = upsertFolder([old, folder("b")], { ...old, name: "جديد", emoji: "🔥", include: { ...old.include, conversationIds: ["x", "t1"] } });
    expect(next.map((f) => f.id)).toEqual(["a", "b"]);
    expect(next[0]).toMatchObject({ name: "جديد", emoji: "🔥", include: { dms: true, conversationIds: ["x", "t1"], spaceIds: ["s9"] }, exclude: { muted: true } });
  });

  it("an empty name changes nothing; the eleventh folder is refused", () => {
    const list = [folder("a")];
    expect(upsertFolder(list, { ...folder("b"), name: "   " })).toBe(list);
    let ten: ChatFolderDef[] = [];
    for (let i = 0; i < MAX_FOLDERS; i++) ten = addFolder(ten, { id: `f${i}`, name: `م${i}` });
    expect(upsertFolder(ten, folder("extra"))).toBe(ten);
    // editing one of the ten is still allowed
    expect(upsertFolder(ten, { ...ten[0]!, name: "غيرت" })[0]!.name).toBe("غيرت");
  });

  it("dedupes the picks and keeps the schema's limit of 100", () => {
    const many = Array.from({ length: MAX_FOLDER_CHATS + 5 }, (_, i) => `c${i}`);
    const next = upsertFolder([], { ...folder("a"), include: { conversationIds: [...many, "c0"], spaceIds: [] } });
    expect(next[0]!.include.conversationIds).toHaveLength(MAX_FOLDER_CHATS);
  });
});

describe("saving from the sheet is ONE write", () => {
  it("a new folder with three picks sends exactly one patch with the whole list of the company", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const draft: ChatFolderDef = { ...folder("n"), name: "طلبات", emoji: "📦", include: { conversationIds: ["dm1", "t1", "t2"], spaceIds: [] }, exclude: { archived: true } };
    const ok = await saveFolderDraft({ save, orgId: "org1", list: [folder("a")], draft });
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    const patch = (save.mock.calls[0] as unknown as [{ folders: Record<string, ChatFolderDef[]> }])[0];
    expect(Object.keys(patch.folders)).toEqual(["org1"]);
    expect(patch.folders["org1"]!.map((f) => f.id)).toEqual(["a", "n"]);
    expect(patch.folders["org1"]![1]!.include.conversationIds).toEqual(["dm1", "t1", "t2"]);
  });

  it("an empty name or a full company sends nothing and says no", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    expect(await saveFolderDraft({ save, orgId: "org1", list: [], draft: { ...folder("n"), name: " " } })).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("a write the server refused is reported, not thrown", async () => {
    const save = vi.fn(() => Promise.reject(new Error("422")));
    expect(await saveFolderDraft({ save, orgId: "org1", list: [], draft: folder("n") })).toBe(false);
  });
});

describe("the tab strip: «+» at the END", () => {
  const folders = tabsOf({ canOversee: false, folders: [folder("a", { name: "عمل", emoji: "💼" }), folder("b", { name: "بيت" })] });

  it("draws one «+» button after the last tab; it is a button, not a tab, and has a name", () => {
    const html = render(createElement(FolderTabs, { folders, active: "all", badges: {}, onChange: () => {}, onAdd: () => {} }));
    expect(html.match(/data-folder-add-tab=""/g)).toHaveLength(1);
    expect(html.match(/role="tab"/g)).toHaveLength(7);
    expect(html.lastIndexOf("data-folder-add-tab")).toBeGreaterThan(html.lastIndexOf('data-folder="f:b"'));
    expect(/<button[^>]*data-folder-add-tab[^>]*>/.exec(html)?.[0]).toContain('aria-label="مجلد جديد"');
  });

  it("without onAdd (the switch is off, or the prefs have not come) the strip is the one it was", () => {
    const html = render(createElement(FolderTabs, { folders, active: "all", badges: {}, onChange: () => {} }));
    expect(html).not.toContain("data-folder-add-tab");
    expect(html.match(/<button/g)).toHaveLength(7);
  });

  it("the «+» is off at ten folders (and says why)", () => {
    const html = render(createElement(FolderTabs, { folders, active: "all", badges: {}, onChange: () => {}, onAdd: () => {}, addDisabled: true }));
    expect(/<button[^>]*data-folder-add-tab[^>]*>/.exec(html)?.[0]).toMatch(/ disabled=""/);
  });

  it("the desktop's column has it too, at the end", () => {
    const html = render(createElement(FolderRail, { folders, active: "all", badges: {}, onChange: () => {}, onAdd: () => {} }));
    expect(html.match(/data-folder-add-tab=""/g)).toHaveLength(1);
    expect(html.lastIndexOf("data-folder-add-tab")).toBeGreaterThan(html.lastIndexOf('data-folder="f:b"'));
  });

  it("a long press (touch) and a right click (computer) on one of the person's own tabs ask to manage it; the built-in tabs have none", () => {
    const src = read("src/components/chat/v2/list/folder-tabs.tsx");
    expect(src).toContain("onManage");
    expect(src).toContain("useRowMenuGestures");
    // the gestures are only wired for a custom tab
    expect(src).toMatch(/useRowMenuGestures\([^)]*custom/);
  });
});

describe("the sheet: name, emoji, the chats in ONE screen with a search, ONE «حفظ»", () => {
  const chats = [row("dm1", { title: "أحمد" }), row("dm2", { title: "سارة" }), topic("t1", "الطلبات"), topic("t2", "الشحن")];
  const sheet = (props: Record<string, unknown> = {}) =>
    render(createElement(FolderSheet, { open: true, onOpenChange: () => {}, folder: null, list: [], chats, chatsLoaded: true, onSave: () => Promise.resolve(true), portal: false, ...props } as never));

  it("a new folder: a name box (12), the emoji choices, a search box, every chat as a tick, and exactly one «حفظ» that is off until there is a name", () => {
    const html = sheet();
    expect(html).toContain("data-folder-sheet");
    expect(textOf(html)).toContain("مجلد جديد");
    expect(/<input[^>]*data-folder-name[^>]*>/.exec(html)?.[0]).toMatch(/maxlength="12"/i);
    expect(html).toContain('type="search"');
    expect(html.match(/data-chat-pick="/g)).toHaveLength(4);
    expect(html.match(/data-folder-save=""/g)).toHaveLength(1);
    expect(/<button[^>]*data-folder-save[^>]*>/.exec(html)?.[0]).toMatch(/ disabled=""/);
    expect(textOf(html)).toContain("حفظ");
  });

  it("the topics of the current space are in the picker with their space's name; a topic can be ticked", () => {
    const html = sheet({ initialChatIds: ["t1"] });
    expect(/<input[^>]*data-chat-pick="t1"[^>]*>/.exec(html)?.[0]).toContain("checked");
    expect(/<input[^>]*data-chat-pick="t2"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(textOf(html)).toContain("الطلبات");
    expect(textOf(html)).toContain("مبيعات");
  });

  it("editing: the folder's own name and picks are there and «حفظ» is on", () => {
    const f = folder("a", { name: "عمل", emoji: "💼", include: { conversationIds: ["dm2", "t2"], spaceIds: [] } });
    const html = sheet({ folder: f, list: [f] });
    expect(/<input[^>]*data-folder-name[^>]*>/.exec(html)?.[0]).toContain('value="عمل"');
    expect(/<input[^>]*data-chat-pick="dm2"[^>]*>/.exec(html)?.[0]).toContain("checked");
    expect(/<button[^>]*data-folder-save[^>]*>/.exec(html)?.[0]).not.toMatch(/ disabled=""/);
    expect(textOf(html)).toContain("تعديل المجلد");
  });

  it("closed, nothing is drawn", () => {
    expect(sheet({ open: false })).not.toContain("data-folder-sheet");
  });

  it("uses theme tokens and logical sides only (no hex, no white/black, no left/right, no text-[10px])", () => {
    const html = sheet();
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const token of classTokens(html)) expect(token, token).not.toMatch(/^(?:text-\[1[01](?:\.5)?px\]|bg-white|bg-black|text-white|(?:ml|mr|pl|pr|left|right)-\S+)$/);
  });
});

describe("ONE editor body for the sheet and the settings page", () => {
  const chats = [row("dm1", { title: "أحمد" }), topic("t1", "الطلبات")];
  it("both draw the same form (data-folder-form), with the same picker", () => {
    const sheetHtml = render(createElement(FolderSheet, { open: true, onOpenChange: () => {}, folder: null, list: [], chats, chatsLoaded: true, onSave: () => Promise.resolve(true), portal: false } as never));
    const f = folder("a");
    const pageHtml = render(createElement(FolderEditor, { folders: [f], onChange: () => {}, chats, initiallyOpen: "a" } as never));
    for (const html of [sheetHtml, pageHtml]) {
      expect(html).toContain("data-folder-form");
      expect(html).toContain('type="search"');
      expect(html.match(/data-chat-pick="/g)).toHaveLength(2);
    }
    // the sheet keeps the rules out of sight; the settings page shows them
    expect(sheetHtml).not.toContain('data-rule="dms"');
    expect(pageHtml).toContain('data-rule="dms"');
  });

  it("the settings page's «مجلد جديد» opens the sheet instead of creating a nameless «مجلد جديد» to retype", () => {
    const src = read("src/components/chat/v2/list/folder-editor.tsx");
    expect(src).toContain("FolderSheet");
    expect(src).not.toContain('ct("chatfld.default_name")');
  });

  it("the settings page keeps its export", () => {
    expect(read("src/components/chat/v2/list/folder-editor.tsx")).toMatch(/export function ChatFoldersSettings/);
    expect(read("src/app/(app)/settings/me/[section]/page.tsx")).toContain("ChatFoldersSettings");
  });
});

describe("«أضف لمجلد» in a chat's menu", () => {
  const f1 = folder("a", { name: "عمل", include: { conversationIds: ["dm1"], spaceIds: [] } });
  const f2 = folder("b", { name: "بيت" });

  it("one entry per folder, ticked where the chat already is, and «مجلد جديد» while there is room", () => {
    const offers = folderMenuOffers(row("dm1"), [f1, f2]);
    expect(offers).not.toBeNull();
    expect(offers!.items.map((i) => [i.id, i.has])).toEqual([["a", true], ["b", false]]);
    expect(offers!.canCreate).toBe(true);
  });

  it("a topic can be added too", () => {
    expect(folderMenuOffers(topic("t1", "الطلبات"), [f2])!.items).toHaveLength(1);
  });

  it("a space's own row has no such entry", () => {
    expect(folderMenuOffers(row("space1", { kind: "SPACE" }), [f1])).toBeNull();
  });

  it("a folder that holds 100 chats cannot take another; one that already holds it can still release it", () => {
    const full = folder("c", { include: { conversationIds: Array.from({ length: MAX_FOLDER_CHATS }, (_, i) => `c${i}`), spaceIds: [] } });
    const withMe = folder("d", { include: { conversationIds: [...full.include.conversationIds.slice(1), "dm1"], spaceIds: [] } });
    const items = folderMenuOffers(row("dm1"), [full, withMe])!.items;
    expect(items.map((i) => [i.id, i.has, i.full])).toEqual([["c", false, true], ["d", true, false]]);
  });

  it("no «مجلد جديد» at ten folders", () => {
    let ten: ChatFolderDef[] = [];
    for (let i = 0; i < MAX_FOLDERS; i++) ten = addFolder(ten, { id: `f${i}`, name: `م${i}` });
    expect(folderMenuOffers(row("dm1"), ten)!.canCreate).toBe(false);
  });

  it("which folders hold a chat", () => {
    expect(foldersHolding([f1, f2], "dm1")).toEqual(["a"]);
    expect(foldersHolding([f1, f2], "zzz")).toEqual([]);
  });

  it("setChatInFolder is a no-op for an unknown folder and for a full one", () => {
    const list = [f1];
    expect(setChatInFolder(list, "nope", "x", true)).toBe(list);
    const full = [folder("c", { include: { conversationIds: Array.from({ length: MAX_FOLDER_CHATS }, (_, i) => `c${i}`), spaceIds: [] } })];
    expect(setChatInFolder(full, "c", "new", true)).toBe(full);
  });

  it("the row menu wires it: the entry sits in the menu of a row, behind the company's switch (the prefs say foldersOn)", () => {
    const src = read("src/components/chat/v2/row-menu.tsx");
    expect(src).toContain("folderMenuOffers");
    expect(src).toContain("chatfolders.menu_label");
    expect(src).toContain("foldersOn");
  });
});

describe("the list column wires the inline folders (and keeps what the calls agent changed)", () => {
  const src = read("src/components/chat/v2/list/chat-list-column.tsx");
  it("the strip and the column get the add / manage props and the sheets are drawn once", () => {
    expect(src).toContain("useInlineFolders");
    expect(src).toMatch(/<FolderTabs[^>]*\.\.\.inline\.tabProps/);
    expect(src).toMatch(/<FolderRail[^>]*\.\.\.inline\.tabProps/);
    expect(src).toContain("inline.element");
  });
  it("a folder view reads the topics of the current space as well as the list", () => {
    expect(src).toContain("useFolderSourceRows");
  });
  it("is not restyled: the pencil still gets canMeet", () => {
    expect(src).toContain("<NewMessageFab onClick={() => setNewDm(true)} onGroup={openGroup} onTopic={openTopic} canMeet={canMeet} />");
  });
});

describe("the words", () => {
  it("every word is Arabic (no Latin word, no tanween on tatweel) and the keys live in ONE new file registered in the dictionary", () => {
    const file = JSON.parse(read("src/lib/i18n/ar.chat-folders.json")) as Record<string, string>;
    expect(Object.keys(file).length).toBeGreaterThan(10);
    for (const [key, text] of Object.entries(file)) {
      expect(AR[key], key).toBe(text);
      expect(text.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
      expect(text, key).not.toMatch(/ـ[ً-ِ]/);
    }
    for (const other of ["ar.chat-features.json", "ar.chat-ui.json", "ar.chat-conversation.json", "ar.chat-home.json", "ar.chat-forward.json"]) {
      const keys = Object.keys(JSON.parse(read(`src/lib/i18n/${other}`)) as Record<string, string>);
      expect(keys.filter((k) => k in file), other).toEqual([]);
    }
    expect(read("src/lib/i18n/dict.ts")).toContain('import chatFolders from "./ar.chat-folders.json"');
    expect(read("src/lib/i18n/dict.ts")).toContain("...chatFolders,");
  });

  it("every key the new components ask for exists", () => {
    const files = ["folder-sheet.tsx", "folder-form.tsx", "folder-inline.tsx", "folder-tabs.tsx", "use-folder-chats.ts"].map((f) => read(`src/components/chat/v2/list/${f}`));
    const used = new Set<string>();
    for (const src of [...files, read("src/components/chat/v2/row-menu.tsx")]) for (const m of src.matchAll(/["'`](chatfolders\.[a-z_.]+)["'`]/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(5);
    for (const key of used) expect(AR[key], key).toBeTypeOf("string");
  });
});
