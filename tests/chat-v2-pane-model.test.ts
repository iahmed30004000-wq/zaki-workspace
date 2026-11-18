import { describe, expect, it, vi } from "vitest";
import { ct, ctCount } from "@/lib/chat/text";
import { NAME_TONES, bubbleClass, bubbleRun, mentionsMeOf, nameTone, showsSender } from "@/lib/chat/v2/pane/bubble-model";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { headerMenuOf, subtitleOf } from "@/lib/chat/v2/pane/header-model";
import { jumpButtonsOf, mentionTargetsOf, mentionsButtonOf } from "@/lib/chat/v2/pane/jump-model";
import { newestToConsider } from "@/lib/chat/v2/pane/read-model";
import { arrivalSoundOf } from "@/lib/chat/v2/pane/arrival-sound";
import { callDoor, doors } from "@/lib/chat/v2/pane/message-actions";
import { composerDetailOf } from "@/lib/chat/v2/pane/composer-detail";
import { conversationPeopleUrl } from "@/lib/chat/conversation/client";
import { messageMenuContext } from "@/components/chat/message/message-item";
import { makeHeader, makeMessage } from "./chat-v2-pane-fixtures.test";

/**
 * C2.4 — the pure half of the conversation pane: what a bubble looks like (runs, tails, the name colour), what the header says under the title and
 * which items its «⋮» draws, the jump buttons, what the read mark is fed, the arrival sound, the doors an action calls, and the composer's detail.
 */

describe("bubble runs, tails and the name colour", () => {
  it("a run is single / start / middle / end from its two flags", () => {
    expect(bubbleRun(true, true)).toBe("single");
    expect(bubbleRun(true, false)).toBe("start");
    expect(bubbleRun(false, false)).toBe("middle");
    expect(bubbleRun(false, true)).toBe("end");
  });

  it("only the LAST bubble of a run has a tail: the corner toward its author — bottom-end for mine, bottom-start for the others", () => {
    expect(bubbleClass({ mine: true, mentionsMe: false, tail: true, highlighted: false })).toContain("rounded-ee-sm");
    expect(bubbleClass({ mine: true, mentionsMe: false, tail: false, highlighted: false })).not.toContain("rounded-ee-sm");
    expect(bubbleClass({ mine: false, mentionsMe: false, tail: true, highlighted: false })).toContain("rounded-es-sm");
    expect(bubbleClass({ mine: false, mentionsMe: false, tail: false, highlighted: false })).not.toMatch(/rounded-e[es]-sm/);
    // never a physical side
    expect(bubbleClass({ mine: true, mentionsMe: false, tail: true, highlighted: true })).not.toMatch(/\b(?:rounded-[lr]|ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)/);
  });

  it("mine takes the accent tint, a mention of me the warn tint, the others the surface; a jump's target a ring", () => {
    expect(bubbleClass({ mine: true, mentionsMe: false, tail: false, highlighted: false })).toContain("bg-accent/10");
    expect(bubbleClass({ mine: false, mentionsMe: true, tail: false, highlighted: false })).toContain("bg-warn/10");
    expect(bubbleClass({ mine: false, mentionsMe: false, tail: false, highlighted: false })).toContain("bg-surface");
    expect(bubbleClass({ mine: false, mentionsMe: false, tail: false, highlighted: true })).toContain("ring-accent");
    expect(bubbleClass({ mine: false, mentionsMe: false, tail: false, highlighted: false })).not.toContain("ring-");
  });

  it("the sender's name is coloured by avatarHue on a theme token (never a colour literal); the same name always gets the same token", () => {
    expect(NAME_TONES.length).toBe(6);
    for (const tone of NAME_TONES) expect(tone).toMatch(/^text-cat-[1-6]$/);
    expect(nameTone("سلمى")).toBe(nameTone("سلمى"));
    const tones = new Set(["سلمى", "أحمد", "ليلى", "عمر", "هديل", "يزن", "رنا", "كريم"].map(nameTone));
    expect(tones.size).toBeGreaterThan(1);
  });

  it("the sender (name and picture) is drawn for the others in a topic or a group, never in a private chat and never for me", () => {
    expect(showsSender(false, "TOPIC")).toBe(true);
    expect(showsSender(false, "GROUP")).toBe(true);
    expect(showsSender(false, "DM")).toBe(false);
    expect(showsSender(true, "TOPIC")).toBe(false);
  });

  it("a message mentions me by my id or by «@الكل», unless it is mine or deleted", () => {
    expect(mentionsMeOf(makeMessage({ mentions: ["u1"] }), "u1")).toBe(true);
    expect(mentionsMeOf(makeMessage({ mentions: ["*"] }), "u1")).toBe(true);
    expect(mentionsMeOf(makeMessage({ mentions: ["u3"] }), "u1")).toBe(false);
    expect(mentionsMeOf(makeMessage({ mentions: ["u1"], mine: true }), "u1")).toBe(false);
    expect(mentionsMeOf(makeMessage({ mentions: ["u1"], deleted: true }), "u1")).toBe(false);
    expect(mentionsMeOf(makeMessage({ mentions: ["u1"] }), undefined)).toBe(false);
  });
});

