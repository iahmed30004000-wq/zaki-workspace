import { beforeEach, describe, expect, it } from "vitest";
import * as presenceRoute from "@/app/api/presence/route";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as oversightOne from "@/app/api/chat/oversight/conversations/[id]/route";
import * as userRoute from "@/app/api/users/[id]/route";
import * as searchRoute from "@/app/api/search/route";
import * as lastSeenRoute from "@/app/api/me/last-seen/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { createTopic } from "@/server/chat/topics";
import { lastSeenReader } from "@/server/services/last-seen";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «آخر ظهور», who may see it (the owner, 2026-10-31). Decided on the SERVER, in the answer's builder: every test below
 * reads the raw answer of a real route, never a screen. The matrix is in src/server/services/last-seen.ts.
 */
const SEEN = new Date("2026-10-31T09:30:00.000Z");
const iso = SEEN.toISOString();

beforeEach(() => resetPresenceForTests());

async function setSeen(userId: string, when: Date | null = SEEN): Promise<void> {
  await db.organizationMember.updateMany({ where: { userId }, data: { lastSeenAt: when } });
}
async function setHide(userId: string, hide: boolean | null): Promise<void> {
  await db.organizationMember.updateMany({ where: { userId }, data: { hideLastSeen: hide } });
}
async function setFeature(orgId: string, key: FeatureKey, on: boolean): Promise<void> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as never } });
}

type DockRow = { userId: string; online: boolean; lastSeenAt?: string | null };
async function dock(): Promise<{ status: number; rows: Map<string, DockRow>; json: Record<string, unknown> | null; text: string }> {
  const res = await call(presenceRoute.GET);
  const rows = new Map(((res.json?.["people"] ?? []) as DockRow[]).map((p) => [p.userId, p]));
  return { status: res.status, rows, json: res.json, text: res.text };
}

/** A team with one more colleague, everybody with a recorded last seen. */
async function world() {
  const t = await makeTeam();
  const mate = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Mate" });
  for (const u of [t.owner, t.admin, t.member, mate, t.guest]) await setSeen(u.id);
  return { ...t, mate };
}

