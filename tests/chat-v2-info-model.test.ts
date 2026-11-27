import { describe, expect, it } from "vitest";
import type { MemberDto } from "@/server/chat/dto";
import type { MediaItemDto } from "@/server/chat/media";
import { mergeViewerItems, viewerItemsOf, viewerItemsOfMedia, type ViewerItem } from "@/components/chat/v2/media-viewer";
import { dayStartOf, inChatSearchUrl, isAskable, stepHit, stepOfSearchKey } from "@/lib/chat/v2/info/in-chat-search";
import { messagesSignature } from "@/lib/chat/v2/info/use-info-tabs";
import { activeTabOf, INFO_TAB_ORDER, isPagedTab, mediaCountsUrl, mediaPageUrl, safeLinkHref, TAB_KIND, tabAfterKey, tabLabelKey, tabsOf, workUrl } from "@/lib/chat/v2/info/info-tabs";
import { infoModelOf } from "@/lib/chat/v2/info/info-model";
import { chatHitHref, hasListResults, LIST_SEARCH_MIN, listSearchUrl, listSearchWords, messageHitHref, personHitHref, personOpensChat } from "@/lib/chat/v2/info/list-search";
import { AR } from "@/lib/i18n/dict";
import { makeHeader } from "./chat-v2-pane-fixtures.test";

/**
 * C2.7 — what the info panel says, as a pure function of the header the cache holds (and the people, when they are known). The panel adds NO door: a
 * button exists only where the server already has the thing it opens, and a private row says «🔒 خاص» WITHOUT names to anybody who was not given them (P0.4).
 */
const person = (id: string, name: string, over: Partial<MemberDto> = {}): MemberDto => ({ id, name, ...over }) as MemberDto;
const members = [person("u1", "أحمد"), person("u2", "سلمى"), person("u3", "ليلى")];
const none = { people: null, teamName: null, system: false } as const;

describe("a private chat shows only what the header already carries", () => {
  const dm = (over: Parameters<typeof makeHeader>[0] = {}) => makeHeader({ kind: "DM", space: null, title: "سلمى", emoji: null, restricted: false, audience: { type: "PAIR", count: 2 }, memberCount: 2, peer: { id: "u2", name: "سلمى", avatarUrl: "/api/avatars/u2" }, ...over });

  it("the big picture is the other person's, with the title and the last-seen line the header already draws", () => {
    const m = infoModelOf(dm({ peerLastSeenAt: null, timeZone: "Asia/Amman" }), { ...none, now: new Date("2026-11-01T10:00:00Z") });
    expect(m.kind).toBe("dm");
    expect(m.title).toBe("سلمى");
    expect(m.avatar).toEqual({ kind: "person", name: "سلمى", src: "/api/avatars/u2" });
    expect(m.peerId).toBe("u2");
    expect(m.audience).toBeNull();
    expect(m.space).toBeNull();
  });

  it("has «🔍 بحث» and, only when the person may call, «📞 اتصال»", () => {
    expect(infoModelOf(dm(), none).buttons).toEqual(["search", "call"]);
    expect(infoModelOf(dm({ me: { canCall: false } }), none).buttons).toEqual(["search"]);
    expect(infoModelOf(dm({ me: { canPost: false } }), none).buttons).toEqual(["search"]);
    expect(infoModelOf(dm({ calls: false }), none).buttons).toEqual(["search"]);
    expect(infoModelOf(dm({ assistantCall: true }), none).buttons).toEqual(["search"]);
  });

  it("never draws «🔔 الإشعارات»: there is no per-person mute door before C3a, so the id does not exist", () => {
    for (const header of [dm(), makeHeader(), makeHeader({ restricted: true })]) expect(infoModelOf(header, none).buttons as string[]).not.toContain("notifications");
  });

  it("has no moderator buttons and no names of anybody, whatever people it is handed", () => {
    const m = infoModelOf(dm({ me: { canModerate: true } }), { ...none, people: { members } });
    expect(m.moderator).toEqual([]);
    expect(m.audience).toBeNull();
  });
});

