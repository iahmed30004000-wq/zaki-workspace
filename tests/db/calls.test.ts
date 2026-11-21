import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jwtVerify } from "jose";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as meetingsRoute from "@/app/api/calls/route";
import * as callRoute from "@/app/api/calls/[id]/route";
import * as tokenRoute from "@/app/api/calls/[id]/token/route";
import * as inviteRoute from "@/app/api/calls/[id]/invite/route";
import * as removeRoute from "@/app/api/calls/[id]/remove/route";
import * as leaveRoute from "@/app/api/calls/[id]/leave/route";
import * as endRoute from "@/app/api/calls/[id]/end/route";
import * as muteRoute from "@/app/api/calls/[id]/mute/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import type { Prisma } from "@prisma/client";
import { setCallsFetchForTests, roomOf } from "@/server/calls/livekit";
import { withFeature } from "@/lib/features";
import { EMPTY_GRACE_MS } from "@/server/calls/calls";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

const SECRET = "test-calls-secret-0123456789abcdef0123456789";
const saved: Record<string, string | undefined> = {};

/** The calls server, faked: who is in which room, and who was taken out. */
const rooms = new Map<string, string[]>();
const removed: { room: string; identity: string }[] = [];
const closed: string[] = [];
const muted: { room: string; identity: string; track: string }[] = [];

beforeAll(() => {
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setCallsFetchForTests(null);
});
beforeEach(() => {
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = SECRET;
  rooms.clear();
  removed.length = 0;
  closed.length = 0;
  muted.length = 0;
  setCallsFetchForTests(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as { room: string; identity?: string };
    if (url.endsWith("/ListParticipants")) {
      if (!rooms.has(body.room)) return new Response(JSON.stringify({ code: "not_found" }), { status: 404 });
      return Response.json({
        participants: (rooms.get(body.room) ?? []).map((identity) => ({ identity, name: identity, tracks: [{ sid: `TR_mic_${identity}`, type: "AUDIO", source: "MICROPHONE" }, { sid: `TR_cam_${identity}`, type: "VIDEO", source: "CAMERA" }] })),
      });
    }
    if (url.endsWith("/DeleteRoom")) {
      closed.push(body.room);
      rooms.delete(body.room);
      return Response.json({});
    }
    if (url.endsWith("/MutePublishedTrack")) {
      const b = body as unknown as { room: string; identity: string; track_sid: string };
      muted.push({ room: b.room, identity: b.identity, track: b.track_sid });
      return Response.json({});
    }
    if (url.endsWith("/RemoveParticipant")) {
      removed.push({ room: body.room, identity: body.identity ?? "" });
      return Response.json({});
    }
    return new Response("?", { status: 400 });
  });
});

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

async function topicOf(orgId: string, spaceId: string, extra: Record<string, unknown> = {}) {
  return db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId, title: "General", ...extra } });
}

async function start(conversationId: string, body: Record<string, unknown> = {}) {
  return call(convCallRoute.POST, { params: { id: conversationId }, body: { video: false, ring: true, ...body } });
}

async function pass(callId: string) {
  return call(tokenRoute.POST, { method: "POST", params: { id: callId } });
}

async function ringsOf(callId: string) {
  const rows = await db.realtimeEvent.findMany({ where: { kind: "call.ring" } });
  return rows.map((r) => r.ids as Record<string, string>).filter((ids) => ids["callId"] === callId).map((ids) => ids["targetUserId"]);
}

async function space() {
  const t = await makeTeam();
  const other = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Other" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }]);
  return { ...t, other, ws };
}

