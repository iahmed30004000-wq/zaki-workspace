import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as listRoute from "@/app/api/system-tokens/route";
import * as oneRoute from "@/app/api/system-tokens/[id]/route";
import * as tasksRoute from "@/app/api/v1/tasks/route";
import * as taskRoute from "@/app/api/v1/tasks/[id]/route";
import * as boardsRoute from "@/app/api/v1/boards/route";
import * as tokensRoute from "@/app/api/integrations/api-tokens/route";
import { withFeature } from "@/lib/features";
import { failureLimiter } from "@/server/door/limits";
import { call, db, loginAs, logout, makeProject, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * W1 (system tokens): «الإعدادات ← توكنات الأنظمة». The owner makes ONE token per consuming system («الميديا باير»: tasks.write + tasks.read), with an
 * expiry; it is shown once, kept only as a hash, listed with its last use, revoked in one click. It is the door's own token (`ApiToken`): the door
 * itself does not change. Against a real PostgreSQL, through the real route handlers.
 *
 * Pins: owner only (an admin who may make door tokens still may not); a system the page does not know is refused; the scopes come from the system,
 * never from the request; shown once, hashed, never listed; the contract's calls work with it (boards, create a task with its key, the status);
 * a missing scope is 403; revoked, expired and an unknown token are 401; the company's other tokens are not on this page.
 */

const BASE = "http://localhost/api/system-tokens";
const DOOR = "http://localhost/api/v1";

beforeEach(() => failureLimiter.reset("unknown"));

async function setFeature(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "apiDoor", on) as Prisma.InputJsonValue } });
}

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "الإعلانات");
  const board = await makeProject(space.id);
  if (opts.on !== false) await setFeature(team.org.id, true);
  return { ...team, space, ...board };
}
type World = Awaited<ReturnType<typeof world>>;

const make = (w: World, body: Record<string, unknown> = {}) => call(listRoute.POST, { url: BASE, body: { system: "mediabuyer", workspaceId: w.space.id, ...body } });
async function mint(w: World, body: Record<string, unknown> = {}) {
  await loginAs(w.owner.id);
  const r = await make(w, body);
  expect(r.status, r.text).toBe(201);
  logout();
  return { token: r.json!["token"] as string, id: (r.json!["item"] as { id: string }).id, item: r.json!["item"] as Record<string, unknown> };
}
const headers = (token: string | null, key: string | null = `mb-task-${uid()}-abc`) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { "idempotency-key": key } : {}) });
const createTask = (token: string | null, w: World, over: Record<string, unknown> = {}, key?: string) =>
  call(tasksRoute.POST, {
    url: `${DOOR}/tasks`,
    method: "POST",
    headers: headers(token, key),
    body: { title: "اتصل بالمورّد وأكّد دفعة التصنيع", boardId: w.board.id, priority: "HIGH", externalRef: "mb:task/ck123abc", description: "المخزون الباقي 6 أيام", dueDate: "2026-11-19", ...over },
  });
const boards = (token: string) => call(boardsRoute.GET, { url: `${DOOR}/boards`, method: "GET", headers: { authorization: `Bearer ${token}` } });
const status = (token: string, id: string) => call(taskRoute.GET, { url: `${DOOR}/tasks/${id}`, method: "GET", params: { id }, headers: { authorization: `Bearer ${token}` } });

describe("who may use the page", () => {
  it("only the owner: an admin who may make door tokens, a member and a guest get 403 on all three doors", async () => {
    const w = await world();
    const { id } = await mint(w);
    for (const who of [w.admin, w.member, w.guest]) {
      await loginAs(who.id);
      expect((await call(listRoute.GET, { url: BASE })).status, who.id).toBe(403);
      expect((await make(w)).status, who.id).toBe(403);
      expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id } })).status, who.id).toBe(403);
    }
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();
    expect(await db.apiToken.count({ where: { organizationId: w.org.id } })).toBe(1);
  });
  it("with the door switch off the owner sees and revokes, but cannot make (404)", async () => {
    const w = await world();
    const { id } = await mint(w);
    await setFeature(w.org.id, false);
    await loginAs(w.owner.id);
    const list = await call(listRoute.GET, { url: BASE });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ switchOn: false });
    expect((await make(w)).status).toBe(404);
    expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
  });
});

