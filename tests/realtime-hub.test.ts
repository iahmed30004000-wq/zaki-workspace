import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STREAMS_PER_USER,
  TYPING_TTL_MS,
  VISIBILITY_CACHE_MS,
  addClient,
  allowTyping,
  broadcastTyping,
  clientCount,
  clientsOfOrg,
  deliverEvent,
  filterVisible,
  flushDeliveredForTests,
  removeClient,
  resetHubForTests,
  setTyping,
  typingIn,
  type RtEvent as HubRtEvent,
} from "@/server/realtime/hub";
type Ev = { id: string; orgId: string; kind: string; ids: Record<string, string> };
const asEvent = (e: Ev) => e as unknown as HubRtEvent;
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { resetPresenceForTests } from "@/server/realtime/presence";

vi.mock("@/server/db", () => ({
  db: {
    // the presence layer records «آخر ظهور» through one raw UPDATE (fire-and-forget)
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: { update: vi.fn().mockResolvedValue({}) },
    conversation: { findUnique: vi.fn().mockResolvedValue({ kind: "DM" }) },
  },
}));
vi.mock("@/server/chat/read-state", () => ({ markDeliveredForUser: vi.fn().mockResolvedValue(undefined) }));
import { markDeliveredForUser } from "@/server/chat/read-state";
import { db } from "@/server/db";

type Reads = Record<string, boolean>;
function stubReads(map: Reads) {
  setPolicyStubs({
    canReadConversation: async (userId, conversationId) => map[`${userId}|${conversationId}`] ?? false,
  });
}

const ev = (id: string, kind: string, ids: Record<string, string>, orgId = "org1") => ({ id, orgId, kind, ids });

function connect(userId: string) {
  const sends: string[] = [];
  const closes: number[] = [];
  const client = addClient({ userId, orgId: "org1", send: (s) => sends.push(s), close: () => closes.push(1) });
  return { client, sends, closes };
}

function payloadOf(frame: string): Record<string, unknown> {
  const line = frame.split("\n").find((l) => l.startsWith("data: "));
  if (!line) throw new Error(`no data line in ${JSON.stringify(frame)}`);
  return JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
}

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  setPolicyStubs({});
  vi.clearAllMocks();
});
afterEach(() => {
  resetHubForTests();
  setPolicyStubs({});
  vi.useRealTimers();
});

describe("hub fan-out", () => {
  it("an event for conversation X reaches only clients allowed by the visibility check, ids only", async () => {
    stubReads({ "u1|cv1": true, "u2|cv1": false });
    const a = connect("u1");
    const b = connect("u2");
    await deliverEvent(asEvent(ev("7", "message.created", { conversationId: "cv1", messageId: "m1" })));

    expect(a.sends).toHaveLength(1);
    expect(b.sends).toHaveLength(0);
    const payload = payloadOf(a.sends[0]!);
    expect(payload).toEqual({ kind: "message.created", conversationId: "cv1", messageId: "m1" });
    expect(Object.keys(payload).every((k) => ["kind", "conversationId", "messageId", "spaceId", "userId"].includes(k))).toBe(true);
  });

  it("caches the visibility answer per client+conversation for 30 s", async () => {
    const canRead = vi.fn(async () => true);
    setPolicyStubs({ canReadConversation: canRead });
    const a = connect("u1");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));

    await deliverEvent(asEvent(ev("2", "message.reacted", { conversationId: "cv1" })));

    expect(canRead).toHaveBeenCalledTimes(1);
    // a DIFFERENT conversation is checked separately
    await deliverEvent(asEvent(ev("3", "message.created", { conversationId: "cv2" })));

    expect(canRead).toHaveBeenCalledTimes(2);
    expect(a.sends).toHaveLength(3);
  });

  it("membership.changed invalidates the cache; conversation.changed invalidates one conversation", async () => {
    const canRead = vi.fn(async () => true);
    setPolicyStubs({ canReadConversation: canRead });
    connect("u1");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));

    expect(canRead).toHaveBeenCalledTimes(1);
    await deliverEvent(asEvent(ev("2", "membership.changed", { userId: "u9" })));

    await deliverEvent(asEvent(ev("3", "message.created", { conversationId: "cv1" })));

    expect(canRead).toHaveBeenCalledTimes(2); // cache wiped org-wide

    await deliverEvent(asEvent(ev("4", "conversation.changed", { conversationId: "cv2" })));

    await deliverEvent(asEvent(ev("5", "message.created", { conversationId: "cv1" })));

    expect(canRead).toHaveBeenCalledTimes(3); // cv1 entry was NOT cleared by cv2's change
  });

  it("an event with a targetUserId goes only to that user", async () => {
    const a = connect("u1");
    const b = connect("u2");
    await deliverEvent(asEvent(ev("1", "membership.changed", { userId: "u2", targetUserId: "u2" })));

    expect(a.sends).toHaveLength(0);
    expect(b.sends).toHaveLength(1);
  });

  it("a read mark reaches the OTHER people of the conversation, not only the reader (live ticks)", async () => {
    stubReads({ "u1|cv1": true, "u2|cv1": true, "u3|cv1": false });
    const reader = connect("u1");
    const sender = connect("u2");
    const outsider = connect("u3");
    await deliverEvent(asEvent(ev("1", "conversation.read", { conversationId: "cv1", userId: "u1" })));

    expect(sender.sends).toHaveLength(1);
    expect(payloadOf(sender.sends[0]!)).toMatchObject({ kind: "conversation.read", conversationId: "cv1", userId: "u1" });
    expect(reader.sends).toHaveLength(1);
    expect(outsider.sends).toHaveLength(0);
  });

  it("a targeted event never reaches anybody else, even somebody who may read its conversation", async () => {
    stubReads({ "u1|cv1": true, "u2|cv1": true });
    const a = connect("u1");
    const b = connect("u2");
    await deliverEvent(asEvent(ev("1", "conversation.changed", { conversationId: "cv1", targetUserId: "u2" })));

    expect(a.sends).toHaveLength(0);
    expect(b.sends).toHaveLength(1);
  });

  it("an event with neither conversation nor userId goes to the whole organization", async () => {
    const a = connect("u1");
    connect("u2"); // org1
    const other = addClient({ userId: "u3", orgId: "org2", send: () => undefined, close: () => undefined });
    await deliverEvent(asEvent(ev("1", "conversation.changed", { spaceId: "ws1" })));

    expect(clientsOfOrg("org1")).toHaveLength(2);
    expect(a.sends).toHaveLength(1);
    expect(other.send).toBeDefined();
    expect(clientCount()).toBe(3);
  });

  it("a message.created for a DM marks the connected people who may see it as delivered, once each, for that DM only", async () => {
    stubReads({ "u1|cv1": true, "u2|cv1": true, "u3|cv1": false });
    connect("u1"); // the author's other tab (read-state leaves the author's own message alone)
    connect("u2"); // the recipient
    connect("u2"); // ... in a second tab
    connect("u3"); // may not see it
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1", messageId: "m1" })));
    expect(markDeliveredForUser).not.toHaveBeenCalled(); // C1.3: written a second later, once per person, not inside the fan-out
    await flushDeliveredForTests();

    expect(markDeliveredForUser).toHaveBeenCalledWith("u1", "cv1");
    expect(markDeliveredForUser).toHaveBeenCalledWith("u2", "cv1");
    expect(markDeliveredForUser).toHaveBeenCalledTimes(2);
  });

  it("a topic's message marks nothing delivered (ticks are for DMs)", async () => {
    vi.mocked(db.conversation.findUnique).mockResolvedValueOnce({ kind: "TOPIC" } as never);
    stubReads({ "u2|cv1": true });
    connect("u2");
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1", messageId: "m1" })));
    await flushDeliveredForTests();

    expect(markDeliveredForUser).not.toHaveBeenCalled();
  });
});