describe("calls: who gets a pass", () => {
  it("a reader of the topic gets a two-minute pass for that call's room only, signed for the calls server", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const started = await start(topic.id);
    expect(started.status).toBe(201);
    const id = started.json?.["id"] as string;

    await loginAs(t.admin.id);
    const p = await pass(id);
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ url: "wss://calls.test.local", room: roomOf(id) });
    const { payload } = await jwtVerify(p.json?.["token"] as string, new TextEncoder().encode(SECRET));
    expect(payload.sub).toBe(t.admin.id);
    expect(payload.iss).toBe("test-key");
    expect(payload["video"]).toMatchObject({ room: roomOf(id), roomJoin: true });
    expect((payload.exp as number) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(120);
  });

  it("the pass says whether the microphone is cleaned of noise: on unless the owner switched «تنقية صوت المكالمات» off", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    expect((await pass(id)).json?.["noiseFilter"]).toBe(true);

    const org = await db.organization.findUniqueOrThrow({ where: { id: t.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature(org.settings, "callNoiseFilter", false) as Prisma.InputJsonValue } });
    const off = await pass(id);
    expect(off.status).toBe(200); // the call itself is untouched: only the filter is off
    expect(off.json?.["noiseFilter"]).toBe(false);
  });

  it("somebody who may not read the conversation gets no pass, and no word that the call exists", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    await loginAs(t.other.id); // in the company, not in the space
    expect((await pass(id)).status).toBe(404);
    expect((await call(callRoute.GET, { params: { id } })).status).toBe(404);
    expect((await call(convCallRoute.GET, { params: { id: topic.id } })).status).toBe(404);
  });

  it("another company's member gets nothing, whatever their rank there", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    const foreign = await makeTeam();
    await loginAs(foreign.owner.id);
    expect((await pass(id)).status).toBe(404);
  });

  it("the owner joins any call silently allowed, but does not START one where he has not joined", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.owner.id);
    const refused = await start(topic.id);
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("calls.e.cannot_start");
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    await loginAs(t.owner.id);
    expect((await pass(id)).status).toBe(200);
  });
});

describe("calls: who starts one", () => {
  it("a muted person, and a guest in announcements, cannot start a call (writing comes first)", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: t.ws.id, userId: t.member.id } }, data: { mutedUntil: new Date(Date.now() + 3600_000) } });
    await loginAs(t.member.id);
    expect((await start(topic.id)).status).toBe(403);

    const news = await topicOf(t.org.id, t.ws.id, { topicType: "ANNOUNCEMENTS", title: "News" });
    await loginAs(t.guest.id);
    expect((await start(news.id)).status).toBe(403);
  });

  it("one call per conversation: starting again hands back the call going on", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const first = await start(topic.id);
    await loginAs(t.admin.id);
    const second = await start(topic.id);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ id: first.json?.["id"], created: false });
    expect(await db.call.count({ where: { conversationId: topic.id } })).toBe(1);
  });

  it("starting writes «بلّش مكالمة» in the conversation", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    await start(topic.id, { video: true });
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: topic.id, kind: "SYSTEM" } });
    expect(JSON.parse(line.body)).toEqual({ k: "call_started", p: { video: 1 } });
  });

  it("without the calls server's settings it says so instead of starting a call nobody can join", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    delete process.env["LIVEKIT_API_SECRET"];
    await loginAs(t.member.id);
    const res = await start(topic.id);
    expect(res.status).toBe(403);
    expect(res.text).toContain("calls.e.not_configured");
    expect(await db.call.count({ where: { conversationId: topic.id } })).toBe(0);
  });
});

describe("calls: the ring", () => {
  it("a topic call rings the space's people — not the caller, and not the owner who only reads silently", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    expect((await ringsOf(id)).sort()).toEqual([t.admin.id, t.guest.id].sort());
  });

  it("«بدون رنّة» rings nobody; the conversation still hears that a call started", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id, { ring: false })).json?.["id"] as string;
    expect(await ringsOf(id)).toEqual([]);
    expect(await db.realtimeEvent.count({ where: { kind: "call.changed", ids: { path: ["callId"], equals: id } } })).toBe(1);
  });

  it("a person who muted the topic for themselves is not rung; the others are; the caller never is", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await db.conversationMember.create({ data: { conversationId: topic.id, userId: t.admin.id, mutedUntil: new Date(Date.now() + 3_600_000) } });
    await db.conversationMember.create({ data: { conversationId: topic.id, userId: t.guest.id, mutedUntil: new Date(Date.now() - 1000) } }); // an old mute is over
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    expect(await ringsOf(id)).toEqual([t.guest.id]);
  });

  it("a person who muted their private chat is still rung by it (a call there is deliberate)", async () => {
    const t = await space();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    await db.conversationMember.update({ where: { conversationId_userId: { conversationId: dm, userId: t.admin.id } }, data: { mutedUntil: new Date(Date.now() + 3_600_000) } });
    const id = (await start(dm)).json?.["id"] as string;
    expect(await ringsOf(id)).toEqual([t.admin.id]);
  });

  it("a DM always rings its other person, and only them", async () => {
    const t = await space();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const id = (await start(dm, { ring: false })).json?.["id"] as string;
    expect(await ringsOf(id)).toEqual([t.admin.id]);
  });

  it("a restricted topic rings its own people only", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id, { restricted: true, members: { create: [{ userId: t.member.id }, { userId: t.admin.id }] } });
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    expect(await ringsOf(id)).toEqual([t.admin.id]);
  });
});