describe("making a token", () => {
  it("«الميديا باير»: the scopes come from the system, the expiry is 90 days unless chosen, the token is shown once and only its hash is kept", async () => {
    const w = await world();
    const { token, id, item } = await mint(w);
    expect(token).toMatch(/^zws_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(item).toMatchObject({ system: "mediabuyer", name: "الميديا باير", status: "active", lastUsedAt: null });
    expect([...(item["permissions"] as string[])].sort()).toEqual(["tasks.read", "tasks.write"]);
    const days = (new Date(item["expiresAt"] as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    const row = await db.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ system: "mediabuyer", createdById: w.owner.id, workspaceId: w.space.id });
    expect(row.tokenHash).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token.split(".")[1] as string);
    // the list never returns it, nor its hash
    await loginAs(w.owner.id);
    const list = await call(listRoute.GET, { url: BASE });
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(token);
    expect(list.text).not.toContain(row.tokenHash);
    expect((list.json!["tokens"] as Array<{ id: string }>).map((t) => t.id)).toEqual([id]);
    expect(await db.auditLog.count({ where: { action: "door.token.created", target: id, actorId: w.owner.id } })).toBe(1);
  });
  it("an expiry can be chosen (30, 90, 365) or none; another number is refused", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const never = await make(w, { expiresInDays: null });
    expect((never.json!["item"] as { expiresAt: string | null }).expiresAt).toBeNull();
    const month = await make(w, { expiresInDays: 30 });
    expect(month.status).toBe(201);
    expect((await make(w, { expiresInDays: 45 })).status).toBeGreaterThanOrEqual(400);
  });
  it("a system the page does not know, a scope smuggled in the request, or a space the owner does not reach is refused; nothing is made", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    for (const system of ["other", "constructor", "__proto__", ""]) expect((await make(w, { system })).status, system).toBeGreaterThanOrEqual(400);
    expect((await make(w, { permissions: ["ideas.write", "tasks.write"] })).status).toBeGreaterThanOrEqual(400);
    expect((await make(w, { workspaceId: "no-such-space" })).status).toBeGreaterThanOrEqual(400);
    expect(await db.apiToken.count({ where: { organizationId: w.org.id } })).toBe(0);
  });
});

describe("the contract's calls with this token", () => {
  it("boards, a task with its Idempotency-Key (once, however many retries), and its status", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    const b = await boards(token);
    expect(b.status, b.text).toBe(200);
    expect(b.text).toContain(w.board.id);
    const key = "mb-task-ck123abc";
    const made = await createTask(token, w, {}, key);
    expect(made.status, made.text).toBe(201);
    const data = made.json!["data"] as { id: string; status: string };
    expect(data.status).toBe("open");
    const again = await createTask(token, w, {}, key);
    expect(again.status).toBe(201);
    expect((again.json!["data"] as { id: string }).id).toBe(data.id);
    expect(await db.task.count({ where: { orgId: w.org.id, externalRef: "mb:task/ck123abc" } })).toBe(1);
    // the same key with another body is 409
    expect((await createTask(token, w, { title: "عنوان ثاني" }, key)).status).toBe(409);
    const st = await status(token, data.id);
    expect(st.status, st.text).toBe(200);
    expect(st.json!["data"]).toMatchObject({ id: data.id, status: "open", finishedAt: null });
    // its last use shows on the page
    await loginAs(w.owner.id);
    const list = await call(listRoute.GET, { url: BASE });
    const row = (list.json!["tokens"] as Array<{ id: string; lastUsedAt: string | null }>).find((t) => t.id === id);
    expect(row?.lastUsedAt).not.toBeNull();
  });
  it("a customer's field in the task is refused by the door (the contract's rule)", async () => {
    const w = await world();
    const { token } = await mint(w);
    const r = await createTask(token, w, { customerPhone: "0791234567" });
    expect(r.status).toBe(422);
    expect(r.text).toContain("door.customer_data_rejected");
  });
});

