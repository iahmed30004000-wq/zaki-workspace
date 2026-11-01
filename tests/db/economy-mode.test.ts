import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// uploaded test files stay out of the repo; vi.hoisted runs before the imports, so it must not use any
vi.hoisted(() => {
  const tmp = process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp";
  process.env["UPLOAD_DIR"] = `${tmp}/zaki-test-uploads-eco-${process.pid}`;
});

import { promises as fs } from "node:fs";
import { join } from "node:path";
import * as featuresRoute from "@/app/api/settings/features/route";
import * as healthRoute from "@/app/api/settings/server-health/route";
import * as watchRoute from "@/app/api/watch/route";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import * as callRoute from "@/app/api/calls/[id]/route";
import * as tokenRoute from "@/app/api/calls/[id]/token/route";
import * as leaveRoute from "@/app/api/calls/[id]/leave/route";
import * as endRoute from "@/app/api/calls/[id]/end/route";
import * as meetingsRoute from "@/app/api/calls/route";
import * as boardRoute from "@/app/api/chat/conversations/[id]/whiteboard/route";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as conversationSearchRoute from "@/app/api/chat/conversations/[id]/search/route";
import * as pagesRoute from "@/app/api/files/[id]/pages/route";
import * as searchRoute from "@/app/api/search/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import { setCallsFetchForTests } from "@/server/calls/livekit";
import { dropPresence, resetPresenceForTests, settleLastSeenWrites, touchPresence } from "@/server/realtime/presence";
import { isFeatureOn } from "@/server/services/features";
import { runDueJobs } from "@/server/jobs/run";
import { fileLibrary, ingest } from "@/server/services/files";
import { setPushSenderForTests } from "@/server/calls/push";
import { featureOnSql } from "@/server/features-sql";
import { ECONOMY_FORCED_OFF, FEATURES, withFeature, type FeatureKey } from "@/lib/features";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeScopedOrg } from "./scoping-helpers";

/**
 * «وضع التوفير» and the switches for the heavy things (the owner, 2026-11-02: «لو السيرفر مش كفو أوقفها»), against a real PostgreSQL.
 *
 * A switch is only honest if the work behind it STOPS: each test below turns one off (itself, or through the master switch) and then
 * proves the server-side effect (a route answers «not found», a write does not happen, a job skips, the file is not even read), and that
 * turning it back gives the feature again. The owner's own choices are never overwritten by the master switch.
 */

const SECRET = "test-calls-secret-0123456789abcdef0123456789";
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) saved[k] = process.env[k];
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setCallsFetchForTests(null);
  setPushSenderForTests(null);
  await db.checkinRound.deleteMany({});
  await db.checkinConfig.deleteMany({});
  await fs.rm(fileLibrary, { recursive: true, force: true }).catch(() => undefined);
});
beforeEach(async () => {
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = SECRET;
  // the calls server, faked: nobody is ever in a room, every other call is accepted
  setCallsFetchForTests(async (input) => (String(input).endsWith("/ListParticipants") ? Response.json({ participants: [] }) : Response.json({})));
  resetPresenceForTests();
  setPushSenderForTests(null);
  // the runner works on EVERY company's check-ins: start each test empty
  await db.checkinRound.deleteMany({});
  await db.checkinConfig.deleteMany({});
});

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  const t = await makeTeam();
  const other = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Other" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, other, ws, topic };
}

const flip = (key: string, on: boolean) => call(featuresRoute.PATCH, { method: "PATCH", body: { key, on } });
const listed = async () => ((await call(featuresRoute.GET)).json?.["features"] as { key: string; on: boolean }[]).reduce<Record<string, boolean>>((m, f) => ({ ...m, [f.key]: f.on }), {});

