import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import fixture from "../fixtures/oms-events.provisional.json";
import * as receiverRoute from "@/app/api/integrations/oms/events/[receiverId]/route";
import * as settingsRoute from "@/app/api/integrations/oms/events/settings/route";
import * as problemSettingsRoute from "@/app/api/tickets/problem-settings/route";
import { withFeature } from "@/lib/features";
import { zonedParts } from "@/lib/zoned-time";
import { decryptSecrets } from "@/server/crypto";
import { signZakiPayload, unixSeconds, zakiSignatureHeader } from "@/server/webhook-signing";
import { MAX_EVENT_BODY_BYTES, claimInboundDelivery, countEvents, refusedDeliveriesLimiter } from "@/server/integrations/oms-events";
import { runOmsDailyCard } from "@/server/jobs/oms-daily-card";
import { call, db, loginAs, logout, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { makeDepartment } from "./guest-helpers";

/**
 * I1.1a: the orders system's own events. Against a real PostgreSQL, through the real route handlers. The fixture is PROVISIONAL (written from the spec, not copied from
 * the orders system): these tests pin OUR receiver.
 *
 * Pins: the switch (404 for everybody), an unsigned delivery / a wrong signature / an old timestamp / an oversized body REFUSED, a delivery taken once, the raw body and
 * total, currency and city never in any row, the order's state refreshed (an older event never overwrites a newer one), a CARD in the topic the owner chose, the ticket rule by
 * EVENT, the daily card (once a day, five counts, no money), and one company's receiver never touching another's.
 */

const KEY = "oms-events-test-encryption-key-0123456789-abcdef";
const saved: Record<string, string | undefined> = {};
const SECRET = fixture.secret;
const NUMBER = "ZK-2026-000123";
const LEAKS = ["149.5", "USD", "Amman", "TRK0001"];

beforeAll(() => {
  saved["ENCRYPTION_KEY"] = process.env["ENCRYPTION_KEY"];
  process.env["ENCRYPTION_KEY"] = KEY;
});
afterAll(() => {
  if (saved["ENCRYPTION_KEY"] === undefined) delete process.env["ENCRYPTION_KEY"];
  else process.env["ENCRYPTION_KEY"] = saved["ENCRYPTION_KEY"];
});
beforeEach(async () => {
  // the daily job walks every receiver of the database: another test's company must not be in this test's run
  await db.integration.deleteMany({ where: { type: "OMS_EVENTS" } });
  refusedDeliveriesLimiter.reset("unknown");
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

/**
 * A company with a space, two topics, the switch on, a receiver made through the owner's route and the secret pasted. The owner (the person who connects the
 * receiver, so the author of every card) has JOINED both topics unless asked otherwise: the silent oversight holder posts only where he joined.
 */
async function world(opts: { on?: boolean; secret?: boolean; ownerJoined?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "الطلبات");
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "مرتجع" } });
  const reports = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "تقارير" } });
  if (opts.ownerJoined !== false) await db.conversationMember.createMany({ data: [topic.id, reports.id].map((conversationId) => ({ conversationId, userId: team.owner.id })) });
  await setFeatures(team.org.id, { omsEvents: opts.on !== false });
  await loginAs(team.owner.id);
  const made = await call(settingsRoute.POST, { url: "http://localhost/api/integrations/oms/events/settings", body: { action: "create" } });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  const receiverId = made.json?.["receiverId"] as string;
  if (opts.secret !== false) {
    const put = await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/api/integrations/oms/events/settings", body: { secret: SECRET } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
  }
  logout();
  return { ...team, space, topic, reports, receiverId };
}
type World = Awaited<ReturnType<typeof world>>;

interface Delivery {
  id?: string;
  event?: string | null;
  ts?: string | null;
  sig?: string | null;
  secret?: string;
  raw?: string;
  receiverId?: string;
  at?: Date;
}
const eventBody = (name: keyof typeof fixture.events, patch: Record<string, unknown> = {}, at?: string) => {
  const e = fixture.events[name];
  return JSON.stringify({ ...e, ...(at ? { at } : {}), data: { ...e.data, ...patch } });
};

/** A signed delivery by default; every part can be changed or removed. */
async function deliver(w: Pick<World, "receiverId">, raw: string, d: Delivery = {}) {
  const ts = d.ts === undefined ? unixSeconds(d.at ?? new Date()) : d.ts;
  const headers: Record<string, string> = { "content-type": "application/json", "x-zaki-delivery": d.id ?? `d-${uid()}-${uid()}` };
  let parsedName: string | undefined;
  try {
    parsedName = (JSON.parse(raw) as { event?: string }).event;
  } catch {
    parsedName = undefined;
  }
  const name = d.event === undefined ? parsedName : d.event;
  if (name) headers["x-zaki-event"] = name;
  if (ts !== null) headers["x-zaki-timestamp"] = ts;
  const sig = d.sig === undefined ? (ts === null ? null : zakiSignatureHeader(d.secret ?? SECRET, ts, raw)) : d.sig;
  if (sig !== null) headers["x-zaki-signature"] = sig;
  const receiverId = d.receiverId ?? w.receiverId;
  const res = await receiverRoute.POST(new Request(`http://localhost/api/integrations/oms/events/${receiverId}`, { method: "POST", headers, body: raw }), { params: { receiverId } });
  return { status: res.status, json: (await res.json()) as { ok: boolean; error?: string; duplicate?: boolean }, deliveryId: headers["x-zaki-delivery"]! };
}