describe("the 5-stream limit", () => {
  it("closes the oldest stream of a user beyond five", () => {
    const closes: number[][] = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      const c = connect("u1");
      closes.push(c.closes);
    }
    expect(clientCount()).toBe(MAX_STREAMS_PER_USER);
    const sixth = connect("u1");
    expect(clientCount()).toBe(MAX_STREAMS_PER_USER);
    expect(closes[0]!.length).toBe(1); // the oldest was closed
    expect(sixth.client.cid).toBeGreaterThan(0);
  });

  it("a closed client stops receiving", async () => {
    stubReads({ "u1|cv1": true });
    const a = connect("u1");
    removeClient(a.client);
    await deliverEvent(asEvent(ev("1", "message.created", { conversationId: "cv1" })));

    expect(a.sends).toHaveLength(0);
  });
});

describe("typing", () => {
  it("expires after 6 s", () => {
    vi.useFakeTimers();
    setTyping("cv1", "u1", "سالم");
    expect(typingIn("cv1")).toEqual([{ userId: "u1", name: "سالم" }]);
    vi.advanceTimersByTime(TYPING_TTL_MS + 1);
    expect(typingIn("cv1")).toEqual([]);
  });

  it("broadcasts to the OTHER viewers who may read the conversation, never the sender", async () => {
    stubReads({ "u1|cv1": true, "u2|cv1": true, "u3|cv1": false });
    const sender = connect("u1");
    const peer = connect("u2");
    connect("u3"); // may not read
    const sent = await broadcastTyping("org1", "cv1", "u1", "سالم");
    expect(sent).toBe(1);
    expect(sender.sends).toHaveLength(0);
    expect(payloadOf(peer.sends[0]!)).toEqual({ kind: "typing", conversationId: "cv1", userId: "u1", name: "سالم" });
  });

  it("throttles typing to one emission per 2 s per user+conversation", () => {
    expect(allowTyping("u1|cv1", 1000)).toBe(true);
    expect(allowTyping("u1|cv1", 1500)).toBe(false);
    expect(allowTyping("u1|cv1", 3001)).toBe(true);
  });
});

describe("replay visibility filter", () => {
  it("keeps only events the person may read; targeted events only for their target (the live rules)", async () => {
    stubReads({ "u1|cv1": true });
    const rows = [
      ev("1", "message.created", { conversationId: "cv1" }),
      ev("2", "message.created", { conversationId: "cv2" }),
      ev("3", "membership.changed", { userId: "u2", targetUserId: "u2" }),
      ev("4", "conversation.changed", { spaceId: "ws1" }),
      ev("5", "conversation.read", { conversationId: "cv1", userId: "u2" }),
    ];
    const out = await filterVisible("u1", rows);
    expect(out.map((r) => r.id)).toEqual(["1", "4", "5"]);
  });
});