describe("«وضع التوفير»: the owner's master switch", () => {
  it("is listed OFF by default, with every other switch exactly as before; only the owner turns it on", async () => {
    const w = await world();
    await loginAs(w.member.id);
    jar().set("zk-space", w.ws.id);
    const all = await listed();
    expect(all["economyMode"]).toBe(false);
    for (const key of ["calls", "whiteboard", "voiceNotes", "pdfPageCount", "search", "backgroundNudges"]) expect(all[key], key).toBe(true);
    expect(Object.keys(all).sort()).toEqual([...FEATURES].sort());

    for (const person of [w.admin, w.member, w.guest]) {
      await loginAs(person.id);
      const res = await flip("economyMode", true);
      expect(res.status, person.id).toBeGreaterThanOrEqual(403);
      expect(res.status, person.id).toBeLessThan(500);
    }
    expect(await isFeatureOn(w.org.id, "calls")).toBe(true);
    await loginAs(w.owner.id);
    expect((await flip("economyMode", true)).status).toBe(200);
    expect(await isFeatureOn(w.org.id, "economyMode")).toBe(true);
  });

  it("ON: every switch on its list is OFF in force for the company and nothing else is; the listing still shows the owner's own choices", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    // the owner had already turned one of them off himself, and left another on
    await flip("whiteboard", false);
    await flip("economyMode", true);
    for (const key of ECONOMY_FORCED_OFF) expect(await isFeatureOn(w.org.id, key), key).toBe(false);
    for (const key of ["voiceNotes", "search", "chatOutbox", "reminders", "checkins", "timeTracking", "pushEverything", "taskRules"] as const) expect(await isFeatureOn(w.org.id, key), key).toBe(true);
    // «الميزات» shows what HE chose (the toggle is not moved under his finger); the screen marks the held ones
    const all = await listed();
    expect(all["quickChat"]).toBe(true);
    expect(all["calls"]).toBe(true);
    expect(all["whiteboard"]).toBe(false);
    expect(all["economyMode"]).toBe(true);
  });

  it("OFF again: every switch is back to exactly what the owner had, and nothing he turned off came back on", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await flip("whiteboard", false);
    await flip("ownerAssistant", true);
    const before = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    const inForce = async () => Object.fromEntries(await Promise.all(FEATURES.map(async (k) => [k, await isFeatureOn(w.org.id, k)] as const)));
    const was = await inForce();

    await flip("economyMode", true);
    expect(await isFeatureOn(w.org.id, "watch")).toBe(false);
    await flip("economyMode", false);
    expect(await inForce()).toEqual(was);
    // the stored settings differ from before by that one key only
    const after = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    expect(after.settings).toEqual({ ...(before.settings as object), features: { ...((before.settings as { features: object }).features), economyMode: false } });
    expect(await isFeatureOn(w.org.id, "whiteboard")).toBe(false);
    expect(await isFeatureOn(w.org.id, "calls")).toBe(true);
  });

  it("holds «نتفرّج سوا» off at its door too (an existing switch, now under the overlay), and gives it back", async () => {
    const w = await world();
    await loginAs(w.member.id);
    jar().set("zk-space", w.ws.id);
    expect((await call(watchRoute.GET)).json?.["message"]).not.toBe("features.off");
    await setSwitch(w.org.id, "economyMode", true);
    const held = await call(watchRoute.GET);
    expect(held.status).toBe(404);
    expect(held.json?.["message"]).toBe("features.off");
    await setSwitch(w.org.id, "economyMode", false);
    expect((await call(watchRoute.GET)).json?.["message"]).not.toBe("features.off");
  });

  it("is one company's switch: another company in the same database is not slowed", async () => {
    const a = await world();
    const b = await world();
    await setSwitch(a.org.id, "economyMode", true);
    expect(await isFeatureOn(a.org.id, "calls")).toBe(false);
    expect(await isFeatureOn(b.org.id, "calls")).toBe(true);
  });

  it("does not stop the jobs that are not on its list: a due reminder still fires in economy mode", async () => {
    const w = await world();
    await setSwitch(w.org.id, "economyMode", true);
    const r = await db.reminder.create({ data: { orgId: w.org.id, userId: w.member.id, title: "اتصل بالمورد", dueAt: new Date(Date.now() - 60_000) } });
    const run = await runDueJobs(new Date());
    expect(run.failed).toEqual([]);
    expect((await db.reminder.findUniqueOrThrow({ where: { id: r.id } })).status).not.toBe("PENDING");
  });
});

