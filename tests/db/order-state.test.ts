import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as stateRoute from "@/app/api/orders/state/route";
import * as sendRecallRoute from "@/app/api/chat/conversations/[id]/recall/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as editRoute from "@/app/api/chat/messages/[id]/route";
import { withFeature } from "@/lib/features";
import { encryptSecrets } from "@/server/crypto";
import { setOmsOptionsForTests } from "@/server/integrations/oms";
import { clearOrderNegativeCache } from "@/server/services/order-state";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * Q1.4: an order's state — read from the orders system by NUMBER, kept 60 seconds in a small cache, shown as a chip and as a «/طلب» card.
 * Against a real PostgreSQL and a FAKE orders system.
 *
 * Pins: the switches (orderStatus + omsLink) off = 404; staff only; a person who cannot read the conversation gets nothing (and the orders system is
 * not even asked); the cache keeps ONLY the fields of the door's contract (a customer's name or phone in the answer is dropped); 60 seconds fresh;
 * an unreachable system shows the last known state marked old; an old orders system (no by-number door) is told as «تتفعّل بعد التحديث»; an answer for
 * another number is no answer; the «/طلب» card stores the number only (no state, no customer data), cannot be edited, and a wrong number is refused.
 */

const KEY = "oms-test-encryption-key-0123456789-abcdef";
const saved: Record<string, string | undefined> = {};
let fetchCalls: string[] = [];
let answer: (url: string) => Response | Promise<Response> = () => new Response("{}", { status: 404 });

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const NUMBER = "ZK-2026-000123";
const door = (over: Record<string, unknown> = {}) => ({ number: NUMBER, order_id: "ord_77", status: "shipped", confirmation_state: "confirmed", shipping_state: "shipped", updated_at: "2030-01-02T10:00:00.000Z", product_name: "حراك", quantity: 2, ...over });

beforeAll(() => {
  saved["ENCRYPTION_KEY"] = process.env["ENCRYPTION_KEY"];
});
afterAll(() => {
  if (saved["ENCRYPTION_KEY"] === undefined) delete process.env["ENCRYPTION_KEY"];
  else process.env["ENCRYPTION_KEY"] = saved["ENCRYPTION_KEY"];
  setOmsOptionsForTests(null);
});
beforeEach(async () => {
  await db.integration.deleteMany({ where: { type: "OMS" } });
  process.env["ENCRYPTION_KEY"] = KEY;
  fetchCalls = [];
  answer = () => ok(door());
  setOmsOptionsForTests({
    resolve: async () => ["93.184.216.34"],
    fetchImpl: (async (url: string) => {
      fetchCalls.push(String(url));
      return answer(String(url));
    }) as typeof fetch,
  });
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function world(opts: { orderStatus?: boolean; omsLink?: boolean; connected?: boolean } = {}) {
  const team = await makeTeam();
  const outsider = await makeUserIn(team.org.id);
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id }, { userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], "الشات");
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "المشاكل" } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: team.org.id }, select: { settings: true } });
  let s = org.settings as Record<string, unknown>;
  s = withFeature(s, "orderStatus", opts.orderStatus !== false);
  s = withFeature(s, "omsLink", opts.omsLink !== false);
  s = withFeature(s, "quickRecall", true);
  await db.organization.update({ where: { id: team.org.id }, data: { settings: s as Prisma.InputJsonValue } });
  if (opts.connected !== false) {
    await db.integration.create({ data: { orgId: team.org.id, type: "OMS", connected: true, secretEnc: encryptSecrets({ token: "omsk_test_token" }), config: { baseUrl: "https://oms.example.test" } } });
  }
  return { ...team, outsider, space, topic };
}
type World = Awaited<ReturnType<typeof world>>;

async function makeUserIn(orgId: string) {
  const { makeUser } = await import("./helpers");
  return makeUser({ orgId, role: "MEMBER", name: "Outsider" });
}

const state = (w: World, number = NUMBER, conv: string | null = w.topic.id) =>
  call(stateRoute.GET, { url: `http://localhost/api/orders/state?number=${encodeURIComponent(number)}${conv ? `&conversationId=${conv}` : ""}` });
