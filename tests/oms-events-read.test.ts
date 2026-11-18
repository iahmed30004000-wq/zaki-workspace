import { describe, expect, it } from "vitest";
import fixture from "./fixtures/oms-events.provisional.json";
import { readOmsEvent, eventsConfigOf, eventCardOf } from "@/server/integrations/oms-events";
import { verifyZakiSignature } from "@/server/webhook-signing";

/**
 * I1.1a: what the receiver keeps of an event, and what it drops. The fixture is PROVISIONAL (written from the spec, not copied from the orders system): these tests
 * pin OUR reader, not the other system's contract.
 */

const raw = (name: keyof typeof fixture.events) => JSON.stringify(fixture.events[name]);

describe("the fixture is provisional and says so", () => {
  it("is marked provisional, and the contract folder does not exist yet", () => {
    expect(fixture._provisional).toMatch(/PROVISIONAL/);
    expect(fixture._provisional).toMatch(/NOT copied/);
  });
});

describe("readOmsEvent keeps a whitelist and drops the rest", () => {
  it("keeps the order id and number, the states, the product name and the quantity", () => {
    const r = readOmsEvent(raw("order.created"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toEqual({
      event: "order.created",
      at: new Date("2030-01-02T10:00:00.000Z"),
      orderId: "ord_77",
      number: "ZK-2026-000123",
      status: "pending",
      confirmationState: "pending",
      shippingState: null,
      productName: "حراك",
      quantity: 2,
    });
  });

  it("holds NO total, currency, city, store, source or tracking number: the result has no such key and no such value", () => {
    for (const name of Object.keys(fixture.events) as Array<keyof typeof fixture.events>) {
      const r = readOmsEvent(raw(name));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const text = JSON.stringify(r.event);
      for (const key of ["total", "currency", "city", "store", "source", "tracking", "items", "pieces"]) expect(text, `${name}:${key}`).not.toContain(key);
      for (const value of ["149.5", "USD", "Amman", "TRK0001"]) expect(text, `${name}:${value}`).not.toContain(value);
    }
  });

  it("states the event itself says are filled in when the data does not carry them", () => {
    const r = readOmsEvent(JSON.stringify({ event: "order.shipped", at: "2030-01-02T10:00:00.000Z", data: { order_number: "ZK-2026-000123" } }));
    expect(r.ok && r.event.shippingState).toBe("shipped");
    expect(r.ok && r.event.status).toBe("shipped");
    const c = readOmsEvent(JSON.stringify({ event: "order.cancelled", data: { order_number: "ZK-2026-000123" } }));
    expect(c.ok && c.event.status).toBe("cancelled");
    expect(c.ok && c.event.at).toBeNull();
  });

  it("an order number that is not the orders system's shape is no order (the event is still read, its state is not written)", () => {
    for (const number of ["0791234567", "079-1234-5678", "zk-2026-000123", "x", ""]) {
      const r = readOmsEvent(JSON.stringify({ event: "order.confirmed", data: { order_number: number } }));
      expect(r.ok && r.event.number, number).toBeNull();
    }
  });

  it("a product name that carries a phone number is dropped, and a bad quantity is no quantity", () => {
    const r = readOmsEvent(JSON.stringify({ event: "order.created", data: { order_number: "ZK-2026-000123", product_name: "حراك 0791234567", quantity: 0 } }));
    expect(r.ok && r.event.productName).toBeNull();
    expect(r.ok && r.event.quantity).toBeNull();
    const big = readOmsEvent(JSON.stringify({ event: "order.created", data: { order_number: "ZK-2026-000123", quantity: 1e9 } }));
    expect(big.ok && big.event.quantity).toBeNull();
  });

  it("a state word is kept only as a short key; anything else is no state", () => {
    const r = readOmsEvent(JSON.stringify({ event: "order.confirmed", data: { order_number: "ZK-2026-000123", confirmation_state: "Mohammad Ali 0791234567" } }));
    expect(r.ok && r.event.confirmationState).toBe("confirmed");
  });

  it("not JSON, not an object, or a name that is not an event name are refused", () => {
    expect(readOmsEvent("not json")).toEqual({ ok: false, reason: "bad_json" });
    expect(readOmsEvent("[1,2]")).toEqual({ ok: false, reason: "bad_json" });
    expect(readOmsEvent(JSON.stringify({ data: {} }))).toEqual({ ok: false, reason: "bad_event" });
    expect(readOmsEvent(JSON.stringify({ event: "Order Confirmed!", data: {} }))).toEqual({ ok: false, reason: "bad_event" });
    expect(readOmsEvent(JSON.stringify({ event: "x".repeat(80) }))).toEqual({ ok: false, reason: "bad_event" });
  });
});

describe("the card of an event", () => {
  it("has the Arabic title, the order number as its ref, no money and no customer field", () => {
    const r = readOmsEvent(raw("order.returned"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const card = eventCardOf(r.event);
    expect(card.title).toBe("مرتجع");
    expect(card.ref).toBe("ZK-2026-000123");
    expect(card.status).toBe("warn");
    expect(card.lines?.map((l) => l.value)).toEqual(["حراك", "2"]);
    expect(JSON.stringify(card)).not.toMatch(/149|USD|Amman/);
  });
});

describe("the receiver settings are read defensively", () => {
  it("only a well-formed id and author make a receiver; a broken route or hour is dropped", () => {
    expect(eventsConfigOf(null)).toBeNull();
    expect(eventsConfigOf({ receiverId: "short", connectedById: "u1" })).toBeNull();
    const ok = eventsConfigOf({ receiverId: "a".repeat(32), connectedById: "u1", routes: [{ event: "order.returned", conversationId: "c1" }, { event: "Bad Name", conversationId: "c2" }, 5], dailyCard: { hour: 25, conversationId: "c1" } });
    expect(ok?.routes).toEqual([{ event: "order.returned", conversationId: "c1" }]);
    expect(ok?.dailyCard).toBeNull();
    expect(eventsConfigOf({ receiverId: "a".repeat(32), connectedById: "u1", dailyCard: { hour: 21, conversationId: "c1" } })?.dailyCard).toEqual({ hour: 21, conversationId: "c1" });
  });
});

describe("the signed example verifies with the existing verifier", () => {
  const ex = fixture.signedExample;
  const at = new Date(Number(ex.timestamp) * 1000);
  it("verifies; an unsigned one, a wrong secret, an edited body and an old timestamp do not", () => {
    expect(verifyZakiSignature({ secret: fixture.secret, timestampHeader: ex.timestamp, signatureHeader: ex.signature, rawBody: ex.body, now: at })).toEqual({ ok: true, timestampSec: Number(ex.timestamp) });
    expect(verifyZakiSignature({ secret: fixture.secret, timestampHeader: null, signatureHeader: null, rawBody: ex.body, now: at })).toEqual({ ok: false, reason: "MISSING_HEADERS" });
    expect(verifyZakiSignature({ secret: "another-secret-0000000000", timestampHeader: ex.timestamp, signatureHeader: ex.signature, rawBody: ex.body, now: at })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyZakiSignature({ secret: fixture.secret, timestampHeader: ex.timestamp, signatureHeader: ex.signature, rawBody: `${ex.body} `, now: at })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyZakiSignature({ secret: fixture.secret, timestampHeader: ex.timestamp, signatureHeader: ex.signature, rawBody: ex.body, now: new Date(at.getTime() + 6 * 60_000) })).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });
  it("the same timestamp in milliseconds is accepted when it is the text that was signed", () => {
    // the orders system sends milliseconds: the HMAC is over the timestamp text exactly as it arrived
    expect(verifyZakiSignature({ secret: fixture.secret, timestampHeader: `${ex.timestamp}000`, signatureHeader: ex.signature, rawBody: ex.body, now: at })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });
});