describe("calls: what the call's page says about the ring (the caller's ringback is for a private call only)", () => {
  it("a private call says it is one, and tells its STARTER that somebody was rung; the other person is told nothing of the ringing", async () => {
    const t = await space();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const id = (await start(dm)).json?.["id"] as string;
    const mine = (await call(callRoute.GET, { params: { id } })).json as { kind: string; rangCount: number };
    expect(mine).toMatchObject({ kind: "DM", rangCount: 1 });
    await loginAs(t.admin.id);
    expect(((await call(callRoute.GET, { params: { id } })).json as { rangCount: number }).rangCount).toBe(0);
  });

  it("a topic call says «topic»: how many it rang when started with the ring, none without it", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const rung = (await start(topic.id, { ring: true })).json?.["id"] as string;
    const view = (await call(callRoute.GET, { params: { id: rung } })).json as { kind: string; rangCount: number };
    expect(view.kind).toBe("TOPIC");
    expect(view.rangCount).toBe((await ringsOf(rung)).length);
    await db.call.update({ where: { id: rung }, data: { endedAt: new Date() } });
    const quiet = (await start(topic.id, { ring: false })).json?.["id"] as string;
    expect(((await call(callRoute.GET, { params: { id: quiet } })).json as { rangCount: number }).rangCount).toBe(0);
  });

  it("a meeting is a meeting, and rang nobody", async () => {
    const t = await space();
    jar().set(SPACE_COOKIE, t.ws.id);
    await loginAs(t.member.id);
    const id = (await call(meetingsRoute.POST, { body: { title: "الصباح", video: true } })).json?.["id"] as string;
    jar().delete(SPACE_COOKIE);
    const view = (await call(callRoute.GET, { params: { id } })).json as { kind: string; rangCount: number };
    expect(view).toMatchObject({ kind: "MEETING", rangCount: 0 });
  });
});

describe("calls: the join bar (who is in, and who started it)", () => {
  it("the call going on lists up to three of the people in the room and their count, for the bar under the header", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id, { ring: false })).json?.["id"] as string;
    expect(((await call(convCallRoute.GET, { params: { id: topic.id } })).json as { call: { count: number; people: unknown[] } }).call).toMatchObject({ count: 0, people: [] });
    const extra = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Extra" });
    const more = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "More" });
    rooms.set(roomOf(id), [t.member.id, t.admin.id, extra.id, more.id]);
    const live = (await call(convCallRoute.GET, { params: { id: topic.id } })).json as { call: { id: string; count: number; people: { userId: string; name: string }[] } };
    expect(live.call.id).toBe(id);
    expect(live.call.count).toBe(4);
    expect(live.call.people).toHaveLength(3);
    expect(live.call.people[0]).toMatchObject({ userId: t.member.id, name: "Member" });
  });

  it("the call's page says whether the viewer started it (a topic's joiners enter with the microphone off)", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id, { ring: false })).json?.["id"] as string;
    expect(((await call(callRoute.GET, { params: { id } })).json as { startedByMe: boolean }).startedByMe).toBe(true);
    await loginAs(t.admin.id);
    expect(((await call(callRoute.GET, { params: { id } })).json as { startedByMe: boolean }).startedByMe).toBe(false);
  });
});