const stateOf = (w: World, number = NUMBER) => db.omsOrderState.findUnique({ where: { orgId_orderNumber: { orgId: w.org.id, orderNumber: number } } });

describe("the owner's settings of the receiver", () => {
  it("only the owner; the secret is shown once, kept encrypted and never in an answer; the switch off is 404 for every change", async () => {
    const w = await world({ secret: false });
    await loginAs(w.admin.id);
    expect((await call(settingsRoute.GET, { url: "http://localhost/x" })).status).toBe(403);
    expect((await call(settingsRoute.POST, { url: "http://localhost/x", body: { action: "generate_secret" } })).status).toBe(403);
    await loginAs(w.owner.id);
    const gen = await call(settingsRoute.POST, { url: "http://localhost/x", body: { action: "generate_secret" } });
    expect(gen.status).toBe(200);
    const secret = gen.json?.["secret"] as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // shown ONCE: the next look has no secret, only «saved»
    const look = await call(settingsRoute.GET, { url: "http://localhost/x" });
    expect(look.text).not.toContain(secret);
    expect(look.json?.["secretSaved"]).toBe(true);
    const row = await db.integration.findFirstOrThrow({ where: { orgId: w.org.id, type: "OMS_EVENTS" } });
    expect(row.secretEnc).not.toContain(secret);
    expect(decryptSecrets<{ secret: string }>(row.secretEnc)?.secret).toBe(secret);
    expect(JSON.stringify(row.config)).not.toContain(secret);
    // a pasted secret: too short or with spaces is refused
    for (const bad of ["short", "has a space in the middle of it 123456"]) expect((await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { secret: bad } })).status).toBe(422);

    await setFeatures(w.org.id, { omsEvents: false });
    expect((await call(settingsRoute.POST, { url: "http://localhost/x", body: { action: "rotate_id" } })).status).toBe(404);
    expect((await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { routes: [] } })).status).toBe(404);
    const off = await call(settingsRoute.GET, { url: "http://localhost/x" });
    expect(off.json?.["switchOn"]).toBe(false);
    // taking it out always works, the secret goes with it
    expect((await call(settingsRoute.DELETE, { method: "DELETE", url: "http://localhost/x" })).status).toBe(200);
    expect(await db.integration.count({ where: { orgId: w.org.id, type: "OMS_EVENTS" } })).toBe(0);
  });

  it("a rule or the daily card must name a live topic of THIS company", async () => {
    const w = await world();
    const other = await world();
    await loginAs(w.owner.id);
    const url = "http://localhost/x";
    const foreign = await call(settingsRoute.PUT, { method: "PUT", url, body: { routes: [{ event: "order.returned", conversationId: other.topic.id }] } });
    expect(foreign.status).toBe(422);
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM" } });
    expect((await call(settingsRoute.PUT, { method: "PUT", url, body: { dailyCard: { hour: 9, conversationId: dm.id } } })).status).toBe(422);
    expect((await call(settingsRoute.PUT, { method: "PUT", url, body: { dailyCard: { hour: 24, conversationId: w.reports.id } } })).status).toBe(422);
    expect((await call(settingsRoute.PUT, { method: "PUT", url, body: { routes: [{ event: "Bad Name!", conversationId: w.topic.id }] } })).status).toBe(422);
    const ok = await call(settingsRoute.PUT, { method: "PUT", url, body: { routes: [{ event: "order.returned", conversationId: w.topic.id }, { event: "order.returned", conversationId: w.topic.id }], dailyCard: { hour: 21, conversationId: w.reports.id } } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json?.["routes"]).toEqual([{ event: "order.returned", conversationId: w.topic.id }]);
    expect(ok.json?.["dailyCard"]).toEqual({ hour: 21, conversationId: w.reports.id });
    // the secret saved before is still there after a save of the rules
    expect(ok.json?.["secretSaved"]).toBe(true);
  });
});

