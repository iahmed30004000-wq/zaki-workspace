import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C1.3 — the server's side of the live line, with the policy stubbed (the rule itself is proven over a real database in
 * tests/db/realtime-live-gate.test.ts):
 *  - ONE readers question per event, however many streams are open (it used to be one `canReadConversation` per stream);
 *  - the answer is remembered per PERSON (30 s), so ten tabs of one person cost one lookup;
 *  - `membership.changed` forgets the answers of THAT company only;
 *  - a failed lookup delivers to nobody and is not remembered; two events at once share one lookup;
 *  - the delivered ticks of a DM are written once per person per second, after the loop, not inside it;
 *  - `presence.changed` is a stream-only nudge: no id line, no person's id, nothing replayed, never to a person who may not see the
 *    roster, never about an owner who hides himself, and a reload that returns within the grace says nothing.
 */

/** who is in which space (the nudge goes to the people who share a space with the person it is about) */
const spacesOf = vi.hoisted(() => ({} as Record<string, string[]>));
vi.mock("@/server/db", () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: { update: vi.fn().mockResolvedValue({}) },
    conversation: { findUnique: vi.fn().mockResolvedValue({ kind: "TOPIC" }) },
    workspaceMember: {
      findMany: vi.fn(async ({ where }: { where: { userId: string | { in: string[] }; workspaceId?: { in: string[] } } }) => {
        if (typeof where.userId === "string") return (spacesOf[where.userId] ?? []).map((workspaceId) => ({ workspaceId }));
        const wanted = new Set(where.workspaceId?.in ?? []);
        return where.userId.in.filter((u) => (spacesOf[u] ?? []).some((w) => wanted.has(w))).map((userId) => ({ userId }));
      }),
    },
  },
}));
vi.mock("@/server/chat/read-state", () => ({ markDeliveredForUser: vi.fn().mockResolvedValue(undefined) }));
const isFeatureOn = vi.fn().mockResolvedValue(false);
vi.mock("@/server/services/features", () => ({ isFeatureOn }));

import { markDeliveredForUser } from "@/server/chat/read-state";
import { addClient, deliverEvent, filterVisible, flushDeliveredForTests, PRESENCE_GRACE_MS, DELIVERED_DEBOUNCE_MS, removeClient, resetHubForTests, type RtClient, type RtEvent } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";

const asEvent = (e: { id: string; orgId: string; kind: string; ids: Record<string, string> }) => e as unknown as RtEvent;
const ev = (id: string, kind: string, ids: Record<string, string>, orgId = "org1") => ({ id, orgId, kind, ids });

type Opts = { orgId?: string; role?: string; seesPresence?: boolean };
function connect(userId: string, opts: Opts = {}) {
  const sends: string[] = [];
  const client = addClient({ userId, orgId: opts.orgId ?? "org1", role: opts.role, seesPresence: opts.seesPresence, send: (s) => sends.push(s), close: () => undefined });
  return { client, sends };
}
const kindsOf = (sends: string[]) => sends.map((s) => (JSON.parse(s.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as { kind: string }).kind);

let readersOf: ReturnType<typeof vi.fn>;
function allowAll(readers: string[] | "all" = "all", kind: "TOPIC" | "DM" = "TOPIC") {
  readersOf = vi.fn(async (_cv: string, userIds: string[]) => ({ readers: new Set(readers === "all" ? userIds : userIds.filter((u) => readers.includes(u))), kind }));
  setPolicyStubs({ readersOf });
}

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({});
  vi.clearAllMocks();
  isFeatureOn.mockResolvedValue(false);
  for (const k of Object.keys(spacesOf)) delete spacesOf[k];
  // everybody of these tests works in the same space unless a test says otherwise
  for (const u of ["w1", "w2", "u1", "u2", "n1", "o1", "x1"]) spacesOf[u] = ["ws1"];
});
afterEach(() => {
  resetHubForTests();
  setPolicyStubs({});
  vi.useRealTimers();
});