describe("the people dock", () => {
  it("a colleague sees everybody's real last seen, with the company's zone; the viewer sees their own", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const d = await dock();
    expect(d.status).toBe(200);
    expect(d.json?.["timeZone"]).toBe("Asia/Damascus");
    for (const u of [w.owner, w.admin, w.mate, w.member]) expect(d.rows.get(u.id)?.lastSeenAt, u.id).toBe(iso);
  });

  it("a person with nothing recorded yet is null (unknown), not absent", async () => {
    const w = await world();
    await setSeen(w.mate.id, null);
    await loginAs(w.member.id);
    const d = await dock();
    expect(d.rows.get(w.mate.id)).toHaveProperty("lastSeenAt", null);
  });

  it("an external partner is refused the dock, and nothing of the field is in the refusal", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const d = await dock();
    expect(d.status).toBe(403);
    expect(d.text).not.toContain("lastSeenAt");
    expect(d.text).not.toContain(iso);
  });

  it("the switch off: no field, no zone, the answer is the old one", async () => {
    const w = await world();
    await setFeature(w.org.id, "lastSeen", false);
    await loginAs(w.member.id);
    const d = await dock();
    expect(d.status).toBe(200);
    expect(d.text).not.toContain("lastSeenAt");
    expect(d.json).not.toHaveProperty("timeZone");
  });

  it("a suspended or offboarded colleague is not on the roster at all", async () => {
    const w = await world();
    await db.organizationMember.updateMany({ where: { userId: w.mate.id }, data: { status: "SUSPENDED" } });
    await loginAs(w.member.id);
    const d = await dock();
    expect(d.rows.has(w.mate.id)).toBe(false);
    expect(d.text).not.toContain(w.mate.id);
  });

  it("«إخفاء آخر ظهوري»: the colleague who hid shows null to a colleague, real to the owner; they still show online while online", async () => {
    const w = await world();
    await setHide(w.mate.id, true);
    touchPresence(w.mate.id);
    await loginAs(w.member.id);
    const seenByMember = (await dock()).rows.get(w.mate.id);
    expect(seenByMember?.lastSeenAt).toBeNull();
    expect(seenByMember?.online).toBe(true); // hidden affects only the TIME, never the dot
    await loginAs(w.owner.id);
    expect((await dock()).rows.get(w.mate.id)?.lastSeenAt).toBe(iso);
  });

  it("reciprocity: a person who hides theirs sees nobody's (null); the owner who hides his own still sees all", async () => {
    const w = await world();
    await setHide(w.member.id, true);
    await loginAs(w.member.id);
    const mine = await dock();
    for (const u of [w.owner, w.admin, w.mate]) expect(mine.rows.get(u.id)?.lastSeenAt, u.id).toBeNull();
    // not "absent": the screen says «غير معروف», not the old «غير متصل»
    for (const u of [w.owner, w.admin, w.mate]) expect(mine.rows.get(u.id)).toHaveProperty("lastSeenAt");

    await setHide(w.owner.id, true);
    await loginAs(w.owner.id);
    const his = await dock();
    for (const u of [w.admin, w.mate, w.member]) expect(his.rows.get(u.id)?.lastSeenAt, u.id).toBe(iso);
  });

  it("the owner sees everybody; hidden from the others when «إخفاء المالك من متصل» is on (null and not online), like the dot", async () => {
    const w = await world();
    touchPresence(w.owner.id);
    await loginAs(w.member.id);
    const open = (await dock()).rows.get(w.owner.id);
    expect(open?.lastSeenAt).toBe(iso);
    expect(open?.online).toBe(true);

    await setFeature(w.org.id, "ownerHiddenOnline", true);
    for (const viewer of [w.member, w.admin]) {
      await loginAs(viewer.id);
      const row = (await dock()).rows.get(w.owner.id);
      expect(row?.lastSeenAt, viewer.id).toBeNull();
      expect(row?.online, viewer.id).toBe(false);
    }
    // he still sees himself, and everybody else
    await loginAs(w.owner.id);
    const his = await dock();
    expect(his.rows.get(w.owner.id)?.lastSeenAt).toBe(iso);
    for (const u of [w.admin, w.member, w.mate]) expect(his.rows.get(u.id)?.lastSeenAt, u.id).toBe(iso);
  });

  it("a co-owner is an owner: he sees every real time, and the primary owner hides from him like from anybody (the dot's rule)", async () => {
    const w = await world();
    const co = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Co-owner" });
    // makeUser marks every OWNER primary: this one is a partner
    await db.organizationMember.updateMany({ where: { userId: co.id }, data: { primaryOwner: false } });
    await setSeen(co.id);
    await setHide(w.mate.id, true);
    await loginAs(co.id);
    expect((await dock()).rows.get(w.mate.id)?.lastSeenAt).toBe(iso);
    await setFeature(w.org.id, "ownerHiddenOnline", true);
    expect((await dock()).rows.get(w.owner.id)?.lastSeenAt).toBeNull();
  });

  it("the PRIMARY owner reads a hidden partner's real time (the switch hides owners from everybody else, a partner included)", async () => {
    const w = await world();
    const co = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Co-owner" });
    await db.organizationMember.updateMany({ where: { userId: co.id }, data: { primaryOwner: false } });
    await setSeen(co.id);
    await setFeature(w.org.id, "ownerHiddenOnline", true);
    // the primary owner sees the partner
    await loginAs(w.owner.id);
    expect((await dock()).rows.get(co.id)?.lastSeenAt).toBe(iso);
    // another partner and everybody else do not
    const co2 = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Second partner" });
    await db.organizationMember.updateMany({ where: { userId: co2.id }, data: { primaryOwner: false } });
    await setSeen(co2.id);
    await loginAs(co2.id);
    expect((await dock()).rows.get(co.id)?.lastSeenAt).toBeNull();
    await loginAs(w.member.id);
    expect((await dock()).rows.get(co.id)?.lastSeenAt).toBeNull();
  });

  it("the company's other people are another company's: a person in two companies is read in the company of the request", async () => {
    const w = await world();
    const other = await makeOrg();
    await db.organizationMember.create({ data: { organizationId: other.id, userId: w.mate.id, role: "MEMBER", lastSeenAt: new Date("2020-01-01T00:00:00Z") } });
    await loginAs(w.member.id);
    expect((await dock()).rows.get(w.mate.id)?.lastSeenAt).toBe(iso);
  });
});

