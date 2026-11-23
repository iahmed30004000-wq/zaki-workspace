import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import * as messagesRoute from "@/app/api/v2/messages/route";
import * as ideasRoute from "@/app/api/v1/ideas/route";
import * as tokensRoute from "@/app/api/integrations/api-tokens/route";
import * as messagesListRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature } from "@/lib/features";
import { setTopicDoorKey } from "@/server/chat/door-message";
import { DOOR_LIMITS, DOOR_V2_LIMITS, failureLimiter, messageLimiter, tokenLimiter } from "@/server/door/limits";
import { cleanHosts, hasPhoneNumber, messageBodySchema } from "@/server/door/message-payload";
import { ALL_DOOR_PERMISSIONS, DOOR_MESSAGE_PERMISSIONS, DOOR_PERMISSIONS } from "@/server/door/tokens";
import { call, db, loginAs, logout, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * I1.1b: «باب الرسائل» (docs/contracts/workspace-door.v2.md): `POST /api/v2/messages`. Through the real route handlers and a real PostgreSQL, the way the media buyer
 * and n8n reach it.
 *
 * Pins: the permission `messages.write`, the two switches (404), idempotency (same key same answer, other body 409, per company and token), tenant isolation (a topic
 * name of another space or company is the same «not found»), the customer-data guard on every text but `ref`, the buttons' hosts, the limits, the failures as visible
 * rows, the author and `viaApp`, and v1 answering exactly as before.
 */

const URL_V2 = "http://localhost/api/v2/messages";
const KEY_NAME = "الميديا باير";

beforeEach(() => {
  failureLimiter.reset("unknown");
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

/** A company with a space (the admin is in it), a topic named «reports» for the door, and both switches on. */
async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], "Space A");
  const topic = await db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId: space.id, title: "تقارير", doorKey: "reports" } });
  await setFeatures(team.org.id, { apiDoor: true, doorMessages: opts.on !== false });
  return { ...team, space, topic };
}
type World = Awaited<ReturnType<typeof world>>;

/** Makes a token the way the owner does (the management route) and, when asked, gives it the hosts a button may use. */
async function mint(w: World, over: { who?: { id: string }; permissions?: string[]; name?: string; hosts?: string[]; workspaceId?: string } = {}) {
  await loginAs((over.who ?? w.admin).id);
  const res = await call(tokensRoute.POST, {
    url: "http://localhost/api/integrations/api-tokens",
    body: { name: over.name ?? KEY_NAME, permissions: over.permissions ?? ["messages.write"], workspaceId: over.workspaceId ?? w.space.id, expiresInDays: null },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  logout();
  const token = res.json?.["token"] as string;
  const id = (res.json?.["item"] as { id: string }).id;
  if (over.hosts) await db.apiToken.update({ where: { id }, data: { buttonHosts: over.hosts } });
  messageLimiter.reset(`t:${id}`);
  return { token, id };
}

const card = (over: Record<string, unknown> = {}) => ({ title: "ملخص الإعلانات", lines: [{ label: "الصرف", value: "عالي" }], status: "ok", ...over });
const body = (over: Record<string, unknown> = {}, cardOver: Record<string, unknown> = {}) => ({ topicKey: "reports", card: card(cardOver), ...over });

interface Init {
  token?: string | null;
  key?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
}
const post = (init: Init) =>
  call(messagesRoute.POST, {
    url: URL_V2,
    body: init.body ?? body(),
    headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.key === null ? {} : { "idempotency-key": init.key ?? `key-${uid()}-abcdefgh` }), ...init.headers },
  });
const errorOf = (res: { json: Record<string, unknown> | null }) => (res.json?.["error"] as { code: string; message: string; details?: unknown } | undefined) ?? undefined;
const messagesIn = (topicId: string) => db.chatMessage.findMany({ where: { conversationId: topicId }, orderBy: { createdAt: "asc" } });