describe("the author of the cards must be allowed in the topic the owner picks", () => {
  const url = "http://localhost/x";
  const saveRoute = (topicId: string) => call(settingsRoute.PUT, { method: "PUT", url, body: { routes: [{ event: "order.returned", conversationId: topicId }] } });
  const saveDaily = (topicId: string) => call(settingsRoute.PUT, { method: "PUT", url, body: { dailyCard: { hour: 9, conversationId: topicId } } });

  it("saving a rule or the daily card is refused (422) when the person who connected the receiver has not joined the topic: nothing is saved", async () => {
    const w = await world({ ownerJoined: false });
    await loginAs(w.owner.id);
    for (const res of [await saveRoute(w.topic.id), await saveDaily(w.reports.id)]) {
      expect(res.status, res.text.slice(0, 200)).toBe(422);
      expect(res.text).toContain("oms.events.e.author_forbidden");
    }
    const look = await call(settingsRoute.GET, { url });
    expect(look.json?.["routes"]).toEqual([]);
    expect(look.json?.["dailyCard"]).toBeNull();
    // once he joins the topic, the same save is fine
    await db.conversationMember.create({ data: { conversationId: w.topic.id, userId: w.owner.id } });
    expect((await saveRoute(w.topic.id)).status).toBe(200);
    // a topic that is closed takes no card either (the same refusal as a topic that is gone)
    await db.conversationMember.create({ data: { conversationId: w.reports.id, userId: w.owner.id } });
    await db.conversation.update({ where: { id: w.reports.id }, data: { closedAt: new Date() } });
    const closed = await saveDaily(w.reports.id);
    expect(closed.status).toBe(422);
    expect(closed.text).toContain("oms.events.e.topic");
  });

  it("a partner owner whose oversight is OFF is judged like a space admin: he posts in an open topic without joining, but cannot read a restricted topic he is not in", async () => {
    const w = await world({ ownerJoined: false });
    const partner = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Partner" });
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: partner.id }, data: { primaryOwner: false, revokedCapabilities: ["archive.view"] } });
    const hidden = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "خاص", restricted: true } });
    await loginAs(partner.id);
    // he connects the receiver (a new address): from now on HE is the author of the cards
    expect((await call(settingsRoute.POST, { url, body: { action: "rotate_id" } })).status).toBe(200);
    const row = await db.integration.findFirstOrThrow({ where: { orgId: w.org.id, type: "OMS_EVENTS" } });
    expect((row.config as { connectedById: string }).connectedById).toBe(partner.id);
    expect((await saveRoute(w.topic.id)).status).toBe(200);
    const refused = await saveRoute(hidden.id);
    expect(refused.status).toBe(422);
    expect(refused.text).toContain("oms.events.e.author_forbidden");
  });

  it("a rule saved while he was in the topic writes NO card once he is out of it: a visible failure by code, the delivery still counts, and when he is back the card is written", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await saveRoute(w.topic.id)).status).toBe(200);
    logout();
    await db.conversationMember.deleteMany({ where: { conversationId: w.topic.id, userId: w.owner.id } });
    expect((await deliver(w, eventBody("order.returned"))).status).toBe(200);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(0);
    const failure = await db.integrationEvent.findFirst({ where: { orgId: w.org.id, status: "FAILED" } });
    expect(failure?.detail).toBe("oms_events.author_forbidden");
    expect(failure?.payload).toBeNull();
    expect(await stateOf(w)).toMatchObject({ status: "returned" });
    await db.conversationMember.create({ data: { conversationId: w.topic.id, userId: w.owner.id } });
    expect((await deliver(w, eventBody("order.returned"))).status).toBe(200);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(1);
  });

  it("the daily card is not sent when he is out of the topic: ONE failure, the day stays taken (it will not mend by itself)", async () => {
    const w = await world();
    const now = new Date(Date.now() + 60_000);
    const tz = (await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { timezone: true } })).timezone;
    await loginAs(w.owner.id);
    expect((await call(settingsRoute.PUT, { method: "PUT", url, body: { dailyCard: { hour: zonedParts(now, tz ?? "Asia/Damascus").hour, conversationId: w.reports.id } } })).status).toBe(200);
    logout();
    await db.conversationMember.deleteMany({ where: { conversationId: w.reports.id, userId: w.owner.id } });
    expect((await runOmsDailyCard(now)).failed).toBe(1);
    expect((await runOmsDailyCard(new Date(now.getTime() + 30_000))).failed).toBe(0);
    expect(await db.chatMessage.count({ where: { conversationId: w.reports.id } })).toBe(0);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, source: "oms-daily" } })).toBe(1);
    expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", detail: "oms_daily_card.failed" } })).toBe(1);
  });
});

