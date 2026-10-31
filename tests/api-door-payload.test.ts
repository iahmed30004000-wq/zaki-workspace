import { describe, expect, it } from "vitest";
import {
  DOOR_MAX_BODY_BYTES,
  IDEMPOTENCY_KEY,
  findCustomerDataKeys,
  ideaBodySchema,
  isCustomerDataKey,
  parseDoorBody,
  requestHash,
  stableStringify,
  storedIdempotencyKey,
  taskBodySchema,
} from "@/server/door/payload";

/** «الباب»: what a sender may put in a request (src/server/door/payload.ts) — pure, no database. */
describe("customer-data keys", () => {
  it("a key that says name / phone / address / e-mail / customer / money is one, in any spelling", () => {
    for (const key of [
      "name", "fullName", "full_name", "first-name", "customerName", "customer_id", "customer", "client", "phone", "phoneNumber", "mobile", "whatsapp",
      "address", "shippingAddress", "street", "city", "email", "e_mail", "recipient", "buyer", "price", "totalPrice", "amount", "balance", "iban", "cod",
      "CustomerPhone", "PHONE", "customername",
    ]) {
      expect(isCustomerDataKey(key), key).toBe(true);
    }
  });

  it("the contract own fields are not", () => {
    for (const key of ["title", "description", "tags", "externalRef", "boardId", "priority", "dueDate"]) expect(isCustomerDataKey(key), key).toBe(false);
  });

  it("is found at any depth, with its path", () => {
    expect(findCustomerDataKeys({ title: "x", meta: { contact: { phone: "1" } }, list: [{ email: "a" }] })).toEqual(["meta.contact.phone", "list.0.email"]);
    expect(findCustomerDataKeys({ title: "x", tags: ["a"] })).toEqual([]);
  });
});