describe("the directories (the quick chat's company list and the chat's picker)", () => {
  type Row = { userId: string; online?: boolean; inSpace?: boolean; lastSeenAt?: string | null };
  const list = async (url: string) => {
    const res = await call(directoryRoute.GET, { url });
    return { res, rows: new Map(((res.json?.["people"] ?? []) as Row[]).map((r) => [r.userId, r])) };
  };

  it("both carry lastSeenAt and the zone for a colleague; the viewer is not in them", async () => {
    const w = await world();
    // the picker lists the people of the space the person is in
    await makeWorkspace(w.org.id, [{ userId: w.member.id }, { userId: w.mate.id }, { userId: w.admin.id }]);
    await loginAs(w.member.id);
    for (const url of ["http://localhost/api/chat/directory?scope=company", "http://localhost/api/chat/directory"]) {
      const { res, rows } = await list(url);
      expect(res.status).toBe(200);
      expect(res.json?.["timeZone"]).toBe("Asia/Damascus");
      expect(rows.get(w.mate.id)?.lastSeenAt, url).toBe(iso);
      expect(rows.get(w.owner.id)?.lastSeenAt, url).toBe(iso);
      expect(rows.has(w.member.id)).toBe(false);
    }
  });

  it("hidden, reciprocity and the owner's switch hold here too", async () => {
    const w = await world();
    await makeWorkspace(w.org.id, [{ userId: w.member.id }, { userId: w.mate.id }, { userId: w.admin.id }]);
    await setHide(w.mate.id, true);
    await loginAs(w.member.id);
    expect((await list("http://localhost/api/chat/directory?scope=company")).rows.get(w.mate.id)?.lastSeenAt).toBeNull();
    await loginAs(w.owner.id);
    expect((await list("http://localhost/api/chat/directory?scope=company")).rows.get(w.mate.id)?.lastSeenAt).toBe(iso);

    await setFeature(w.org.id, "ownerHiddenOnline", true);
    await loginAs(w.admin.id);
    expect((await list("http://localhost/api/chat/directory?scope=company")).rows.get(w.owner.id)?.lastSeenAt).toBeNull();
    expect((await list("http://localhost/api/chat/directory")).rows.get(w.owner.id)?.lastSeenAt).toBeNull();

    await setHide(w.admin.id, true);
    expect((await list("http://localhost/api/chat/directory?scope=company")).rows.get(w.mate.id)?.lastSeenAt).toBeNull();
  });

  it("a guest is refused both, and the refusal carries no field", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    for (const url of ["http://localhost/api/chat/directory?scope=company", "http://localhost/api/chat/directory"]) {
      const { res } = await list(url);
      expect(res.status).toBe(403);
      expect(res.text).not.toContain("lastSeenAt");
    }
  });

  it("the switch off: neither the rows nor the answer carry anything of it", async () => {
    const w = await world();
    await setFeature(w.org.id, "lastSeen", false);
    await loginAs(w.member.id);
    for (const url of ["http://localhost/api/chat/directory?scope=company", "http://localhost/api/chat/directory"]) {
      const { res } = await list(url);
      expect(res.status).toBe(200);
      expect(res.text, url).not.toContain("lastSeenAt");
      expect(res.json, url).not.toHaveProperty("timeZone");
    }
  });
});