describe("a topic: the space and who sees it", () => {
  it("an open topic says «كل أعضاء المساحة (42)» and names nobody", () => {
    const m = infoModelOf(makeHeader(), { ...none, people: { members, mentionables: members } });
    expect(m.kind).toBe("topic");
    expect(m.space).toBe("المبيعات");
    expect(m.audience).toMatchObject({ state: "open", names: [] });
    expect(m.audience!.line).toBe("كل أعضاء المساحة (42)");
    expect(m.avatar).toEqual({ kind: "emoji", emoji: "📦" });
  });

  it("a topic of a section says «المقطع: …» with the section's name when known, and no names", () => {
    const header = makeHeader({ teamId: "t1", audience: { type: "TEAM", count: 7 }, memberCount: 7 });
    const named = infoModelOf(header, { people: { members, mentionables: members }, teamName: "خدمة الزبائن", system: false });
    expect(named.audience).toMatchObject({ state: "team", names: [] });
    expect(named.audience!.line).toBe("المقطع: خدمة الزبائن");
    const anon = infoModelOf(header, none);
    expect(anon.audience!.line).not.toContain("undefined");
    expect(anon.audience!.line).not.toBe(named.audience!.line);
  });

  it("a restricted topic says «🔒 خاص — 4 أشخاص» and lists the people only when the server's door gave them", () => {
    const header = makeHeader({ restricted: true, audience: { type: "PEOPLE", count: 3 }, memberCount: 3 });
    const given = infoModelOf(header, { ...none, people: { members } });
    expect(given.audience!.state).toBe("restricted");
    expect(given.audience!.line).toBe("🔒 خاص — 3 أشخاص");
    expect(given.audience!.names.map((n) => n.name)).toEqual(["أحمد", "سلمى", "ليلى"]);
  });

  it("…and WITHOUT names to anybody who was not given them (P0.4): no people, an empty list, or only the space's audience", () => {
    const header = makeHeader({ restricted: true, audience: { type: "PEOPLE", count: 3 }, memberCount: 3 });
    for (const people of [null, {}, { members: [] }, { mentionables: members }]) {
      const m = infoModelOf(header, { ...none, people });
      expect(m.audience!.line).toBe("🔒 خاص — 3 أشخاص");
      expect(m.audience!.names).toEqual([]);
    }
  });

  it("the assistant is not listed as a person", () => {
    const header = makeHeader({ restricted: true, memberCount: 2 });
    const m = infoModelOf(header, { ...none, people: { members: [person("u1", "أحمد"), person("ai", "المساعد", { role: "AI" } as never)] } });
    expect(m.audience!.names.map((n) => n.name)).toEqual(["أحمد"]);
  });

  it("the owner's silent reading is said honestly (the server's own flag), only on a private topic", () => {
    expect(infoModelOf(makeHeader({ restricted: true, oversightNotice: true }), none).oversightNotice).toBe(true);
    expect(infoModelOf(makeHeader({ restricted: true, oversightNotice: false }), none).oversightNotice).toBe(false);
    expect(infoModelOf(makeHeader({ restricted: true }), none).oversightNotice).toBe(false);
    expect(infoModelOf(makeHeader({ oversightNotice: true }), none).oversightNotice).toBe(false);
  });

  it("the subtitle is the header's own line: the space and the count, or the lock and the space", () => {
    expect(infoModelOf(makeHeader(), none).subtitle).toBe("المبيعات · 42 عضوًا");
    expect(infoModelOf(makeHeader({ restricted: true, memberCount: 4 }), none).subtitle).toContain("🔒 خاص");
  });
});

