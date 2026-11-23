import { describe, expect, it } from "vitest";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import { GENERAL_KEY, groupItems, groupRows, topicsOfGroup, type GroupMeta } from "@/lib/chat/v2/groups";

/**
 * «مجموعات المواضيع» on the list: the pure half. A topic row carries its `groupId`; a group is one row (name, last message, unread rolled up from its topics); the topics with no group are
 * «عام». Nothing here reads the cache or the network.
 */
const topic = (id: string, groupId: string | null, over: Partial<ChatRowDto> = {}): ChatRowDto => ({
  id,
  kind: "TOPIC",
  title: `موضوع ${id}`,
  emoji: "💬",
  space: { id: "s1", name: "العمل" },
  lastMessage: null,
  unread: 0,
  mentionsUnread: 0,
  muted: false,
  pinnedByMe: false,
  archivedByMe: false,
  markedUnread: false,
  restricted: false,
  topicType: "DISCUSSION",
  groupId,
  ...over,
});
const dm = (id: string): ChatRowDto => ({ ...topic(id, null), kind: "DM", title: `خاص ${id}`, space: null });
const last = (at: string, preview: string): ChatRowDto["lastMessage"] => ({ id: `m-${at}`, authorName: "x", preview, kind: "TEXT", at, mine: false } as ChatRowDto["lastMessage"]);

const admin: GroupMeta = { id: "g-admin", name: "الإدارة", emoji: "🧭", position: 1, restricted: false };
const ads: GroupMeta = { id: "g-ads", name: "التسويق", emoji: null, position: 0, restricted: false };

describe("groupRows", () => {
  it("is empty when the space has no group at all: the list stays flat, exactly as before", () => {
    expect(groupRows([topic("a", null), topic("b", null)], [], "عام", { showEmpty: true })).toEqual([]);
  });

  it("makes one row per group in the order of `position`, «عام» last, with the unread rolled up and the newest last message", () => {
    const rows = [
      topic("a", "g-admin", { unread: 2, mentionsUnread: 1, lastMessage: last("2026-11-20T10:00:00Z", "قديمة") }),
      topic("b", "g-admin", { unread: 3, lastMessage: last("2026-11-21T10:00:00Z", "الأحدث") }),
      topic("c", "g-ads", { unread: 4 }),
      topic("d", null, { unread: 5 }),
    ];
    const out = groupRows(rows, [admin, ads], "عام", { showEmpty: false });
    expect(out.map((g) => g.name)).toEqual(["التسويق", "الإدارة", "عام"]);
    const a = out.find((g) => g.id === "g-admin")!;
    expect([a.unread, a.mentions, a.topicCount]).toEqual([5, 1, 2]);
    expect(a.last?.preview).toBe("الأحدث");
    expect(out.at(-1)).toMatchObject({ key: GENERAL_KEY, id: null, unread: 5 });
  });

  it("does not draw an empty group for a plain reader, nor «عام» when nothing is in it; a manager still sees the empty group", () => {
    const rows = [topic("a", "g-admin")];
    expect(groupRows(rows, [admin, ads], "عام", { showEmpty: false }).map((g) => g.id)).toEqual(["g-admin"]);
    expect(groupRows(rows, [admin, ads], "عام", { showEmpty: true }).map((g) => g.id)).toEqual(["g-ads", "g-admin"]);
  });

  it("counts neither an archived topic nor one the person archived", () => {
    const rows = [topic("a", "g-admin", { unread: 9, archived: true }), topic("b", "g-admin", { unread: 1, archivedByMe: true }), topic("c", "g-admin", { unread: 2 })];
    const g = groupRows(rows, [admin], "عام", { showEmpty: false })[0]!;
    expect([g.unread, g.topicCount]).toEqual([2, 1]);
  });

  it("a group is muted when every topic of it is; a topic of a group the viewer does not know goes to «عام»", () => {
    const rows = [topic("a", "g-admin", { muted: true }), topic("b", "g-admin", { muted: true }), topic("c", "g-unknown", { unread: 1 })];
    const out = groupRows(rows, [admin], "عام", { showEmpty: false });
    expect(out.find((g) => g.id === "g-admin")?.muted).toBe(true);
    expect(out.find((g) => g.id === null)?.topicCount).toBe(1);
  });
});