describe("the idea body", () => {
  it("takes a title and the optional fields, and gives back what it understood", () => {
    const parsed = parseDoorBody(ideaBodySchema, { title: "  فكرة جديدة  ", description: "نص", tags: ["عروض", "q4", "q4"], externalRef: "s7:idea/42" });
    expect(parsed).toEqual({ ok: true, data: { title: "فكرة جديدة", description: "نص", tags: ["عروض", "q4"], externalRef: "s7:idea/42" } });
  });

  it("refuses a field nobody declared (strict), naming it", () => {
    const parsed = parseDoorBody(ideaBodySchema, { title: "فكرة جديدة", status: "ACCEPTED" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok && parsed.code === "door.validation_failed") expect(parsed.issues[0]?.message).toContain("status");
  });

  it("refuses a customer-data key with its OWN code, before the rest is looked at", () => {
    const parsed = parseDoorBody(ideaBodySchema, { title: "x", customerPhone: "0790000000" });
    expect(parsed).toEqual({ ok: false, code: "door.customer_data_rejected", keys: ["customerPhone"] });
    expect(parseDoorBody(ideaBodySchema, { title: "فكرة جديدة", meta: { address: "..." } })).toEqual({ ok: false, code: "door.customer_data_rejected", keys: ["meta.address"] });
  });

  it("checks the limits: a short title, a long one, too many tags, a tag with a space", () => {
    for (const body of [
      { title: "ab" },
      { title: "x".repeat(141) },
      { title: "فكرة جديدة", description: "x".repeat(2001) },
      { title: "فكرة جديدة", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { title: "فكرة جديدة", tags: ["two words"] },
      { title: "فكرة جديدة", tags: ["a@b.co"] },
    ]) {
      expect(parseDoorBody(ideaBodySchema, body).ok, JSON.stringify(body).slice(0, 60)).toBe(false);
    }
  });

  it("an opaque reference carries no space and no @: a name or an e-mail cannot ride in it", () => {
    for (const ref of ["Ahmad Ali", "a@b.co", "", "x".repeat(129), "-lead", "ref#1"]) {
      expect(parseDoorBody(ideaBodySchema, { title: "فكرة جديدة", externalRef: ref }).ok, ref).toBe(false);
    }
    for (const ref of ["s7:idea/42", "9f1c2b3a-0000-4000-8000-000000000000", "S7_conv.12"]) {
      expect(parseDoorBody(ideaBodySchema, { title: "فكرة جديدة", externalRef: ref }).ok, ref).toBe(true);
    }
  });
});

describe("the task body", () => {
  it("needs a title and a board; the day or the instant, the priority and the reference are optional", () => {
    expect(parseDoorBody(taskBodySchema, { title: "t", boardId: "b1" }).ok).toBe(true);
    expect(parseDoorBody(taskBodySchema, { title: "t", boardId: "b1", dueDate: "2026-11-05", priority: "HIGH", externalRef: "s7:task/9" }).ok).toBe(true);
    expect(parseDoorBody(taskBodySchema, { title: "t", boardId: "b1", dueDate: "2026-11-05T10:00:00+02:00" }).ok).toBe(true);
    for (const body of [{ title: "t" }, { boardId: "b1" }, { title: "t", boardId: "b1", dueDate: "tomorrow" }, { title: "t", boardId: "b1", priority: "MAX" }]) {
      expect(parseDoorBody(taskBodySchema, body).ok, JSON.stringify(body)).toBe(false);
    }
  });

  it("does not take who the task is for, the space or the project: the token decides those", () => {
    for (const extra of [{ assigneeId: "u1" }, { workspaceId: "w1" }, { projectId: "p1" }, { columnId: "c1" }, { reward: { value: 1 } }]) {
      expect(parseDoorBody(taskBodySchema, { title: "t", boardId: "b1", ...extra }).ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it("refuses customer data by key name here too", () => {
    expect(parseDoorBody(taskBodySchema, { title: "t", boardId: "b1", customerName: "x" })).toMatchObject({ ok: false, code: "door.customer_data_rejected" });
  });
});

describe("idempotency", () => {
  it("the key is 8..128 of letters, digits and . _ : -", () => {
    for (const ok of ["abcdefgh", "a".repeat(128), "s7:order.42_retry-1", "123e4567-e89b-12d3-a456-426614174000"]) expect(IDEMPOTENCY_KEY.test(ok), ok).toBe(true);
    for (const bad of ["short", "a".repeat(129), "has space!", "bad/slash", ""]) expect(IDEMPOTENCY_KEY.test(bad), bad).toBe(false);
  });

  it("the stored key starts with the company, then the token, the kind and the key of the sender: two companies never share one", () => {
    const base = { tokenId: "t1", type: "idea.create" as const, key: "retry-key-1" };
    const a = storedIdempotencyKey({ ...base, organizationId: "orgA" });
    const b = storedIdempotencyKey({ ...base, organizationId: "orgB" });
    expect(a).toBe("orgA:t1:idea.create:retry-key-1");
    expect(a).not.toBe(b);
    expect(storedIdempotencyKey({ ...base, organizationId: "orgA", type: "task.create" })).not.toBe(a);
    expect(storedIdempotencyKey({ ...base, organizationId: "orgA", tokenId: "t2" })).not.toBe(a);
  });

  it("the request hash ignores the order the sender wrote the fields in and notices any change", () => {
    expect(requestHash("idea.create", { title: "a", tags: ["x"] })).toBe(requestHash("idea.create", { tags: ["x"], title: "a" }));
    expect(requestHash("idea.create", { title: "a" })).not.toBe(requestHash("idea.create", { title: "b" }));
    expect(requestHash("idea.create", { title: "a" })).not.toBe(requestHash("task.create", { title: "a" }));
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe('{"a":{"c":[2,1]},"b":1}');
  });

  it("a body has a ceiling", () => {
    expect(DOOR_MAX_BODY_BYTES).toBe(32 * 1024);
  });
});