describe("a token that may not, or no longer may", () => {
  it("a missing scope is 403: a read-only token cannot create, a token without tasks cannot even read boards", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const readOnly = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "قراءة فقط", permissions: ["tasks.read"], workspaceId: w.space.id } });
    const ideasOnly = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "أفكار فقط", permissions: ["ideas.write"], workspaceId: w.space.id } });
    logout();
    const ro = readOnly.json!["token"] as string;
    const io = ideasOnly.json!["token"] as string;
    expect((await createTask(ro, w)).status).toBe(403);
    expect((await boards(io)).status).toBe(403);
    expect((await createTask(io, w)).status).toBe(403);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });
  it("revoked on the page: the very next call is 401, revoking again is the same answer, and the audit says who", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    expect((await boards(token)).status).toBe(200);
    await loginAs(w.owner.id);
    const killed = await call(oneRoute.DELETE, { method: "DELETE", params: { id } });
    expect(killed.status, killed.text).toBe(200);
    expect((killed.json!["item"] as { status: string }).status).toBe("revoked");
    expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    logout();
    expect((await boards(token)).status).toBe(401);
    expect((await createTask(token, w)).status).toBe(401);
    expect((await status(token, "any")).status).toBe(401);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "door.token.revoked", target: id, actorId: w.owner.id } })).toBe(1);
  });
  it("expired is 401; no header and a wrong token are the same 401", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    await db.apiToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await createTask(token, w)).status).toBe(401);
    expect((await createTask(null, w)).status).toBe(401);
    expect((await createTask("zws_000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", w)).status).toBe(401);
    await loginAs(w.owner.id);
    const list = await call(listRoute.GET, { url: BASE });
    expect((list.json!["tokens"] as Array<{ status: string }>)[0]?.status).toBe("expired");
  });
});

describe("this page and the company's other tokens", () => {
  it("a token made on the «الأتمتة» screen is not listed here and cannot be revoked from here; another company sees nothing", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const plain = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "نظام آخر", permissions: ["ideas.write"], workspaceId: w.space.id } });
    const plainId = (plain.json!["item"] as { id: string }).id;
    const mine = await make(w);
    expect(mine.status).toBe(201);
    const list = await call(listRoute.GET, { url: BASE });
    expect((list.json!["tokens"] as Array<{ id: string }>).map((t) => t.id)).toEqual([(mine.json!["item"] as { id: string }).id]);
    expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id: plainId } })).status).toBe(404);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id: plainId } })).revokedAt).toBeNull();
    // another company's owner
    const other = await world();
    await loginAs(other.owner.id);
    const otherList = await call(listRoute.GET, { url: BASE });
    expect(otherList.json!["tokens"]).toEqual([]);
    expect((await call(oneRoute.DELETE, { method: "DELETE", params: { id: (mine.json!["item"] as { id: string }).id } })).status).toBe(404);
  });
});

describe("a long list", () => {
  it("a system token is still on the page after more than 200 newer tokens of the company", async () => {
    const w = await world();
    const { id } = await mint(w);
    const rows = Array.from({ length: 205 }, (_, i) => ({
      organizationId: w.org.id,
      name: `قديم ${i}`,
      prefix: `p${uid().replace(/[^a-z0-9]/gi, "").slice(0, 8)}${i}`.slice(0, 12).padEnd(12, "0") + String(i).padStart(0, "0"),
      tokenHash: "x".repeat(64),
      permissions: ["ideas.read"],
      workspaceId: w.space.id,
      createdById: w.owner.id,
      createdAt: new Date(Date.now() + 60_000 + i),
    }));
    // prefixes must be unique: make them so
    rows.forEach((r, i) => (r.prefix = `z${String(i).padStart(11, "0")}`));
    await db.apiToken.createMany({ data: rows });
    await loginAs(w.owner.id);
    const list = await call(listRoute.GET, { url: BASE });
    expect((list.json!["tokens"] as Array<{ id: string }>).map((t) => t.id)).toEqual([id]);
  });
});
