import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as route from "@/app/api/me/nav-order/route";
import { withFeature } from "@/lib/features";
import { applyNavOrder, readNavOrder } from "@/lib/nav/order";
import { buildNav } from "@/lib/nav/places";
import { requireActor } from "@/server/policy/actor";
import { navSubjectOf } from "@/server/services/nav-order";
import { call, db, loginAs, logout, makeTeam } from "./helpers";
import { pendingMember, setMemberStatus } from "./login-helpers";

/**
 * «ترتيبي» on the server: /api/me/nav-order keeps ONE person's order of the menu on their account (`User.navOrder`,
 * the additive migration 20261030163000_user_nav_order). It is the caller's alone, it only orders what the caller may
 * see, and the layout reads it so the first paint already has it.
 */

const URL = "http://localhost/api/me/nav-order";
const get = () => call(route.GET, { method: "GET", url: URL });
const put = (body: unknown) => call(route.PUT, { method: "PUT", url: URL, body });
const del = () => call(route.DELETE, { method: "DELETE", url: URL });

const stored = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { navOrder: true } })).navOrder;

const ORDER = { places: ["library", "chat", "today", "work", "watch", "admin"], tabs: { work: ["crm", "list"] } };

beforeEach(() => logout());

describe("the column", () => {
  it("every account starts with no order (NULL): the code's order, what everybody sees today", async () => {
    const { member, owner } = await makeTeam();
    expect(await stored(member.id)).toBeNull();
    expect(await stored(owner.id)).toBeNull();
  });
});

describe("GET /api/me/nav-order", () => {
  it("answers { order: null } for somebody who never ordered", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ order: null });
  });

  it("answers the saved order", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await put({ places: ["chat", "today"], tabs: { work: ["list", "my-work"] } });
    expect((await get()).json).toEqual({ order: { places: ["chat", "today"], tabs: { work: ["list", "my-work"] } } });
  });

  it("a stored value that is damaged or out of date reads as what is still good, never as an error", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await db.user.update({ where: { id: member.id }, data: { navOrder: { places: ["gone", "chat", "chat"], tabs: { work: ["removed", "list"], nowhere: ["x"] } } } });
    expect((await get()).json).toEqual({ order: { places: ["chat"], tabs: { work: ["list"] } } });
    await db.user.update({ where: { id: member.id }, data: { navOrder: "nonsense" } });
    expect((await get()).json).toEqual({ order: null });
  });
});

describe("PUT /api/me/nav-order", () => {
  it("saves the order on the caller's account and answers it", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await put(ORDER);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ order: ORDER });
    expect(await stored(owner.id)).toEqual(ORDER);
  });

  it("replaces the order before it, whole", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    await put(ORDER);
    await put({ places: ["admin"], tabs: {} });
    expect(await stored(owner.id)).toEqual({ places: ["admin"], tabs: {} });
  });

  it("an order that says nothing is the same as none: the column is cleared", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    await put(ORDER);
    expect((await put({ places: [], tabs: {} })).json).toEqual({ order: null });
    expect(await stored(owner.id)).toBeNull();
  });

  it("refuses what is not an order (422): an unknown place or tab, a duplicate, a tab of another place, an extra field, the wrong kind", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    await put(ORDER);
    const bad: unknown[] = [
      { places: ["nope"] },
      { places: ["work", "work"] },
      { tabs: { work: ["nope"] } },
      { tabs: { work: ["crm", "crm"] } },
      { tabs: { work: ["settings"] } },
      { tabs: { today: ["crm"] } },
      { places: [], tabs: {}, extra: 1 },
      { places: "work" },
      [],
      "x",
    ];
    for (const body of bad) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    // nothing was written by any of them
    expect(await stored(owner.id)).toEqual(ORDER);
  });

  it("signed out: 401; suspended: 401; still in the onboarding: 403 — and nothing is written", async () => {
    const { member } = await makeTeam();
    expect((await put(ORDER)).status).toBe(401);
    expect((await get()).status).toBe(401);
    expect((await del()).status).toBe(401);
    const pending = await pendingMember({ password: true, notice: true });
    expect((await put(ORDER)).status).toBe(403);
    expect(await stored(pending.member.id)).toBeNull();
    await loginAs(member.id);
    await setMemberStatus(member.id, "SUSPENDED");
    expect((await put(ORDER)).status).toBe(401);
    expect(await stored(member.id)).toBeNull();
  });
});