describe("what the bubble knows about the conversation (from the header, never from a rank)", () => {
  it("is the header's own flags, and the hint line only in an open topic", () => {
    const facts = bubbleFactsOf(makeHeader({ me: { canModerate: true, canMakeTask: false, canRemind: true, canMustRead: true, orderHints: true, canOrderState: true, problemKinds: [{ key: "late", label: "x" }] }, voiceTranscript: true, imageOcr: true }));
    expect(facts.conversationKind).toBe("TOPIC");
    expect(facts.meId).toBe("u1");
    expect(facts.canModerate).toBe(true);
    expect(facts.canMakeTask).toBe(false);
    expect(facts.canRemind).toBe(true);
    expect(facts.canMustRead).toBe(true);
    expect(facts.canProblem).toBe(true);
    expect(facts.canOrderState).toBe(true);
    expect(facts.canTranscribe).toBe(true);
    expect(facts.canReadImages).toBe(true);
    expect(facts.orderHints).toBe(true);
    expect(bubbleFactsOf(makeHeader({ restricted: true, me: { orderHints: true } })).orderHints).toBe(false);
    expect(bubbleFactsOf(makeHeader({ teamId: "t1", me: { orderHints: true } })).orderHints).toBe(false);
    expect(bubbleFactsOf(makeHeader({ kind: "DM", me: { orderHints: true } })).orderHints).toBe(false);
  });

  it("no capability is invented: a header that says nothing gives nothing", () => {
    const facts = bubbleFactsOf(makeHeader({ me: { canMakeWork: undefined, canRemind: undefined } }));
    expect(facts.canMakeWork).toBe(false);
    expect(facts.canRemind).toBe(false);
    expect(facts.canTranslate).toBe(false);
    expect(facts.canMustRead).toBe(false);
    expect(facts.canProblem).toBe(false);
    expect(facts.canTranscribe).toBe(false);
    expect(facts.problemRules).toEqual([]);
  });

  it("the menu context of a message is the registry's, built from the same facts the old screen used", () => {
    const facts = bubbleFactsOf(makeHeader({ me: { canModerate: true, canMakeWork: true } }));
    const ctx = messageMenuContext(makeMessage({ mine: true, pinned: true }), facts);
    expect(ctx).toMatchObject({ mine: true, pinned: true, deleted: false, kind: "TEXT", hasText: true, conversationKind: "TOPIC", canPost: true, canModerate: true, oversight: false, canMakeWork: true });
    expect(messageMenuContext(makeMessage({ body: "   " }), facts).hasText).toBe(false);
  });
});