describe("one readers question per event", () => {
  it("ten streams of five people cost ONE lookup, naming the five, and every stream gets the frame", async () => {
    allowAll();
    const all = ["u1", "u2", "u3", "u4", "u5"].flatMap((u) => [connect(u), connect(u)]);
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1", messageId: "m1" })));
    expect(readersOf).toHaveBeenCalledTimes(1);
    expect(new Set(readersOf.mock.calls[0]![1] as string[])).toEqual(new Set(["u1", "u2", "u3", "u4", "u5"]));
    expect(readersOf.mock.calls[0]![1]).toHaveLength(5);
    expect(all.every((c) => c.sends.length === 1)).toBe(true);
  });

  it("only the people the question names as readers get the frame; the others get nothing", async () => {
    allowAll(["u1"]);
    const a = connect("u1");
    const b = connect("u2");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    expect(a.sends).toHaveLength(1);
    expect(b.sends).toHaveLength(0);
  });

  it("remembers the answer per person for 30 s, whichever tab asks", async () => {
    allowAll();
    connect("u1");
    connect("u1");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    await deliverEvent(asEvent(ev("2", "message.reacted", { conversationId: "cv1" })));
    expect(readersOf).toHaveBeenCalledTimes(1);
    // a person who joins later is the only one asked about
    connect("u2");
    await deliverEvent(asEvent(ev("3", "message.created", { conversationId: "cv1" })));
    expect(readersOf).toHaveBeenCalledTimes(2);
    expect(readersOf.mock.calls[1]![1]).toEqual(["u2"]);
  });

  it("membership.changed forgets the answers of THAT company only", async () => {
    allowAll();
    connect("u1", { orgId: "org1" });
    connect("u9", { orgId: "org2" });
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" }, "org1")));
    await deliverEvent(asEvent(ev("2", "message.created", { conversationId: "cv9" }, "org2")));
    expect(readersOf).toHaveBeenCalledTimes(2);
    await deliverEvent(asEvent(ev("3", "membership.changed", { userId: "u5" }, "org1")));
    await deliverEvent(asEvent(ev("4", "message.created", { conversationId: "cv1" }, "org1")));
    await deliverEvent(asEvent(ev("5", "message.created", { conversationId: "cv9" }, "org2")));
    expect(readersOf).toHaveBeenCalledTimes(3); // org1 asked again; org2 was NOT forgotten
  });

  it("conversation.changed forgets that conversation only", async () => {
    allowAll();
    connect("u1");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    await deliverEvent(asEvent(ev("2", "message.created", { conversationId: "cv2" })));
    await deliverEvent(asEvent(ev("3", "conversation.changed", { conversationId: "cv2" })));
    await deliverEvent(asEvent(ev("4", "message.created", { conversationId: "cv1" })));
    await deliverEvent(asEvent(ev("5", "message.created", { conversationId: "cv2" })));
    expect(readersOf).toHaveBeenCalledTimes(3);
  });

  it("a lookup that fails delivers to nobody and is not remembered: the next event asks again", async () => {
    readersOf = vi.fn().mockRejectedValueOnce(new Error("db down")).mockImplementation(async (_cv: string, ids: string[]) => ({ readers: new Set(ids), kind: "TOPIC" as const }));
    setPolicyStubs({ readersOf });
    const a = connect("u1");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    expect(a.sends).toHaveLength(0);
    await deliverEvent(asEvent(ev("2", "message.created", { conversationId: "cv1" })));
    expect(a.sends).toHaveLength(1);
    expect(readersOf).toHaveBeenCalledTimes(2);
  });

  it("two events of one conversation at the same moment share one lookup", async () => {
    let release: (v: { readers: Set<string>; kind: "TOPIC" }) => void = () => undefined;
    readersOf = vi.fn(() => new Promise((r) => (release = r as typeof release)));
    setPolicyStubs({ readersOf });
    const a = connect("u1");
    const first = deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    const second = deliverEvent(asEvent(ev("2", "message.created", { conversationId: "cv1" })));
    await new Promise((r) => setTimeout(r, 5));
    release({ readers: new Set(["u1"]), kind: "TOPIC" });
    await Promise.all([first, second]);
    expect(readersOf).toHaveBeenCalledTimes(1);
    expect(a.sends).toHaveLength(2);
  });

  it("an event with no conversation asks nobody and reaches the whole company", async () => {
    allowAll();
    const a = connect("u1");
    const b = connect("u2");
    await deliverEvent(asEvent(ev("1", "conversation.changed", { spaceId: "ws1" })));
    expect(readersOf).not.toHaveBeenCalled();
    expect(a.sends).toHaveLength(1);
    expect(b.sends).toHaveLength(1);
  });

  it("the replay gate asks once per conversation, not once per row", async () => {
    allowAll(["u1"]);
    const out = await filterVisible("u1", [
      { id: "1", kind: "message.created", ids: { conversationId: "cv1" } },
      { id: "2", kind: "message.edited", ids: { conversationId: "cv1" } },
      { id: "3", kind: "message.created", ids: { conversationId: "cv2" } },
    ]);
    expect(out.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(readersOf).toHaveBeenCalledTimes(2);
  });
});

describe("a read mark says it was mine, to my own streams only", () => {
  it("the reader's tabs get self:true, everybody else's frame is the plain one", async () => {
    allowAll();
    const mine1 = connect("u1");
    const mine2 = connect("u1");
    const other = connect("u2");
    await deliverEvent(asEvent(ev("1", "conversation.read", { conversationId: "cv1", userId: "u1" })));
    const parse = (s: string) => JSON.parse(s.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as Record<string, unknown>;
    expect(parse(mine1.sends[0]!)).toMatchObject({ kind: "conversation.read", userId: "u1", self: true });
    expect(parse(mine2.sends[0]!)).toMatchObject({ self: true });
    expect(parse(other.sends[0]!)).not.toHaveProperty("self");
  });
});

describe("the delivered ticks of a DM", () => {
  it("are written once per person per second, after the loop: five messages, one write each for the conversation", async () => {
    vi.useFakeTimers();
    allowAll("all", "DM");
    connect("u1");
    connect("u2");
    connect("u2");
    for (let i = 0; i < 5; i++) await deliverEvent(asEvent(ev(String(i), "message.created", { conversationId: "cv1", messageId: `m${i}` })));
    expect(markDeliveredForUser).not.toHaveBeenCalled(); // nothing inside the loop
    await vi.advanceTimersByTimeAsync(DELIVERED_DEBOUNCE_MS + 10);
    expect(markDeliveredForUser).toHaveBeenCalledTimes(2);
    expect(markDeliveredForUser).toHaveBeenCalledWith("u1", "cv1");
    expect(markDeliveredForUser).toHaveBeenCalledWith("u2", "cv1");
  });

  it("a topic's message marks nothing", async () => {
    allowAll();
    connect("u1");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    await flushDeliveredForTests();
    expect(markDeliveredForUser).not.toHaveBeenCalled();
  });

  it("a person who may not read the DM is never marked", async () => {
    allowAll(["u1"], "DM");
    connect("u1");
    connect("u3");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));
    await flushDeliveredForTests();
    expect(markDeliveredForUser).toHaveBeenCalledTimes(1);
    expect(markDeliveredForUser).toHaveBeenCalledWith("u1", "cv1");
  });
});

