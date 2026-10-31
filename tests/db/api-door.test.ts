import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as ideasRoute from "@/app/api/v1/ideas/route";
import * as tasksRoute from "@/app/api/v1/tasks/route";
import * as taskRoute from "@/app/api/v1/tasks/[id]/route";
import * as boardsRoute from "@/app/api/v1/boards/route";
import * as tokensRoute from "@/app/api/integrations/api-tokens/route";
import * as tokenRoute from "@/app/api/integrations/api-tokens/[id]/route";
import { withFeature } from "@/lib/features";
import { failureLimiter } from "@/server/door/limits";
import { call, db, loginAs, logout, makeProject, makeTeam, makeWorkspace, uid } from "./helpers";
import { accountsApi, grantCapabilities } from "./accounts-helpers";

/**
 * «الباب» (docs/contracts/workspace-door.v1.md): /api/v1/ideas and /api/v1/tasks, and the owner's screen for the tokens.
 * Every check goes through the real route handlers and a real PostgreSQL, the way System 7 and the browser reach them.
 */

const BASE = "http://localhost/api/v1";
const WRITE = ["ideas.write", "tasks.write"];

beforeEach(() => {
  // every test calls from the same (unknown) address: a refused token in one test must not lock the next one out
  failureLimiter.reset("unknown");
});

async function setFeature(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "apiDoor", on) as Prisma.InputJsonValue } });
}

/** A company with a space (the admin is in it, the owner sees it), a board, and the switch ON. */
async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "Space A");
  const board = await makeProject(space.id);
  if (opts.on !== false) await setFeature(team.org.id, true);
  return { ...team, space, ...board };
}
type World = Awaited<ReturnType<typeof world>>;

