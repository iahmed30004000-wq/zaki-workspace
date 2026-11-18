import { describe, expect, it } from "vitest";
import {
  applyMarksToData,
  compareMessages,
  dropFromList,
  headerAgreesWithRow,
  lastMessageOf,
  mergeMessage,
  mergeRowsIntoList,
  mergeRowsIntoSpace,
  messagesOfData,
  newestKnown,
  normalizeMessage,
  normalizePage,
  rowAfterMessage,
  rowAfterRead,
  spaceRowAfterMessage,
  spaceRowAfterRead,
  toTombstone,
  tombstoneInData,
} from "@/lib/chat/cache/reducers";
import { filterRows, summarizeUnread, unreadByFolder, unreadBySpace, unreadOfRow, unreadOfRows } from "@/lib/chat/cache/unread";
import { LATEST, type ChatListDto, type ChatRowDto, type MessageDto, type MessagesData, type MessagesPageDto, type SpaceTopicsDto } from "@/lib/chat/cache/types";

const at = (n: number) => `2026-11-16T10:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`;
const msg = (id: string, n: number, over: Partial<MessageDto> = {}): MessageDto => ({
  id,
  kind: "TEXT",
  body: `نص ${id}`,
  deleted: false,
  edited: false,
  pinned: false,
  mine: false,
  authorId: "u2",
  authorName: "سلمى",
  createdAt: at(n),
  clientId: null,
  mentions: [],
  attachments: [],
  reactions: [],
  ...over,
});
const page = (messages: MessageDto[], over: Partial<MessagesPageDto> = {}): MessagesPageDto => ({ messages, hasOlder: false, hasNewer: false, firstUnreadId: null, readers: [], ...over });
const data = (...pages: MessagesPageDto[]): MessagesData => ({ pages, pageParams: pages.map(() => LATEST) });
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
const last = (id: string, n: number, over: Partial<NonNullable<ChatRowDto["lastMessage"]>> = {}) => ({ id, authorName: "سلمى", preview: `نص ${id}`, kind: "TEXT" as const, at: at(n), mine: false, ...over });

describe("a tombstone has no text", () => {
  it("strips the body, the files, the reactions and everything else a deleted message could still say", () => {
    const m = msg("m1", 1, {
      deleted: true,
      body: "نص سري",
      attachments: [{ id: "a", kind: "IMAGE", name: "x.png", mime: "image/png", size: 1, url: "/f" }],
      reactions: [{ emoji: "👍", count: 1, mine: false }],
      original: { body: "الأصل", deletedBy: "س", deletedAt: at(2) },
      history: [{ body: "قديم", editedAt: at(1) }],
      notes: [{ id: "n", authorId: "u", authorName: "م", body: "ملاحظة", createdAt: at(1) }],
      replyTo: { id: "p", preview: "اقتباس", authorName: "ع" },
    });
    const t = toTombstone(m);
    expect(t).toMatchObject({ id: "m1", deleted: true, body: null, attachments: [], reactions: [] });
    expect(JSON.stringify(t)).not.toMatch(/نص سري|الأصل|قديم|ملاحظة|اقتباس|x\.png/);
    // who and when stay: the place of the message in the conversation
    expect(t).toMatchObject({ authorId: "u2", createdAt: at(1) });
  });

  it("a deleted message is stripped of EVERYTHING a tombstone does not keep, not only its text (a card, a forward, the people who must read it, its work chips, its mentions)", () => {
    const m = msg("m1", 1, {
      deleted: true,
      body: null,
      forwardedFrom: { name: "من محادثة سرية" },
      card: { type: "order", number: "1234" },
      mustRead: { mine: true, acked: false, missing: [{ id: "u9", name: "اسم شخص" }] },
      work: [{ kind: "task", id: "t1" }],
      mentions: ["u7"],
      videoAtSec: 12,
      edited: true,
    });
    const n = normalizeMessage(m);
    expect(n).not.toBe(m);
    expect(JSON.stringify(n)).not.toMatch(/من محادثة سرية|1234|اسم شخص|u7|"t1"/);
    expect(n).toMatchObject({ deleted: true, body: null, mentions: [], edited: false });
    expect("forwardedFrom" in n || "card" in n || "mustRead" in n || "work" in n || "videoAtSec" in n).toBe(false);
  });

  it("normalize leaves a live message alone (the very same object) and strips a deleted one that still carries text", () => {
    const live = msg("m1", 1);
    expect(normalizeMessage(live)).toBe(live);
    const clean = msg("m2", 2, { deleted: true, body: null });
    expect(normalizeMessage(clean)).toBe(clean);
    expect(normalizeMessage(msg("m3", 3, { deleted: true, body: "ما انحذف" })).body).toBeNull();
    const p = page([live, msg("m4", 4, { deleted: true, body: "x" })]);
    expect(normalizePage(p).messages[1]!.body).toBeNull();
    expect(normalizePage(page([live]))).toBeDefined();
  });
});