describe("the moderators' buttons (the topics door; the server decides again)", () => {
  const mod = (over: Parameters<typeof makeHeader>[0] = {}) => makeHeader({ ...over, me: { canModerate: true, ...(over.me ?? {}) } });

  it("settings, close and archive for a moderator of a topic; nothing for a member", () => {
    expect(infoModelOf(mod(), none).moderator).toEqual(["settings", "close", "archive"]);
    expect(infoModelOf(makeHeader(), none).moderator).toEqual([]);
  });

  it("a closed topic offers reopen, an archived one bring-back", () => {
    expect(infoModelOf(mod({ closed: true }), none).moderator).toEqual(["settings", "reopen", "archive"]);
    expect(infoModelOf(mod({ archived: true }), none).moderator).toEqual(["settings", "unarchive"]);
  });

  it("a starter topic is only edited: the server refuses to close or archive it", () => {
    expect(infoModelOf(mod(), { ...none, system: true }).moderator).toEqual(["settings"]);
  });
});

describe("what is NOT drawn", () => {
  it("the panel's own model has no tabs (they are their own module, `info-tabs.ts`; the four content tabs are always drawn there, S5.4)", () => {
    const m = infoModelOf(makeHeader(), none) as unknown as Record<string, unknown>;
    expect(Object.keys(m)).not.toContain("tabs");
  });
});

// ───────────────────────────── C3d ─────────────────────────────
const noCounts = { IMAGE: 0, VIDEO: 0, FILE: 0, AUDIO: 0, LINK: 0 };

// S5.4 (changed deliberately): the four content tabs are ALWAYS there, each with an empty sentence of its own, and «الأعضاء» is there for a topic or a group; «الشغل»
// and «المثبّتة» still draw only with data. The new rules are pinned in tests/chat-info-profile.test.ts; these are the old ones, restated for the new behaviour.
describe("C3d — which tabs exist", () => {
  it("nothing known: the four content tabs are still there (S5.4), the old «الشغل» and «المثبّتة» are not (no data), no members tab for a private chat", () => {
    expect(tabsOf({ counts: null, work: null, pinned: 0, members: null }).map((t) => t.id)).toEqual(["media", "files", "links", "voice"]);
    expect(tabsOf({ counts: noCounts, work: { tasks: 0, tickets: 0 }, pinned: 0, members: null }).map((t) => t.id)).toEqual(["media", "files", "links", "voice"]);
  });

  it("the plan's order; «الوسائط» counts the pictures and the videos together, «الشغل» the tasks and the tickets", () => {
    const tabs = tabsOf({ counts: { ...noCounts, IMAGE: 2, VIDEO: 1, AUDIO: 3 }, work: { tasks: 1, tickets: 2 }, pinned: 4, members: null });
    expect(tabs.map((t) => [t.id, t.count])).toEqual([["media", 3], ["files", 0], ["links", 0], ["voice", 3], ["work", 3], ["pinned", 4]]);
    expect(tabs.map((t) => t.labelKey)).toEqual(["chatinfo.tab.media", "chatinfo.tab.files", "chatinfo.tab.links", "chatinfo.tab.voice", "chatinfo.tab.work", "chatinfo.tab.pinned"]);
    expect(INFO_TAB_ORDER).toEqual(["media", "files", "links", "voice", "groups", "members", "work", "pinned"]);
    for (const id of INFO_TAB_ORDER) expect(AR[tabLabelKey(id)], id).toBeTruthy();
  });

  it("the tab shown is the chosen one, otherwise the first content tab with data", () => {
    const tabs = tabsOf({ counts: { ...noCounts, FILE: 1, LINK: 1 }, work: null, pinned: 0, members: null });
    expect(activeTabOf(tabs, null)).toBe("files");
    expect(activeTabOf(tabs, "links")).toBe("links");
    // a tab that is no longer in the list: back to the first with data
    expect(activeTabOf(tabs, "work")).toBe("files");
    expect(activeTabOf([], "files")).toBeNull();
  });

  it("the arrow keys move between tabs the way a right-to-left row reads: the right arrow is the PREVIOUS tab, the left arrow the NEXT; the ends stop", () => {
    const tabs = tabsOf({ counts: { ...noCounts, IMAGE: 1, FILE: 1, LINK: 1 }, work: null, pinned: 0, members: null });
    expect(tabAfterKey(tabs, "media", "ArrowLeft")).toBe("files");
    expect(tabAfterKey(tabs, "files", "ArrowRight")).toBe("media");
    expect(tabAfterKey(tabs, "media", "ArrowRight")).toBe("media");
    expect(tabAfterKey(tabs, "voice", "ArrowLeft")).toBe("voice");
    expect(tabAfterKey(tabs, "files", "Home")).toBe("media");
    expect(tabAfterKey(tabs, "files", "End")).toBe("voice");
    expect(tabAfterKey(tabs, "files", "Enter")).toBeNull();
    expect(tabAfterKey([], null, "ArrowLeft")).toBeNull();
  });

  it("the addresses: the page of a tab (with a cursor), the counts, the work — and only an ordinary web address is opened from a link row", () => {
    expect(isPagedTab("media") && isPagedTab("files") && isPagedTab("links") && isPagedTab("voice")).toBe(true);
    expect(isPagedTab("work") || isPagedTab("pinned")).toBe(false);
    expect(TAB_KIND).toEqual({ media: "MEDIA", files: "FILE", links: "LINK", voice: "AUDIO" });
    expect(mediaPageUrl("c 1", "MEDIA")).toBe("/api/chat/conversations/c%201/media?kind=MEDIA");
    expect(mediaPageUrl("c1", "FILE", "a/b")).toBe("/api/chat/conversations/c1/media?kind=FILE&before=a%2Fb");
    expect(mediaCountsUrl("c1")).toBe("/api/chat/conversations/c1/media?counts=1");
    expect(workUrl("c1")).toBe("/api/chat/conversations/c1/media/work");
    expect(safeLinkHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLinkHref("http://example.com")).toBe("http://example.com");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//example.com", "ftp://example.com", "https://a b"]) expect(safeLinkHref(bad), bad).toBeNull();
  });
});