describe("calls: add somebody, take somebody out", () => {
  it("«ضيف حدا» rings one of the space's people in: they join the CALL without reading the restricted topic", async () => {
    const t = await space();
    const extra = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Extra" });
    await db.workspaceMember.create({ data: { workspaceId: t.ws.id, userId: extra.id } });
    const topic = await topicOf(t.org.id, t.ws.id, { restricted: true, members: { create: [{ userId: t.member.id }] } });
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;

    await loginAs(extra.id);
    expect((await pass(id)).status).toBe(404); // not yet

    await loginAs(t.member.id);
    expect((await call(inviteRoute.POST, { params: { id }, body: { userId: extra.id } })).status).toBe(200);
    expect(await ringsOf(id)).toContain(extra.id);

    await loginAs(extra.id);
    expect((await pass(id)).status).toBe(200);
    // the call, not the conversation
    expect((await call(convCallRoute.GET, { params: { id: topic.id } })).status).toBe(404);
  });

  it("nobody from outside the space is rung in, and a guest rings nobody in", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    const outside = await call(inviteRoute.POST, { params: { id }, body: { userId: t.other.id } });
    expect(outside.status).toBe(403);
    expect(outside.text).toContain("calls.e.not_in_space");
    await loginAs(t.guest.id);
    expect((await call(inviteRoute.POST, { params: { id }, body: { userId: t.admin.id } })).status).toBe(403);
  });

  it("the caller takes somebody out: out of the room at once, and no new pass for this call", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    rooms.set(roomOf(id), [t.member.id, t.guest.id]);
    expect((await call(removeRoute.POST, { params: { id }, body: { userId: t.guest.id } })).status).toBe(200);
    expect(removed).toEqual([{ room: roomOf(id), identity: t.guest.id }]);
    await loginAs(t.guest.id);
    expect((await pass(id)).status).toBe(404);
  });

  it("a plain member who did not start the call takes nobody out, and nobody takes the owner out", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    const extra = await makeUser({ orgId: t.org.id, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: t.ws.id, userId: extra.id } });
    await loginAs(extra.id);
    expect((await call(removeRoute.POST, { params: { id }, body: { userId: t.member.id } })).status).toBe(403);
    await loginAs(t.admin.id); // the space's admin moderates the topic
    expect((await call(removeRoute.POST, { params: { id }, body: { userId: extra.id } })).status).toBe(200);
    expect((await call(removeRoute.POST, { params: { id }, body: { userId: t.owner.id } })).status).toBe(403);
    await loginAs(t.owner.id);
    expect((await pass(id)).status).toBe(200);
  });
});

describe("calls: meetings by link, and the end", () => {
  it("a meeting is for the people of the space it was opened in; a guest opens none", async () => {
    const t = await space();
    jar().set(SPACE_COOKIE, t.ws.id);
    await loginAs(t.member.id);
    const made = await call(meetingsRoute.POST, { body: { title: "Weekly", video: true } });
    expect(made.status).toBe(201);
    const id = made.json?.["id"] as string;
    expect(made.json?.["path"]).toBe(`/calls/${id}`);

    await loginAs(t.admin.id);
    expect((await pass(id)).status).toBe(200);
    await loginAs(t.other.id);
    expect((await pass(id)).status).toBe(404);

    await loginAs(t.guest.id);
    expect((await call(meetingsRoute.POST, { body: { title: "x" } })).status).toBe(403);
    jar().delete(SPACE_COOKIE);
  });

  it("a call nobody is in any more ends: its line in the conversation, and no pass after it", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    // still inside the first minute: the first person may still be connecting
    await call(leaveRoute.POST, { method: "POST", params: { id } });
    expect((await db.call.findUniqueOrThrow({ where: { id } })).endedAt).toBeNull();

    await db.call.update({ where: { id }, data: { startedAt: new Date(Date.now() - EMPTY_GRACE_MS - 1000) } });
    rooms.set(roomOf(id), [t.member.id]);
    await call(leaveRoute.POST, { method: "POST", params: { id } });
    expect((await db.call.findUniqueOrThrow({ where: { id } })).endedAt).toBeNull(); // somebody is still in

    rooms.set(roomOf(id), []);
    await call(leaveRoute.POST, { method: "POST", params: { id } });
    expect((await db.call.findUniqueOrThrow({ where: { id } })).endedAt).not.toBeNull();
    const lines = await db.chatMessage.findMany({ where: { conversationId: topic.id, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => (JSON.parse(l.body) as { k: string }).k)).toEqual(["call_started", "call_ended"]);
    const after = await pass(id);
    expect(after.status).toBe(403);
    expect(after.text).toContain("calls.e.ended");
    expect((await call(convCallRoute.GET, { params: { id: topic.id } })).json).toEqual({ call: null });
  });

  it("an ended DM call tells nobody else of the space that the two talked", async () => {
    const t = await space();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const id = (await start(dm)).json?.["id"] as string;
    await db.call.update({ where: { id }, data: { endedAt: new Date() } });
    expect((await call(callRoute.GET, { params: { id } })).status).toBe(200); // its own people still see «خلصت»
    await loginAs(t.guest.id); // of the space, not of the DM
    expect((await call(callRoute.GET, { params: { id } })).status).toBe(404);
  });

  it("a calls server that cannot be asked ends nothing", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    await db.call.update({ where: { id }, data: { startedAt: new Date(Date.now() - EMPTY_GRACE_MS - 1000) } });
    setCallsFetchForTests(async () => new Response("down", { status: 502 }));
    await call(leaveRoute.POST, { method: "POST", params: { id } });
    expect((await db.call.findUniqueOrThrow({ where: { id } })).endedAt).toBeNull();
  });

  it("the call's page lists who is in the room, with who may be taken out", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    rooms.set(roomOf(id), [t.member.id, t.admin.id, t.owner.id]);
    const res = await call(callRoute.GET, { params: { id } });
    expect(res.status).toBe(200);
    const people = res.json?.["people"] as { userId: string; canRemove: boolean }[];
    expect(Object.fromEntries(people.map((p) => [p.userId, p.canRemove]))).toEqual({ [t.member.id]: false, [t.admin.id]: true, [t.owner.id]: false });
  });
});