describe("a delivery is refused unless it is signed, fresh, small and for a receiver that exists", () => {
  it("the switch off, an unknown receiver and a receiver with no secret", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    expect((await deliver(w, raw, { receiverId: "f".repeat(32) })).status).toBe(404);
    expect((await deliver(w, raw, { receiverId: "not-an-id" })).status).toBe(404);
    const noSecret = await world({ secret: false });
    // it signs with a secret the receiver does not hold: nothing is accepted
    expect((await deliver(noSecret, raw)).status).toBe(401);
    await setFeatures(w.org.id, { omsEvents: false });
    const off = await deliver(w, raw);
    expect(off.status).toBe(404);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await stateOf(w)).toBeNull();
  });

  it("UNSIGNED is refused (no headers, no signature, no timestamp); a wrong signature, a wrong secret, an edited body and an old timestamp too; nothing is stored", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    const cases: Array<[string, Delivery, number, string]> = [
      ["no timestamp and no signature", { ts: null }, 401, "oms_events.unsigned"],
      ["a timestamp but no signature", { sig: null }, 401, "oms_events.unsigned"],
      ["a wrong signature", { sig: `sha256=${"0".repeat(64)}` }, 401, "oms_events.bad_signature"],
      ["a signature that is not hex", { sig: "sha256=hello" }, 401, "oms_events.bad_signature"],
      ["another secret", { secret: "another-secret-000000000000" }, 401, "oms_events.bad_signature"],
      ["an old timestamp", { ts: unixSeconds(new Date(Date.now() - 6 * 60_000)) }, 401, "oms_events.stale_timestamp"],
      ["a timestamp from the future", { ts: unixSeconds(new Date(Date.now() + 6 * 60_000)) }, 401, "oms_events.stale_timestamp"],
      ["a timestamp that is not a number", { ts: "yesterday" }, 401, "oms_events.bad_timestamp"],
    ];
    for (const [label, d, status, error] of cases) {
      const r = await deliver(w, raw, d);
      expect({ label, status: r.status, error: r.json.error }).toEqual({ label, status, error });
    }
    // an edited body under the signature of the original
    const ts = unixSeconds();
    const edited = await deliver(w, eventBody("order.confirmed", { order_number: "ZK-2026-999999" }), { ts, sig: zakiSignatureHeader(SECRET, ts, raw) });
    expect(edited.status).toBe(401);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.omsOrderState.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("an oversized body is refused 413 before anything else (the signature is never even looked at)", async () => {
    const w = await world();
    const big = JSON.stringify({ event: "order.confirmed", data: { order_number: NUMBER, pad: "x".repeat(MAX_EVENT_BODY_BYTES + 10) } });
    expect(Buffer.byteLength(big)).toBeGreaterThan(MAX_EVENT_BODY_BYTES);
    const r = await deliver(w, big);
    expect(r.status).toBe(413);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id } })).toBe(0);
    // just under the ceiling still goes through
    const small = JSON.stringify({ event: "order.confirmed", data: { order_number: NUMBER, pad: "x".repeat(MAX_EVENT_BODY_BYTES - 200) } });
    expect(Buffer.byteLength(small)).toBeLessThan(MAX_EVENT_BODY_BYTES);
    expect((await deliver(w, small)).status).toBe(200);
  });

  it("an address that keeps sending refused deliveries is answered 429 for a while; a delivery that is fine is not counted against it", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    for (let i = 0; i < 30; i++) expect((await deliver(w, raw, { sig: `sha256=${"0".repeat(64)}` })).status).toBe(401);
    const blocked = await receiverRoute.POST(new Request("http://localhost/x", { method: "POST", body: raw }), { params: { receiverId: w.receiverId } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    refusedDeliveriesLimiter.reset("unknown");
    for (let i = 0; i < 40; i++) expect((await deliver(w, raw)).status).toBe(200);
  });

  it("the delivery id and the event name are required to be sane; a header that disagrees with the body is refused", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    expect((await deliver(w, raw, { id: "short" })).status).toBe(400);
    expect((await deliver(w, raw, { event: "order.shipped" })).status).toBe(400);
    expect((await deliver(w, "not json")).status).toBe(400);
    expect((await deliver(w, JSON.stringify({ data: {} }))).status).toBe(422);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("milliseconds are accepted when they are the text that was signed (the orders system's unit)", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    const ts = String(Date.now());
    expect((await deliver(w, raw, { ts })).status).toBe(200);
  });
});

