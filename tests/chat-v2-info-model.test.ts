import { describe, expect, it } from "vitest";
import type { MemberDto } from "@/server/chat/dto";
import { infoModelOf } from "@/lib/chat/v2/info/info-model";
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
  it("has no tabs (the media, files, links, voice, work and pinned tabs are C3d) and no placeholder for them", () => {
    const m = infoModelOf(makeHeader(), none) as unknown as Record<string, unknown>;
    expect(Object.keys(m)).not.toContain("tabs");
  });
});