describe("C3d — the in-chat search's rules", () => {
  it("something to ask: two letters of words, or a person, or a day", () => {
    expect(isAskable({ q: "", from: null, since: null })).toBe(false);
    expect(isAskable({ q: "ا", from: null, since: null })).toBe(false);
    expect(isAskable({ q: " طلب ", from: null, since: null })).toBe(true);
    expect(isAskable({ q: "", from: "u1", since: null })).toBe(true);
    expect(isAskable({ q: "", from: null, since: "2026-11-02T00:00:00.000Z" })).toBe(true);
  });

  it("the address: the scope and the conversation always; the words only when they count; a day is a jump, so the words are left out", () => {
    const url = (q: string, from: string | null = null, since: string | null = null) => new URL(inChatSearchUrl("c 1", { q, from, since }), "http://x");
    expect(url("طلب").searchParams.get("scope")).toBe("chat");
    expect(url("طلب").searchParams.get("conversationId")).toBe("c 1");
    expect(url("طلب").searchParams.get("q")).toBe("طلب");
    expect(url("طلب", "u1").searchParams.get("from")).toBe("u1");
    expect(url("ا").searchParams.has("q")).toBe(false);
    const jump = url("طلب", null, "2026-11-02T00:00:00.000Z");
    expect(jump.searchParams.get("since")).toBe("2026-11-02T00:00:00.000Z");
    expect(jump.searchParams.has("q")).toBe(false);
    expect(inChatSearchUrl("c1", { q: "a&b=c", from: null, since: null })).toContain("q=a%26b%3Dc");
  });

  it("a picked day is the start of THAT day on the person's own clock; an impossible day or another format is nothing", () => {
    const at = new Date(dayStartOf("2026-11-02")!);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 10, 2, 0, 0]);
    expect(dayStartOf("2026-02-31")).toBeNull();
    expect(dayStartOf("2026-13-01")).toBeNull();
    expect(dayStartOf("02/11/2026")).toBeNull();
    expect(dayStartOf("")).toBeNull();
  });

  it("↑ goes to the older hit, ↓ to the newer one (the list is newest first); the first step lands on the newest; the ends stop", () => {
    expect(stepHit(null, "older", 5)).toBe(0);
    expect(stepHit(null, "newer", 5)).toBe(0);
    expect(stepHit(0, "older", 5)).toBe(1);
    expect(stepHit(4, "older", 5)).toBe(4);
    expect(stepHit(2, "newer", 5)).toBe(1);
    expect(stepHit(0, "newer", 5)).toBe(0);
    expect(stepHit(null, "older", 0)).toBeNull();
    expect(stepHit(3, "older", 0)).toBeNull();
  });

  it("the keys: ↑ older, ↓ newer, Enter older, Shift+Enter newer, anything else is the person's typing", () => {
    expect(stepOfSearchKey("ArrowUp", false)).toBe("older");
    expect(stepOfSearchKey("ArrowDown", false)).toBe("newer");
    expect(stepOfSearchKey("Enter", false)).toBe("older");
    expect(stepOfSearchKey("Enter", true)).toBe("newer");
    expect(stepOfSearchKey("a", false)).toBeNull();
    expect(stepOfSearchKey("Escape", false)).toBeNull();
  });
});