/** Makes a token the way the owner does: through the management route. Returns the whole token (shown once) and its row id. */
async function mint(w: World, who: { id: string } = w.owner, over: { permissions?: string[]; workspaceId?: string; name?: string; expiresInDays?: number | null } = {}) {
  await loginAs(who.id);
  const res = await call(tokensRoute.POST, {
    url: "http://localhost/api/integrations/api-tokens",
    body: { name: over.name ?? "System 7", permissions: over.permissions ?? WRITE, workspaceId: over.workspaceId ?? w.space.id, expiresInDays: over.expiresInDays ?? null },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  logout();
  const token = res.json?.["token"] as string;
  const id = (res.json?.["item"] as { id: string }).id;
  return { token, id };
}

interface DoorInit {
  token?: string | null;
  method?: string;
  body?: unknown;
  key?: string | null;
  headers?: Record<string, string>;
  query?: string;
}
const headersOf = (init: DoorInit) => ({
  ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
  ...(init.key === null ? {} : init.method === "GET" ? {} : { "idempotency-key": init.key ?? `key-${uid()}-abcdefgh` }),
  ...init.headers,
});
const ideasApi = (init: DoorInit) => call(init.method === "GET" ? ideasRoute.GET : ideasRoute.POST, { url: `${BASE}/ideas${init.query ?? ""}`, ...init, headers: headersOf(init) });
const tasksApi = (init: DoorInit) => call(init.method === "GET" ? tasksRoute.GET : tasksRoute.POST, { url: `${BASE}/tasks${init.query ?? ""}`, ...init, headers: headersOf(init) });
const boardsApi = (init: DoorInit) => call(boardsRoute.GET, { url: `${BASE}/boards`, method: "GET", headers: headersOf({ ...init, method: "GET" }) });
const taskApi = (id: string, init: DoorInit) => call(taskRoute.GET, { url: `${BASE}/tasks/${id}`, method: "GET", params: { id }, headers: headersOf({ ...init, method: "GET" }) });

const errorOf = (res: { json: Record<string, unknown> | null }) => (res.json?.["error"] as { code: string; message: string; details?: unknown } | undefined) ?? undefined;
const dataOf = <T,>(res: { json: Record<string, unknown> | null }) => res.json?.["data"] as T;

// ---------------------------------------------------------------------------------------------
// the switch
// ---------------------------------------------------------------------------------------------

describe("the switch «باب الربط الخارجي»", () => {
  it("is OFF by default: with a perfectly good token every route answers 404, nothing is created, and the management routes are 404 too", async () => {
    const w = await world({ on: false });
    // the owner can only make a token once the switch is on: make it on, then turn it off
    await setFeature(w.org.id, true);
    const { token } = await mint(w);
    await setFeature(w.org.id, false);

    const post = await ideasApi({ token, body: { title: "فكرة جديدة" } });
    expect(post.status).toBe(404);
    expect((await ideasApi({ token, method: "GET" })).status).toBe(404);
    expect((await tasksApi({ token, body: { title: "t", boardId: w.board.id } })).status).toBe(404);
    expect((await tasksApi({ token, method: "GET" })).status).toBe(404);
    expect((await taskApi("whatever", { token })).status).toBe(404);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);

    // making a token needs the switch; seeing the tokens does not (see the next test)
    await loginAs(w.owner.id);
    expect((await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "x1", permissions: ["ideas.read"], workspaceId: w.space.id } })).status).toBe(404);
    expect(await db.apiToken.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("the owner can list and revoke tokens while the door is shut; making one stays 404; the revoked token stays dead when the door opens again", async () => {
    const w = await world();
    const { token, id } = await mint(w, w.admin);
    await setFeature(w.org.id, false);

    for (const who of [w.owner, w.admin]) {
      await loginAs(who.id);
      const list = await call(tokensRoute.GET, { url: "http://localhost/api/integrations/api-tokens" });
      expect(list.status, "list").toBe(200);
      expect(list.json?.["switchOn"]).toBe(false);
      expect((list.json?.["tokens"] as { id: string; status: string }[]).find((t) => t.id === id)?.status).toBe("active");
      expect(list.text).not.toContain(token);
    }
    // somebody without the capability still cannot
    await loginAs(w.member.id);
    expect((await call(tokensRoute.GET, { url: "http://localhost/api/integrations/api-tokens" })).status).toBe(403);
    expect((await call(tokenRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(403);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();

    await loginAs(w.owner.id);
    const killed = await call(tokenRoute.DELETE, { method: "DELETE", params: { id } });
    expect(killed.status, JSON.stringify(killed.json)).toBe(200);
    expect((killed.json?.["item"] as { status: string }).status).toBe("revoked");
    const row = await db.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.revokedReason).toBe("manual");
    expect(row.revokedById).toBe(w.owner.id);
    expect(await db.auditLog.count({ where: { action: "door.token.revoked", target: id, actorId: w.owner.id } })).toBe(1);
    // revoking again is the same answer, still with the door shut
    expect((await call(tokenRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    // creating is still refused while it is off
    const create = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "again", permissions: ["ideas.read"], workspaceId: w.space.id } });
    expect(create.status).toBe(404);
    expect(await db.apiToken.count({ where: { organizationId: w.org.id } })).toBe(1);
    logout();

    await setFeature(w.org.id, true);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(401);
  });

  it("switched back on, the same token works again (nothing was lost)", async () => {
    const w = await world();
    const { token } = await mint(w);
    await setFeature(w.org.id, false);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(404);
    await setFeature(w.org.id, true);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(201);
  });

  it("is per company: another company's switch does not open or close this one", async () => {
    const a = await world();
    const b = await world({ on: false });
    const { token } = await mint(a);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(201);
    expect(b.org.id).not.toBe(a.org.id);
  });
});

// ---------------------------------------------------------------------------------------------
// who is let in
// ---------------------------------------------------------------------------------------------

describe("the token: who is let in", () => {
  it("no header, another scheme, a malformed token, an unknown token and a wrong secret are all the SAME 401", async () => {
    const w = await world();
    const { token } = await mint(w);
    const wrongSecret = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const answers = [];
    for (const bad of [null, "Basic abc", "Bearer nope", `Bearer zws_${"0".repeat(12)}.${"A".repeat(43)}`, `Bearer ${wrongSecret}`]) {
      const res = await ideasApi({ headers: bad ? { authorization: bad } : {}, body: { title: "فكرة جديدة" } });
      expect(res.status, String(bad)).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
      answers.push(JSON.stringify(res.json));
    }
    expect(new Set(answers).size).toBe(1);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a revoked token is refused at once; revoking twice is the same answer; a token of another company cannot revoke it", async () => {
    const w = await world();
    const other = await world();
    const { token, id } = await mint(w);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(201);

    await loginAs(other.owner.id);
    expect((await call(tokenRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(404);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة ثانية" } })).status).toBe(201);

    await loginAs(w.owner.id);
    const first = await call(tokenRoute.DELETE, { method: "DELETE", params: { id } });
    expect(first.status).toBe(200);
    expect((await call(tokenRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    logout();
    const after = await ideasApi({ token, body: { title: "فكرة جديدة ثالثة" } });
    expect(after.status).toBe(401);
    expect((await ideasApi({ token, method: "GET" })).status).toBe(401);
    expect((await tasksApi({ token, method: "GET" })).status).toBe(401);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(2);
    const row = await db.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.revokedReason).toBe("manual");
    expect(row.revokedById).toBe(w.owner.id);
  });

  it("an expired token is refused", async () => {
    const w = await world();
    const { token, id } = await mint(w, w.owner, { expiresInDays: 30 });
    expect((await ideasApi({ token, method: "GET" })).status).toBe(200);
    await db.apiToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await ideasApi({ token, method: "GET" })).status).toBe(401);
  });

  it("the person who made it, suspended: it dies at once (even before anything revokes it), and reactivating them does not bring it back", async () => {
    const w = await world();
    const { token, id } = await mint(w, w.admin);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(201);

    // the live check alone: only the status flips, the token row is untouched
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { status: "SUSPENDED" } });
    expect((await ideasApi({ token, body: { title: "فكرة جديدة ثانية" } })).status).toBe(401);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { status: "ACTIVE" } });
    expect((await ideasApi({ token, body: { title: "فكرة جديدة ثالثة" } })).status).toBe(201);

    // the real suspension (the People screen): the token is revoked for good, with its reason and an audit row
    await loginAs(w.owner.id);
    expect((await accountsApi.status(w.org.id, w.admin.id, { action: "suspend" })).status).toBe(200);
    logout();
    expect((await ideasApi({ token, body: { title: "فكرة جديدة رابعة" } })).status).toBe(401);
    const row = await db.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedReason).toBe("person_suspended");
    await loginAs(w.owner.id);
    expect((await accountsApi.status(w.org.id, w.admin.id, { action: "reactivate" })).status).toBe(200);
    logout();
    expect((await ideasApi({ token, body: { title: "فكرة جديدة خامسة" } })).status).toBe(401);
    expect(await db.auditLog.count({ where: { action: "door.token.revoked", target: id } })).toBe(1);
  });

  it("the person who made it, offboarded: the token is revoked in the same commit", async () => {
    const w = await world();
    const { token, id } = await mint(w, w.admin);
    await loginAs(w.owner.id);
    expect((await accountsApi.status(w.org.id, w.admin.id, { action: "offboard" })).status).toBe(200);
    logout();
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(401);
    const row = await db.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.revokedReason).toBe("person_offboarded");
    // somebody else's token in the same company is untouched
    const other = await mint(w, w.owner);
    expect((await ideasApi({ token: other.token, body: { title: "فكرة جديدة" } })).status).toBe(201);
  });

  it("the person who made it, no longer holding the integrations switch or no longer in the space: refused at once", async () => {
    const w = await world();
    const { token } = await mint(w, w.admin);
    expect((await ideasApi({ token, method: "GET" })).status).toBe(200);

    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: ["integrations.manage"] } });
    expect((await ideasApi({ token, method: "GET" })).status).toBe(401);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: [] } });
    expect((await ideasApi({ token, method: "GET" })).status).toBe(200);

    await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.admin.id } } });
    expect((await ideasApi({ token, method: "GET" })).status).toBe(401);
  });

  it("a token whose maker was turned into a partner (GUEST) writes nothing", async () => {
    const w = await world();
    const { token } = await mint(w, w.admin);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { role: "GUEST" } });
    expect((await ideasApi({ token, body: { title: "فكرة جديدة" } })).status).toBe(401);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("an address that keeps presenting refused tokens is answered 429, another address is not", async () => {
    const w = await world();
    const { token } = await mint(w);
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    for (let i = 0; i < 20; i++) expect((await ideasApi({ headers: { ...from("203.0.113.9"), authorization: "Bearer nope" }, body: { title: "فكرة جديدة" } })).status).toBe(401);
    // a token that is not a live one (here: well-formed, unknown) is what the lock refuses
    const unknown = `zws_${"1".repeat(12)}.${"B".repeat(43)}`;
    const blocked = await ideasApi({ token: unknown, headers: from("203.0.113.9"), body: { title: "فكرة جديدة" } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(errorOf(blocked)?.code).toBe("door.rate_limited");
    expect((await ideasApi({ token, headers: from("203.0.113.10"), body: { title: "فكرة جديدة" } })).status).toBe(201);
    failureLimiter.reset("203.0.113.9");
  });

  it("a request with a LIVE token is never locked out by the failures of its address, nor counted; unknown, revoked and expired tokens still are", async () => {
    const w = await world();
    const live = await mint(w);
    const revoked = await mint(w);
    const expired = await mint(w, w.owner, { expiresInDays: 30 });
    await db.apiToken.update({ where: { id: revoked.id }, data: { revokedAt: new Date(), revokedReason: "manual" } });
    await db.apiToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const ip = "203.0.113.50";
    const from = { "x-forwarded-for": ip };
    try {
      for (let i = 0; i < 20; i++) expect((await ideasApi({ headers: { ...from, authorization: "Bearer nope" }, body: { title: "فكرة جديدة" } })).status).toBe(401);
      expect(failureLimiter.check(ip).ok).toBe(false);

      // the address is locked for what is refused ...
      const wrongSecret = live.token.slice(0, -1) + (live.token.endsWith("A") ? "B" : "A");
      for (const bad of [null, "Bearer nope", `Bearer ${wrongSecret}`, `Bearer ${revoked.token}`, `Bearer ${expired.token}`]) {
        const res = await ideasApi({ headers: { ...from, ...(bad ? { authorization: bad } : {}) }, body: { title: "فكرة جديدة" } });
        expect(res.status, String(bad)).toBe(429);
        expect(errorOf(res)?.code).toBe("door.rate_limited");
      }
      // ... and not for a good token: it works, reads and writes
      expect((await ideasApi({ token: live.token, headers: from, body: { title: "فكرة جديدة" } })).status).toBe(201);
      expect((await ideasApi({ token: live.token, headers: from, method: "GET" })).status).toBe(200);
      expect((await tasksApi({ token: live.token, headers: from, method: "GET" })).status).toBe(200);
    } finally {
      failureLimiter.reset(ip);
    }
  });

  it("a live token whose switch is off still answers 404 from a blocked address (the lock spares it; the switch decides)", async () => {
    const w = await world();
    const { token } = await mint(w);
    const ip = "203.0.113.51";
    try {
      for (let i = 0; i < 20; i++) await ideasApi({ headers: { "x-forwarded-for": ip, authorization: "Bearer nope" }, body: { title: "فكرة جديدة" } });
      await setFeature(w.org.id, false);
      expect((await ideasApi({ token, headers: { "x-forwarded-for": ip }, body: { title: "فكرة جديدة" } })).status).toBe(404);
    } finally {
      failureLimiter.reset(ip);
    }
  });

  it("a token over its allowance (60 a minute) is answered 429 with Retry-After", async () => {
    const w = await world();
    const { token } = await mint(w);
    for (let i = 0; i < 60; i++) expect((await ideasApi({ token, method: "GET" })).status, `request ${i + 1}`).toBe(200);
    const over = await ideasApi({ token, method: "GET" });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    // another token is not held by it
    const second = await mint(w, w.owner, { name: "Another" });
    expect((await ideasApi({ token: second.token, method: "GET" })).status).toBe(200);
  });

  it("records the last use, and the answer carries a request id", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt).toBeNull();
    const res = await ideasApi({ token, method: "GET" });
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// permissions
// ---------------------------------------------------------------------------------------------

describe("the permissions", () => {
  it("a read-only token writes nothing (403) and creates nothing; a write token of the other kind does not write here", async () => {
    const w = await world();
    const ro = await mint(w, w.owner, { permissions: ["ideas.read", "tasks.read"] });
    expect(errorOf(await ideasApi({ token: ro.token, body: { title: "فكرة جديدة" } }))?.code).toBe("door.forbidden");
    expect((await tasksApi({ token: ro.token, body: { title: "t", boardId: w.board.id } })).status).toBe(403);
    expect((await ideasApi({ token: ro.token, method: "GET" })).status).toBe(200);
    expect((await tasksApi({ token: ro.token, method: "GET" })).status).toBe(200);

    const tasksOnly = await mint(w, w.owner, { permissions: ["tasks.write"] });
    expect((await ideasApi({ token: tasksOnly.token, body: { title: "فكرة جديدة" } })).status).toBe(403);
    expect((await ideasApi({ token: tasksOnly.token, method: "GET" })).status).toBe(403);
    expect((await tasksApi({ token: tasksOnly.token, body: { title: "t", boardId: w.board.id } })).status).toBe(201);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// ideas
// ---------------------------------------------------------------------------------------------

describe("hardening: input that used to be a 500", () => {
  const NUL = String.fromCharCode(0);

  it("a dueDate outside the years 2000 to 2100 is 422 (not 500) and creates nothing; inside it, the task is made", async () => {
    const w = await world();
    const { token } = await mint(w);
    for (const dueDate of ["0001-01-01", "9999-12-31", "1999-12-31", "2101-01-01", "9999-12-31T23:59:59Z", "0000-01-01T00:00:00Z"]) {
      const res = await tasksApi({ token, body: { title: "مهمة", boardId: w.board.id, dueDate } });
      expect(res.status, `${dueDate}: ${JSON.stringify(res.json)}`).toBe(422);
      expect(errorOf(res)?.code).toBe("door.validation_failed");
    }
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    expect((await tasksApi({ token, body: { title: "مهمة", boardId: w.board.id, dueDate: "2100-12-31" } })).status).toBe(201);
    expect((await tasksApi({ token, body: { title: "مهمة 2", boardId: w.board.id, dueDate: "2000-01-01T08:00:00+03:00" } })).status).toBe(201);
  });

  it("a NUL character in a title, description, boardId, externalRef or tag is 422 (not 500), and nothing is stored", async () => {
    const w = await world();
    const { token } = await mint(w);
    const bad = `abc${NUL}def`;
    const cases: [string, () => Promise<{ status: number; json: Record<string, unknown> | null }>][] = [
      ["idea title", () => ideasApi({ token, body: { title: `فكرة ${bad}` } })],
      ["idea description", () => ideasApi({ token, body: { title: "فكرة جديدة", description: bad } })],
      ["idea externalRef", () => ideasApi({ token, body: { title: "فكرة جديدة", externalRef: `s7:${bad}` } })],
      ["idea tag", () => ideasApi({ token, body: { title: "فكرة جديدة", tags: [bad] } })],
      ["task title", () => tasksApi({ token, body: { title: `مهمة ${bad}`, boardId: w.board.id } })],
      ["task description", () => tasksApi({ token, body: { title: "مهمة", description: bad, boardId: w.board.id } })],
      ["task boardId", () => tasksApi({ token, body: { title: "مهمة", boardId: `${w.board.id}${NUL}` } })],
      ["task externalRef", () => tasksApi({ token, body: { title: "مهمة", boardId: w.board.id, externalRef: `s7:${bad}` } })],
    ];
    for (const [what, run] of cases) {
      const res = await run();
      expect(res.status, `${what}: ${JSON.stringify(res.json)}`).toBe(422);
      expect(errorOf(res)?.code, what).toBe("door.validation_failed");
    }
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { key: { startsWith: `${w.org.id}:` } } })).toBe(0);
  });

  it("a NUL character in a cursor is 422 and in a task id is 404 (not 500)", async () => {
    const w = await world();
    const { token } = await mint(w);
    expect((await ideasApi({ token, method: "GET", query: "?cursor=ab%00cd" })).status).toBe(422);
    expect((await tasksApi({ token, method: "GET", query: "?cursor=ab%00cd" })).status).toBe(422);
    const res = await taskApi(`ab${NUL}cd`, { token });
    expect(res.status).toBe(404);
    expect(errorOf(res)?.code).toBe("door.not_found");
  });
});

describe("POST /api/v1/ideas", () => {
  it("creates the idea in the token's space, in the name of the person who made it, marked with its source; and audits it", async () => {
    const w = await world();
    const { token, id } = await mint(w, w.admin, { name: "System 7 prod" });
    const res = await ideasApi({ token, body: { title: "  فكرة من سيستم 7  ", description: "تفاصيل", tags: ["عروض", "q4"], externalRef: "s7:idea/42" } });
    expect(res.status).toBe(201);
    const idea = dataOf<{ id: string }>(res);
    const row = await db.idea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(row).toMatchObject({
      orgId: w.org.id,
      workspaceId: w.space.id,
      creatorId: w.admin.id,
      title: "فكرة من سيستم 7",
      description: "تفاصيل",
      status: "NEW",
      source: "System 7 prod",
      externalRef: "s7:idea/42",
      tags: ["عروض", "q4"],
      apiTokenId: id,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "door.idea.created", target: idea.id } });
    expect(audit).toMatchObject({ actorId: w.admin.id, orgId: w.org.id, workspaceId: w.space.id });
    expect(audit.meta).toMatchObject({ tokenId: id, via: "api-door" });
    expect(JSON.stringify(audit.meta)).not.toContain("فكرة من سيستم 7");
  });

  it("the answer holds exactly the contract's fields: no author, no company, no space, no token", async () => {
    const w = await world();
    const { token } = await mint(w);
    const res = await ideasApi({ token, body: { title: "فكرة جديدة" } });
    expect(Object.keys(dataOf<object>(res)).sort()).toEqual(["createdAt", "description", "externalRef", "id", "source", "status", "tags", "title", "updatedAt"]);
    expect(res.text).not.toContain(w.owner.id);
    expect(res.text).not.toContain(w.org.id);
    expect(res.text).not.toContain(w.space.id);
  });

  it("the same Idempotency-Key and the same body: the same answer, marked as a replay, and ONE idea; the stored key starts with the company", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `retry-${uid()}-abcdef`;
    const first = await ideasApi({ token, key, body: { title: "فكرة جديدة", tags: ["a"] } });
    const again = await ideasApi({ token, key, body: { tags: ["a"], title: "فكرة جديدة" } });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.json).toEqual(first.json);
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(1);
    const record = await db.idempotencyRecord.findFirstOrThrow({ where: { organizationId: w.org.id } });
    expect(record.key.startsWith(`${w.org.id}:`)).toBe(true);
    expect(record.key.endsWith(`idea.create:${key}`)).toBe(true);
    expect(record.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
  });

  it("the same key with ANOTHER body is 409 and creates nothing", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `retry-${uid()}-abcdef`;
    expect((await ideasApi({ token, key, body: { title: "فكرة جديدة" } })).status).toBe(201);
    const clash = await ideasApi({ token, key, body: { title: "فكرة مختلفة" } });
    expect(clash.status).toBe(409);
    expect(errorOf(clash)?.code).toBe("door.idempotency_conflict");
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("two companies using the same key never see each other's answer: each creates its own", async () => {
    const a = await world();
    const b = await world();
    const ta = await mint(a);
    const tb = await mint(b);
    const key = `shared-key-${uid()}`;
    const ra = await ideasApi({ token: ta.token, key, body: { title: "فكرة جديدة" } });
    const rb = await ideasApi({ token: tb.token, key, body: { title: "فكرة جديدة" } });
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(dataOf<{ id: string }>(ra).id).not.toBe(dataOf<{ id: string }>(rb).id);
    expect(rb.headers.get("idempotent-replayed")).toBeNull();
    expect(await db.idea.count({ where: { orgId: a.org.id } })).toBe(1);
    expect(await db.idea.count({ where: { orgId: b.org.id } })).toBe(1);
    const keys = (await db.idempotencyRecord.findMany({ where: { organizationId: { in: [a.org.id, b.org.id] } }, select: { key: true } })).map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("two tokens of ONE company with the same key do not replay each other either", async () => {
    const w = await world();
    const t1 = await mint(w, w.owner, { name: "One" });
    const t2 = await mint(w, w.owner, { name: "Two" });
    const key = `shared-key-${uid()}`;
    const r1 = await ideasApi({ token: t1.token, key, body: { title: "فكرة جديدة" } });
    const r2 = await ideasApi({ token: t2.token, key, body: { title: "فكرة جديدة" } });
    expect(dataOf<{ id: string }>(r1).id).not.toBe(dataOf<{ id: string }>(r2).id);
  });

  it("identical requests arriving together create ONE idea and all answer with it", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `race-${uid()}-abcdef`;
    const answers = await Promise.all(Array.from({ length: 5 }, () => ideasApi({ token, key, body: { title: "فكرة جديدة" } })));
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(answers.map((a) => dataOf<{ id: string }>(a).id)).size).toBe(1);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(1);
    expect(await db.idempotencyRecord.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("an answer past its 48 hours is forgotten: the key is free again", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `old-${uid()}-abcdef`;
    await ideasApi({ token, key, body: { title: "فكرة جديدة" } });
    await db.idempotencyRecord.updateMany({ where: { organizationId: w.org.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const again = await ideasApi({ token, key, body: { title: "فكرة مختلفة" } });
    expect(again.status).toBe(201);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(2);
  });

  it("needs the key: missing or malformed is 400, and nothing is created", async () => {
    const w = await world();
    const { token } = await mint(w);
    expect(errorOf(await ideasApi({ token, key: null, body: { title: "فكرة جديدة" } }))?.code).toBe("door.idempotency_key_required");
    expect(errorOf(await ideasApi({ token, key: "short", body: { title: "فكرة جديدة" } }))?.code).toBe("door.idempotency_key_invalid");
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a body with a customer's name, phone or address is refused with its own code, and nothing is stored", async () => {
    const w = await world();
    const { token } = await mint(w);
    for (const extra of [{ customerName: "x" }, { phone: "0790000000" }, { address: "x" }, { email: "a@b.co" }, { meta: { customer: { name: "x" } } }, { price: 10 }]) {
      const res = await ideasApi({ token, body: { title: "فكرة جديدة", ...extra } });
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(errorOf(res)?.code).toBe("door.customer_data_rejected");
      expect((errorOf(res)?.details as { keys: string[] }).keys.length).toBeGreaterThan(0);
    }
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { organizationId: w.org.id } })).toBe(0);
  });

  it("a field nobody declared is refused (strict), not ignored; so is a bad title, bad JSON, the wrong content type and a huge body", async () => {
    const w = await world();
    const { token } = await mint(w);
    const unknown = await ideasApi({ token, body: { title: "فكرة جديدة", status: "ACCEPTED" } });
    expect(unknown.status).toBe(422);
    expect(errorOf(unknown)?.code).toBe("door.validation_failed");
    expect((await ideasApi({ token, body: { title: "ab" } })).status).toBe(422);
    expect((await ideasApi({ token, body: { title: "فكرة جديدة", externalRef: "Ahmad Ali" } })).status).toBe(422);

    const raw = async (body: string, type = "application/json") => {
      const req = new Request(`${BASE}/ideas`, { method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": `raw-${uid()}-abcdefg`, "content-type": type }, body });
      return ideasRoute.POST(req);
    };
    expect((await raw("{not json")).status).toBe(400);
    expect((await raw("[1,2]")).status).toBe(400);
    expect((await raw(JSON.stringify({ title: "فكرة جديدة" }), "text/plain")).status).toBe(415);
    expect((await raw(JSON.stringify({ title: "فكرة جديدة", description: "x".repeat(40_000) }))).status).toBe(413);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the person it acts for must still be allowed to add ideas: a section switched off for them is a 403 and nothing is created", async () => {
    const w = await world();
    const { token } = await mint(w, w.admin);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: ["ideas.edit"] } });
    const res = await ideasApi({ token, body: { title: "فكرة جديدة" } });
    expect(res.status).toBe(403);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { organizationId: w.org.id } })).toBe(0);
  });
});