// ---------------------------------------------------------------------------------------------

describe("the permission and the switches", () => {
  it("messages.write is the one permission of v2: v1's four stay as they were, and every permission is accepted by the management route", () => {
    expect([...DOOR_PERMISSIONS]).toEqual(["ideas.read", "ideas.write", "tasks.read", "tasks.write"]);
    expect([...DOOR_MESSAGE_PERMISSIONS]).toEqual(["messages.write"]);
    expect([...ALL_DOOR_PERMISSIONS]).toEqual(["ideas.read", "ideas.write", "tasks.read", "tasks.write", "messages.write", "mcp.tasks", "mcp.chat", "chat.structure"]);
  });

  it("a token without messages.write is 403; with it, 201 with the one answer shape and nothing of the author or the space", async () => {
    const w = await world();
    const reader = await mint(w, { permissions: ["ideas.write", "tasks.read"] });
    const denied = await post({ token: reader.token });
    expect(denied.status).toBe(403);
    expect(errorOf(denied)?.code).toBe("door.forbidden");
    expect(await messagesIn(w.topic.id)).toEqual([]);

    const { token } = await mint(w);
    const ok = await post({ token });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const data = ok.json?.["data"] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["createdAt", "id", "topicKey"]);
    expect(data["topicKey"]).toBe("reports");
    expect(ok.text).not.toContain(w.admin.id);
    expect(ok.text).not.toContain(w.space.id);
    expect(ok.headers.get("x-request-id")).toBeTruthy();
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("no token, a malformed one, a wrong one and a revoked one are the same 401", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    expect((await post({ token: null })).status).toBe(401);
    expect((await post({ token: "zws_nothing" })).status).toBe(401);
    expect((await post({ token: `${token.slice(0, -2)}xx` })).status).toBe(401);
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    const revoked = await post({ token });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("with «باب الرسائل» off, or the door's own switch off, every route answers 404 for a good token and posts nothing", async () => {
    const w = await world();
    const { token } = await mint(w);
    await setFeatures(w.org.id, { doorMessages: false });
    const off = await post({ token });
    expect(off.status).toBe(404);
    expect(errorOf(off)?.code).toBe("door.not_found");
    await setFeatures(w.org.id, { doorMessages: true, apiDoor: false });
    expect((await post({ token })).status).toBe(404);
    expect(await messagesIn(w.topic.id)).toEqual([]);
    await setFeatures(w.org.id, { apiDoor: true });
    expect((await post({ token })).status).toBe(201);
  });

  it("the person the token acts for stops being allowed: the token answers 401 at once", async () => {
    const w = await world();
    const { token } = await mint(w);
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.admin.id }, data: { status: "SUSPENDED" } });
    expect((await post({ token })).status).toBe(401);
    await db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.admin.id }, data: { status: "ACTIVE" } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.space.id, userId: w.admin.id } });
    expect((await post({ token })).status).toBe(401);
  });
});

describe("v1 answers exactly as before", () => {
  it("the token with messages.write only cannot use v1; a v1 token cannot use v2; v1's limit is still 60 and its envelope the same", async () => {
    const w = await world();
    const msg = await mint(w);
    const v1 = await mint(w, { permissions: ["ideas.write"], name: "v1" });
    const v1post = (token: string) =>
      call(ideasRoute.POST, { url: "http://localhost/api/v1/ideas", body: { title: "فكرة جديدة" }, headers: { authorization: `Bearer ${token}`, "idempotency-key": `key-${uid()}-abcdefgh` } });
    tokenLimiter.reset(`t:${msg.id}`);
    const refused = await v1post(msg.token);
    expect(refused.status).toBe(403);
    expect(errorOf(refused)?.code).toBe("door.forbidden");
    tokenLimiter.reset(`t:${v1.id}`);
    const made = await v1post(v1.token);
    expect(made.status).toBe(201);
    expect(Object.keys(made.json ?? {})).toEqual(["data"]);
    expect((await post({ token: v1.token })).status).toBe(403);
    expect(DOOR_LIMITS.perToken.limit).toBe(60);
    expect(DOOR_V2_LIMITS.perToken.limit).toBe(120);
    // the v1 door's own switch is not the v2 one: v1 keeps answering with doorMessages off
    await setFeatures(w.org.id, { doorMessages: false });
    tokenLimiter.reset(`t:${v1.id}`);
    expect((await v1post(v1.token)).status).toBe(201);
  });
});