describe("C3d — the list's search", () => {
  it("nothing is asked under two letters; the words are cleaned the way the server cleans them", () => {
    expect(listSearchWords("")).toBeNull();
    expect(listSearchWords(" ا ")).toBeNull();
    expect(listSearchWords("  طلب   اليوم ")).toBe("طلب اليوم");
    expect(LIST_SEARCH_MIN).toBe(2);
    expect(listSearchUrl("a&b")).toBe("/api/search?scope=chat&q=a%26b");
  });

  it("where each result opens: a topic and a private chat their conversation, a space its forum, a message around itself, a person's private chat when there is one", () => {
    expect(chatHitHref({ id: "c1", kind: "TOPIC", title: "", emoji: null, context: null })).toBe("/chat/c1");
    expect(chatHitHref({ id: "d1", kind: "DM", title: "", emoji: null, context: null })).toBe("/chat/d1");
    expect(chatHitHref({ id: "s1", kind: "SPACE", title: "", emoji: null, context: null })).toBe("/chat/s/s1");
    expect(messageHitHref({ id: "m 1", conversationId: "c1" })).toBe("/chat/c1?m=m%201");
    expect(personHitHref({ id: "u1", name: "x", dmId: "d1" })).toBe("/chat/d1");
    expect(personHitHref({ id: "u1", name: "x", dmId: null })).toBeNull();
    expect(personOpensChat({ id: "u1", name: "x", dmId: null })).toBe(true);
    // a guest's row has no `dmId` key at all: nothing to open
    expect(personOpensChat({ id: "g", name: "x" })).toBe(false);
  });

  it("results exist when any of the three has a row", () => {
    expect(hasListResults(null)).toBe(false);
    expect(hasListResults({ chats: [], people: [], messages: [] })).toBe(false);
    expect(hasListResults({ chats: [], people: [{ id: "u", name: "x" }], messages: [] })).toBe(true);
  });
});