describe("presence.changed — a stream-only nudge", () => {
  const nudges = (c: { sends: string[] }) => c.sends.filter((s) => s.includes("presence.changed"));

  it("the first stream of a person nudges the others who may see the roster; a second tab of the same person does not", () => {
    const watcher = connect("w1", { seesPresence: true });
    const guest = connect("g1", { role: "GUEST", seesPresence: false });
    const noFlag = connect("n1", { role: "MEMBER" });
    const base = nudges(watcher).length; // each of them opened a stream too (not a guest: guests are on no roster)
    connect("u1", { seesPresence: true });
    return Promise.resolve().then(async () => {
      await vi.waitFor(() => expect(nudges(watcher)).toHaveLength(base + 1));
      expect(nudges(guest)).toHaveLength(0);
      expect(nudges(noFlag)).toHaveLength(0);
      connect("u1", { seesPresence: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(nudges(watcher)).toHaveLength(base + 1);
    });
  });

  it("the nudge has no id line and no person in it (it is never replayed and tells nobody who)", async () => {
    const watcher = connect("w1", { seesPresence: true });
    connect("u1", { seesPresence: true });
    await vi.waitFor(() => expect(nudges(watcher)).toHaveLength(1));
    const frame = nudges(watcher)[0]!;
    expect(frame).toBe(`data: ${JSON.stringify({ kind: "presence.changed" })}\n\n`);
    expect(frame).not.toContain("id:");
  });

  it("only the people who share a space with the person get the nudge (the roster is the space's); an owner is in every space and always does", async () => {
    spacesOf["w2"] = ["ws-other"];
    const sharing = connect("w1", { seesPresence: true });
    const apart = connect("w2", { seesPresence: true });
    const owner = connect("o1", { role: "OWNER", seesPresence: true });
    await new Promise((r) => setTimeout(r, 30)); // the owner's own arrival has been announced (it reads a switch first)
    const base = [sharing, apart, owner].map((c) => nudges(c).length);
    connect("u1", { seesPresence: true });
    await vi.waitFor(() => expect(nudges(owner).length).toBe(base[2]! + 1));
    expect(nudges(sharing).length).toBe(base[0]! + 1);
    expect(nudges(apart).length).toBe(base[1]!);
  });

  it("an owner coming online is on every roster: everybody who sees one is nudged, in a space or not", async () => {
    spacesOf["w2"] = [];
    const apart = connect("w2", { seesPresence: true });
    const base = nudges(apart).length;
    connect("o1", { role: "OWNER", seesPresence: true });
    await vi.waitFor(() => expect(nudges(apart).length).toBe(base + 1));
  });

  it("a guest's coming and going nudges nobody (no roster shows a guest)", async () => {
    const watcher = connect("w1", { seesPresence: true });
    connect("g1", { role: "GUEST" });
    await new Promise((r) => setTimeout(r, 10));
    expect(nudges(watcher)).toHaveLength(0);
  });

  it("never reaches the person it is about, nor another company", async () => {
    const me = connect("u1", { seesPresence: true });
    const other = connect("x1", { orgId: "org2", seesPresence: true });
    const second = connect("u1", { seesPresence: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(nudges(me)).toHaveLength(0);
    expect(nudges(second)).toHaveLength(0);
    expect(nudges(other)).toHaveLength(0);
  });

  it("the last stream closing nudges after the grace, and a reload inside the grace says nothing at all", async () => {
    vi.useFakeTimers();
    const watcher = connect("w1", { seesPresence: true });
    const u = connect("u1", { seesPresence: true });
    await vi.advanceTimersByTimeAsync(5);
    expect(nudges(watcher)).toHaveLength(1);
    // a reload: the stream closes and a new one opens inside the grace
    removeClient(u.client);
    await vi.advanceTimersByTimeAsync(PRESENCE_GRACE_MS - 500);
    connect("u1", { seesPresence: true });
    await vi.advanceTimersByTimeAsync(PRESENCE_GRACE_MS * 2);
    expect(nudges(watcher)).toHaveLength(1);
    // a real leaving
    const stream = [...Array(1)].map(() => connect("u2", { seesPresence: true }))[0]!;
    await vi.advanceTimersByTimeAsync(5);
    expect(nudges(watcher)).toHaveLength(2);
    removeClient(stream.client);
    await vi.advanceTimersByTimeAsync(PRESENCE_GRACE_MS - 100);
    expect(nudges(watcher)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(nudges(watcher)).toHaveLength(3);
  });

  it("an owner who hides himself nudges nobody, coming or going; with the switch off he nudges like anybody", async () => {
    vi.useFakeTimers();
    isFeatureOn.mockResolvedValue(true);
    const watcher = connect("w1", { seesPresence: true });
    const owner = connect("o1", { role: "OWNER", seesPresence: true });
    await vi.advanceTimersByTimeAsync(5);
    removeClient(owner.client);
    await vi.advanceTimersByTimeAsync(PRESENCE_GRACE_MS + 100);
    expect(nudges(watcher)).toHaveLength(0);
    expect(isFeatureOn).toHaveBeenCalledWith("org1", "ownerHiddenOnline");
    isFeatureOn.mockResolvedValue(false);
    connect("o1", { role: "OWNER", seesPresence: true });
    await vi.advanceTimersByTimeAsync(5);
    expect(nudges(watcher)).toHaveLength(1);
  });

  it("an owner whose switch cannot be read is treated as hidden (never leak)", async () => {
    isFeatureOn.mockRejectedValue(new Error("db"));
    const watcher = connect("w1", { seesPresence: true });
    connect("o1", { role: "OWNER", seesPresence: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(nudges(watcher)).toHaveLength(0);
  });

  it("a stream that cannot be written to is dropped, not retried", async () => {
    const dead = addClient({ userId: "w2", orgId: "org1", seesPresence: true, send: () => { throw new Error("gone"); }, close: () => undefined }) as RtClient;
    connect("u1", { seesPresence: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(dead.cid).toBeGreaterThan(0);
    const { clientCount } = await import("@/server/realtime/hub");
    expect(clientCount()).toBe(1); // only the one that is still writable is left
  });
});

describe("kinds", () => {
  it("presence.changed is NOT one of the stored kinds (the one list pins that)", async () => {
    const { REALTIME_KINDS } = await import("@/server/realtime/emit");
    expect((REALTIME_KINDS as readonly string[]).includes("presence.changed")).toBe(false);
  });
});