const sendOrder = (w: World, order: string, convId = w.topic.id, clientId?: string) =>
  call(sendRecallRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${convId}/recall`, params: { id: convId }, body: { order, ...(clientId ? { clientId } : {}) } });

describe("the switches and who may ask", () => {
  it("with orderStatus off, or the orders system not linked, both doors answer 404 and nothing is asked", async () => {
    for (const opts of [{ orderStatus: false }, { omsLink: false }, { connected: false }]) {
      const w = await world(opts);
      await loginAs(w.member.id);
      const s = await state(w);
      expect(s.status).toBe(404);
      expect((await sendOrder(w, NUMBER)).status).toBe(404);
    }
    expect(fetchCalls).toEqual([]);
  });
  it("a guest and a person outside the conversation get nothing, and the orders system is not asked", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    expect([403, 404]).toContain((await state(w)).status);
    await loginAs(w.outsider.id);
    expect((await state(w)).status).toBe(404);
    // the ordinary send path answers (403 or 404): either way nothing is posted
    expect([403, 404]).toContain((await sendOrder(w, NUMBER)).status);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "CARD" } })).toBe(0);
    expect(fetchCalls).toEqual([]);
  });
  it("the door needs the conversation: without one it is refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await state(w, NUMBER, null)).status).toBe(422);
    expect(fetchCalls).toEqual([]);
  });
  it("a phone number or a wrong shape is refused before anything is asked", async () => {
    const w = await world();
    await loginAs(w.member.id);
    for (const bad of ["0791234567", "079-1234-5678", "zk-2026-000123", "ZK-1-2"]) {
      expect((await state(w, bad)).status, bad).toBe(422);
      expect((await sendOrder(w, bad)).status, bad).toBe(422);
    }
    expect(fetchCalls).toEqual([]);
  });
});

describe("the lookup and the cache", () => {
  it("reads the state by number and keeps only the fields of the contract", async () => {
    const w = await world();
    answer = () => ok(door({ customer_name: "سلمى الأحمد", phone: "0791234567", address: "عمان", city: "عمان", email: "x@y.test" }));
    await loginAs(w.member.id);
    const r = await state(w);
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ number: NUMBER, state: "ready", status: "shipped", confirmation: "confirmed", shipping: "shipped", productName: "حراك", quantity: 2, stale: false });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain("/api/v1/orders?number=ZK-2026-000123");
    // what was kept: the row and the answer carry none of the customer's fields
    const row = await db.omsOrderState.findUniqueOrThrow({ where: { orgId_orderNumber: { orgId: w.org.id, orderNumber: NUMBER } } });
    expect(row).toMatchObject({ orderId: "ord_77", status: "shipped", productName: "حراك", quantity: 2 });
    const everything = JSON.stringify(row) + r.text;
    for (const leak of ["سلمى", "0791234567", "عمان", "x@y.test", "customer_name", "address"]) expect(everything, leak).not.toContain(leak);
  });
  it("is kept 60 seconds fresh: a second look inside it asks nobody, after it asks again", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await state(w);
    await state(w);
    expect(fetchCalls).toHaveLength(1);
    await db.omsOrderState.update({ where: { orgId_orderNumber: { orgId: w.org.id, orderNumber: NUMBER } }, data: { fetchedAt: new Date(Date.now() - 61_000) } });
    answer = () => ok(door({ status: "delivered", shipping_state: "delivered" }));
    const r = await state(w);
    expect(fetchCalls).toHaveLength(2);
    expect(r.json).toMatchObject({ status: "delivered", shipping: "delivered" });
  });
  it("an unreachable system shows the last known state, marked old; with none known it says it could not", async () => {
    const w = await world();
    await loginAs(w.member.id);
    answer = () => new Response("down", { status: 503 });
    expect((await state(w)).json).toMatchObject({ state: "unreachable" });
    answer = () => ok(door());
    clearOrderNegativeCache();
    await state(w);
    await db.omsOrderState.update({ where: { orgId_orderNumber: { orgId: w.org.id, orderNumber: NUMBER } }, data: { fetchedAt: new Date(Date.now() - 120_000) } });
    answer = () => new Response("down", { status: 503 });
    expect((await state(w)).json).toMatchObject({ state: "ready", stale: true, status: "shipped" });
  });
  it("an orders system without the by-number door is told as «waits for the update»; an unknown number as «not found»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    answer = () => new Response("", { status: 501 });
    expect((await state(w)).json).toMatchObject({ state: "waits_update" });
    clearOrderNegativeCache();
    answer = () => ok([door(), door({ number: "ZK-2026-000124" })]);
    expect((await state(w)).json).toMatchObject({ state: "waits_update" });
    clearOrderNegativeCache();
    answer = () => new Response("", { status: 404 });
    expect((await state(w)).json).toMatchObject({ state: "not_found" });
  });
  it("an answer for another order is no answer: its state is never shown under this number", async () => {
    const w = await world();
    await loginAs(w.member.id);
    answer = () => ok(door({ number: "ZK-2026-999999", status: "cancelled" }));
    const r = await state(w);
    expect(r.json).toMatchObject({ state: "waits_update" });
    expect(r.text).not.toContain("cancelled");
    expect(await db.omsOrderState.count({ where: { orgId: w.org.id } })).toBe(0);
  });
  it("an unknown state word travels as a key, never as an invented one", async () => {
    const w = await world();
    await loginAs(w.member.id);
    answer = () => ok(door({ status: "<b>weird</b>", shipping_state: "teleported" }));
    const r = await state(w);
    expect(r.json).toMatchObject({ status: null, shipping: "teleported" });
  });
});

describe("«/طلب» sends a card with the number only", () => {
  it("stores `{ type: order, number }` and a line with no state; nobody can edit it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await sendOrder(w, NUMBER);
    expect(r.status, r.text).toBe(201);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: r.json!["id"] as string } });
    expect(row).toMatchObject({ kind: "CARD", body: `طلب ${NUMBER}`, authorId: w.member.id });
    expect(row.card).toEqual({ type: "order", number: NUMBER });
    expect(r.json).toMatchObject({ kind: "CARD", card: { type: "order", number: NUMBER } });
    expect(fetchCalls).toEqual([]);
    const edit = await call(editRoute.PATCH, { method: "PATCH", url: `http://localhost/api/chat/messages/${row.id}`, params: { id: row.id }, body: { body: "غيّرت" } });
    expect(edit.status).toBeGreaterThanOrEqual(400);
  });
  it("the same clientId sends it once", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await sendOrder(w, NUMBER, w.topic.id, "order-client-1");
    const b = await sendOrder(w, NUMBER, w.topic.id, "order-client-1");
    expect(b.json!["id"]).toBe(a.json!["id"]);
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id, kind: "CARD" } })).toBe(1);
  });
  it("a reader sees the order card in the conversation, a guest too (the state itself is asked for per reader)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await sendOrder(w, NUMBER);
    await loginAs(w.guest.id);
    const r = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } });
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain("ZK-2026-000123");
    expect(r.text).not.toContain("shipped");
    expect((await state(w)).status).toBe(404);
  });
});