describe("a message goes into the windows of its own conversation", () => {
  it("an id already there is replaced IN PLACE (an edit, a reaction), never added twice", () => {
    const d = data(page([msg("a", 1), msg("b", 2), msg("c", 3)]));
    const r = mergeMessage(d, msg("b", 2, { body: "معدّل", edited: true }), { append: false });
    expect(r.status).toBe("replaced");
    expect(messagesOfData(r.data).map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(messagesOfData(r.data)[1]!.body).toBe("معدّل");
    expect(r.data.pages[0]!.messages[0]).toBe(d.pages[0]!.messages[0]); // the others are untouched
  });

  it("a new message is appended in order to the last window when that window reaches the newest, and only then", () => {
    const reaches = data(page([msg("a", 1), msg("b", 3)]));
    expect(mergeMessage(reaches, msg("c", 5), { append: true }).status).toBe("appended");
    expect(messagesOfData(mergeMessage(reaches, msg("c", 5), { append: true }).data).map((m) => m.id)).toEqual(["a", "b", "c"]);
    // a late one lands between, by (createdAt, id)
    expect(messagesOfData(mergeMessage(reaches, msg("x", 2), { append: true }).data).map((m) => m.id)).toEqual(["a", "x", "b"]);
    // a window opened around an old message does not grow at the wrong end
    const around = data(page([msg("a", 1), msg("b", 3)], { hasNewer: true }));
    const skipped = mergeMessage(around, msg("c", 5), { append: true });
    expect(skipped.status).toBe("skipped");
    expect(skipped.data).toBe(around);
    // append false never adds
    expect(mergeMessage(reaches, msg("c", 5), { append: false }).status).toBe("skipped");
  });

  it("a message older than the whole newest window, with older windows behind it, is not put at the wrong place", () => {
    const d = data(page([msg("a", 1)], { hasNewer: false, hasOlder: true }));
    expect(mergeMessage(d, msg("z", 0), { append: true }).status).toBe("skipped");
  });

  it("the pending copy of MY message is replaced by the server's (same clientId), but another person's clientId is not matched", () => {
    const pending = msg("pending:c1", 4, { mine: true, authorId: "me", clientId: "c1", status: "sent" });
    const d = data(page([msg("a", 1), pending]));
    const done = mergeMessage(d, msg("srv1", 4, { mine: true, authorId: "me", clientId: "c1", status: "sent" }), { append: true });
    expect(done.status).toBe("replaced");
    expect(messagesOfData(done.data).map((m) => m.id)).toEqual(["a", "srv1"]);
    // somebody else's message that carries the same clientId text is a different message
    const other = mergeMessage(d, msg("o1", 5, { mine: false, clientId: "c1" }), { append: true });
    expect(other.status).toBe("appended");
    expect(messagesOfData(other.data).map((m) => m.id)).toEqual(["a", "pending:c1", "o1"]);
  });

  it("says when the pinned flag of a message that was already here changed (the header's pinned bar is stale)", () => {
    const d = data(page([msg("a", 1)]));
    expect(mergeMessage(d, msg("a", 1, { pinned: true }), { append: false }).pinChanged).toBe(true);
    expect(mergeMessage(d, msg("a", 1, { body: "x" }), { append: false }).pinChanged).toBe(false);
  });

  it("a deleted message that arrives with text is stored as a tombstone", () => {
    const d = data(page([msg("a", 1)]));
    const r = mergeMessage(d, msg("a", 1, { deleted: true, body: "محذوف لكن فيه نص" }), { append: false });
    expect(JSON.stringify(r.data)).not.toContain("محذوف لكن فيه نص");
  });

  it("tombstoneInData keeps the place, drops the content, and the replies that quoted it lose the quote", () => {
    const d = data(page([msg("a", 1), msg("b", 2, { replyTo: { id: "a", preview: "نص a", authorName: "سلمى" } })]));
    const next = tombstoneInData(d, "a");
    const [a, b] = next.pages[0]!.messages;
    expect(a).toMatchObject({ id: "a", deleted: true, body: null });
    expect(b!.replyTo).toMatchObject({ id: "a", preview: null, deleted: true });
    expect(tombstoneInData(d, "nope")).toBe(d);
  });

  it("newestKnown is the newest message only while the last window reaches the end", () => {
    expect(newestKnown(data(page([msg("a", 1), msg("b", 2)])))!.id).toBe("b");
    expect(newestKnown(data(page([msg("a", 1)], { hasNewer: true })))).toBeNull();
  });

  it("orders by (createdAt, id)", () => {
    expect([msg("b", 1), msg("a", 1), msg("c", 0)].sort(compareMessages).map((m) => m.id)).toEqual(["c", "a", "b"]);
  });
});

describe("read marks move the ticks of the OTHER person, never mine", () => {
  const dm = () =>
    data(page([msg("a", 10, { mine: true, authorId: "me", status: "sent" }), msg("b", 20, { mine: true, authorId: "me", status: "sent" }), msg("c", 30, { mine: false, authorId: "peer" })]));
  it("the peer's read mark turns my messages up to it «read»", () => {
    const next = applyMarksToData(dm(), { reads: [{ userId: "peer", lastReadAt: at(25) }], delivered: [] }, "me");
    expect(next.pages[0]!.messages.map((m) => m.status)).toEqual(["read", "read", undefined]);
    const part = applyMarksToData(dm(), { reads: [{ userId: "peer", lastReadAt: at(15) }], delivered: [] }, "me");
    expect(part.pages[0]!.messages.map((m) => m.status)).toEqual(["read", "sent", undefined]);
  });
  it("a delivery mark makes «sent» «delivered», and never lowers «read»", () => {
    const next = applyMarksToData(dm(), { reads: [], delivered: [{ userId: "peer", lastDeliveredAt: at(25) }] }, "me");
    expect(next.pages[0]!.messages.map((m) => m.status)).toEqual(["delivered", "delivered", undefined]);
    const read = data(page([msg("a", 10, { mine: true, authorId: "me", status: "read" })]));
    expect(applyMarksToData(read, { reads: [], delivered: [{ userId: "peer", lastDeliveredAt: at(25) }] }, "me")).toBe(read);
  });
  it("MY OWN read mark changes no tick, and with no way to know who I am the ticks are left alone", () => {
    const d = dm();
    expect(applyMarksToData(d, { reads: [{ userId: "me", lastReadAt: at(99) }], delivered: [] }, "me")).toBe(d);
    const noMine = data(page([msg("c", 30, { mine: false, authorId: "peer" })]));
    expect(applyMarksToData(noMine, { reads: [{ userId: "peer", lastReadAt: at(99) }], delivered: [] })).toBe(noMine);
    // my id is read from a message of mine when the caller does not know it
    expect(applyMarksToData(dm(), { reads: [{ userId: "peer", lastReadAt: at(99) }], delivered: [] }).pages[0]!.messages[0]!.status).toBe("read");
  });
  it("a topic's «who read» avatar moves to the newest message the reader has read in the newest window", () => {
    const d = data(page([msg("a", 10, { mine: true, authorId: "me" }), msg("b", 20), msg("c", 30)], { readers: [{ userId: "u9", name: "عمر", messageId: "a" }] }));
    const next = applyMarksToData(d, { reads: [{ userId: "u9", lastReadAt: at(25) }], delivered: [] }, "me");
    expect(next.pages[0]!.readers[0]).toMatchObject({ userId: "u9", messageId: "b", readAt: at(25) });
  });
});

describe("rows", () => {
  const list = (scope: "all" | "space", rows: ChatRowDto[], spaceId: string | null = null): ChatListDto => ({ scope, spaceId, rows, canOversee: false });

  it("a changed row replaces its old one and moves the list: the newest activity first", () => {
    const l = list("all", [row("a", { lastMessage: last("m1", 50) }), row("b", { lastMessage: last("m2", 40) })]);
    const next = mergeRowsIntoList(l, [row("b", { lastMessage: last("m3", 60), unread: 2 })])!;
    expect(next.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(next.rows[0]!.unread).toBe(2);
  });
  it("a chat that is new to the list is added, a topic row is only a replacement of one the list holds (its space's row carries it)", () => {
    const l = list("all", [row("a", { lastMessage: last("m1", 50) })]);
    expect(mergeRowsIntoList(l, [row("new", { lastMessage: last("m9", 70) })])!.rows.map((r) => r.id)).toEqual(["new", "a"]);
    const topic = row("t1", { kind: "TOPIC", space: { id: "s1", name: "مساحة" } });
    expect(mergeRowsIntoList(l, [topic])).toBe(l);
  });
  it("the list of ONE space takes that space's topics and private chats, never another space's, never a forum row", () => {
    const l = list("space", [row("t1", { kind: "TOPIC", space: { id: "s1", name: "م" } })], "s1");
    const next = mergeRowsIntoList(l, [row("t2", { kind: "TOPIC", space: { id: "s1", name: "م" } }), row("t3", { kind: "TOPIC", space: { id: "s2", name: "ن" } }), row("s1", { kind: "SPACE", space: { id: "s1", name: "م" } })])!;
    expect(next.rows.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });
  it("nothing is made up when there is no list", () => {
    expect(mergeRowsIntoList(undefined, [row("a")])).toBeUndefined();
    expect(mergeRowsIntoSpace(undefined, [row("a")])).toBeUndefined();
  });
  it("a forum view takes the topics of its own space only, pinned first and archived last", () => {
    const view: SpaceTopicsDto = { space: { id: "s1", name: "م", emoji: null, canModerate: false, canCreateTopic: false }, rows: [row("t1", { kind: "TOPIC", space: { id: "s1", name: "م" }, lastMessage: last("m", 10) })] };
    const next = mergeRowsIntoSpace(view, [
      row("t2", { kind: "TOPIC", space: { id: "s1", name: "م" }, lastMessage: last("m2", 20) }),
      row("t3", { kind: "TOPIC", space: { id: "s1", name: "م" }, pinned: true }),
      row("t4", { kind: "TOPIC", space: { id: "s1", name: "م" }, archived: true, lastMessage: last("m4", 99) }),
      row("x", { kind: "TOPIC", space: { id: "s2", name: "ن" } }),
    ])!;
    expect(next.rows.map((r) => r.id)).toEqual(["t3", "t2", "t1", "t4"]);
  });
  it("a removed conversation leaves its row and its chip under the space's row", () => {
    const l = list("all", [row("s1", { kind: "SPACE", topicChips: [{ id: "t1", title: "أ", emoji: null, unread: 1 }, { id: "t2", title: "ب", emoji: null, unread: 0 }] }), row("d1")]);
    const next = dropFromList(dropFromList(l, "d1"), "t1")!;
    expect(next.rows.map((r) => r.id)).toEqual(["s1"]);
    expect(next.rows[0]!.topicChips!.map((c) => c.id)).toEqual(["t2"]);
    expect(dropFromList(l, "zzz")).toBe(l);
  });
});

describe("the numbers the cache works out by itself (the server's replace them)", () => {
  it("a new message of someone else moves the row's last line and adds one unread; mine adds none; a deleted or system one adds none", () => {
    const r = row("a", { lastMessage: last("m1", 10), unread: 1 });
    expect(rowAfterMessage(r, msg("m2", 20))).toMatchObject({ unread: 2, lastMessage: { id: "m2", preview: "نص m2", at: at(20) } });
    expect(rowAfterMessage(r, msg("m3", 20, { mine: true })).unread).toBe(1);
    expect(rowAfterMessage(r, msg("m4", 20, { deleted: true, body: null })).unread).toBe(1);
    expect(rowAfterMessage(r, msg("m5", 20, { kind: "SYSTEM", body: null, system: { k: "join" } })).unread).toBe(1);
    // an older message than the row's last one changes nothing
    expect(rowAfterMessage(r, msg("m0", 5))).toBe(r);
    // the same message twice is one
    expect(rowAfterMessage(rowAfterMessage(r, msg("m2", 20)), msg("m2", 20)).unread).toBe(2);
  });
  it("a mention of me adds to the mention count", () => {
    expect(rowAfterMessage(row("a"), msg("m1", 1, { mentions: ["me"] }), { mentionsMe: true }).mentionsUnread).toBe(1);
  });
  it("the preview is cut like the server's and a deleted message has none", () => {
    expect(lastMessageOf(msg("m", 1, { body: "ا".repeat(300) })).preview).toHaveLength(140);
    expect(lastMessageOf(msg("m", 1, { deleted: true, body: null })).preview).toBeNull();
  });
  it("reading a conversation empties its row and takes its share out of the forum row of its space", () => {
    expect(rowAfterRead(row("a", { unread: 3, mentionsUnread: 1, markedUnread: true }))).toMatchObject({ unread: 0, mentionsUnread: 0, markedUnread: false });
    const same = row("a");
    expect(rowAfterRead(same)).toBe(same);
    const space = row("s1", { kind: "SPACE", unread: 5, mentionsUnread: 2, topicChips: [{ id: "t1", title: "أ", emoji: null, unread: 3 }] });
    expect(spaceRowAfterRead(space, "t1", { unread: 3, mentionsUnread: 1 })).toMatchObject({ unread: 2, mentionsUnread: 1, topicChips: [{ id: "t1", unread: 0 }] });
    expect(spaceRowAfterMessage(space, "t1", msg("m", 99))).toMatchObject({ unread: 6, topicChips: [{ id: "t1", unread: 4 }] });
  });
  it("a header that no longer says what its topic's row says is stale; a private chat's never is", () => {
    const header = { title: "عام", emoji: null, closed: false, restricted: false, topicType: "DISCUSSION", archived: false, teamId: null };
    const topic = row("t", { kind: "TOPIC", title: "عام", emoji: null, closed: false, restricted: false, topicType: "DISCUSSION", archived: false, teamId: null });
    expect(headerAgreesWithRow(header, topic)).toBe(true);
    expect(headerAgreesWithRow(header, { ...topic, title: "اسم جديد" })).toBe(false);
    expect(headerAgreesWithRow(header, { ...topic, closed: true })).toBe(false);
    expect(headerAgreesWithRow(header, { ...topic, restricted: true })).toBe(false);
    expect(headerAgreesWithRow(header, row("d", { title: "أي شيء" }))).toBe(true);
  });
});

describe("unread per row, per folder, per space — derived from the rows", () => {
  const rows: ChatRowDto[] = [
    row("dm1", { kind: "DM", unread: 2, space: { id: "hq", name: "الشركة" }, lastMessage: last("m", 1) }),
    row("dm2", { kind: "DM", unread: 0, space: { id: "hq", name: "الشركة" } }),
    row("g1", { kind: "GROUP", unread: 1, muted: true }),
    row("s1", { kind: "SPACE", unread: 7, mentionsUnread: 2, space: { id: "s1", name: "مبيعات" } }),
    row("s2", { kind: "SPACE", unread: 0, space: { id: "s2", name: "تصميم" } }),
    row("old", { kind: "DM", unread: 9, archivedByMe: true }),
    row("man", { kind: "DM", unread: 0, markedUnread: true }),
  ];
  it("a row's number is its messages, or one when it was marked unread by hand", () => {
    expect(unreadOfRow(rows[0]!)).toBe(2);
    expect(unreadOfRow(rows[6]!)).toBe(1);
    expect(unreadOfRow(rows[1]!)).toBe(0);
  });
  it("folders filter the rows (an archived row is in none)", () => {
    expect(filterRows(rows, "all").map((r) => r.id)).toEqual(["dm1", "dm2", "g1", "s1", "s2", "man"]);
    expect(filterRows(rows, "unread").map((r) => r.id)).toEqual(["dm1", "g1", "s1", "man"]);
    expect(filterRows(rows, "dm").map((r) => r.id)).toEqual(["dm1", "dm2", "g1", "man"]);
    expect(filterRows(rows, "spaces").map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(filterRows(rows, "mentions").map((r) => r.id)).toEqual(["s1"]);
  });
  it("the numbers of a folder, with or without the muted", () => {
    expect(unreadOfRows(rows)).toEqual({ messages: 11, chats: 4, mentions: 2 });
    expect(unreadOfRows(rows, { includeMuted: false })).toEqual({ messages: 10, chats: 3, mentions: 2 });
    expect(unreadByFolder(rows).dm).toEqual({ messages: 4, chats: 3, mentions: 0 });
    expect(unreadByFolder(rows).unread.chats).toBe(4);
  });
  it("per space: a space's own row and the private chats that carry its chip", () => {
    const bySpace = unreadBySpace(rows);
    expect(bySpace["hq"]).toEqual({ messages: 2, chats: 1, mentions: 0 });
    expect(bySpace["s1"]!.messages).toBe(7);
    expect(bySpace["s2"]!.messages).toBe(0);
    expect(summarizeUnread(rows).total.messages).toBe(11);
  });
});