describe("the line under the title", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");

  it("an open topic: the space and how many people, only because the header carries the count", () => {
    const s = subtitleOf(makeHeader(), { typingNames: [], now });
    expect(s.privacy).toBeNull();
    expect(s.line).toBe(`المبيعات · ${ctCount("chatc.members", 42)}`);
    expect(s.typing).toBe(false);
  });

  it("a topic made for named people says «🔒 خاص» with the count — never a name", () => {
    const s = subtitleOf(makeHeader({ restricted: true, memberCount: 4, audience: { type: "PEOPLE", count: 4 } }), { typingNames: [], now });
    expect(s.privacy).toBe(ct("chatp.label.restricted", { people: ctCount("chatp.people", 4) }));
    expect(s.privacy).toContain("خاص");
    expect(s.line).toBe("المبيعات");
    for (const names of ["سلمى", "أحمد"]) expect(`${s.privacy}${s.line}`).not.toContain(names);
  });

  it("a section's topic says so with the same wording as P0.4", () => {
    const s = subtitleOf(makeHeader({ teamId: "t1", memberCount: 6 }), { typingNames: [], now });
    expect(s.privacy).toBe(ct("chatp.label.team", { people: ctCount("chatp.people", 6) }));
  });

  it("a private chat: the other person's last seen (the line the old head had), and «🔒 بينكم بس»", () => {
    const header = makeHeader({ kind: "DM", space: null, title: "أحمد", peer: { id: "u2", name: "أحمد" }, peerLastSeenAt: "2026-11-01T11:55:00.000Z", timeZone: "UTC", audience: { type: "PAIR", count: 2 }, memberCount: 2 });
    const s = subtitleOf(header, { typingNames: [], now });
    expect(s.privacy).toBe(ct("chatp.label.dm"));
    expect(s.line).toContain("آخر ظهور");
    // nothing recorded at all (the company's switch is off): no line, never a made-up one
    expect(subtitleOf({ ...header, peerLastSeenAt: undefined }, { typingNames: [], now }).line).toBeNull();
  });

  it("typing wins the line: «عم يكتب…» in a private chat, «سلمى عم يكتب…» in a topic", () => {
    expect(subtitleOf(makeHeader({ kind: "DM", space: null }), { typingNames: ["أحمد"], now })).toMatchObject({ line: ct("chatui.row.typing"), typing: true });
    expect(subtitleOf(makeHeader(), { typingNames: ["سلمى"], now })).toMatchObject({ line: ct("chatui.row.typing_one", { name: "سلمى" }), typing: true });
  });
});