describe("topicsOfGroup", () => {
  it("returns the topics of one group, or the ungrouped ones for null (a stale or unknown group id counts as «عام»)", () => {
    const rows = [topic("a", "g-admin"), topic("b", null), topic("c", "g-ads"), topic("d", "g-gone")];
    expect(topicsOfGroup(rows, "g-admin", [admin, ads]).map((r) => r.id)).toEqual(["a"]);
    expect(topicsOfGroup(rows, null, [admin, ads]).map((r) => r.id)).toEqual(["b", "d"]);
  });
});

describe("groupItems", () => {
  it("replaces the topic rows by the group rows at the place of the first topic and keeps every other row where it was", () => {
    const rows = [dm("x"), topic("a", "g-admin"), topic("b", "g-ads"), dm("y"), topic("c", null)];
    const items = groupItems(rows, [admin, ads], "عام", { showEmpty: false });
    expect(items.map((i) => (i.type === "group" ? `G:${i.group.name}` : i.type === "row" ? i.id : i.key))).toEqual(["x", "G:التسويق", "G:الإدارة", "G:عام", "y"]);
  });

  it("is the plain rows when there is no group", () => {
    const rows = [dm("x"), topic("a", null)];
    expect(groupItems(rows, [], "عام", { showEmpty: false }).map((i) => i.type)).toEqual(["row", "row"]);
  });
});

describe("reorderWithin / groupOfRow", () => {
  it("the ids of one group take the places they held, in the new order; the others do not move", async () => {
    const { reorderWithin, groupOfRow } = await import("@/lib/chat/v2/groups");
    expect(reorderWithin(["a", "x", "b", "y", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "x", "a", "y", "b"]);
    expect(reorderWithin(["a", "x", "b"], ["a", "b"], ["b", "a", "zzz"])).toEqual(["b", "x", "a"]);
    expect(groupOfRow(topic("t", "g-admin"), [admin])).toBe("g-admin");
    expect(groupOfRow(topic("t", "g-gone"), [admin])).toBeNull();
  });
});

describe("groupedForumItems", () => {
  it("is the group rows, then the archived topics under their line", async () => {
    const { groupedForumItems } = await import("@/lib/chat/v2/groups");
    const items = groupedForumItems([topic("a", "g-admin"), topic("z", "g-admin", { archived: true })], [admin], "عام", { showEmpty: false });
    expect(items.map((i) => i.type)).toEqual(["group", "section", "row"]);
  });
});

describe("expandSpaces: «مجلد ← مجموعة ← موضوع»", () => {
  const spaceRow = (id: string): ChatRowDto => ({ ...topic(id, null), kind: "SPACE", title: `مساحة ${id}`, topicChips: [] });
  it("a space with groups becomes its group rows (with the space named on each); other rows and spaces without groups stay one row", async () => {
    const { expandSpaces } = await import("@/lib/chat/v2/groups");
    const spaces = new Map([["s1", { groups: [admin, ads], topics: [topic("a", "g-admin", { unread: 2 }), topic("b", "g-ads"), topic("c", null)], canManage: false }]]);
    const items = expandSpaces([spaceRow("s1"), spaceRow("s2"), dm("x")], spaces, "عام");
    expect(items.map((i) => (i.type === "group" ? `G:${i.group.name}@${i.group.spaceId}` : i.type === "row" ? i.id : i.key))).toEqual(["G:التسويق@s1", "G:الإدارة@s1", "G:عام@s1", "s2", "x"]);
    const g = items.find((i) => i.type === "group" && i.group.id === "g-admin");
    expect(g && g.type === "group" && g.group.key).toBe("group:s1:g-admin");
    expect(g && g.type === "group" && g.group.unread).toBe(2);
  });

  it("a space whose groups are not known yet (or none) stays as it was", async () => {
    const { expandSpaces } = await import("@/lib/chat/v2/groups");
    expect(expandSpaces([spaceRow("s1")], new Map(), "عام").map((i) => i.type)).toEqual(["row"]);
    expect(expandSpaces([spaceRow("s1")], new Map([["s1", { groups: [], topics: [topic("a", null)], canManage: true }]]), "عام").map((i) => i.type)).toEqual(["row"]);
  });
});