describe("it only orders what the caller may see", () => {
  it("an external partner cannot save an order for places or tabs they do not have (403), and nothing is written", async () => {
    const { guest } = await makeTeam();
    await loginAs(guest.id);
    for (const body of [
      { places: ["admin"] },
      { places: ["chat", "watch"] },
      { tabs: { library: ["files"] } },
      { tabs: { work: ["projects", "crm"] } },
      { tabs: { work: ["goals"] } },
      { tabs: { admin: ["team"] } },
    ]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect((res.json as { error?: { message?: string } } | null)?.error?.message ?? res.text).toContain("navorder.not_visible");
    }
    expect(await stored(guest.id)).toBeNull();
  });

  it("…but may order the places and tabs they do see", async () => {
    const { guest } = await makeTeam();
    await loginAs(guest.id);
    const order = { places: ["work", "chat", "today"], tabs: { work: ["calendar", "list", "projects", "my-work"] } };
    expect((await put(order)).status).toBe(200);
    expect(await stored(guest.id)).toEqual(order);
  });

  it("a member has no «الإدارة» tabs they hold no switch for: «الإعدادات» is refused, «الفريق» is accepted", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    expect((await put({ tabs: { admin: ["settings"] } })).status).toBe(403);
    expect((await put({ places: ["admin"] })).status).toBe(200);
  });

  it("a member who is not a manager of the space they are in cannot order «المساحة» (403)", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    expect((await put({ tabs: { admin: ["space"] } })).status).toBe(403);
  });

  it("a place the owner switched off for the company («الميزات») cannot be ordered either", async () => {
    const { org, owner, member } = await makeTeam();
    await db.organization.update({ where: { id: org.id }, data: { settings: withFeature(org.settings, "watch", false) as Prisma.InputJsonObject } });
    await loginAs(owner.id);
    expect((await put({ places: ["watch"] })).status).toBe(403);
    await loginAs(member.id);
    expect((await put({ places: ["watch"] })).status).toBe(403);
    expect((await put({ places: ["chat", "today"] })).status).toBe(200);
  });

  it("the owner sees every place, so may order every place", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    expect((await put({ places: ["admin", "watch", "library", "work", "chat", "today"], tabs: { admin: ["archive", "team"] } })).status).toBe(200);
  });
});

describe("it is personal", () => {
  it("each person has their own order: one's save changes nobody else's, and a reset clears only their own", async () => {
    const { owner, member, admin } = await makeTeam();
    await loginAs(owner.id);
    await put({ places: ["admin", "today"], tabs: {} });
    await loginAs(member.id);
    expect((await get()).json).toEqual({ order: null });
    await put({ places: ["chat", "today"], tabs: {} });
    await loginAs(admin.id);
    expect((await get()).json).toEqual({ order: null });
    await put({ places: ["library"], tabs: {} });

    await loginAs(member.id);
    expect((await del()).status).toBe(200);
    expect(await stored(member.id)).toBeNull();
    expect(await stored(owner.id)).toEqual({ places: ["admin", "today"], tabs: {} });
    expect(await stored(admin.id)).toEqual({ places: ["library"], tabs: {} });
  });

  it("there is no way to name somebody else: a user id in the body is refused as an unknown field, and in the address it is no route", async () => {
    const { owner, member } = await makeTeam();
    await loginAs(member.id);
    const res = await put({ places: ["chat"], tabs: {}, userId: owner.id });
    expect(res.status).toBe(422);
    expect(await stored(owner.id)).toBeNull();
  });
});

describe("DELETE /api/me/nav-order: «رجّع الترتيب الأصلي»", () => {
  it("clears the caller's order and answers { order: null }; doing it twice is harmless", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    await put(ORDER);
    const res = await del();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ order: null });
    expect(await stored(owner.id)).toBeNull();
    expect((await del()).status).toBe(200);
    expect((await get()).json).toEqual({ order: null });
  });
});

describe("what the layout draws from it", () => {
  it("the saved order, read the way the layout reads it, orders the person's own map — and never adds to it", async () => {
    const { guest } = await makeTeam();
    await loginAs(guest.id);
    await put({ places: ["work", "chat", "today", "library"], tabs: { work: ["calendar", "list", "projects", "my-work"] } });
    const actor = await requireActor();
    const nav = buildNav(navSubjectOf(actor, null, null));
    const row = await db.user.findUniqueOrThrow({ where: { id: guest.id }, select: { navOrder: true } });
    const shown = applyNavOrder(nav, readNavOrder(row.navOrder));
    expect(shown.places.map((p) => p.key)).toEqual(["work", "chat", "today", "library"]);
    expect(shown.places[0]?.tabs.map((t) => t.key)).toEqual(["calendar", "list", "projects", "my-work"]);
    // and the places stay the same set
    expect(shown.places.map((p) => p.key).sort()).toEqual(nav.places.map((p) => p.key).sort());
  });

  it("an order saved while the person saw less puts a newly offered place at its default place, not lost and not forced to the end", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    // a member sees today, chat, work, library, watch, admin (team): saved without «watch»
    await db.user.update({ where: { id: member.id }, data: { navOrder: { places: ["admin", "today", "chat", "work", "library"], tabs: {} } } });
    const actor = await requireActor();
    const row = await db.user.findUniqueOrThrow({ where: { id: member.id }, select: { navOrder: true } });
    const keys = applyNavOrder(buildNav(navSubjectOf(actor, null, null)), readNavOrder(row.navOrder)).places.map((p) => p.key);
    expect(keys[0]).toBe("admin");
    expect(keys).toContain("watch");
    expect(keys.indexOf("watch")).toBe(keys.indexOf("library") + 1);
  });
});