describe("a private chat's header", () => {
  async function dmOf(a: string, b: string): Promise<string> {
    await loginAs(a);
    const made = await call(dmRoute.POST, { body: { userId: b } });
    expect(made.status).toBeLessThan(300);
    return made.json?.["id"] as string;
  }
  const detail = async (id: string) => {
    const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } });
    expect(res.status).toBe(200);
    return res.json as unknown as ConversationDto & Record<string, unknown>;
  };

  it("shows the OTHER person's last seen and nothing about anyone else", async () => {
    const w = await world();
    await setSeen(w.admin.id, new Date("2026-10-30T08:00:00Z"));
    const id = await dmOf(w.member.id, w.admin.id);
    const mine = await detail(id);
    expect(mine.peerLastSeenAt).toBe("2026-10-30T08:00:00.000Z");
    expect(mine.timeZone).toBe("Asia/Damascus");
    // the members list (the pills) never carries the time: it is the peer's line only
    expect(JSON.stringify(mine.members)).not.toContain("lastSeenAt");

    await loginAs(w.admin.id);
    expect((await detail(id)).peerLastSeenAt).toBe(iso); // for the admin, the peer is the member
  });

  it("the peer who hid is null; a viewer who hid sees null; the owner of the company is read for real", async () => {
    const w = await world();
    const id = await dmOf(w.member.id, w.admin.id);
    await setHide(w.admin.id, true);
    await loginAs(w.member.id);
    expect((await detail(id)).peerLastSeenAt).toBeNull();
    await setHide(w.admin.id, false);
    await setHide(w.member.id, true);
    expect((await detail(id)).peerLastSeenAt).toBeNull();

    // the owner, whose peer hid theirs, still reads the real time (he is the peer of a DM of his own)
    await setHide(w.mate.id, true);
    const ownerDm = await dmOf(w.owner.id, w.mate.id);
    expect((await detail(ownerDm)).peerLastSeenAt).toBe(iso);
  });

  it("the owner as the peer, with «إخفاء المالك من متصل» on, is null for the other side", async () => {
    const w = await world();
    const id = await dmOf(w.member.id, w.owner.id);
    expect((await detail(id)).peerLastSeenAt).toBe(iso);
    await setFeature(w.org.id, "ownerHiddenOnline", true);
    await loginAs(w.member.id);
    expect((await detail(id)).peerLastSeenAt).toBeNull();
  });

  it("a topic never carries it, and neither does the owner reading a DM that is not his (oversight)", async () => {
    const w = await world();
    const space = await makeWorkspace(w.org.id, [{ userId: w.member.id }, { userId: w.admin.id }]);
    const topic = await createTopic({ orgId: w.org.id, orgRole: "OWNER", userId: w.owner.id }, { spaceId: space.id, title: "عام" });
    await loginAs(w.member.id);
    const t = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${topic.id}`, params: { id: topic.id } });
    expect(t.status).toBe(200);
    expect(t.text).not.toContain("peerLastSeenAt");
    expect(t.text).not.toContain("lastSeenAt");

    const dm = await dmOf(w.member.id, w.admin.id);
    await loginAs(w.owner.id);
    const looked = await call(oversightOne.GET, { params: { id: dm } });
    expect(looked.status).toBe(200);
    expect(looked.text).not.toContain("peerLastSeenAt");
  });

  it("a peer who is suspended is nobody: no time is given", async () => {
    const w = await world();
    const id = await dmOf(w.member.id, w.mate.id);
    await db.organizationMember.updateMany({ where: { userId: w.mate.id }, data: { status: "SUSPENDED" } });
    await loginAs(w.member.id);
    const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } });
    expect(res.text).not.toContain(iso);
    expect(res.text).not.toContain("peerLastSeenAt");
  });

  it("the switch off: the answer has no peerLastSeenAt and no zone", async () => {
    const w = await world();
    const id = await dmOf(w.member.id, w.admin.id);
    await setFeature(w.org.id, "lastSeen", false);
    await loginAs(w.member.id);
    const d = await detail(id);
    expect(d).not.toHaveProperty("peerLastSeenAt");
    expect(d).not.toHaveProperty("timeZone");
  });
});

describe("a profile", () => {
  const profileOf = async (id: string) => call(userRoute.GET, { url: `http://localhost/api/users/${id}`, params: { id } });

  it("shows another person's last seen and whether they are here; nothing on one's own page", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await profileOf(w.admin.id);
    expect(res.status).toBe(200);
    const profile = res.json?.["profile"] as Record<string, unknown>;
    expect(profile["lastSeenAt"]).toBe(iso);
    expect(profile["online"]).toBe(false);
    expect(profile["lastSeenTimeZone"]).toBe("Asia/Damascus");

    touchPresence(w.admin.id);
    expect(((await profileOf(w.admin.id)).json?.["profile"] as Record<string, unknown>)["online"]).toBe(true);

    const mine = (await profileOf(w.member.id)).json?.["profile"] as Record<string, unknown>;
    expect(mine).not.toHaveProperty("lastSeenAt");
  });

  it("hidden is null; reciprocity is null; the owner reads the real time; the owner's own switch hides him from the rest", async () => {
    const w = await world();
    await setHide(w.admin.id, true);
    await loginAs(w.member.id);
    expect(((await profileOf(w.admin.id)).json?.["profile"] as Record<string, unknown>)["lastSeenAt"]).toBeNull();
    await loginAs(w.owner.id);
    expect(((await profileOf(w.admin.id)).json?.["profile"] as Record<string, unknown>)["lastSeenAt"]).toBe(iso);

    await setHide(w.admin.id, false);
    await setHide(w.member.id, true);
    await loginAs(w.member.id);
    expect(((await profileOf(w.mate.id)).json?.["profile"] as Record<string, unknown>)["lastSeenAt"]).toBeNull();

    await setHide(w.member.id, false);
    await setFeature(w.org.id, "ownerHiddenOnline", true);
    touchPresence(w.owner.id);
    const p = (await profileOf(w.owner.id)).json?.["profile"] as Record<string, unknown>;
    expect(p["lastSeenAt"]).toBeNull();
    expect(p["online"]).toBe(false);
  });

  it("a suspended person has no profile to read a time from", async () => {
    const w = await world();
    await db.organizationMember.updateMany({ where: { userId: w.mate.id }, data: { status: "SUSPENDED" } });
    await loginAs(w.member.id);
    const res = await profileOf(w.mate.id);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(iso);
  });

  it("an external partner gets the names-only view and never the field", async () => {
    const w = await world();
    const space = await makeWorkspace(w.org.id, [{ userId: w.guest.id }, { userId: w.member.id }]);
    expect(space.id).toBeTruthy();
    await loginAs(w.guest.id);
    const res = await profileOf(w.member.id);
    expect(res.status).toBe(200);
    expect(Object.keys(res.json?.["profile"] as object).sort()).toEqual(["id", "name"]);
    expect(res.text).not.toContain("lastSeenAt");
  });

  it("the switch off: no field on the profile", async () => {
    const w = await world();
    await setFeature(w.org.id, "lastSeen", false);
    await loginAs(w.member.id);
    const res = await profileOf(w.admin.id);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("lastSeenAt");
    expect(res.text).not.toContain("lastSeenTimeZone");
  });
});

