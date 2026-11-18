import "./scoping-react";
import type { ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F1.1 + F1.2 (= C1.9): what ONE request asks the database, counted.
 *
 * Next hands a server render a request scope through React's `cache()`; under vitest there is none, so this file puts
 * the same thing in its place: a `cache()` whose memory lives until `newRequest()` is called, and whose key is the
 * IDENTITY of the arguments (exactly React's rule). Every `render` below is therefore "one request".
 *
 * The counts are Prisma calls recorded by a middleware (a call that starts before the previous one finished is the
 * same round trip). Only what the terminal shows is claimed: no browser, no timing.
 */

const scope = vi.hoisted(() => {
  interface Node {
    value?: { ok: true; v: unknown } | { ok: false; e: unknown };
    next: Map<unknown, Node>;
  }
  let current = new Map<object, Node>();
  return {
    newRequest(): void {
      current = new Map();
    },
    cache<F extends (...args: never[]) => unknown>(fn: F): F {
      return function cached(this: unknown, ...args: unknown[]) {
        let node: Node = current.get(fn) ?? { next: new Map() };
        current.set(fn, node);
        for (const a of args) {
          let child = node.next.get(a);
          if (!child) node.next.set(a, (child = { next: new Map() }));
          node = child;
        }
        if (!node.value) {
          try {
            node.value = { ok: true, v: fn.apply(this, args as never[]) };
          } catch (e) {
            node.value = { ok: false, e };
          }
        }
        if (!node.value.ok) throw node.value.e;
        return node.value.v;
      } as unknown as F;
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const base = ((actual as { default?: typeof actual }).default ?? actual) as typeof actual;
  return { ...base, default: { ...base, cache: scope.cache }, cache: scope.cache };
});

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/my-work",
  useSearchParams: () => new URLSearchParams(),
}));

import AppLayout from "@/app/(app)/layout";
import { pageActor } from "@/app/(app)/_access";
import { currentUser, pageUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn, isEconomyOn, isFeatureOn } from "@/server/services/features";
import { db, loginAs, logout, makeTeam } from "./helpers";

interface Call {
  what: string;
  start: number;
  end: number;
}
let calls: Call[] = [];
let recording = false;

beforeAll(() => {
  (db as unknown as { $use: (fn: (params: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(
    async (params, next) => {
      if (!recording) return next(params);
      const call: Call = { what: `${params.model ?? "raw"}.${params.action}`, start: performance.now(), end: 0 };
      calls.push(call);
      try {
        return await next(params);
      } finally {
        call.end = performance.now();
      }
    },
  );
});

beforeEach(() => {
  logout();
  scope.newRequest();
});

/** Runs `work` as ONE request and returns what it asked the database. */
async function request<T>(work: () => Promise<T>): Promise<{ result: T; calls: string[]; rounds: number }> {
  scope.newRequest();
  calls = [];
  recording = true;
  try {
    const result = await work();
    const sorted = [...calls].sort((a, b) => a.start - b.start);
    let rounds = 0;
    let until = -1;
    for (const c of sorted) {
      if (c.start >= until) rounds += 1;
      until = Math.max(until, c.end);
    }
    return { result, calls: sorted.map((c) => c.what), rounds };
  } finally {
    recording = false;
  }
}

const render = () => AppLayout({ children: null }) as Promise<ReactElement>;

describe("the (app) layout: how many database calls and round trips", () => {
  it("reads the person once and the company once; at most 3 round trips", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    const first = await request(render);
    console.info(`layout: ${first.calls.length} Prisma calls in ${first.rounds} round trips (${first.calls.join(", ")})`);
    const users = first.calls.filter((c) => c === "User.findUnique");
    // the person: once for the session (currentUser) and once for the picture and the menu order
    expect(users.length, first.calls.join(", ")).toBe(2);
    expect(first.calls.filter((c) => c === "OrganizationMember.findFirst").length, first.calls.join(", ")).toBe(1);
    expect(first.calls.filter((c) => c === "Organization.findUnique").length, first.calls.join(", ")).toBe(1);
    expect(first.rounds, `${first.calls.join(", ")} in ${first.rounds} round trips`).toBeLessThanOrEqual(3);
  });

  it("a page after the layout (pageActor, currentSpace, the switches) adds NO database call in the same request", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    const layoutOnly = await request(render);
    const withPage = await request(async () => {
      await render();
      const { actor } = await pageActor();
      await pageUser();
      await currentSpace(actor);
      await requireActor();
      for (const key of ["peopleDock", "quickChat", "siteGuide", "ownerAssistant", "themeSwitchFx"] as const) await isFeatureOn(actor.orgId, key);
      await actorFeatureOn(actor, "quickChat");
      await isEconomyOn(actor.orgId);
      return null;
    });
    expect(withPage.calls, "the page repeated what the layout already read").toEqual(layoutOnly.calls);
  });
});

describe("cache() is per request, never a memo of a user or of a permission", () => {
  it("currentUser / pageUser / requireActor answer from the database again in the NEXT request", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const a = await request(async () => {
      await currentUser();
      await currentUser();
      await pageUser();
      await requireActor();
      await requireActor({});
      await requireActor({ allowPending: false });
      return null;
    });
    expect(a.calls).toEqual(["User.findUnique", "OrganizationMember.findFirst"]);
    const b = await request(async () => {
      await currentUser();
      await requireActor();
      return null;
    });
    expect(b.calls).toEqual(["User.findUnique", "OrganizationMember.findFirst"]);
  });

  it("a session revoked between two requests is refused by the second one (no memo of the user)", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    expect((await request(() => currentUser())).result?.id).toBe(member.id);
    await db.user.update({ where: { id: member.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await request(() => currentUser())).result).toBeNull();
  });

  it("a rank changed between two requests is seen by the second one (no memo of a permission)", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    expect((await request(() => requireActor())).result.role).toBe("MEMBER");
    await db.organizationMember.updateMany({ where: { userId: member.id }, data: { role: "ADMIN" } });
    expect((await request(() => requireActor())).result.role).toBe("ADMIN");
    await db.organizationMember.updateMany({ where: { userId: member.id }, data: { status: "SUSPENDED" } });
    await expect(request(() => requireActor())).rejects.toThrow();
  });

  it("two different people in the same request never share an answer (the key is the person, not 'the actor')", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(owner.id);
    const spaces = await request(async () => {
      const a = await currentSpace({ userId: owner.id, orgId: org.id, role: "OWNER" });
      const b = await currentSpace({ userId: member.id, orgId: org.id, role: "MEMBER" });
      return { a, b };
    });
    // the owner sees every space of the company, the member only theirs: the two calls must have asked separately
    expect(spaces.calls.filter((c) => c === "Workspace.findMany").length).toBe(2);
  });

  it("the company's switches are read once per request, per company, and again in the next request", async () => {
    const { org, owner } = await makeTeam();
    const other = await makeTeam();
    await db.organization.update({ where: { id: other.org.id }, data: { settings: { features: { quickChat: false } } } });
    const one = await request(async () => {
      const keys = ["peopleDock", "quickChat", "siteGuide", "ownerAssistant", "themeSwitchFx", "quickChat", "peopleDock"] as const;
      const mine = await Promise.all(keys.map((k) => isFeatureOn(org.id, k)));
      const theirs = await isFeatureOn(other.org.id, "quickChat");
      await isEconomyOn(org.id);
      return { mine, theirs };
    });
    expect(one.calls.filter((c) => c === "Organization.findUnique").length).toBe(2);
    expect(one.result.theirs).toBe(false);
    await db.organization.update({ where: { id: org.id }, data: { settings: { features: { quickChat: false } } } });
    const next = await request(() => isFeatureOn(org.id, "quickChat"));
    expect(next.calls).toEqual(["Organization.findUnique"]);
    expect(next.result).toBe(false);
    void owner;
  });
});
