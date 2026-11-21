import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A session revocation that lands WHILE a request is being served must not be "laundered" into a
 * fresh cookie (found by independent review A).
 *
 * `requireUser()` checks the cookie's `tv` against the database when a request starts; routes that
 * re-issue the cookie (`startSession`) sign THAT version (`CurrentUser.tv`), never a fresh read. A
 * revocation in between ("log out everywhere", a password reset, the victim's own password change)
 * therefore leaves the in-flight request's new cookie already dead.
 *
 * POST /api/me/transparency is the cheapest carrier (allowed while pending, idempotent, no bcrypt).
 * The revocation is injected between the two steps by wrapping `acceptTransparency` (which the route
 * calls after requireUser and before startSession); the revocations use the real routes.
 */

const hooks = vi.hoisted(() => ({ midRequest: null as null | (() => Promise<void>) }));

vi.mock("@/server/services/onboarding", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/onboarding")>();
  return {
    ...real,
    acceptTransparency: async (userId: string) => {
      const hook = hooks.midRequest;
      hooks.midRequest = null;
      if (hook) await hook();
      return real.acceptTransparency(userId);
    },
  };
});

import * as transparencyRoute from "@/app/api/me/transparency/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as meRoute from "@/app/api/me/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import * as memberLogoutRoute from "@/app/api/organizations/[id]/members/[userId]/logout/route";
import * as memberPasswordRoute from "@/app/api/organizations/[id]/members/[userId]/password/route";
import * as sessionOne from "@/app/api/me/sessions/[id]/route";
import { createSessionToken } from "@/server/session";
import { call, db, loginAs, logout, makeTeam, makeWorkspace, TEST_PASSWORD } from "./helpers";
import { sessionClaims, sessionCookie, setSessionCookie } from "./login-helpers";

beforeEach(() => {
  hooks.midRequest = null;
  logout();
});
afterEach(() => {
  hooks.midRequest = null;
});

async function tokenVersionOf(userId: string): Promise<number> {
  return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } })).tokenVersion;
}

describe("a revocation during an in-flight request is not laundered into a fresh cookie", () => {
  it("'log out everywhere' by the owner while a stolen cookie has a request in flight ends that session", async () => {
    const { org, owner, member } = await makeTeam();
    await makeWorkspace(org.id, [{ userId: member.id }]);
    await loginAs(member.id);
    const stolen = sessionCookie() as string;
    const tvBefore = await tokenVersionOf(member.id);

    hooks.midRequest = async () => {
      await loginAs(owner.id);
      const res = await call(memberLogoutRoute.POST, { method: "POST", params: { id: org.id, userId: member.id } });
      expect(res.status).toBe(200);
      setSessionCookie(stolen);
    };
    await call(transparencyRoute.POST, { body: { accept: true } });

    expect(await tokenVersionOf(member.id)).toBe(tvBefore + 1); // the revocation did happen
    expect((await call(meRoute.GET)).status, "the thief survived 'log out everywhere'").toBe(401);
    expect((await call(workspacesRoute.GET)).status).toBe(401);
    expect((await sessionClaims())?.tv).not.toBe(tvBefore + 1);
  });

  it("changing one's own password ends a stolen session even if the thief has a request in flight", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const stolen = sessionCookie() as string; // the victim's browser and the thief hold the same token

    hooks.midRequest = async () => {
      setSessionCookie(stolen);
      const res = await call(passwordRoute.POST, {
        body: { currentPassword: TEST_PASSWORD, newPassword: "Victim-new-pass9" },
      });
      expect(res.status).toBe(200); // the victim now holds a fresh cookie; every other one is dead
    };
    setSessionCookie(stolen);
    await call(transparencyRoute.POST, { body: { accept: true } });

    expect((await call(meRoute.GET)).status, "the thief survived the victim's password change").toBe(401);
  });

  it("a password reset by the owner ends a stolen session even if the thief has a request in flight", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(member.id);
    const stolen = sessionCookie() as string;

    hooks.midRequest = async () => {
      await loginAs(owner.id);
      const res = await call(memberPasswordRoute.POST, { method: "POST", params: { id: org.id, userId: member.id } });
      expect(res.status).toBe(200);
      setSessionCookie(stolen);
    };
    await call(transparencyRoute.POST, { body: { accept: true } });

    expect((await call(meRoute.GET)).status, "the thief kept a session through the reset").toBe(401);
  });
});

describe("ending ONE device (C4.2) is not laundered either", () => {
  it("«اطلع من هالجهاز» landing while that device has a request in flight leaves the cookie the request re-issues already dead; the person's other device is untouched", async () => {
    const { member } = await makeTeam();
    const tv = await tokenVersionOf(member.id);
    const expiresAt = new Date(Date.now() + 3600_000);
    const a = await db.userSession.create({ data: { userId: member.id, tokenVersion: tv, expiresAt } });
    const b = await db.userSession.create({ data: { userId: member.id, tokenVersion: tv, expiresAt } });
    const cookieA = await createSessionToken({ userId: member.id, tv, sid: a.id });
    const cookieB = await createSessionToken({ userId: member.id, tv, sid: b.id });

    hooks.midRequest = async () => {
      setSessionCookie(cookieB); // the other device ends this one while its request is being served
      const res = await call(sessionOne.DELETE, { method: "DELETE", params: { id: a.id } });
      expect(res.status).toBe(200);
      setSessionCookie(cookieA);
    };
    setSessionCookie(cookieA);
    await call(transparencyRoute.POST, { body: { accept: true } });

    expect((await sessionClaims())?.sid, "the re-issued cookie still names the ended session").toBe(a.id);
    expect((await call(meRoute.GET)).status, "the ended device survived").toBe(401);
    setSessionCookie(cookieB);
    expect((await call(meRoute.GET)).status).toBe(200);
    expect((await db.userSession.findUniqueOrThrow({ where: { id: a.id } })).revokedAt).not.toBeNull();
    expect((await db.userSession.findUniqueOrThrow({ where: { id: b.id } })).revokedAt).toBeNull();
  });
});