describe("the ⋮ menu draws only what has a server door", () => {
  const base = { kind: "TOPIC" as const, whiteboard: true, watch: true, digest: false, canModerate: false, closed: false, archived: false, system: false };

  it("a member: search, the board, watch together, the info — and nothing for a moderator", () => {
    expect(headerMenuOf(base)).toEqual(["search", "whiteboard", "watch", "info"]);
  });

  it("a moderator of a topic also gets the settings, close and archive", () => {
    expect(headerMenuOf({ ...base, canModerate: true })).toEqual(["search", "whiteboard", "watch", "info", "settings", "close", "archive"]);
    expect(headerMenuOf({ ...base, canModerate: true, closed: true, archived: false })).toContain("reopen");
    expect(headerMenuOf({ ...base, canModerate: true, archived: true })).toEqual(["search", "whiteboard", "watch", "info", "settings", "unarchive"]);
  });

  it("a starter topic is never archived or closed (the server refuses): only the settings", () => {
    expect(headerMenuOf({ ...base, canModerate: true, system: true })).toEqual(["search", "whiteboard", "watch", "info", "settings"]);
  });

  it("each switch hides its own item: the board, watch together, the summary only when the header says so", () => {
    expect(headerMenuOf({ ...base, whiteboard: false })).not.toContain("whiteboard");
    expect(headerMenuOf({ ...base, watch: false })).not.toContain("watch");
    expect(headerMenuOf({ ...base, digest: true })).toContain("digest");
    expect(headerMenuOf({ ...base, digest: false })).not.toContain("digest");
  });

  it("a private chat has no topic items even for a «moderator»", () => {
    expect(headerMenuOf({ ...base, kind: "DM", canModerate: true })).toEqual(["search", "whiteboard", "watch", "info"]);
  });

  it("«اكتم الإشعارات» is NOT an item (no per-person door until C3a): not even disabled", () => {
    const ids = headerMenuOf({ ...base, canModerate: true, digest: true });
    expect(ids.join(",")).not.toMatch(/mute/);
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("the jump buttons", () => {
  it("«↓» is hidden at the newest message with nothing to read, and shows «آخر الرسائل» when the windows do not reach it", () => {
    expect(jumpButtonsOf({ atBottom: true, atNewest: true, unread: 0, newBelow: 0 }).down.show).toBe(false);
    const away = jumpButtonsOf({ atBottom: false, atNewest: true, unread: 0, newBelow: 0 }).down;
    expect(away).toMatchObject({ show: true, count: 0, kind: "newest" });
    expect(jumpButtonsOf({ atBottom: true, atNewest: false, unread: 0, newBelow: 0 }).down).toMatchObject({ show: true, kind: "newest" });
  });

  it("with unread messages it carries the counter — the server's number, or what arrived while reading, whichever is larger", () => {
    expect(jumpButtonsOf({ atBottom: false, atNewest: true, unread: 12, newBelow: 0 }).down).toMatchObject({ show: true, count: 12, kind: "unread" });
    expect(jumpButtonsOf({ atBottom: false, atNewest: true, unread: 0, newBelow: 3 }).down).toMatchObject({ count: 3, kind: "unread" });
    expect(jumpButtonsOf({ atBottom: false, atNewest: true, unread: 2, newBelow: 5 }).down.count).toBe(5);
  });

  it("the mention targets are the newest N messages that mention me, N = the unread mentions the row counts", () => {
    const messages = [
      makeMessage({ id: "a", mentions: ["u1"] }),
      makeMessage({ id: "b" }),
      makeMessage({ id: "c", mentions: ["*"] }),
      makeMessage({ id: "d", mentions: ["u1"], mine: true }),
      makeMessage({ id: "e", mentions: ["u1"] }),
    ];
    expect(mentionTargetsOf(messages, "u1", 2)).toEqual(["c", "e"]);
    expect(mentionTargetsOf(messages, "u1", 5)).toEqual(["a", "c", "e"]);
    expect(mentionTargetsOf(messages, "u1", 0)).toEqual([]);
    expect(mentionTargetsOf(messages, undefined, 2)).toEqual([]);
  });

  it("«@» shows the unread mentions and goes to the next one not visited yet; nothing when none are unread", () => {
    expect(mentionsButtonOf({ mentionsUnread: 0, targets: ["c"], visited: [] })).toEqual({ show: false, count: 0, target: null });
    expect(mentionsButtonOf({ mentionsUnread: 2, targets: ["c", "e"], visited: [] })).toEqual({ show: true, count: 2, target: "c" });
    expect(mentionsButtonOf({ mentionsUnread: 2, targets: ["c", "e"], visited: ["c"] })).toEqual({ show: true, count: 1, target: "e" });
    // the targets are not loaded: the number still shows, there is nowhere to jump yet
    expect(mentionsButtonOf({ mentionsUnread: 3, targets: [], visited: [] })).toEqual({ show: true, count: 3, target: null });
  });
});

describe("what feeds the read mark", () => {
  const messages = [makeMessage({ id: "m1" }), makeMessage({ id: "m2" }), makeMessage({ id: "pending:x", pending: { state: "sending" } })];
  it("the newest CONFIRMED message, and only while the newest message is really on screen", () => {
    expect(newestToConsider({ messages, atNewest: true, atBottom: true })).toBe("m2");
    expect(newestToConsider({ messages, atNewest: true, atBottom: false })).toBeNull();
    expect(newestToConsider({ messages, atNewest: false, atBottom: true })).toBeNull();
    expect(newestToConsider({ messages: [], atNewest: true, atBottom: true })).toBeNull();
    expect(newestToConsider({ messages: [messages[2]!], atNewest: true, atBottom: true })).toBeNull();
  });
});

describe("the arrival sound", () => {
  const old = [makeMessage({ id: "m1" })];
  it("a message of somebody else after the first one makes the received sound; two for a mention; none for mine or at the opening", () => {
    const next = [...old, makeMessage({ id: "m2" })];
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: next, meId: "u1" })).toBe("received");
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2", mentions: ["u1"] })], meId: "u1" })).toBe("mention");
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2", mine: true })], meId: "u1" })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: null, messages: next, meId: "u1" })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m2", messages: next, meId: "u1" })).toBeNull();
  });

  it("a page of newer messages arriving while an old place is read is paging, not an arrival", () => {
    const next = [...old, makeMessage({ id: "m2" })];
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: next, meId: "u1", hadNewer: true, hasNewer: false })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: next, meId: "u1", hadNewer: false, hasNewer: true })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: next, meId: "u1", hadNewer: false, hasNewer: false })).toBe("received");
  });

  it("a window that replaced the old one (the old newest is gone) is not an arrival, and a pending bubble or a system line is silent", () => {
    expect(arrivalSoundOf({ previousNewestId: "gone", messages: [makeMessage({ id: "z1" }), makeMessage({ id: "z2" })], meId: "u1" })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "pending:y", mine: true, pending: { state: "sending" } })], meId: "u1" })).toBeNull();
    expect(arrivalSoundOf({ previousNewestId: "m1", messages: [...old, makeMessage({ id: "m2", kind: "SYSTEM", body: null })], meId: "u1" })).toBeNull();
  });
});