describe("«آخر ظهور»: no row is written while economy mode (or the switch) holds it off", () => {
  const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
  const seen = async (orgId: string, userId: string) =>
    (await db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { lastSeenAt: true } })).lastSeenAt;

  it("a heartbeat and the closing write change nothing in economy mode; economy off, the next heartbeat records again", async () => {
    const t = await makeTeam();
    await setSwitch(t.org.id, "economyMode", true);
    touchPresence(t.member.id, T0, t.org.id);
    dropPresence(t.member.id, t.org.id, T0 + 1_000);
    await settleLastSeenWrites();
    expect(await seen(t.org.id, t.member.id)).toBeNull();

    await setSwitch(t.org.id, "economyMode", false);
    resetPresenceForTests();
    touchPresence(t.member.id, T0 + 2_000, t.org.id);
    await settleLastSeenWrites();
    expect((await seen(t.org.id, t.member.id))?.getTime()).toBe(T0 + 2_000);
  });

  it("the owner's own «آخر ظهور» choice is untouched by economy mode", async () => {
    const t = await makeTeam();
    await setSwitch(t.org.id, "lastSeen", true);
    await setSwitch(t.org.id, "economyMode", true);
    const org = await db.organization.findUniqueOrThrow({ where: { id: t.org.id }, select: { settings: true } });
    expect((org.settings as { features: Record<string, boolean> }).features["lastSeen"]).toBe(true);
  });
});

describe("«المكالمات»: off, no call starts, no pass is made and the calls server is never asked", () => {
  it("the owner's switch and economy mode both stop starting, joining, inviting and the people list, and the button's lookup is empty", async () => {
    for (const how of ["switch", "economy"] as const) {
      const w = await world();
      await loginAs(w.member.id);
      const started = await call(convCallRoute.POST, { params: { id: w.topic.id }, body: { video: false, ring: true } });
      expect(started.status, how).toBe(201);
      const id = started.json?.["id"] as string;
      expect((await call(tokenRoute.POST, { method: "POST", params: { id } })).status, how).toBe(200);

      if (how === "switch") await setSwitch(w.org.id, "calls", false);
      else await setSwitch(w.org.id, "economyMode", true);

      const asked = vi.fn(async () => Response.json({ participants: [] }));
      setCallsFetchForTests(asked);
      const refused = await call(convCallRoute.POST, { params: { id: w.topic.id }, body: { video: false, ring: true } });
      expect(refused.status, how).toBe(404);
      expect(refused.json?.["message"], how).toBe("features.off");
      expect((await call(meetingsRoute.POST, { body: { title: "x", video: true } })).status, how).toBe(404);
      expect((await call(tokenRoute.POST, { method: "POST", params: { id } })).status, how).toBe(404);
      expect((await call(callRoute.GET, { params: { id } })).status, how).toBe(404);
      // the header button asks «is a call going on here»: nobody is, and nothing is asked of the calls server
      const lookup = await call(convCallRoute.GET, { params: { id: w.topic.id } });
      expect(lookup.status, how).toBe(200);
      expect(lookup.json?.["call"], how).toBeNull();
      expect(asked, how).not.toHaveBeenCalled();
      // the conversation says so, so the header draws no call button and no link to the board
      const detail = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } })).json as unknown as ConversationDto;
      expect(detail.calls, how).toBe(false);

      // somebody already in the call can still get out of it
      expect((await call(leaveRoute.POST, { method: "POST", params: { id } })).status, how).toBe(200);
      await loginAs(w.member.id);
      expect((await call(endRoute.POST, { method: "POST", params: { id } })).status, how).toBeLessThan(500);

      // back on: a call starts again
      if (how === "switch") await setSwitch(w.org.id, "calls", true);
      else await setSwitch(w.org.id, "economyMode", false);
      expect((await call(convCallRoute.POST, { params: { id: w.topic.id }, body: { video: false, ring: true } })).status, how).toBe(201);
    }
  });

  it("the call page is not there while it is off (the page itself answers «not found»)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/calls/[id]/page.tsx", "utf8");
    // a source pin: the page asks the switch before anything else is read (a page needs a running Next app to render here)
    expect(src).toMatch(/actorFeatureOn\(actor, "calls"\)\)\) notFound\(\)/);
  });
});