describe("review fixes", () => {
  it("a lookup the orders system cannot answer leaves no failure on the owner's integration card", async () => {
    const w = await world();
    await loginAs(w.member.id);
    for (const code of [404, 400, 405, 501]) {
      clearOrderNegativeCache();
      answer = () => new Response("", { status: code });
      await state(w);
    }
    expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", type: { startsWith: "oms." } } })).toBe(0);
    // a real failure (the system is down) is still recorded
    clearOrderNegativeCache();
    answer = () => new Response("", { status: 503 });
    await state(w);
    expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", type: { startsWith: "oms." } } })).toBe(1);
  });
  it("the screen offers chips and the «طلب» tab only while the orders system is connected", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const detail = () => call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}`, params: { id: w.topic.id } });
    const on = await detail();
    expect((on.json!["me"] as Record<string, unknown>)["canOrderState"]).toBe(true);
    expect((on.json!["me"] as Record<string, unknown>)["recallKinds"]).toContain("order");
    await db.integration.updateMany({ where: { orgId: w.org.id, type: "OMS" }, data: { connected: false } });
    const off = await detail();
    expect((off.json!["me"] as Record<string, unknown>)["canOrderState"]).toBe(false);
    expect((off.json!["me"] as Record<string, unknown>)["recallKinds"]).not.toContain("order");
  });
  it("a failed or unknown lookup is remembered for a short while: tapping again does not ask the orders system again", async () => {
    const w = await world();
    await loginAs(w.member.id);
    clearOrderNegativeCache();
    answer = () => new Response("", { status: 404 });
    await state(w);
    await state(w);
    await state(w);
    expect(fetchCalls).toHaveLength(1);
    clearOrderNegativeCache();
    await state(w);
    expect(fetchCalls).toHaveLength(2);
  });
});