describe("GET /api/v1/ideas", () => {
  it("lists only the ideas THIS token sent (not a person's, not another token's, not another company's), newest first, with a cursor", async () => {
    const w = await world();
    const other = await world();
    const mine = await mint(w);
    const theirs = await mint(w, w.owner, { name: "Other token" });
    const foreign = await mint(other);
    await db.idea.create({ data: { orgId: w.org.id, creatorId: w.owner.id, title: "فكرة كتبها شخص", workspaceId: w.space.id } });
    for (let i = 0; i < 3; i++) await ideasApi({ token: mine.token, body: { title: `فكرة رقم ${i + 1}` } });
    await ideasApi({ token: theirs.token, body: { title: "فكرة التوكن التاني" } });
    await ideasApi({ token: foreign.token, body: { title: "فكرة شركة تانية" } });

    const all = await ideasApi({ token: mine.token, method: "GET" });
    expect(all.status).toBe(200);
    expect(dataOf<{ title: string }[]>(all).map((i) => i.title)).toEqual(["فكرة رقم 3", "فكرة رقم 2", "فكرة رقم 1"]);

    const page1 = await ideasApi({ token: mine.token, method: "GET", query: "?limit=2" });
    const cursor = page1.json?.["nextCursor"] as string;
    expect(dataOf<unknown[]>(page1)).toHaveLength(2);
    expect(cursor).toBeTruthy();
    const page2 = await ideasApi({ token: mine.token, method: "GET", query: `?limit=2&cursor=${cursor}` });
    expect(dataOf<{ title: string }[]>(page2).map((i) => i.title)).toEqual(["فكرة رقم 1"]);
    expect(page2.json?.["nextCursor"]).toBeNull();

    expect((await ideasApi({ token: mine.token, method: "GET", query: "?limit=0" })).status).toBe(422);
  });

  it("shows the idea's CURRENT status (the team moves it along)", async () => {
    const w = await world();
    const { token } = await mint(w);
    const made = dataOf<{ id: string }>(await ideasApi({ token, body: { title: "فكرة جديدة" } }));
    await db.idea.update({ where: { id: made.id }, data: { status: "PLANNING" } });
    expect(dataOf<{ status: string }[]>(await ideasApi({ token, method: "GET" }))[0]?.status).toBe("PLANNING");
  });
});