describe("each delivery is taken once", () => {
  it("the same X-Zaki-Delivery again is answered «duplicate», counts once and changes nothing", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    const first = await deliver(w, raw, { id: "delivery-0001-abcdef" });
    expect(first.status).toBe(200);
    expect(first.json.duplicate).toBeUndefined();
    const before = await stateOf(w);
    const again = await deliver(w, raw, { id: "delivery-0001-abcdef" });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, source: "oms" } })).toBe(1);
    expect((await stateOf(w))?.updatedAt).toEqual(before?.updatedAt);
    const counts = await countEvents(w.org.id, new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));
    expect(counts["order.confirmed"]).toBe(1);
  });

  it("two at once make one; the delivery id is per company and per source", async () => {
    const w = await world();
    const other = await world();
    const raw = eventBody("order.confirmed");
    const both = await Promise.all([deliver(w, raw, { id: "delivery-0002-abcdef" }), deliver(w, raw, { id: "delivery-0002-abcdef" })]);
    expect(both.map((b) => b.status)).toEqual([200, 200]);
    expect(both.filter((b) => b.json.duplicate).length).toBe(1);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id } })).toBe(1);
    // the same id for another company is its own delivery
    expect((await deliver(other, raw, { id: "delivery-0002-abcdef" })).json.duplicate).toBeUndefined();
    // and the claim helper itself: the same id for another SOURCE is another delivery
    expect(await claimInboundDelivery(db, { orgId: w.org.id, source: "n8n", deliveryId: "delivery-0002-abcdef" })).toBe(true);
    expect(await claimInboundDelivery(db, { orgId: w.org.id, source: "n8n", deliveryId: "delivery-0002-abcdef" })).toBe(false);
  });

  it("a failure inside the write takes nothing: the sender can send it again", async () => {
    const w = await world();
    const raw = eventBody("order.confirmed");
    // the state write fails inside the database (a trigger of this test): the delivery row taken a moment before is not left behind
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION oms_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER oms_test_fail BEFORE INSERT ON "OmsOrderState" FOR EACH ROW EXECUTE FUNCTION oms_test_fail()`);
    try {
      await expect(deliver(w, raw, { id: "delivery-0003-abcdef" })).resolves.toMatchObject({ status: 500 });
      expect(await db.inboundDelivery.count({ where: { orgId: w.org.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS oms_test_fail ON "OmsOrderState"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS oms_test_fail()`);
    }
    expect((await deliver(w, raw, { id: "delivery-0003-abcdef" })).status).toBe(200);
  });
});

describe("what reaches the database", () => {
  it("total, currency, city, the tracking number and the raw body are in NO row of any table the delivery touched (the rows are read)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { routes: [{ event: "order.created", conversationId: w.topic.id }, { event: "order.returned", conversationId: w.topic.id }] } });
    logout();
    for (const name of Object.keys(fixture.events) as Array<keyof typeof fixture.events>) expect((await deliver(w, eventBody(name))).status, name).toBe(200);

    const state = await stateOf(w);
    expect(state).toMatchObject({ orderId: "ord_77", status: "cancelled", productName: "حراك", quantity: 2 });
    const tables = {
      state: await db.omsOrderState.findMany({ where: { orgId: w.org.id } }),
      deliveries: await db.inboundDelivery.findMany({ where: { orgId: w.org.id } }),
      events: await db.integrationEvent.findMany({ where: { orgId: w.org.id } }),
      messages: await db.chatMessage.findMany({ where: { orgId: w.org.id } }),
      integration: (await db.integration.findMany({ where: { orgId: w.org.id } })).map((i) => i.config),
      audit: await db.auditLog.findMany({ where: { orgId: w.org.id } }),
      tickets: await db.ticket.findMany({ where: { orgId: w.org.id } }),
    };
    const dump = JSON.stringify(tables);
    for (const leak of LEAKS) expect(dump, leak).not.toContain(leak);
    // no body, no payload, no header: a delivery row is five facts
    expect(Object.keys(tables.deliveries[0]!).sort()).toEqual(["deliveryId", "event", "id", "orgId", "receivedAt", "source"]);
    expect(tables.deliveries.length).toBe(6);
    // the state table has no column for money or a place
    expect(Object.keys(state!).filter((k) => /total|currency|city|price|amount|address|phone|customer/i.test(k))).toEqual([]);
    expect(tables.events.every((e) => e.payload === null)).toBe(true);
  });

  it("an older event never overwrites a newer state, and a field the event does not carry keeps what was known", async () => {
    const w = await world();
    expect((await deliver(w, eventBody("order.created"))).status).toBe(200);
    expect((await deliver(w, eventBody("order.delivered", {}, "2030-01-05T10:00:00.000Z"))).status).toBe(200);
    expect(await stateOf(w)).toMatchObject({ status: "delivered", shippingState: "delivered", productName: "حراك", quantity: 2, confirmationState: "pending" });
    // an event from before it arrives late: counted, but the state stays
    expect((await deliver(w, eventBody("order.shipped", {}, "2030-01-03T10:00:00.000Z"))).status).toBe(200);
    expect(await stateOf(w)).toMatchObject({ status: "delivered", shippingState: "delivered" });
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, event: "order.shipped" } })).toBe(1);
  });

  it("an event with no order number is counted and writes no state", async () => {
    const w = await world();
    expect((await deliver(w, JSON.stringify({ event: "order.confirmed", data: {} }))).status).toBe(200);
    expect(await db.omsOrderState.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, event: "order.confirmed" } })).toBe(1);
  });
});