describe("what is posted", () => {
  it("is a CARD message in the token's topic by the person who made the token, with the key's name as viaApp, the card's words as its body and no price or phone anywhere", async () => {
    const w = await world();
    const { token, id } = await mint(w, { hosts: ["adsmanager.example.com"] });
    const res = await post({
      token,
      body: body({}, { ref: "ZK-2026-000123", buttons: [{ label: "افتح التقرير", url: "https://adsmanager.example.com/report/12" }], lines: [{ label: "الصرف", value: "عالي" }, { label: "النتيجة", value: "ممتازة" }] }),
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const rows = await messagesIn(w.topic.id);
    expect(rows.length).toBe(1);
    const msg = rows[0]!;
    expect(msg).toMatchObject({ kind: "CARD", viaApp: KEY_NAME, authorId: w.admin.id, orgId: w.org.id, ackRequired: false });
    expect(msg.card).toMatchObject({ type: "app", title: "ملخص الإعلانات", status: "ok", ref: "ZK-2026-000123" });
    expect(msg.body.split("\n")[0]).toBe(KEY_NAME);
    expect(msg.body).toContain("ملخص الإعلانات");
    expect(msg.body).toContain("الصرف: عالي");
    expect(msg.body).toContain("ZK-2026-000123");
    expect(msg.body).toContain("https://adsmanager.example.com/report/12");
    // the topic moves, the live event is written, the audit row holds the token and the request but never the words
    const topic = await db.conversation.findUniqueOrThrow({ where: { id: w.topic.id } });
    expect(topic.lastMessageAt).toEqual(msg.createdAt);
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "message.created" } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "door.message.posted", orgId: w.org.id } });
    expect(audit).toMatchObject({ actorId: w.admin.id, target: msg.id });
    expect(JSON.stringify(audit.meta)).toContain(id);
    expect(JSON.stringify(audit.meta)).not.toContain("ملخص");
    // the token's last use moved
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();
  });

  it("the people of the space read it in the topic's messages (the chat does not break on this card)", async () => {
    const w = await world();
    const { token } = await mint(w);
    expect((await post({ token })).status).toBe(201);
    await loginAs(w.member.id);
    const list = await call(messagesListRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages`, params: { id: w.topic.id } });
    expect(list.status, list.text.slice(0, 200)).toBe(200);
    const messages = (list.json?.["messages"] ?? list.json?.["items"] ?? list.json?.["data"]) as Array<{ kind: string; body: string }>;
    expect(messages.some((m) => m.kind === "CARD" && m.body.includes("ملخص الإعلانات"))).toBe(true);
  });

  it("the owner behind the token posts only where he JOINED the topic: not joined is 403 door.forbidden (a visible failure, nothing written); once he joins, 201", async () => {
    const w = await world();
    const { token } = await mint(w, { who: w.owner });
    const refused = await post({ token });
    expect(refused.status).toBe(403);
    expect(errorOf(refused)?.code).toBe("door.forbidden");
    expect(await messagesIn(w.topic.id)).toEqual([]);
    expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", detail: "door.forbidden" } })).toBe(1);
    await db.conversationMember.create({ data: { conversationId: w.topic.id, userId: w.owner.id } });
    expect((await post({ token })).status).toBe(201);
    expect((await messagesIn(w.topic.id)).length).toBe(1);
  });

  it("a closed or archived topic takes nothing (409), for a person who may post in it", async () => {
    const w = await world();
    const { token } = await mint(w);
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: new Date() } });
    const closed = await post({ token });
    expect(closed.status).toBe(409);
    expect(errorOf(closed)?.code).toBe("door.topic_closed");
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: null, archivedAt: new Date() } });
    expect((await post({ token })).status).toBe(409);
    expect((await messagesIn(w.topic.id)).length).toBe(0);
  });

  it("«لازم ينقرأ»: refused while the switch is off; with it on and a moderator behind the token, the card must be read", async () => {
    const w = await world();
    const { token } = await mint(w);
    const off = await post({ token, body: body({ mustRead: true }) });
    expect(off.status).toBe(403);
    expect(await messagesIn(w.topic.id)).toEqual([]);
    await setFeatures(w.org.id, { mustRead: true });
    const on = await post({ token, body: body({ mustRead: true }) });
    expect(on.status, JSON.stringify(on.json)).toBe(201);
    expect((await messagesIn(w.topic.id))[0]).toMatchObject({ ackRequired: true });
    const plain = await post({ token, body: body({ mustRead: false }) });
    expect(plain.status).toBe(201);
    expect((await messagesIn(w.topic.id))[1]).toMatchObject({ ackRequired: false });
  });
});

describe("idempotency", () => {
  it("the same key and body is the same answer and ONE card; another body is 409; no key or a bad key is 400", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `key-${uid()}-abcdefgh`;
    const first = await post({ token, key });
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    const again = await post({ token, key });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.json).toEqual(first.json);
    expect((await messagesIn(w.topic.id)).length).toBe(1);
    // the same fields in another order are the same body
    const reordered = await post({ token, key, body: { card: { status: "ok", lines: [{ value: "عالي", label: "الصرف" }], title: "ملخص الإعلانات" }, topicKey: "reports" } });
    expect(reordered.headers.get("idempotent-replayed")).toBe("true");
    const conflict = await post({ token, key, body: body({}, { title: "عنوان ثاني" }) });
    expect(conflict.status).toBe(409);
    expect(errorOf(conflict)?.code).toBe("door.idempotency_conflict");
    expect((await messagesIn(w.topic.id)).length).toBe(1);
    expect(errorOf(await post({ token, key: null }))?.code).toBe("door.idempotency_key_required");
    expect(errorOf(await post({ token, key: "short" }))?.code).toBe("door.idempotency_key_invalid");
    // the record is born with the card: it starts with the company, then the token
    const record = await db.idempotencyRecord.findFirstOrThrow({ where: { organizationId: w.org.id } });
    expect(record.key.startsWith(`${w.org.id}:`)).toBe(true);
    expect(record).toMatchObject({ resourceType: "message", responseStatus: 201 });
  });

  it("two identical requests at once make one card; a failed request stores nothing and can be retried with the same key", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `key-${uid()}-abcdefgh`;
    const both = await Promise.all([post({ token, key }), post({ token, key })]);
    expect(both.map((b) => b.status)).toEqual([201, 201]);
    expect((await messagesIn(w.topic.id)).length).toBe(1);
    const retryKey = `key-${uid()}-abcdefgh`;
    const bad = await post({ token, key: retryKey, body: body({ topicKey: "nowhere" }) });
    expect(bad.status).toBe(404);
    expect(await db.idempotencyRecord.count({ where: { key: { endsWith: retryKey } } })).toBe(0);
    expect((await post({ token, key: retryKey })).status).toBe(201);
  });

  it("the key of one token never answers for another token of the same company", async () => {
    const w = await world();
    const a = await mint(w, { name: "Key A" });
    const b = await mint(w, { name: "Key B" });
    const key = `key-${uid()}-abcdefgh`;
    expect((await post({ token: a.token, key })).status).toBe(201);
    const other = await post({ token: b.token, key, body: body({}, { title: "من المفتاح الثاني" }) });
    expect(other.status).toBe(201);
    expect(other.headers.get("idempotent-replayed")).toBeNull();
    expect((await messagesIn(w.topic.id)).map((m) => m.viaApp)).toEqual(["Key A", "Key B"]);
  });
});

describe("tenant isolation", () => {
  it("a topic name of another space, another company, a topic nobody opened and a DM are all the same «not found»", async () => {
    const a = await world();
    const b = await world();
    const otherSpace = await makeWorkspace(a.org.id, [{ userId: a.admin.id, role: "ADMIN" }], "Space B");
    await db.conversation.create({ data: { orgId: a.org.id, kind: "TOPIC", spaceId: otherSpace.id, title: "ثاني", doorKey: "elsewhere" } });
    await db.conversation.create({ data: { orgId: a.org.id, kind: "TOPIC", spaceId: a.space.id, title: "بدون اسم" } });
    await db.conversation.create({ data: { orgId: a.org.id, kind: "DM", doorKey: "dm-key" } });
    await db.conversation.create({ data: { orgId: b.org.id, kind: "TOPIC", spaceId: b.space.id, title: "خاص بشركة ثانية", doorKey: "only-b" } });
    const ta = await mint(a);
    for (const topicKey of ["elsewhere", "only-b", "dm-key", "unknown"]) {
      const r = await post({ token: ta.token, body: body({ topicKey }) });
      expect({ topicKey, status: r.status, code: errorOf(r)?.code }).toEqual({ topicKey, status: 404, code: "door.topic_not_found" });
    }
    expect(await db.chatMessage.count({ where: { orgId: { in: [a.org.id, b.org.id] }, kind: "CARD" } })).toBe(0);
    // the same name in the other company is ITS topic: each token reaches only its own
    const tb = await mint(b);
    expect((await post({ token: tb.token })).status).toBe(201);
    expect((await post({ token: ta.token })).status).toBe(201);
    expect((await messagesIn(a.topic.id)).length).toBe(1);
    expect((await messagesIn(b.topic.id)).length).toBe(1);
    expect((await messagesIn(a.topic.id))[0]!.orgId).toBe(a.org.id);
  });

  it("the door name is unique inside a space and free in another (the index of the migration)", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [], "Other");
    await expect(db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "نسخة", doorKey: "reports" } })).rejects.toMatchObject({ code: "P2002" });
    await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: other.id, title: "مساحة ثانية", doorKey: "reports" } });
    // born NULL: any number of topics have no name
    for (let i = 0; i < 3; i++) await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: `بدون ${i}` } });
  });
});

describe("customer data never goes in", () => {
  it("a phone number in the title, a label, a value, a button label or an address is refused with the path, never the value, and nothing is stored", async () => {
    const w = await world();
    const { token } = await mint(w, { hosts: ["example.com"] });
    const phones = ["0791234567", "079 123 4567", "٠٧٩١٢٣٤٥٦٧٨", "+962 79 123 4567", "00962791234567"];
    for (const phone of phones) {
      const cases: Array<[string, Record<string, unknown>]> = [
        ["card.title", { title: `اتصلوا ${phone}` }],
        ["card.lines.0.label", { lines: [{ label: phone, value: "x" }] }],
        ["card.lines.0.value", { lines: [{ label: "رقم", value: phone }] }],
        ["card.buttons.0.label", { buttons: [{ label: phone, url: "https://example.com/a" }] }],
        ["card.buttons.0.url", { buttons: [{ label: "افتح", url: `https://example.com/call/${phone.replace(/\s/g, "")}` }] }],
      ];
      for (const [path, over] of cases) {
        const r = await post({ token, body: body({}, over) });
        const err = errorOf(r);
        expect({ phone, path, status: r.status, code: err?.code }).toEqual({ phone, path, status: 422, code: "door.customer_data_rejected" });
        expect((err?.details as { keys: string[] }).keys).toContain(path);
        expect(r.text).not.toContain(phone);
      }
    }
    expect(await messagesIn(w.topic.id)).toEqual([]);
    expect(await db.idempotencyRecord.count({ where: { organizationId: w.org.id } })).toBe(0);
  });

  it("an order number as `ref` passes (it is not scanned), and plain numbers, dates and short ids pass; a field NAMED like customer data is refused first", async () => {
    const w = await world();
    const { token } = await mint(w);
    const ok = await post({ token, body: body({}, { ref: "ZK-2026-000123", lines: [{ label: "التاريخ", value: "2026-11-20" }, { label: "الإنفاق", value: "1250 دينار" }, { label: "الطلبات", value: "34" }] }) });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    for (const over of [{ customerName: "x" }, { phone: "1" }, { price: 3 }]) {
      const r = await post({ token, body: { ...body(), ...over } });
      expect({ over, status: r.status, code: errorOf(r)?.code }).toEqual({ over, status: 422, code: "door.customer_data_rejected" });
    }
    const named = await post({ token, body: body({}, { lines: [{ label: "x", value: "y", customerPhone: "1" }] }) });
    expect(errorOf(named)?.code).toBe("door.customer_data_rejected");
    expect(((errorOf(named)?.details as { keys: string[] }).keys)).toEqual(["card.lines.0.customerPhone"]);
    // a field nobody declared is a plain validation error
    expect(errorOf(await post({ token, body: { ...body(), extra: 1 } }))?.code).toBe("door.validation_failed");
    expect((await messagesIn(w.topic.id)).length).toBe(1);
  });

  it("the pure guard: the pattern of the chat filter, digits normalised, an escaped number found", () => {
    expect(hasPhoneNumber("هاتفي 0791234567")).toBe(true);
    expect(hasPhoneNumber("٠٧٩١٢٣٤٥٦٧٨")).toBe(true);
    expect(hasPhoneNumber("https://x.com/%30%37%39%31%32%33%34%35%36%37")).toBe(true);
    expect(hasPhoneNumber("12 طلب من 34")).toBe(false);
    expect(hasPhoneNumber("2026-11-20")).toBe(false);
  });
});

