import { describe, expect, it, vi } from "vitest";

// the policy module loads the DB client at import; these tests only use its pure functions
vi.mock("@/server/db", () => ({ db: {} }));

import { canModerate, canPost, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { menuFor, menuOpen, messageMenuItems, V2_MENU_ORDER, type MessageMenuContext, type MessageMenuId } from "@/components/chat/message/message-menu-registry";

/**
 * C2.6 — the registry is still the ONE source of the menu, and it learned five ids for the new screen: «نسخ الرابط» (copyLink), «اقرأ النص» (readText),
 * «حوّل الصوت لنص» (transcribe), «مين شاف» (seen) and «اسألي مشرفتك» (ask). «حدّد» is C3b.5: it has no action yet, so its id is NOT added.
 *
 * The new ids are opt-in (`surface: "v2"`): the OLD screen (and the quick chat) has no handler for them, so an id it cannot run must never reach it.
 * Per permission, as in `chat-message-menu.test.ts`: a member, a moderator, a guest, the owner reading silently, a deleted message, a system line.
 */
const NEW_IDS: MessageMenuId[] = ["copyLink", "readText", "transcribe", "seen", "ask"];

type Who = { name: string; role: OrgFacts["role"]; spaceRole: ConversationFacts["viewerSpaceRole"]; member: boolean };
const WHO: Who[] = [
  { name: "member", role: "MEMBER", spaceRole: "MEMBER", member: true },
  { name: "moderator (space admin)", role: "MEMBER", spaceRole: "ADMIN", member: true },
  { name: "guest", role: "GUEST", spaceRole: "GUEST", member: true },
  { name: "owner, joined", role: "OWNER", spaceRole: null, member: true },
  { name: "owner, silent oversight", role: "OWNER", spaceRole: null, member: false },
];

const facts = (w: Who): ConversationFacts => ({
  kind: "TOPIC",
  orgId: "o1",
  spaceId: "s1",
  restricted: false,
  closedAt: null,
  postingPolicy: "ALL",
  teamId: null,
  viewerInTeam: false,
  topicType: "DISCUSSION",
  viewerIsMember: w.member,
  viewerGroupRole: null,
  viewerSpaceRole: w.spaceRole,
  mutedUntil: null,
  dmOtherActive: true,
  memberIds: [],
});

/** The v2 context of a person, with every switch of the new items on: what is left out is the registry's own rule. */
const ctx = (w: Who, over: Partial<MessageMenuContext> = {}): MessageMenuContext => {
  const f = facts(w);
  const org: OrgFacts = { orgId: "o1", role: w.role, status: "ACTIVE" };
  return {
    mine: false,
    deleted: false,
    kind: "TEXT",
    hasText: true,
    pinned: false,
    conversationKind: "TOPIC",
    canPost: canPost(f, org, { ownerJoined: f.viewerIsMember }),
    canModerate: canModerate(f, org),
    oversight: org.role === "OWNER" && !f.viewerIsMember,
    surface: "v2",
    canReadText: true,
    canTranscribe: true,
    readerCount: 3,
    canAsk: true,
    ...over,
  };
};
const ids = (c: MessageMenuContext): MessageMenuId[] => menuFor(c).map((i) => i.id);

describe("«نسخ الرابط» (copyLink): anybody who reads the message", () => {
  for (const w of WHO) {
    for (const mine of [true, false]) {
      it(`${w.name} · ${mine ? "own" : "someone else's"} message`, () => {
        const c = ctx(w, { mine });
        if (c.oversight) expect(ids(c)).toEqual([]);
        else expect(ids(c)).toContain("copyLink");
      });
    }
  }

  it("is offered on a message with no text (a picture, a voice note): the link points at the message, not at its words", () => {
    expect(ids(ctx(WHO[0]!, { kind: "VOICE", hasText: false }))).toContain("copyLink");
  });

  it("nothing at all on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«اقرأ النص» (readText): a picture, where the server's reading-of-pictures switch says so", () => {
  it("is offered with the flag and never without it, for every person who reads", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { canReadText: true })), w.name).toContain("readText");
      expect(ids(ctx(w, { canReadText: false })), w.name).not.toContain("readText");
      expect(ids(ctx(w, { canReadText: undefined })), w.name).not.toContain("readText");
    }
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«حوّل الصوت لنص» (transcribe): a voice note, where the server's transcript switch says so", () => {
  it("is offered on a voice note with the flag, and on nothing else", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { kind: "VOICE", hasText: false })), w.name).toContain("transcribe");
      expect(ids(ctx(w, { kind: "VOICE", hasText: false, canTranscribe: false })), w.name).not.toContain("transcribe");
      expect(ids(ctx(w, { kind: "TEXT" })), w.name).not.toContain("transcribe");
    }
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!, { kind: "VOICE", hasText: false }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "VOICE", hasText: false, deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«مين شاف» (seen): a topic or a group, with today's reader list", () => {
  it("is offered where somebody has read up to this message", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { readerCount: 2 })), w.name).toContain("seen");
      expect(ids(ctx(w, { readerCount: 0 })), w.name).not.toContain("seen");
      expect(ids(ctx(w, { readerCount: undefined })), w.name).not.toContain("seen");
    }
  });

  it("never in a private chat (it has ticks instead)", () => {
    expect(ids(ctx(WHO[0]!, { conversationKind: "DM", readerCount: 2 }))).not.toContain("seen");
    expect(ids(ctx(WHO[0]!, { conversationKind: "GROUP", readerCount: 2 }))).toContain("seen");
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
  });
});