describe("one company's receiver never touches another's", () => {
  it("B's secret on A's address is refused, and A's events write nothing for B", async () => {
    const a = await world();
    const b = await world();
    // B has its own secret: set a different one for B
    await loginAs(b.owner.id);
    await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { secret: "b-company-secret-0123456789-abcdef" } });
    logout();
    const raw = eventBody("order.confirmed");
    expect((await deliver(a, raw, { secret: "b-company-secret-0123456789-abcdef" })).status).toBe(401);
    expect((await deliver(b, raw)).status).toBe(401);
    expect((await deliver(a, raw)).status).toBe(200);
    expect(await db.omsOrderState.count({ where: { orgId: a.org.id } })).toBe(1);
    expect(await db.omsOrderState.count({ where: { orgId: b.org.id } })).toBe(0);
    expect(await db.inboundDelivery.count({ where: { orgId: b.org.id } })).toBe(0);
    // A's address after the owner changes it: the old one stops at once
    await loginAs(a.owner.id);
    const rotated = await call(settingsRoute.POST, { url: "http://localhost/x", body: { action: "rotate_id" } });
    logout();
    expect(rotated.json?.["receiverId"]).not.toBe(a.receiverId);
    expect((await deliver(a, raw)).status).toBe(404);
    expect((await deliver({ receiverId: rotated.json?.["receiverId"] as string }, raw)).status).toBe(200);
  });
});

describe("rules per space: a card in the topic", () => {
  it("an event with a rule posts ONE card (the order number as its ref, no money, the app's name), an event with none posts nothing", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { routes: [{ event: "order.returned", conversationId: w.topic.id }] } })).status).toBe(200);
    logout();
    expect((await deliver(w, eventBody("order.confirmed"))).status).toBe(200);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(0);
    const sent = await deliver(w, eventBody("order.returned"), { id: "delivery-card-0001" });
    expect(sent.status).toBe(200);
    // a redelivery of the same delivery posts nothing more
    await deliver(w, eventBody("order.returned"), { id: "delivery-card-0001" });
    const cards = await db.chatMessage.findMany({ where: { conversationId: w.topic.id } });
    expect(cards.length).toBe(1);
    const card = cards[0]!;
    expect(card).toMatchObject({ kind: "CARD", viaApp: "نظام الطلبات", authorId: w.owner.id, orgId: w.org.id });
    expect(card.card).toMatchObject({ type: "app", title: "مرتجع", ref: NUMBER, status: "warn" });
    expect(card.body).toContain(NUMBER);
    expect(card.body).toContain("مرتجع");
    const topic = await db.conversation.findUniqueOrThrow({ where: { id: w.topic.id } });
    expect(topic.lastMessageAt).toEqual(card.createdAt);
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "message.created" } })).toBeGreaterThanOrEqual(1);
  });

  it("a topic that was archived since leaves a visible failure and the delivery still counts", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { routes: [{ event: "order.cancelled", conversationId: w.topic.id }] } });
    logout();
    await db.conversation.update({ where: { id: w.topic.id }, data: { archivedAt: new Date() } });
    expect((await deliver(w, eventBody("order.cancelled"))).status).toBe(200);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(0);
    const failure = await db.integrationEvent.findFirst({ where: { orgId: w.org.id, status: "FAILED" } });
    expect(failure?.detail).toBe("oms_events.topic_gone");
    expect(failure?.payload).toBeNull();
    expect(await stateOf(w)).toMatchObject({ status: "cancelled" });
  });
});

describe("the ticket rule by EVENT (the fourth kind of autoTicketRules)", () => {
  async function ticketWorld() {
    const w = await world();
    await setFeatures(w.org.id, { autoTickets: true });
    const dept = await makeDepartment(w.org.id, { memberIds: [w.member.id], leadId: w.member.id });
    return { ...w, dept };
  }
  const save = (body: unknown) => call(problemSettingsRoute.PUT, { method: "PUT", url: "http://localhost/api/tickets/problem-settings", body });

  it("order.returned opens ONE ticket for the person named, made by the person who connected it; the same order again while it is open makes no second", async () => {
    const w = await ticketWorld();
    await loginAs(w.owner.id);
    const saved = await save({ eventRules: [{ id: "r1", type: "event", event: "order.returned", kindKey: "returned", assigneeId: w.member.id }, { id: "r2", type: "event", event: "order.confirmed", kindKey: "returned" }, { id: "r3", type: "event", event: "order.cancelled", kindKey: "no_such_kind" }] });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    // only the returned and cancelled events can open a ticket, and only for a kind that exists
    expect((saved.json?.["eventRules"] as Array<{ id: string }>).map((r) => r.id)).toEqual(["r1"]);
    logout();
    expect((await deliver(w, eventBody("order.returned"), { id: "delivery-tkt-0001" })).status).toBe(200);
    const tickets = await db.ticket.findMany({ where: { orgId: w.org.id } });
    expect(tickets.length).toBe(1);
    expect(tickets[0]).toMatchObject({ creatorId: w.owner.id, assigneeId: w.member.id, externalRef: NUMBER, kindKey: "returned" });
    expect(tickets[0]!.title).toContain(NUMBER);
    for (const leak of LEAKS) expect(JSON.stringify(tickets)).not.toContain(leak);
    // the same order returned again under another delivery id, while the ticket is open
    expect((await deliver(w, eventBody("order.returned"), { id: "delivery-tkt-0002" })).status).toBe(200);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(1);
    // an event with no rule (confirmed) makes nothing
    expect((await deliver(w, eventBody("order.confirmed", { order_number: "ZK-2026-000124" }))).status).toBe(200);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("a department works too, the rule survives saving the other rules, and with the switch autoTickets off nothing is opened", async () => {
    const w = await ticketWorld();
    await loginAs(w.owner.id);
    await save({ eventRules: [{ id: "r1", type: "event", event: "order.cancelled", kindKey: "other", departmentId: w.dept.id }] });
    // saving the three Q1.5 kinds of rules without touching the event rules keeps them
    const again = await save({ rules: [] });
    expect((again.json?.["eventRules"] as unknown[]).length).toBe(1);
    logout();
    expect((await deliver(w, eventBody("order.cancelled"))).status).toBe(200);
    const t = await db.ticket.findFirstOrThrow({ where: { orgId: w.org.id } });
    expect(t).toMatchObject({ departmentId: w.dept.id, creatorId: w.owner.id, externalRef: NUMBER });
    await db.ticket.deleteMany({ where: { orgId: w.org.id } });
    await setFeatures(w.org.id, { autoTickets: false });
    expect((await deliver(w, eventBody("order.cancelled", { order_number: "ZK-2026-000125" }))).status).toBe(200);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a rule whose person is no longer active makes no ticket and the delivery is still taken", async () => {
    const w = await ticketWorld();
    await loginAs(w.owner.id);
    await save({ eventRules: [{ id: "r1", type: "event", event: "order.returned", kindKey: "returned", assigneeId: w.member.id }] });
    logout();
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.member.id }, data: { status: "SUSPENDED" } });
    expect((await deliver(w, eventBody("order.returned"))).status).toBe(200);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, event: "order.returned" } })).toBe(1);
  });
});