describe("the card's shape and the buttons", () => {
  it("limits: title 120, 8 lines, 3 buttons, a status of four, a ref in the order shape, a topic name of letters and digits", async () => {
    const w = await world();
    const { token } = await mint(w, { hosts: ["example.com"] });
    const bad: Array<[string, Record<string, unknown>, Record<string, unknown>?]> = [
      ["title 121", {}, { title: "ع".repeat(121) }],
      ["empty title", {}, { title: " " }],
      ["9 lines", {}, { lines: Array.from({ length: 9 }, (_, i) => ({ label: `l${i}`, value: "v" })) }],
      ["status", {}, { status: "red" }],
      ["ref shape", {}, { ref: "0791234567" }],
      ["ref lower case", {}, { ref: "zk-2026-000123" }],
      ["4 buttons", {}, { buttons: Array.from({ length: 4 }, () => ({ label: "افتح", url: "https://example.com/a" })) }],
      ["button label 25", {}, { buttons: [{ label: "ع".repeat(25), url: "https://example.com/a" }] }],
      ["topicKey", { topicKey: "has space" }],
      ["no card", { card: undefined }],
      ["mustRead text", { mustRead: "yes" }],
    ];
    for (const [label, over, cardOver] of bad) {
      const r = await post({ token, body: body(over, cardOver ?? {}) });
      expect({ label, status: r.status, code: errorOf(r)?.code }).toEqual({ label, status: 422, code: "door.validation_failed" });
    }
    const edge = await post({ token, body: body({}, { title: "ع".repeat(120), lines: Array.from({ length: 8 }, (_, i) => ({ label: `l${i}`, value: "v" })), buttons: Array.from({ length: 3 }, () => ({ label: "ع".repeat(24), url: "https://example.com/a" })) }) });
    expect(edge.status, JSON.stringify(edge.json)).toBe(201);
    expect(messageBodySchema.safeParse(body()).success).toBe(true);
  });

  it("a button needs https, no credentials, no port, and a host the owner allowed on THIS token; a token with no hosts accepts no button", async () => {
    const w = await world();
    const none = await mint(w, { name: "none" });
    const some = await mint(w, { name: "some", hosts: ["adsmanager.example.com"] });
    const button = (url: string) => ({ buttons: [{ label: "افتح", url }] });
    expect((await post({ token: none.token, body: body({}, button("https://adsmanager.example.com/a")) })).status).toBe(422);
    expect((await post({ token: some.token, body: body({}, button("https://adsmanager.example.com/a?x=1")) })).status).toBe(201);
    const refused = await post({ token: some.token, body: body({}, button("https://evil.example.org/a")) });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(errorOf(refused)?.details)).toContain("card.buttons.0.url");
    for (const url of ["http://adsmanager.example.com/a", "https://user:pw@adsmanager.example.com/a", "https://adsmanager.example.com:8443/a", "javascript:alert(1)", "https://adsmanager.example.com.evil.org/a", "https://sub.adsmanager.example.com/a", "//adsmanager.example.com/a", "not a url"]) {
      const r = await post({ token: some.token, body: body({}, button(url)) });
      expect({ url, status: r.status }).toEqual({ url, status: 422 });
    }
    expect(cleanHosts(["Example.COM", "https://x.com", "x.com/path", "*.x.com", "a.b.co", "localhost", " ok.dev "])).toEqual(["example.com", "a.b.co", "ok.dev"]);
  });
});