describe("the doors an action calls (the same ones the old screen called; none is new)", () => {
  it("each action's address, method and body", () => {
    expect(doors.react("m 1", "👍")).toEqual({ path: "/api/chat/messages/m%201/react", method: "POST", body: { emoji: "👍" } });
    expect(doors.pin("m1")).toEqual({ path: "/api/chat/messages/m1/pin", method: "POST" });
    expect(doors.remove("m1")).toEqual({ path: "/api/chat/messages/m1", method: "DELETE" });
    expect(doors.ack("m1", true)).toEqual({ path: "/api/chat/messages/m1/ack", method: "POST" });
    expect(doors.ack("m1", false)).toEqual({ path: "/api/chat/messages/m1/ack", method: "DELETE" });
    expect(doors.mustRead("m1", true)).toEqual({ path: "/api/chat/messages/m1/must-read", method: "POST", body: { on: true } });
    expect(doors.join("c1")).toEqual({ path: "/api/chat/conversations/c1/join", method: "POST" });
    expect(doors.topic("c1", { closed: true })).toEqual({ path: "/api/chat/topics/c1", method: "PATCH", body: { closed: true } });
    expect(doors.topic("c1", { archived: false })).toEqual({ path: "/api/chat/topics/c1", method: "PATCH", body: { archived: false } });
  });

  it("callDoor sends JSON when there is a body, and says why when the server refuses", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(await callDoor(doors.react("m1", "🔥"), ok as unknown as typeof fetch)).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("/api/chat/messages/m1/react");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe(JSON.stringify({ emoji: "🔥" }));
    await callDoor(doors.pin("m1"), ok as unknown as typeof fetch);
    expect(calls[1]!.init.headers).toBeUndefined();
    expect(calls[1]!.init.body).toBeUndefined();

    const refused = async () => new Response(JSON.stringify({ message: "chat.topic_system" }), { status: 409 });
    expect(await callDoor(doors.topic("c1", { closed: true }), refused as unknown as typeof fetch)).toEqual({ ok: false, message: "chat.topic_system" });
    const down = async () => {
      throw new TypeError("offline");
    };
    expect(await callDoor(doors.pin("m1"), down as unknown as typeof fetch)).toEqual({ ok: false, message: null });
  });
});

describe("the composer's detail and the people", () => {
  it("is the header with the people the header leaves out, and no messages (the composer never reads them)", () => {
    const header = makeHeader();
    const people = { members: [{ id: "u1", name: "أنا", online: true }], mentionables: [{ id: "u2", name: "سلمى", online: false }] };
    const detail = composerDetailOf(header, people);
    expect(detail.id).toBe("c1");
    expect(detail.me.canPost).toBe(true);
    expect(detail.members).toEqual(people.members);
    expect(detail.mentionables).toEqual(people.mentionables);
    expect(detail.messages).toEqual([]);
    expect(composerDetailOf(header, null).mentionables).toBeUndefined();
  });

  it("the people come from the one old door that carries them, asking for ONE message", () => {
    expect(conversationPeopleUrl("c 1")).toBe("/api/chat/conversations/c%201?limit=1");
  });
});