describe("«اسألي مشرفتك» (ask): a text message, for staff who have the problem kinds", () => {
  it("is offered on a text message with the flag (it is the «🎫 مشكلة» door with the question kind)", () => {
    for (const w of WHO.filter((x) => x.member)) {
      expect(ids(ctx(w, { canAsk: true })), w.name).toContain("ask");
      expect(ids(ctx(w, { canAsk: false })), w.name).not.toContain("ask");
      expect(ids(ctx(w, { canAsk: undefined })), w.name).not.toContain("ask");
    }
    expect(ids(ctx(WHO[0]!, { canAsk: true, hasText: false, kind: "VOICE" }))).not.toContain("ask");
  });

  it("nothing for the owner reading silently, on a deleted message or a system line", () => {
    expect(ids(ctx(WHO[4]!))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { deleted: true }))).toEqual([]);
    expect(ids(ctx(WHO[0]!, { kind: "SYSTEM" }))).toEqual([]);
    expect(menuOpen(ctx(WHO[4]!))).toBe(false);
  });
});

describe("the old screen never gets an id it has no handler for", () => {
  it("without `surface: \"v2\"` no new id is offered, whatever the flags say", () => {
    for (const w of WHO) {
      for (const mine of [true, false]) {
        const { surface: _surface, ...old } = ctx(w, { mine });
        void _surface;
        const offered = ids(old as MessageMenuContext);
        for (const id of NEW_IDS) expect(offered, `${w.name} ${id}`).not.toContain(id);
      }
    }
  });

  it("the old order is untouched: «حذف» is still the last item of the list", () => {
    const order = messageMenuItems.map((i) => i.id);
    expect(order[order.length - 1]).toBe("delete");
    const { surface: _surface, ...old } = ctx(WHO[1]!, { mine: true, canMakeWork: true, canRemind: true });
    void _surface;
    const offered = ids(old as MessageMenuContext);
    expect(offered[offered.length - 1]).toBe("delete");
  });
});