// ---------------------------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/tasks", () => {
  it("creates the task through createTask on the named board of the token's space: first column, numbered, in the name of the maker, linked to the token", async () => {
    const w = await world();
    const { token, id } = await mint(w, w.admin);
    const res = await tasksApi({ token, body: { title: "مهمة من سيستم 7", description: "تفاصيل", boardId: w.board.id, priority: "HIGH", dueDate: "2026-11-20", externalRef: "s7:task/9" } });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const task = dataOf<{ id: string; number: number; status: string; column: { id: string } }>(res);
    expect(task.status).toBe("open");
    expect(task.column.id).toBe(w.todo.id);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({
      orgId: w.org.id,
      workspaceId: w.space.id,
      projectId: w.project.id,
      boardId: w.board.id,
      columnId: w.todo.id,
      creatorId: w.admin.id,
      assigneeId: null,
      title: "مهمة من سيستم 7",
      priority: "HIGH",
      apiTokenId: id,
      externalRef: "s7:task/9",
      number: task.number,
    });
    expect(row.dueDate).not.toBeNull();
    expect(await db.taskActivity.count({ where: { taskId: task.id, event: "task.created" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "door.task.created", target: task.id, actorId: w.admin.id } })).toBe(1);
  });

  it("numbers continue the company's counter (the task is a real task)", async () => {
    const w = await world();
    const { token } = await mint(w);
    const one = dataOf<{ number: number }>(await tasksApi({ token, body: { title: "مهمة أولى", boardId: w.board.id } }));
    const two = dataOf<{ number: number }>(await tasksApi({ token, body: { title: "مهمة ثانية", boardId: w.board.id } }));
    expect(two.number).toBe(one.number + 1);
  });

  it("a board of ANOTHER space of the same company, or of another company, is 404 and nothing is created", async () => {
    const w = await world();
    const other = await world();
    const spaceB = await makeWorkspace(w.org.id, [{ userId: w.admin.id }], "Space B");
    const boardB = await makeProject(spaceB.id);
    const { token } = await mint(w);
    for (const boardId of [boardB.board.id, other.board.id, "nope"]) {
      const res = await tasksApi({ token, body: { title: "مهمة جديدة", boardId } });
      expect(res.status, boardId).toBe(404);
      expect(errorOf(res)?.code).toBe("door.board_not_found");
    }
    expect(await db.task.count({ where: { orgId: { in: [w.org.id, other.org.id] } } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { organizationId: w.org.id } })).toBe(0);
  });

  it("does not take an assignee, a space, a project or a column: the token decides", async () => {
    const w = await world();
    const { token } = await mint(w);
    for (const extra of [{ assigneeId: w.member.id }, { workspaceId: w.space.id }, { projectId: w.project.id }, { columnId: w.done.id }]) {
      expect((await tasksApi({ token, body: { title: "مهمة جديدة", boardId: w.board.id, ...extra } })).status, JSON.stringify(extra)).toBe(422);
    }
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("customer data by key name is refused, as for ideas", async () => {
    const w = await world();
    const { token } = await mint(w);
    const res = await tasksApi({ token, body: { title: "مهمة جديدة", boardId: w.board.id, customerName: "x", phone: "1" } });
    expect(errorOf(res)?.code).toBe("door.customer_data_rejected");
    expect((errorOf(res)?.details as { keys: string[] }).keys.sort()).toEqual(["customerName", "phone"]);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("is idempotent: a retry returns the same task and the counter is not spent twice; another body under the key is 409", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `task-${uid()}-abcdef`;
    const first = await tasksApi({ token, key, body: { title: "مهمة جديدة", boardId: w.board.id } });
    const again = await tasksApi({ token, key, body: { title: "مهمة جديدة", boardId: w.board.id } });
    expect(again.json).toEqual(first.json);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect((await tasksApi({ token, key, body: { title: "مهمة مختلفة", boardId: w.board.id } })).status).toBe(409);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(1);
    const next = dataOf<{ number: number }>(await tasksApi({ token, body: { title: "مهمة تانية", boardId: w.board.id } }));
    expect(next.number).toBe(dataOf<{ number: number }>(first).number + 1);
  });

  it("identical requests arriving together create ONE task", async () => {
    const w = await world();
    const { token } = await mint(w);
    const key = `race-${uid()}-abcdef`;
    const answers = await Promise.all(Array.from({ length: 4 }, () => tasksApi({ token, key, body: { title: "مهمة جديدة", boardId: w.board.id } })));
    expect(answers.map((a) => a.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(answers.map((a) => dataOf<{ id: string }>(a).id)).size).toBe(1);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("the person it acts for must still be allowed to add tasks (the section grid): else 403 and nothing is created", async () => {
    const w = await world();
    const { token } = await mint(w, w.admin);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: ["tasks.edit"] } });
    expect((await tasksApi({ token, body: { title: "مهمة جديدة", boardId: w.board.id } })).status).toBe(403);
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("the answer holds exactly the contract's fields and no price, reward, assignee or person", async () => {
    const w = await world();
    const { token } = await mint(w);
    const res = await tasksApi({ token, body: { title: "مهمة جديدة", boardId: w.board.id } });
    expect(Object.keys(dataOf<object>(res)).sort()).toEqual(["boardId", "column", "createdAt", "description", "dueDate", "externalRef", "finishedAt", "id", "number", "priority", "status", "title", "updatedAt"]);
    expect(res.text).not.toContain(w.owner.id);
    expect(res.text).not.toContain(w.org.id);
    expect(res.text).not.toMatch(/reward|assignee|creator/i);
  });
});

describe("GET /api/v1/tasks and /api/v1/tasks/{id}", () => {
  it("the status of a task THIS token made; moving it to the finished column makes it `done`", async () => {
    const w = await world();
    const { token } = await mint(w);
    const made = dataOf<{ id: string }>(await tasksApi({ token, body: { title: "مهمة جديدة", boardId: w.board.id } }));
    const open = await taskApi(made.id, { token });
    expect(open.status).toBe(200);
    expect(dataOf<{ status: string }>(open).status).toBe("open");
    await db.task.update({ where: { id: made.id }, data: { columnId: w.done.id, completedAt: new Date() } });
    const done = dataOf<{ status: string; column: { name: string } }>(await taskApi(made.id, { token }));
    expect(done).toMatchObject({ status: "done", column: { name: "done" } });
  });

  it("any other task is the same 404: a person's, another token's, another company's, one that does not exist", async () => {
    const w = await world();
    const other = await world();
    const mine = await mint(w);
    const theirs = await mint(w, w.owner, { name: "Other token" });
    const foreign = await mint(other);
    const personal = await db.task.create({
      data: { number: 9001, orgId: w.org.id, workspaceId: w.space.id, projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, creatorId: w.owner.id, title: "مهمة شخص", position: 1000 },
    });
    const ofTheirs = dataOf<{ id: string }>(await tasksApi({ token: theirs.token, body: { title: "مهمة التوكن التاني", boardId: w.board.id } }));
    const ofForeign = dataOf<{ id: string }>(await tasksApi({ token: foreign.token, body: { title: "مهمة شركة تانية", boardId: other.board.id } }));
    const answers = [];
    for (const id of [personal.id, ofTheirs.id, ofForeign.id, "does-not-exist"]) {
      const res = await taskApi(id, { token: mine.token });
      expect(res.status, id).toBe(404);
      answers.push(JSON.stringify(res.json));
    }
    expect(new Set(answers).size).toBe(1);
  });

  it("the list holds only this token's tasks", async () => {
    const w = await world();
    const mine = await mint(w);
    const theirs = await mint(w, w.owner, { name: "Other token" });
    await tasksApi({ token: mine.token, body: { title: "مهمة أولى", boardId: w.board.id } });
    await tasksApi({ token: theirs.token, body: { title: "مهمة تانية", boardId: w.board.id } });
    expect(dataOf<{ title: string }[]>(await tasksApi({ token: mine.token, method: "GET" })).map((t) => t.title)).toEqual(["مهمة أولى"]);
  });
});

describe("GET /api/v1/boards", () => {
  it("lists the open boards of the token's space, and nothing of another space, another company or the instant-work project", async () => {
    const w = await world();
    const other = await world();
    const spaceB = await makeWorkspace(w.org.id, [{ userId: w.admin.id }], "Space B");
    await makeProject(spaceB.id);
    await db.board.create({ data: { projectId: w.project.id, name: "Archived board", archived: true } });
    const instant = await db.project.create({ data: { workspaceId: w.space.id, name: "Instant", systemKey: "instant" } });
    await db.board.create({ data: { projectId: instant.id, name: "Instant board" } });
    const { token } = await mint(w);
    const res = await boardsApi({ token });
    expect(res.status).toBe(200);
    expect(dataOf<{ id: string; name: string; project: string }[]>(res)).toEqual([{ id: w.board.id, name: "Board", project: w.project.name }]);
    expect(res.text).not.toContain(other.board.id);
  });

  it("a team's project is listed only when the person the token acts for is in the team", async () => {
    const w = await world();
    const team = await db.team.create({ data: { workspaceId: w.space.id, name: "Closed team" } });
    const teamProject = await db.project.create({ data: { workspaceId: w.space.id, name: "Team project", teamId: team.id } });
    const teamBoard = await db.board.create({ data: { projectId: teamProject.id, name: "Team board" } });
    await grantCapabilities(w.org.id, w.member.id, ["integrations.manage"]);
    const { token } = await mint(w, w.member);
    expect(dataOf<{ id: string }[]>(await boardsApi({ token })).map((b) => b.id)).not.toContain(teamBoard.id);
    const owner = await mint(w, w.owner);
    expect(dataOf<{ id: string }[]>(await boardsApi({ token: owner.token })).map((b) => b.id)).toContain(teamBoard.id);
  });

  it("needs a task permission", async () => {
    const w = await world();
    const { token } = await mint(w, w.owner, { permissions: ["ideas.write"] });
    expect((await boardsApi({ token })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
// the owner's screen
// ---------------------------------------------------------------------------------------------

describe("the tokens screen (/api/integrations/api-tokens)", () => {
  it("the whole token is in the answer of the POST only; what is stored is its hash; the list never carries it", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    const row = await db.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token.split(".")[1] as string);
    await loginAs(w.owner.id);
    const list = await call(tokensRoute.GET, { url: "http://localhost/api/integrations/api-tokens" });
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(token);
    expect(list.text).not.toContain(row.tokenHash);
    const item = (list.json?.["tokens"] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(["createdAt", "createdBy", "expiresAt", "hint", "id", "lastUsedAt", "name", "permissions", "revokedAt", "revokedReason", "space", "status"]);
    expect(item["hint"]).toBe(`zws_${row.prefix}…`);
    expect(await db.auditLog.count({ where: { action: "door.token.created", target: id, actorId: w.owner.id } })).toBe(1);
  });

  it("the owner and an admin (who holds the switch) manage tokens; a member and a partner cannot, and nothing is made", async () => {
    const w = await world();
    for (const who of [w.owner, w.admin]) await mint(w, who);
    for (const who of [w.member, w.guest]) {
      await loginAs(who.id);
      const res = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "System 7", permissions: ["ideas.read"], workspaceId: w.space.id } });
      expect(res.status, who.name).toBe(403);
      expect((await call(tokensRoute.GET, { url: "http://localhost/api/integrations/api-tokens" })).status).toBe(403);
    }
    expect(await db.apiToken.count({ where: { organizationId: w.org.id } })).toBe(2);
    // a member given the switch by the owner may, and sees the same list
    await grantCapabilities(w.org.id, w.member.id, ["integrations.manage"]);
    await loginAs(w.member.id);
    expect((await call(tokensRoute.GET, { url: "http://localhost/api/integrations/api-tokens" })).status).toBe(200);
  });

  it("a token is for ONE space the maker reaches: an unreachable space, another company's space and a missing one are refused", async () => {
    const w = await world();
    const other = await world();
    const hidden = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Hidden from admin");
    await loginAs(w.admin.id);
    for (const workspaceId of [hidden.id, other.space.id, "nope"]) {
      const res = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "System 7", permissions: ["ideas.read"], workspaceId } });
      expect(res.status, workspaceId).toBe(403);
    }
    // the owner sees every space of the company, so the owner may
    await loginAs(w.owner.id);
    const ok = await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "System 7", permissions: ["ideas.read"], workspaceId: hidden.id } });
    expect(ok.status).toBe(201);
    // ...but never another company's
    expect((await call(tokensRoute.POST, { url: "http://localhost/api/integrations/api-tokens", body: { name: "System 7", permissions: ["ideas.read"], workspaceId: other.space.id } })).status).toBe(403);
    expect(await db.apiToken.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("the list offers only the spaces the maker reaches, and every token of the company is listed for whoever holds the switch", async () => {
    const w = await world();
    const hidden = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "Hidden from admin");
    await mint(w, w.owner);
    await mint(w, w.admin);
    await loginAs(w.admin.id);
    const list = await call(tokensRoute.GET, { url: "http://localhost/api/integrations/api-tokens" });
    const spaces = (list.json?.["spaces"] as { id: string }[]).map((s) => s.id);
    expect(spaces).toContain(w.space.id);
    expect(spaces).not.toContain(hidden.id);
    expect((list.json?.["tokens"] as unknown[]).length).toBe(2);
  });

  it("validates: a short name, no permission, an unknown permission, an odd expiry", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const url = "http://localhost/api/integrations/api-tokens";
    const base = { name: "System 7", permissions: ["ideas.read"], workspaceId: w.space.id };
    for (const bad of [{ name: "x" }, { permissions: [] }, { permissions: ["ideas.admin"] }, { expiresInDays: 7 }, { workspaceId: "" }]) {
      expect((await call(tokensRoute.POST, { url, body: { ...base, ...bad } })).status, JSON.stringify(bad)).toBe(422);
    }
    const ok = await call(tokensRoute.POST, { url, body: { ...base, expiresInDays: 90 } });
    expect(ok.status).toBe(201);
    const row = await db.apiToken.findFirstOrThrow({ where: { organizationId: w.org.id } });
    expect(row.permissions).toEqual(["ideas.read"]);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
  });
});