describe("«السبورة»: off, the board is not read, not saved and not announced; what was drawn stays", () => {
  const el = (id: string, version: number) => ({ id, version, versionNonce: 1, type: "rectangle", x: 0, y: 0 });

  it("both doors answer «not found» under the switch and under economy mode, the stored board is intact, and it comes back", async () => {
    for (const how of ["switch", "economy"] as const) {
      const w = await world();
      await loginAs(w.member.id);
      expect((await call(boardRoute.PUT, { method: "PUT", params: { id: w.topic.id }, body: { elements: [el("a", 1)] } })).status, how).toBe(200);
      const events = () => db.realtimeEvent.count({ where: { kind: "whiteboard.changed" } });
      const sent = await events();

      if (how === "switch") await setSwitch(w.org.id, "whiteboard", false);
      else await setSwitch(w.org.id, "economyMode", true);
      const read = await call(boardRoute.GET, { params: { id: w.topic.id } });
      expect(read.status, how).toBe(404);
      expect(read.json?.["message"], how).toBe("features.off");
      expect((await call(boardRoute.PUT, { method: "PUT", params: { id: w.topic.id }, body: { elements: [el("b", 1)] } })).status, how).toBe(404);
      expect(await events(), how).toBe(sent);
      const row = await db.whiteboard.findUniqueOrThrow({ where: { conversationId: w.topic.id } });
      expect((row.elements as { id: string }[]).map((e) => e.id), how).toEqual(["a"]);
      const detail = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } })).json as unknown as ConversationDto;
      expect(detail.whiteboard, how).toBe(false);

      if (how === "switch") await setSwitch(w.org.id, "whiteboard", true);
      else await setSwitch(w.org.id, "economyMode", false);
      expect((await call(boardRoute.GET, { params: { id: w.topic.id } })).json, how).toMatchObject({ elements: [{ id: "a" }] });
    }
  });
});