describe("the daily numbers card", () => {
  /**
   * The test's clock, pinned: minute 59 of an hour between 00 and 21 in the company's zone, at most a few hours ahead (the events received now stay inside the
   * day the card counts). One tick later is the NEXT hour, the case that once made a second card on CI (2026-11-25), and no step of a test crosses midnight, so
   * the result no longer depends on when the suite runs.
   */
  function pinnedNow(tz: string): Date {
    let t = Math.ceil((Date.now() + 60_000) / 60_000) * 60_000;
    for (;;) {
      const p = zonedParts(new Date(t), tz);
      if (p.minute === 59 && p.hour <= 21) return new Date(t);
      t += 60_000;
    }
  }

  async function dailyWorld(hourOffset = 0) {
    const w = await world();
    // the job walks every receiver: an earlier world of the SAME test (an hour later, or switched off) must not add its card to this one's run
    await db.integration.updateMany({ where: { type: "OMS_EVENTS", orgId: { not: w.org.id } }, data: { connected: false } });
    const tz = (await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { timezone: true } })).timezone;
    const now = pinnedNow(tz ?? "Asia/Damascus");
    const hour = zonedParts(now, tz ?? "Asia/Damascus").hour;
    await loginAs(w.owner.id);
    const put = await call(settingsRoute.PUT, { method: "PUT", url: "http://localhost/x", body: { dailyCard: { hour: Math.min(23, hour + hourOffset), conversationId: w.reports.id } } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    logout();
    return { ...w, now, hour };
  }

  it("counts the five events from what was received, once a day, with no money and no customer data, and says what cannot be counted", async () => {
    const w = await dailyWorld();
    for (const [name, n] of [["order.confirmed", 3], ["order.cancelled", 1], ["order.shipped", 2], ["order.delivered", 1], ["order.returned", 1]] as const) {
      for (let i = 0; i < n; i++) expect((await deliver(w, eventBody(name, { order_number: `ZK-2026-00${100 + i}` }))).status).toBe(200);
    }
    // an event that is not counted (and a duplicate) change nothing
    await deliver(w, eventBody("order.created", { order_number: "ZK-2026-000190" }));
    const run = await runOmsDailyCard(w.now);
    expect(run).toEqual({ sent: 1, failed: 0 });
    const cards = await db.chatMessage.findMany({ where: { conversationId: w.reports.id } });
    expect(cards.length).toBe(1);
    const lines = (cards[0]!.card as { lines: Array<{ label: string; value: string }> }).lines;
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel).toMatchObject({ "تأكّدت": "3", "انلغت": "1", "انشحنت": "2", "اتسلّمت": "1", "رجعت": "1" });
    expect(lines.at(-1)?.value).toMatch(/الطلبات الجديدة/);
    expect(cards[0]).toMatchObject({ kind: "CARD", viaApp: "نظام الطلبات", authorId: w.owner.id });
    const dump = JSON.stringify(cards);
    for (const leak of LEAKS) expect(dump, leak).not.toContain(leak);
    // the day is taken: a second tick, and a runner that restarted, send nothing more
    expect(await runOmsDailyCard(new Date(w.now.getTime() + 30_000))).toEqual({ sent: 0, failed: 0 });
    expect(await db.chatMessage.count({ where: { conversationId: w.reports.id } })).toBe(1);
    // the next day it is sent again
    expect((await runOmsDailyCard(new Date(w.now.getTime() + 24 * 3_600_000 + 60_000))).sent).toBe(1);
  });

  it("nothing before the hour, nothing while the switch is off, and a failure gives the day back and shows under «التكاملات»", async () => {
    const early = await dailyWorld(1);
    // the pinned hour is 21 at most, so «an hour later» is always a later hour
    expect(early.hour).toBeLessThan(23);
    expect(await runOmsDailyCard(early.now)).toEqual({ sent: 0, failed: 0 });
    const off = await dailyWorld();
    await setFeatures(off.org.id, { omsEvents: false });
    expect((await runOmsDailyCard(off.now)).sent).toBe(0);
    expect(await db.chatMessage.count({ where: { conversationId: off.reports.id } })).toBe(0);

    // a topic that is gone will not mend by itself: ONE failure row, the day stays taken (no row every 30 seconds), and tomorrow sends again
    const gone = await dailyWorld();
    await db.conversation.update({ where: { id: gone.reports.id }, data: { archivedAt: new Date() } });
    expect((await runOmsDailyCard(gone.now)).failed).toBe(1);
    expect((await runOmsDailyCard(new Date(gone.now.getTime() + 30_000))).failed).toBe(0);
    expect(await db.inboundDelivery.count({ where: { orgId: gone.org.id, source: "oms-daily" } })).toBe(1);
    expect(await db.integrationEvent.count({ where: { orgId: gone.org.id, status: "FAILED", detail: "oms_daily_card.failed" } })).toBe(1);
    await db.conversation.update({ where: { id: gone.reports.id }, data: { archivedAt: null } });
    expect((await runOmsDailyCard(new Date(gone.now.getTime() + 24 * 3_600_000 + 60_000))).sent).toBe(1);
  });

  it("a failure that may mend (the database) gives the day back: the next tick sends, and the failure shows once, not at every tick", async () => {
    const w = await dailyWorld();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION oms_test_fail_msg() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER oms_test_fail_msg BEFORE INSERT ON "ChatMessage" FOR EACH ROW EXECUTE FUNCTION oms_test_fail_msg()`);
    try {
      expect((await runOmsDailyCard(w.now)).failed).toBe(1);
      expect((await runOmsDailyCard(new Date(w.now.getTime() + 30_000))).failed).toBe(1);
      expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, source: "oms-daily" } })).toBe(0);
      expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", type: "oms.daily_card" } })).toBe(1);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS oms_test_fail_msg ON "ChatMessage"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS oms_test_fail_msg()`);
    }
    expect((await runOmsDailyCard(new Date(w.now.getTime() + 60_000))).sent).toBe(1);
  });

  it("cleaning the old delivery rows after the card is stored never gives the day back: a failed cleanup makes no second card", async () => {
    const w = await dailyWorld();
    await db.inboundDelivery.create({ data: { orgId: w.org.id, source: "oms", deliveryId: "old-delivery-0002", event: "order.confirmed", receivedAt: new Date(Date.now() - 41 * 86_400_000) } });
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION oms_test_fail_clean() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER oms_test_fail_clean BEFORE DELETE ON "InboundDelivery" FOR EACH ROW WHEN (OLD.source = 'oms') EXECUTE FUNCTION oms_test_fail_clean()`);
    try {
      expect(await runOmsDailyCard(w.now)).toEqual({ sent: 1, failed: 0 });
      expect(await runOmsDailyCard(new Date(w.now.getTime() + 30_000))).toEqual({ sent: 0, failed: 0 });
      expect(await db.chatMessage.count({ where: { conversationId: w.reports.id } })).toBe(1);
      expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, source: "oms-daily" } })).toBe(1);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS oms_test_fail_clean ON "InboundDelivery"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS oms_test_fail_clean()`);
    }
  });

  it("the sign of a delivery older than 40 days is not needed any more: the old rows are removed when the card is sent", async () => {
    const w = await dailyWorld();
    await db.inboundDelivery.create({ data: { orgId: w.org.id, source: "oms", deliveryId: "old-delivery-0001", event: "order.confirmed", receivedAt: new Date(Date.now() - 41 * 86_400_000) } });
    await deliver(w, eventBody("order.confirmed"));
    await runOmsDailyCard(w.now);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, deliveryId: "old-delivery-0001" } })).toBe(0);
    expect(await db.inboundDelivery.count({ where: { orgId: w.org.id, source: "oms" } })).toBe(1);
  });
});

describe("the signing helpers agree with the verifier the receiver uses", () => {
  it("signZakiPayload and zakiSignatureHeader are the same HMAC", () => {
    expect(zakiSignatureHeader("s", "1", "b")).toBe(`sha256=${signZakiPayload("s", "1", "b")}`);
  });
});