describe("the limits and the failures the owner can see", () => {
  it("120 a minute per token, then 429 with Retry-After; one failure row per minute for it; another token is not affected", async () => {
    const w = await world();
    const a = await mint(w, { name: "Key A" });
    const b = await mint(w, { name: "Key B" });
    for (let i = 0; i < DOOR_V2_LIMITS.perToken.limit; i++) messageLimiter.hit(`t:${a.id}`);
    const over = await post({ token: a.token });
    expect(over.status).toBe(429);
    expect(errorOf(over)?.code).toBe("door.rate_limited");
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post({ token: a.token })).status).toBe(429);
    expect((await post({ token: b.token })).status).toBe(201);
    expect(await db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", detail: "door.rate_limited" } })).toBe(1);
    expect(await messagesIn(w.topic.id).then((r) => r.length)).toBe(1);
  });

  it("a daily cap per token, counted from the stored answers (a restart does not forget it)", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    await db.idempotencyRecord.createMany({
      data: Array.from({ length: DOOR_V2_LIMITS.perTokenPerDay }, (_, i) => ({
        organizationId: w.org.id,
        tokenId: id,
        key: `${w.org.id}:${id}:message.create:cap-${i}`,
        requestHash: "x",
        responseStatus: 201,
        responseBody: {},
        resourceType: "message",
        resourceId: `m${i}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    });
    const capped = await post({ token });
    expect(capped.status).toBe(429);
    expect(errorOf(capped)?.code).toBe("door.daily_cap");
    expect(capped.headers.get("retry-after")).toBeTruthy();
    expect(await messagesIn(w.topic.id)).toEqual([]);
    // a replay of an answer already given is not a new card and is still answered
    const replayKey = `cap-replay-${uid()}`;
    await db.idempotencyRecord.deleteMany({ where: { tokenId: id, key: { endsWith: "cap-0" } } });
    expect((await post({ token, key: replayKey })).status).toBe(201);
  });

  it("every refusal code is throttled: ONE row per token per code per minute, another code or another token has its own, and a minute later it is written again", async () => {
    const w = await world();
    const a = await mint(w, { name: "Key A" });
    const b = await mint(w, { name: "Key B" });
    const rows = (code: string) => db.integrationEvent.count({ where: { orgId: w.org.id, status: "FAILED", detail: code } });
    for (let i = 0; i < 4; i++) expect((await post({ token: a.token, body: body({ topicKey: "nowhere" }) })).status).toBe(404);
    for (let i = 0; i < 3; i++) expect((await post({ token: a.token, body: { topicKey: "reports" } })).status).toBe(422);
    expect(await rows("door.topic_not_found")).toBe(1);
    expect(await rows("door.validation_failed")).toBe(1);
    // another token's refusal of the same code is its own row
    expect((await post({ token: b.token, body: body({ topicKey: "nowhere" }) })).status).toBe(404);
    expect(await rows("door.topic_not_found")).toBe(2);
    // the permission refusal too (it is written before the body is read)
    await db.apiToken.update({ where: { id: a.id }, data: { permissions: ["ideas.read"] } });
    for (let i = 0; i < 3; i++) expect((await post({ token: a.token })).status).toBe(403);
    expect(await rows("door.forbidden")).toBe(1);
    // a minute later the same refusal is written again (and only once more)
    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    try {
      for (let i = 0; i < 3; i++) await post({ token: b.token, body: body({ topicKey: "nowhere" }) });
    } finally {
      later.mockRestore();
    }
    expect(await rows("door.topic_not_found")).toBe(3);
  });

  it("every refusal after the token was accepted is a FAILED row with a code only: no text, no payload, no token", async () => {
    const w = await world();
    const { token } = await mint(w);
    await post({ token, body: body({ topicKey: "nowhere" }) });
    await post({ token, body: body({}, { title: "اتصل 0791234567" }) });
    await post({ token, body: { topicKey: "reports" } });
    await post({ token, key: null });
    await db.apiToken.updateMany({ where: { organizationId: w.org.id }, data: { permissions: ["ideas.read"] } });
    await post({ token });
    const rows = await db.integrationEvent.findMany({ where: { orgId: w.org.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.detail)).toEqual(["door.topic_not_found", "door.customer_data_rejected", "door.validation_failed", "door.forbidden"]);
    expect(rows.every((r) => r.status === "FAILED" && r.direction === "IN" && r.type === "door.message" && r.payload === null)).toBe(true);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("0791234567");
    expect(dump).not.toContain(token.slice(0, 12));
  });
});

describe("naming a topic for the door", () => {
  it("a moderator names it, the name is unique in the space, a member may not, null takes it out of the door", async () => {
    const w = await world();
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "جديد" } });
    const admin = { userId: w.admin.id, orgId: w.org.id };
    expect(await setTopicDoorKey(admin, topic.id, "ads.daily")).toEqual({ doorKey: "ads.daily" });
    await expect(setTopicDoorKey(admin, topic.id, "reports")).rejects.toMatchObject({ issues: [{ message: "door.field.topic_key_taken" }] });
    await expect(setTopicDoorKey(admin, topic.id, "has space")).rejects.toMatchObject({ issues: [{ message: "door.field.topic_key" }] });
    await expect(setTopicDoorKey({ userId: w.member.id, orgId: w.org.id }, topic.id, "mine")).rejects.toThrow();
    await expect(setTopicDoorKey({ userId: w.guest.id, orgId: w.org.id }, topic.id, "mine")).rejects.toThrow();
    // another company's person cannot even see it
    const other = await world();
    await expect(setTopicDoorKey({ userId: other.admin.id, orgId: other.org.id }, topic.id, "x1")).rejects.toThrow();
    expect(await setTopicDoorKey(admin, topic.id, null)).toEqual({ doorKey: null });
    const { token } = await mint(w);
    expect((await post({ token, body: body({ topicKey: "ads.daily" }) })).status).toBe(404);
  });
});