describe("«الرسائل الصوتية»: off, a recording is refused before a byte is kept", () => {
  const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, ...Buffer.from("webm"), 0x42, 0x87, 0x81, 0x04, 0, 0, 0, 0]);
  async function upload(kind: string) {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(WEBM)], "voice.webm"));
    form.append("kind", kind);
    const res = await uploadsRoute.POST(new Request("http://localhost/api/chat/uploads", { method: "POST", body: form }));
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
  }

  it("the upload and the voice message answer «not found», nothing is stored, a text message still goes, and back on it works", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const first = await upload("VOICE");
    expect(first.status).toBe(201);

    await setSwitch(t.org.id, "voiceNotes", false);
    const stored = () => db.storedFile.count({ where: { orgId: t.org.id, purpose: "VOICE" } });
    const before = await stored();
    const refused = await upload("VOICE");
    expect(refused.status).toBe(404);
    expect(refused.json?.["message"]).toBe("features.off");
    expect(await stored()).toBe(before);
    const voice = await call(messagesRoute.POST, { params: { id: dm }, body: { voice: true, attachmentIds: [first.json?.["id"]] } });
    expect(voice.status).toBe(404);
    expect(voice.json?.["message"]).toBe("features.off");
    expect((await call(messagesRoute.POST, { params: { id: dm }, body: { body: "مرحبا" } })).status).toBeLessThan(300);
    const detail = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${dm}`, params: { id: dm } })).json as unknown as ConversationDto;
    expect(detail.voiceNotes).toBe(false);

    await setSwitch(t.org.id, "voiceNotes", true);
    const again = await upload("VOICE");
    expect(again.status).toBe(201);
    expect((await call(messagesRoute.POST, { params: { id: dm }, body: { voice: true, attachmentIds: [again.json?.["id"]] } })).status).toBeLessThan(300);
  });

  it("economy mode does not hold voice notes off (the team still talks)", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    await setSwitch(t.org.id, "economyMode", true);
    expect((await upload("VOICE")).status).toBe(201);
  });
});

describe("«عدّ صفحات الـPDF»: off, the file is not even read", () => {
  const PDF = Buffer.from("%PDF-1.4\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n4 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n", "latin1");

  it("the count is null at once (the bytes are not opened), under the switch and under economy mode, and 2 again when it is back", async () => {
    for (const how of ["switch", "economy"] as const) {
      const t = await makeTeam();
      const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
      const ctx = { orgId: t.org.id, orgRole: "MEMBER" as const, userId: t.member.id };
      const pdf = await ingest(ctx, { name: "عقد.pdf", bytes: PDF }, undefined, "LIBRARY", undefined, { workspaceId: space.id });
      await loginAs(t.member.id);
      expect((await call(pagesRoute.GET, { params: { id: pdf.id } })).json).toEqual({ pages: 2 });

      if (how === "switch") await setSwitch(t.org.id, "pdfPageCount", false);
      else await setSwitch(t.org.id, "economyMode", true);
      // the bytes are GONE from the disk: reading them would answer 404 (missing_storage), so a 200 with null proves they were not read
      const row = await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id }, select: { path: true } });
      const bytes = await fs.readFile(join(fileLibrary, row.path));
      await fs.rm(join(fileLibrary, row.path));
      const off = await call(pagesRoute.GET, { params: { id: pdf.id } });
      expect(off.status, how).toBe(200);
      expect(off.json, how).toEqual({ pages: null });
      // the door's own rule still applies: another company learns nothing
      const foreign = await makeTeam();
      await loginAs(foreign.owner.id);
      expect((await call(pagesRoute.GET, { params: { id: pdf.id } })).status, how).toBe(404);

      await fs.writeFile(join(fileLibrary, row.path), bytes);
      await loginAs(t.member.id);
      if (how === "switch") await setSwitch(t.org.id, "pdfPageCount", true);
      else await setSwitch(t.org.id, "economyMode", false);
      expect((await call(pagesRoute.GET, { params: { id: pdf.id } })).json, how).toEqual({ pages: 2 });
    }
  });
});

describe("«البحث الشامل»: off, an empty answer and no search query", () => {
  it("the box finds the work while it is on, finds nothing while it is off, and the in-conversation search has no hits", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.member.id);
    const find = async () => (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(f.token)}` })).json as { tasks: unknown[]; projects: unknown[] };
    expect((await find()).tasks.length).toBeGreaterThan(0);

    await setSwitch(f.org.id, "search", false);
    // an empty answer for work that exists and that this member may open: it stopped at the switch
    expect(await find()).toEqual({ tasks: [], projects: [], topics: [], messages: [], people: [], files: [] });

    const topic = await db.conversation.create({ data: { orgId: f.org.id, kind: "TOPIC", spaceId: f.wsIn.id, title: "عام" } });
    await db.chatMessage.create({ data: { conversationId: topic.id, orgId: f.org.id, authorId: f.member.id, kind: "TEXT", body: `رسالة ${f.token}` } });
    const hits = await call(conversationSearchRoute.GET, { url: `http://localhost/api/chat/conversations/${topic.id}/search?q=${encodeURIComponent(f.token)}`, params: { id: topic.id } });
    expect(hits.json).toEqual({ hits: [] });

    await setSwitch(f.org.id, "search", true);
    expect((await find()).tasks.length).toBeGreaterThan(0);
    const back = await call(conversationSearchRoute.GET, { url: `http://localhost/api/chat/conversations/${topic.id}/search?q=${encodeURIComponent(f.token)}`, params: { id: topic.id } });
    expect((back.json?.["hits"] as unknown[]).length).toBe(1);
  });

  it("economy mode does not hold search off", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.member.id);
    await setSwitch(f.org.id, "economyMode", true);
    const res = (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(f.token)}` })).json as { tasks: unknown[] };
    expect(res.tasks.length).toBeGreaterThan(0);
  });
});

describe("«تنبيهات الخلفية»: the check-in nudge is skipped while it is off, and goes out once it is back", () => {
  const HOUR = 3_600_000;
  // Damascus is UTC+3 all year: Monday 2031-03-10 09:00 local is 06:00Z, the nudge is due at 09:00Z
  const OPEN = new Date("2031-03-10T06:00:00.000Z");
  const at = (ms: number) => new Date(OPEN.getTime() + ms);

  async function opened() {
    const t = await makeTeam();
    const lead = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "قائد" });
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: lead.id, role: "ADMIN" }], "مساحة");
    await db.checkinConfig.create({ data: { workspaceId: ws.id, questions: ["شو خلصت؟"], timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4], participantsMode: "ALL", participantIds: [], active: true } });
    await runDueJobs(OPEN);
    const round = await db.checkinRound.findFirstOrThrow({ where: { workspaceId: ws.id } });
    return { ...t, lead, ws, round };
  }
  const nudges = () => db.notification.count({ where: { type: "checkin_nudge" } });

  for (const how of ["switch", "economy"] as const) {
    it(`under ${how}: no nudge and the round stays un-nudged; the rounds still open; back on, the nudge goes out once`, async () => {
      const w = await opened();
      const before = await nudges();
      if (how === "switch") await setSwitch(w.org.id, "backgroundNudges", false);
      else await setSwitch(w.org.id, "economyMode", true);
      const run = await runDueJobs(at(3 * HOUR));
      expect(run.failed).toEqual([]);
      expect(await nudges()).toBe(before);
      expect((await db.checkinRound.findUniqueOrThrow({ where: { id: w.round.id } })).nudgedAt).toBeNull();

      if (how === "switch") await setSwitch(w.org.id, "backgroundNudges", true);
      else await setSwitch(w.org.id, "economyMode", false);
      await runDueJobs(at(3 * HOUR + 60_000));
      expect(await nudges()).toBeGreaterThan(before);
      expect((await db.checkinRound.findUniqueOrThrow({ where: { id: w.round.id } })).nudgedAt).not.toBeNull();
      const once = await nudges();
      await runDueJobs(at(4 * HOUR));
      expect(await nudges()).toBe(once);
    });
  }

  it("economy mode does not stop the round from opening (only the nudge is a background nudge)", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "مساحة");
    await db.checkinConfig.create({ data: { workspaceId: ws.id, questions: ["شو خلصت؟"], timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4], participantsMode: "ALL", participantIds: [], active: true } });
    await setSwitch(t.org.id, "economyMode", true);
    await runDueJobs(OPEN);
    expect(await db.checkinRound.count({ where: { workspaceId: ws.id } })).toBe(1);
  });
});

describe("«featureOnSql»: the same answer as the TypeScript overlay, in the database", () => {
  it("agrees with featureOn for every company state: unset, own off, own on, economy on, a broken value", async () => {
    const states: Array<{ name: string; settings: unknown }> = [
      { name: "unset", settings: {} },
      { name: "own off", settings: { features: { lastSeen: false } } },
      { name: "own on", settings: { features: { lastSeen: true } } },
      { name: "economy", settings: { features: { economyMode: true } } },
      { name: "economy + own off", settings: { features: { economyMode: true, lastSeen: false } } },
      { name: "broken", settings: { features: { lastSeen: "false", economyMode: "true" } } },
      { name: "features not an object", settings: { features: 3 } },
    ];
    const { featureOn } = await import("@/lib/features");
    for (const s of states) {
      const org = await makeTeam();
      await db.organization.update({ where: { id: org.org.id }, data: { settings: s.settings as Prisma.InputJsonValue } });
      for (const key of ["lastSeen", "backgroundNudges", "calls", "reminders"] as const) {
        const rows = await db.$queryRaw<{ on: boolean }[]>`SELECT ${featureOnSql(key)} AS "on" FROM "Organization" o WHERE o.id = ${org.org.id}`;
        expect(rows[0]?.on, `${s.name} / ${key}`).toBe(featureOn(s.settings, key));
      }
    }
  });
});

describe("«حال السيرفر»: the owner reads numbers about the box, nobody else does, and nothing private is in it", () => {
  it("the owner gets the numbers, the database answer and the verdict, never cached", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await call(healthRoute.GET);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = res.json as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["at", "cpus", "dbLatencyMs", "dbOk", "eventLoopLagMs", "freeMemBytes", "heapTotalBytes", "heapUsedBytes", "loadAvg1", "loadAvg5", "memLimitBytes", "rssBytes", "totalMemBytes", "uploads", "uptimeSec", "verdict"].sort(),
    );
    expect(body["dbOk"]).toBe(true);
    expect(typeof body["dbLatencyMs"]).toBe("number");
    expect(body["rssBytes"] as number).toBeGreaterThan(0);
    expect(typeof body["eventLoopLagMs"]).toBe("number");
    expect(body["uptimeSec"] as number).toBeGreaterThanOrEqual(0);
    expect(body["totalMemBytes"] as number).toBeGreaterThan(0);
    expect(body["verdict"]).toMatchObject({ level: expect.stringMatching(/^(ok|warn)$/), reasons: expect.any(Array) });
    expect(body["uploads"]).toMatchObject({ files: expect.any(Number), bytes: expect.any(Number) });
  });

  it("an admin, a member, a guest and a signed-out caller are refused", async () => {
    const w = await world();
    for (const person of [w.admin, w.member, w.guest]) {
      await loginAs(person.id);
      const res = await call(healthRoute.GET);
      expect(res.status, person.id).toBe(403);
      expect(res.json?.["message"], person.id).toBe("health.owner_only");
    }
    const { logout } = await import("./helpers");
    logout();
    expect((await call(healthRoute.GET)).status).toBe(401);
  });

  it("carries no secret, no path and no customer data, and counts only this company's uploads", async () => {
    const w = await world();
    process.env["TEST_HEALTH_MARKER_SECRET"] = "hunter2-marker";
    await loginAs(w.owner.id);
    const text = (await call(healthRoute.GET)).text;
    delete process.env["TEST_HEALTH_MARKER_SECRET"];
    for (const needle of [process.env["DATABASE_URL"] ?? "postgres://", "postgres", "AUTH_SECRET", SECRET, "hunter2", fileLibrary, process.cwd(), w.owner.email, w.member.email, "@", "token"]) {
      expect(text.includes(needle), needle).toBe(false);
    }
    // uploads are the company's own: a file of another company is not in this company's count
    const ctxA = { orgId: w.org.id, orgRole: "OWNER" as const, userId: w.owner.id };
    const other = await makeTeam();
    const ctxB = { orgId: other.org.id, orgRole: "OWNER" as const, userId: other.owner.id };
    const bytes = Buffer.from("%PDF-1.4\n%%EOF\n", "latin1");
    const before = ((await call(healthRoute.GET)).json?.["uploads"] as { files: number }).files;
    await ingest(ctxB, { name: "b.pdf", bytes }, undefined, "LIBRARY", undefined, {});
    expect(((await call(healthRoute.GET)).json?.["uploads"] as { files: number }).files).toBe(before);
    await ingest(ctxA, { name: "a.pdf", bytes }, undefined, "LIBRARY", undefined, {});
    expect(((await call(healthRoute.GET)).json?.["uploads"] as { files: number }).files).toBe(before + 1);
  });

  it("is only a reading: it changes no switch (the advice never turns economy mode on by itself)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const before = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    await call(healthRoute.GET);
    const after = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    expect(after.settings).toEqual(before.settings);
  });
});