describe("calls: the host ends the call for everybody, and mutes", () => {
  it("whoever started the call ends it for everybody: its end, its line, the room closed on the calls server", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    rooms.set(roomOf(id), [t.member.id, t.guest.id]);
    expect((await call(callRoute.GET, { params: { id } })).json).toMatchObject({ can: { end: true } });

    expect((await call(endRoute.POST, { method: "POST", params: { id } })).status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id } })).endedAt).not.toBeNull();
    expect(closed).toEqual([roomOf(id)]);
    const lines = await db.chatMessage.findMany({ where: { conversationId: topic.id, kind: "SYSTEM" }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => (JSON.parse(l.body) as { k: string }).k)).toEqual(["call_started", "call_ended"]);
    expect(await db.realtimeEvent.count({ where: { kind: "call.changed", ids: { path: ["callId"], equals: id } } })).toBe(2);
    await loginAs(t.guest.id);
    expect((await pass(id)).status).toBe(403); // ended: no way back in
  });

  it("somebody who did not start it gets 403 on ending: they only leave, and the call goes on", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    const extra = await makeUser({ orgId: t.org.id, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: t.ws.id, userId: extra.id } });
    await loginAs(extra.id);
    expect((await call(callRoute.GET, { params: { id } })).json).toMatchObject({ can: { end: false } });
    const refused = await call(endRoute.POST, { method: "POST", params: { id } });
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("calls.e.cannot_end");
    expect((await db.call.findUniqueOrThrow({ where: { id } })).endedAt).toBeNull();
    expect(closed).toEqual([]);
  });

  it("the space's admin and the owner end a call they did not start", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const a = (await start(topic.id)).json?.["id"] as string;
    await loginAs(t.admin.id);
    expect((await call(endRoute.POST, { method: "POST", params: { id: a } })).status).toBe(200);

    await loginAs(t.member.id);
    const b = (await start(topic.id)).json?.["id"] as string;
    await loginAs(t.owner.id);
    expect((await call(endRoute.POST, { method: "POST", params: { id: b } })).status).toBe(200);
  });

  it("a host mutes somebody's microphone on the calls server; nobody else does, and nobody mutes the owner", async () => {
    const t = await space();
    const topic = await topicOf(t.org.id, t.ws.id);
    await loginAs(t.member.id);
    const id = (await start(topic.id)).json?.["id"] as string;
    rooms.set(roomOf(id), [t.member.id, t.guest.id, t.owner.id]);
    expect((await call(muteRoute.POST, { params: { id }, body: { userId: t.guest.id } })).status).toBe(200);
    expect(muted).toEqual([{ room: roomOf(id), identity: t.guest.id, track: `TR_mic_${t.guest.id}` }]);
    expect((await call(muteRoute.POST, { params: { id }, body: { userId: t.owner.id } })).status).toBe(403);

    await loginAs(t.guest.id);
    const refused = await call(muteRoute.POST, { params: { id }, body: { userId: t.member.id } });
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("calls.e.cannot_mute");
    expect(muted).toHaveLength(1);
  });
});