describe("an external partner is told nothing, anywhere", () => {
  it("the reader answers «left out» for every person, and the search carries no field", async () => {
    const w = await world();
    const reader = await lastSeenReader(w.org.id, w.guest.id);
    expect(reader.enabled).toBe(false);
    for (const u of [w.owner, w.admin, w.member, w.mate]) {
      expect(reader.read({ userId: u.id, role: "MEMBER", status: "ACTIVE", lastSeenAt: SEEN, hideLastSeen: false })).toBeUndefined();
      expect(reader.field({ userId: u.id, role: "MEMBER", status: "ACTIVE", lastSeenAt: SEEN, hideLastSeen: false })).toEqual({});
    }
    await loginAs(w.guest.id);
    const res = await call(searchRoute.GET, { url: "http://localhost/api/search?q=Mate" });
    expect(res.text).not.toContain("lastSeenAt");
    expect(res.text).not.toContain(iso);
  });

  it("an unknown viewer, or a viewer who is no longer ACTIVE, is told nothing either", async () => {
    const w = await world();
    const stranger = await makeUser({});
    expect((await lastSeenReader(w.org.id, stranger.id)).enabled).toBe(false);
    await db.organizationMember.updateMany({ where: { userId: w.mate.id }, data: { status: "OFFBOARDED" } });
    expect((await lastSeenReader(w.org.id, w.mate.id)).enabled).toBe(false);
  });
});