describe("C3d — the viewer's list: the loaded part and the part the media route brought", () => {
  const item = (id: string, messageId: string, at: string, position = 0): ViewerItem => ({
    id,
    messageId,
    attachment: { id, kind: "IMAGE", name: `${id}.png`, mime: "image/png", size: 1, url: `/api/chat/attachments/${id}` },
    url: `/api/chat/attachments/${id}`,
    caption: null,
    authorName: null,
    at,
    position,
  });
  const dto = (id: string, messageId: string, at: string, position = 0, over: Partial<MediaItemDto["attachment"]> = {}): MediaItemDto => ({
    id,
    messageId,
    at,
    position,
    authorName: "سلمى",
    caption: "**كلمة**",
    attachment: { id, kind: "IMAGE", name: `${id}.png`, mime: "image/png", size: 1, url: `/api/chat/attachments/${id}`, ...over },
  });

  it("the route's pages (newest first) become the viewer's list (oldest first), the caption without its markers; an address that is not ours or a file is dropped", () => {
    const items = viewerItemsOfMedia([dto("c", "m3", "2026-11-03T00:00:00.000Z"), dto("far", "m2", "2026-11-02T12:00:00.000Z", 0, { url: "https://x.example/a.png" }), dto("a", "m1", "2026-11-01T00:00:00.000Z")]);
    expect(items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(items[0]).toMatchObject({ messageId: "m1", caption: "كلمة", authorName: "سلمى", at: "2026-11-01T00:00:00.000Z", position: 0 });
  });

  it("the older pictures that were never loaded come BEFORE the loaded ones, each picture once (the loaded copy wins), pictures of one message stay in their order", () => {
    const loaded = [item("c", "m3", "2026-11-03T00:00:00.000Z"), item("d", "m4", "2026-11-04T00:00:00.000Z", 0), item("e", "m4", "2026-11-04T00:00:00.000Z", 1)];
    const fetched = viewerItemsOfMedia([dto("e", "m4", "2026-11-04T00:00:00.000Z", 1), dto("d", "m4", "2026-11-04T00:00:00.000Z", 0), dto("c", "m3", "2026-11-03T00:00:00.000Z"), dto("b", "m2", "2026-11-02T00:00:00.000Z"), dto("a", "m1", "2026-11-01T00:00:00.000Z")]);
    expect(mergeViewerItems(loaded, fetched).map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
    // the loaded item is the one kept
    expect(mergeViewerItems(loaded, fetched).find((i) => i.id === "c")).toBe(loaded[0]);
  });

  it("nothing fetched is the loaded list as it was; a fetched picture of a message the screen knows was deleted is dropped (the files of a deleted message never show)", () => {
    const loaded = [item("c", "m3", "2026-11-03T00:00:00.000Z")];
    expect(mergeViewerItems(loaded, [])).toEqual(loaded);
    const fetched = viewerItemsOfMedia([dto("gone", "m2", "2026-11-02T00:00:00.000Z"), dto("b", "m1", "2026-11-01T00:00:00.000Z")]);
    expect(mergeViewerItems(loaded, fetched, new Set(["m2"])).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("the loaded part carries the message's time and the picture's place, so the two parts can be ordered together", () => {
    const [first, second] = viewerItemsOf([
      {
        id: "m1",
        kind: "TEXT",
        body: "صور",
        deleted: false,
        edited: false,
        pinned: false,
        mine: false,
        authorId: "u2",
        authorName: "سلمى",
        createdAt: "2026-11-01T08:30:00.000Z",
        mentions: [],
        attachments: [dto("p0", "m1", "x").attachment, dto("p1", "m1", "x").attachment],
        reactions: [],
      },
    ]);
    expect([first!.at, first!.position, second!.position]).toEqual(["2026-11-01T08:30:00.000Z", 0, 1]);
  });
});

describe("C3d — the tabs follow the conversation", () => {
  it("the signature changes when a message arrives or one is deleted, and not for a message that is only pending", () => {
    const m = (over: { deleted?: boolean; pending?: unknown } = {}) => over;
    expect(messagesSignature([])).toBe("0:0");
    expect(messagesSignature([m(), m()])).toBe("2:0");
    expect(messagesSignature([m(), m({ deleted: true })])).toBe("2:1");
    // a delete changes it even though no message left
    expect(messagesSignature([m(), m({ deleted: true })])).not.toBe(messagesSignature([m(), m()]));
    // an optimistic message is not one yet: the arrival of the real one is the change
    expect(messagesSignature([m(), m({ pending: { state: "sending" } })])).toBe("1:0");
  });
});