describe("the new screen's order is Telegram's, and ours after it", () => {
  const all = ctx(WHO[1]!, { mine: true, canMakeWork: true, canRemind: true, canProblem: true, canMustRead: true, canTranslate: true, pinned: false });

  it("reply, copy, copy link, pin, forward, edit, delete (danger) — then task, ticket, remind, note, translate, read text, transcribe, seen", () => {
    const order = (from: MessageMenuId, to: MessageMenuId) => expect(V2_MENU_ORDER.indexOf(from), `${from} before ${to}`).toBeLessThan(V2_MENU_ORDER.indexOf(to));
    const chain: MessageMenuId[] = ["reply", "copy", "copyLink", "pin", "forward", "edit", "delete", "task", "ticket", "remind", "note", "translate", "readText", "transcribe", "seen"];
    for (let i = 1; i < chain.length; i++) order(chain[i - 1]!, chain[i]!);
  });

  it("what a person is offered comes out in that order (the list is a subsequence of it)", () => {
    const offered = menuFor(all).map((i) => i.id);
    expect(offered.length).toBeGreaterThan(8);
    expect(offered).toEqual(V2_MENU_ORDER.filter((id) => offered.includes(id)));
    expect(offered.indexOf("delete")).toBeLessThan(offered.indexOf("task"));
    const voice = menuFor({ ...all, kind: "VOICE", hasText: false }).map((i) => i.id);
    expect(voice).toEqual(V2_MENU_ORDER.filter((id) => voice.includes(id)));
    expect(voice).toContain("transcribe");
  });

  it("every id of the registry has a place in the new order (a new id has to choose one)", () => {
    expect([...V2_MENU_ORDER].sort()).toEqual(messageMenuItems.map((i) => i.id).sort());
    expect(new Set(V2_MENU_ORDER).size).toBe(V2_MENU_ORDER.length);
  });

  it("«حدّد» is not in the registry: it has no action before C3b.5", () => {
    expect(messageMenuItems.map((i) => i.id as string)).not.toContain("select");
  });

  it("the dangerous item is the only one marked, and every label is Arabic and a dictionary key", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    expect(messageMenuItems.filter((i) => i.danger).map((i) => i.id)).toEqual(["delete"]);
    for (const item of messageMenuItems) {
      for (const pinned of [true, false]) {
        for (const surface of [undefined, "v2" as const]) {
          const key = item.labelKey({ pinned, surface } as MessageMenuContext);
          expect(AR[key], key).toMatch(/[؀-ۿ]/);
        }
      }
    }
  });

  it("the words are Telegram's: «ثبّت», «حوّل», «عدّل», «احذف», «نسخ الرابط» on the new screen; the old screen keeps its own words", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    const label = (id: MessageMenuId, c: Partial<MessageMenuContext>) => AR[messageMenuItems.find((i) => i.id === id)!.labelKey({ pinned: false, ...c } as MessageMenuContext)];
    expect(label("pin", { surface: "v2" })).toBe("ثبّت");
    expect(label("forward", { surface: "v2" })).toBe("حوّل");
    expect(label("edit", { surface: "v2" })).toBe("عدّل");
    expect(label("delete", { surface: "v2" })).toBe("احذف");
    expect(label("copyLink", { surface: "v2" })).toBe("نسخ الرابط");
    expect(label("seen", { surface: "v2" })).toBe("مين شاف");
    expect(label("ask", { surface: "v2" })).toBe("اسألي مشرفتك");
    expect(label("readText", { surface: "v2" })).toBe("اقرأ النص");
    expect(label("transcribe", { surface: "v2" })).toBe("حوّل الصوت لنص");
    // the old screen's wording is unchanged
    expect(label("pin", {})).toBe(AR["chatc.menu.pin"]);
    expect(label("delete", {})).toBe(AR["chatc.menu.delete"]);
  });
});

describe("Q1 carry-over: «🎫 مشكلة» and «اسألي مشرفتك» are items of the registry", () => {
  it("«🎫 مشكلة» is offered with `me.problemKinds` (canProblem) on a text message and not without", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    expect(ids(ctx(WHO[0]!, { canProblem: true }))).toContain("problem");
    expect(ids(ctx(WHO[0]!, { canProblem: false }))).not.toContain("problem");
    expect(AR["tickets.menu.problem"]).toContain("مشكلة");
  });
});