describe("reading leaves no trace", () => {
  it("no audit row, no notification, no realtime event and no change to anybody's time", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.admin.id } })).json?.["id"] as string;
    const count = async () => ({
      audit: await db.auditLog.count(),
      notes: await db.notification.count(),
      events: await db.realtimeEvent.count(),
      seen: JSON.stringify(await db.organizationMember.findMany({ orderBy: { id: "asc" }, select: { id: true, lastSeenAt: true, hideLastSeen: true } })),
    });
    const before = await count();
    for (const viewer of [w.owner, w.member, w.admin]) {
      await loginAs(viewer.id);
      await call(presenceRoute.GET);
      await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory?scope=company" });
      await call(userRoute.GET, { url: `http://localhost/api/users/${w.mate.id}`, params: { id: w.mate.id } });
    }
    await loginAs(w.admin.id);
    await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${dm}`, params: { id: dm } });
    expect(await count()).toEqual(before);
  });
});

describe("PATCH /api/me/last-seen — «إخفاء آخر ظهوري»", () => {
  const patch = (body: unknown) => call(lastSeenRoute.PATCH, { method: "PATCH", body });
  const hideOf = async (userId: string) => (await db.organizationMember.findFirstOrThrow({ where: { userId }, select: { hideLastSeen: true } })).hideLastSeen;

  it("sets the caller's own choice and nobody else's; GET tells them", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect(await hideOf(w.member.id)).toBe(false);
    const on = await patch({ hide: true });
    expect(on.status).toBe(200);
    expect(on.json).toEqual({ ok: true, hide: true });
    expect(await hideOf(w.member.id)).toBe(true);
    for (const u of [w.owner, w.admin, w.mate, w.guest]) expect(await hideOf(u.id), u.id).toBe(false);
    expect((await call(lastSeenRoute.GET)).json).toEqual({ hide: true });
    expect((await patch({ hide: false })).status).toBe(200);
    expect(await hideOf(w.member.id)).toBe(false);
  });

  it("only the membership of the company the caller works in changes (a second company keeps its own)", async () => {
    const w = await world();
    const other = await makeOrg();
    await db.organizationMember.create({ data: { organizationId: other.id, userId: w.member.id, role: "MEMBER" } });
    await loginAs(w.member.id);
    await patch({ hide: true });
    const rows = await db.organizationMember.findMany({ where: { userId: w.member.id }, select: { organizationId: true, hideLastSeen: true } });
    expect(rows.find((r) => r.organizationId === w.org.id)?.hideLastSeen).toBe(true);
    expect(rows.find((r) => r.organizationId === other.id)?.hideLastSeen).toBe(false);
  });

  it("validates strictly: only { hide: boolean } — 422 for anything else, and nothing is written", async () => {
    const w = await world();
    await loginAs(w.member.id);
    for (const body of [{}, { hide: "yes" }, { hide: 1 }, { hide: null }, { hide: true, userId: w.admin.id }, { hide: true, extra: 1 }, []]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(await hideOf(w.member.id)).toBe(false);
    expect(await hideOf(w.admin.id)).toBe(false);
  });

  it("needs a signed-in person; an external partner is refused; the switch off answers «not found»", async () => {
    const w = await world();
    logout();
    expect((await patch({ hide: true })).status).toBe(401);
    await loginAs(w.guest.id);
    const refused = await patch({ hide: true });
    expect(refused.status).toBe(403);
    expect(await hideOf(w.guest.id)).toBe(false);

    await setFeature(w.org.id, "lastSeen", false);
    await loginAs(w.member.id);
    const off = await patch({ hide: true });
    expect(off.status).toBe(404);
    expect(off.json?.["message"]).toBe("features.off");
    expect((await call(lastSeenRoute.GET)).status).toBe(404);
    expect(await hideOf(w.member.id)).toBe(false);
  });

  it("a stored choice survives the switch: off hides nothing from the data, on brings it back", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await patch({ hide: true });
    await setFeature(w.org.id, "lastSeen", false);
    expect(await hideOf(w.member.id)).toBe(true);
    await setFeature(w.org.id, "lastSeen", true);
    await loginAs(w.mate.id);
    expect((await dock()).rows.get(w.member.id)?.lastSeenAt).toBeNull();
  });
});
