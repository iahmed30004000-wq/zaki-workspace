import { beforeEach, describe, expect, it } from "vitest";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as logoutEverywhere from "@/app/api/me/logout-everywhere/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as meRoute from "@/app/api/me/route";
import * as sessionsRoute from "@/app/api/me/sessions/route";
import * as sessionOne from "@/app/api/me/sessions/[id]/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { createSessionToken, verifySessionToken } from "@/server/session";
import { call, db, loginAs, logout, makeTeam, makeUser, TEST_PASSWORD } from "./helpers";
import { sessionClaims, sessionCookie, setMemberStatus, setSessionCookie } from "./login-helpers";

/**
 * C4.2 — «الجلسات»: a person's devices (`UserSession`). The cookie carries the id of its row; `currentUser()` refuses a revoked row at the NEXT request while the
 * person's other devices go on working; a cookie issued before the table existed (no session id) keeps working until it expires.
 * Everything is driven through the real routes (the sign-in route issues the cookies; a second device is a second cookie in the jar).
 */

beforeEach(() => logout());

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter = (ipCounter % 250) + 1)}`;

/**
 * Signs in through the real route from a "device" with this user agent; returns that device's cookie. A new device starts with an EMPTY jar (its own
 * browser); `sameBrowser` keeps what the jar holds, as a person signing in again in the browser they already used.
 */
async function signIn(email: string, userAgent: string | null = "TestBrowser/1.0 (Windows)", sameBrowser = false): Promise<string> {
  if (!sameBrowser) logout();
  const res = await call(loginRoute.POST, {
    method: "POST",
    body: { identifier: email, password: TEST_PASSWORD },
    headers: { "x-forwarded-for": freshIp(), ...(userAgent === null ? {} : { "user-agent": userAgent }) },
  });
  expect(res.status, "sign-in").toBe(200);
  return sessionCookie() as string;
}

/** Acts as the device that holds this cookie. */
const use = (cookie: string) => setSessionCookie(cookie);
const status = async (cookie: string, handler: unknown = meRoute.GET) => {
  use(cookie);
  return (await call(handler)).status;
};
const sidOf = async (cookie: string) => (await verifySessionToken(cookie))?.sid as string;
const versionOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } })).tokenVersion;
const endSession = (id: string) => call(sessionOne.DELETE, { method: "DELETE", params: { id } });

describe("sign-in creates the session row the cookie names", () => {
  it("the cookie carries a session id, the row belongs to the person and stores the user agent, and the answer is exactly what it was", async () => {
    const { member } = await makeTeam();
    const res = await call(loginRoute.POST, {
      method: "POST",
      body: { identifier: member.email, password: TEST_PASSWORD },
      headers: { "x-forwarded-for": freshIp(), "user-agent": "okhttp/4.12.0" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, next: "/" }); // the android app reads exactly this
    const claims = await sessionClaims();
    expect(claims?.userId).toBe(member.id);
    expect(claims?.sid).toBeTruthy();
    const row = await db.userSession.findUniqueOrThrow({ where: { id: claims?.sid as string } });
    expect(row.userId).toBe(member.id);
    expect(row.revokedAt).toBeNull();
    expect(row.userAgent).toBe("okhttp/4.12.0");
    expect(row.tokenVersion).toBe(await versionOf(member.id));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await call(meRoute.GET)).status).toBe(200);
  });

  it("the user agent is stored trimmed: whitespace collapsed, control characters dropped, 200 characters at most; none at all is null", async () => {
    const { member } = await makeTeam();
    const noisy = `   Mozilla/5.0\t (X11;\tLinux)  ${"x".repeat(400)}   `;
    const cookie = await signIn(member.email, noisy);
    const stored = (await db.userSession.findUniqueOrThrow({ where: { id: await sidOf(cookie) } })).userAgent as string;
    expect(stored.length).toBeLessThanOrEqual(200);
    expect(stored.startsWith("Mozilla/5.0 (X11; Linux) xxx")).toBe(true);
    expect(stored).not.toMatch(/[\r\n\t]/);
    const bare = await signIn(member.email, null);
    expect((await db.userSession.findUniqueOrThrow({ where: { id: await sidOf(bare) } })).userAgent).toBeNull();
  });

  it("signing in again from the same browser replaces its session: one device in the list, and the old cookie stops working", async () => {
    const { member } = await makeTeam();
    const first = await signIn(member.email);
    const second = await signIn(member.email, "TestBrowser/1.0 (Windows)", true); // the jar still holds `first`
    expect(await sidOf(second)).not.toBe(await sidOf(first));
    expect(await status(first)).toBe(401);
    expect(await status(second)).toBe(200);
  });

  it("a wrong password creates no session", async () => {
    const { member } = await makeTeam();
    const before = await db.userSession.count({ where: { userId: member.id } });
    const res = await call(loginRoute.POST, { method: "POST", body: { identifier: member.email, password: "wrong-pass-1" }, headers: { "x-forwarded-for": freshIp() } });
    expect(res.status).toBe(401);
    expect(await db.userSession.count({ where: { userId: member.id } })).toBe(before);
  });
});

describe("«اطلع من هالجهاز»: a revoked session gets 401 on its NEXT request, the others keep working", () => {
  it("ending the phone from the laptop: the phone is refused at once, the laptop and a third device are untouched, and the person's version does not move", async () => {
    const { member } = await makeTeam();
    const laptop = await signIn(member.email, "Laptop/1");
    const phone = await signIn(member.email, "Phone/1");
    const tablet = await signIn(member.email, "Tablet/1");
    expect(await status(phone)).toBe(200); // the phone works until it is ended
    const versionBefore = await versionOf(member.id);

    use(laptop);
    const res = await endSession(await sidOf(phone));
    expect(res.status).toBe(200);
    expect(sessionCookie(), "ending ANOTHER device keeps this one's cookie").toBe(laptop);

    expect(await status(phone), "the ended device").toBe(401);
    expect(await status(phone, workspacesRoute.GET), "the ended device, another route").toBe(401);
    expect(await status(laptop)).toBe(200);
    expect(await status(tablet)).toBe(200);
    expect(await status(tablet, workspacesRoute.GET)).toBe(200);
    expect(await versionOf(member.id)).toBe(versionBefore);
    expect(await db.userSession.count({ where: { userId: member.id, revokedAt: { not: null } } })).toBe(1);
  });

  it("ending THIS device is a sign-out: its cookie is cleared and a copy of it is refused", async () => {
    const { member } = await makeTeam();
    const here = await signIn(member.email);
    const other = await signIn(member.email, "Other/1");
    use(here);
    expect((await endSession(await sidOf(here))).status).toBe(200);
    expect(sessionCookie()).toBeUndefined();
    expect(await status(here)).toBe(401);
    expect(await status(other)).toBe(200);
  });

  it("ending a session twice is harmless, one that does not exist is 404, and neither changes anything else", async () => {
    const { member } = await makeTeam();
    const a = await signIn(member.email);
    const b = await signIn(member.email, "B/1");
    use(a);
    const sidB = await sidOf(b);
    expect((await endSession(sidB)).status).toBe(200);
    expect((await endSession(sidB)).status, "already ended").toBe(200); // idempotent: the row is the person's own, and only one audit row is written
    expect((await endSession("does-not-exist-123")).status).toBe(404);
    expect(await status(a)).toBe(200);
    expect(await db.auditLog.count({ where: { action: "auth.session_revoked", actorId: member.id } })).toBe(1);
  });

  it("a cookie that names a session that is gone, or somebody else's session, is refused", async () => {
    const { member, admin } = await makeTeam();
    const mine = await signIn(member.email);
    const theirs = await signIn(admin.email, "Admin/1");
    const tv = await versionOf(member.id);
    // the session id of another person under this person's own signature
    expect(await status(await createSessionToken({ userId: member.id, tv, sid: await sidOf(theirs) }))).toBe(401);
    // a session id that was never a row
    expect(await status(await createSessionToken({ userId: member.id, tv, sid: "ghostsession123456" }))).toBe(401);
    expect(await status(mine)).toBe(200);
    expect(await status(theirs)).toBe(200);
  });

  it("a session row deleted behind the cookie (a restored database) refuses the cookie rather than honouring it", async () => {
    const { member } = await makeTeam();
    const cookie = await signIn(member.email);
    await db.userSession.delete({ where: { id: await sidOf(cookie) } });
    expect(await status(cookie)).toBe(401);
  });
});

describe("signing out of one browser ends its session (R11: a copied cookie no longer outlives the sign-out)", () => {
  it("a copy of the cookie stops working after POST /api/auth/logout; another device is untouched", async () => {
    const { member } = await makeTeam();
    const browser = await signIn(member.email, "Browser/1");
    const other = await signIn(member.email, "Other/1");
    use(browser);
    const copy = browser; // what a thief (or a second tab's jar) holds
    expect((await call(logoutRoute.POST, { method: "POST" })).status).toBe(200);
    expect(sessionCookie()).toBeUndefined();
    expect(await status(copy), "the copied cookie after sign-out").toBe(401);
    expect(await status(other)).toBe(200);
    const row = await db.userSession.findUniqueOrThrow({ where: { id: await sidOf(browser) } });
    expect(row.revokedAt).not.toBeNull();
  });

  it("a cookie of somebody else cannot end a session by signing out: only the row it names", async () => {
    const { member, admin } = await makeTeam();
    const mine = await signIn(member.email);
    const theirs = await signIn(admin.email, "Admin/1");
    use(mine);
    await call(logoutRoute.POST, { method: "POST" });
    expect(await status(theirs)).toBe(200);
  });
});

describe("a cookie issued BEFORE the table existed (no session id)", () => {
  it("keeps working: the deploy signs nobody out", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id); // tests/db/helpers.ts signs exactly the old shape: userId + tv, no sid
    expect((await sessionClaims())?.sid).toBeUndefined();
    expect((await call(meRoute.GET)).status).toBe(200);
    expect((await call(workspacesRoute.GET)).status).toBe(200);
    expect(await db.userSession.count({ where: { userId: member.id } }), "an ordinary request creates no row").toBe(0);
  });

  it("is migrated when its owner opens the list (and only then): it gets a row, the re-issued cookie names it, and it is listed as this device", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const old = sessionCookie() as string;
    const res = await call(sessionsRoute.GET, { headers: { "user-agent": "OldBrowser/9" } });
    expect(res.status).toBe(200);
    const claims = await sessionClaims();
    expect(claims?.sid).toBeTruthy();
    expect(sessionCookie()).not.toBe(old);
    const list = (res.json as { sessions: { id: string; current: boolean }[] }).sessions;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: claims?.sid, current: true });
    // the migrated session can now be ended from another device, and the old cookie is still honoured by its own (version-based) rules
    const row = await db.userSession.findUniqueOrThrow({ where: { id: claims?.sid as string } });
    expect(row.userAgent).toBe("OldBrowser/9");
    const migrated = sessionCookie() as string;
    const other = await signIn(member.email, "Other/1");
    use(other);
    expect((await endSession(claims?.sid as string)).status).toBe(200);
    expect(await status(migrated)).toBe(401);
    expect(await status(other)).toBe(200);
    expect(await status(old), "the pre-deploy cookie itself has no session to end: it lives until it expires or the version moves").toBe(200);
  });

  it("the version still ends it: «اطلع من كل الأجهزة» and a password change refuse it", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const old = sessionCookie() as string;
    await db.user.update({ where: { id: member.id }, data: { tokenVersion: { increment: 1 } } });
    expect(await status(old)).toBe(401);
  });

  it("accepting the notice or changing the password re-issues an old cookie OLD-SHAPED: the deploy changes nothing for it until it opens the list", async () => {
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { transparencyVersion: null, transparencyAcceptedAt: null } });
    await loginAs(member.id, { tp: true });
    const transparency = await import("@/app/api/me/transparency/route");
    expect((await call(transparency.POST, { body: { accept: true } })).status).toBe(200);
    expect((await sessionClaims())?.sid).toBeUndefined();
    expect((await call(meRoute.GET)).status).toBe(200);
    expect((await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: "Brand-new-pass9" } })).status).toBe(200);
    expect((await sessionClaims())?.sid).toBeUndefined();
    expect((await call(meRoute.GET)).status).toBe(200);
    expect(await db.userSession.count({ where: { userId: member.id } })).toBe(0);
  });
});

describe("«اطلع من كل الأجهزة» ends every session row and keeps its own rule", () => {
  it("every row of the person is revoked, the others' rows are not, and the caller's own push browsers and paired phones are deleted in the same commit", async () => {
    const { member, admin } = await makeTeam();
    const a = await signIn(member.email, "A/1");
    const b = await signIn(member.email, "B/1");
    const theirs = await signIn(admin.email, "Admin/1");
    await db.pushSubscription.create({ data: { userId: member.id, endpoint: `https://push.test.local/${member.id}/s`, p256dh: "p", auth: "a" } });
    await db.pushSubscription.create({ data: { userId: admin.id, endpoint: `https://push.test.local/${admin.id}/s`, p256dh: "p", auth: "a" } });
    await db.appDevice.create({ data: { userId: member.id, tokenHash: `hash-s-${member.id}`, name: "تلفوني" } });
    await db.appDevice.create({ data: { userId: admin.id, tokenHash: `hash-s-${admin.id}`, name: "تلفونه" } });
    use(a);
    expect((await call(logoutEverywhere.POST, { method: "POST" })).status).toBe(200);
    expect(await db.userSession.count({ where: { userId: member.id, revokedAt: null } })).toBe(0);
    expect(await db.userSession.count({ where: { userId: admin.id, revokedAt: null } })).toBe(1);
    expect(await db.pushSubscription.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.appDevice.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: admin.id } })).toBe(1);
    expect(await db.appDevice.count({ where: { userId: admin.id } })).toBe(1);
    expect(await status(a)).toBe(401);
    expect(await status(b)).toBe(401);
    expect(await status(theirs)).toBe(200);
  });

  it("ending ONE device leaves the person's push browsers and paired phones alone (only «كل الأجهزة» disconnects them)", async () => {
    const { member } = await makeTeam();
    const a = await signIn(member.email, "A/1");
    const b = await signIn(member.email, "B/1");
    await db.pushSubscription.create({ data: { userId: member.id, endpoint: `https://push.test.local/${member.id}/one`, p256dh: "p", auth: "a" } });
    await db.appDevice.create({ data: { userId: member.id, tokenHash: `hash-one-${member.id}`, name: "تلفوني" } });
    use(a);
    expect((await endSession(await sidOf(b))).status).toBe(200);
    expect(await db.pushSubscription.count({ where: { userId: member.id } })).toBe(1);
    expect(await db.appDevice.count({ where: { userId: member.id } })).toBe(1);
  });
});

describe("GET /api/me/sessions", () => {
  it("lists the person's live devices newest activity first, marks this one, and shows nothing secret", async () => {
    const { member, admin } = await makeTeam();
    const a = await signIn(member.email, "Laptop/1");
    const b = await signIn(member.email, "Phone/1");
    await signIn(admin.email, "Admin/1");
    await db.userSession.update({ where: { id: await sidOf(a) }, data: { lastSeenAt: new Date(Date.now() - 3 * 60_000) } }); // quieter than the phone, inside the throttle: this request does not rewrite it
    use(a);
    const res = await call(sessionsRoute.GET);
    expect(res.status).toBe(200);
    const list = (res.json as { sessions: { id: string; current: boolean; userAgent: string | null; lastSeenAt: string }[] }).sessions;
    expect(list.map((s) => s.userAgent)).toEqual(["Phone/1", "Laptop/1"]);
    expect(list.find((s) => s.userAgent === "Laptop/1")?.current).toBe(true);
    expect(list.find((s) => s.userAgent === "Phone/1")?.current).toBe(false);
    // no token, hash or cookie anywhere in the answer
    expect(res.text).not.toContain(a);
    expect(res.text).not.toContain(b);
    expect(Object.keys(list[0] as object).sort()).toEqual(["createdAt", "current", "id", "lastSeenAt", "userAgent"]);
  });

  it("does not list an ended session, an expired one, or one issued before the last password change / «كل الأجهزة»", async () => {
    const { member } = await makeTeam();
    const keep = await signIn(member.email, "Keep/1");
    const ended = await signIn(member.email, "Ended/1");
    const expired = await signIn(member.email, "Expired/1");
    const old = await signIn(member.email, "Old/1");
    await db.userSession.update({ where: { id: await sidOf(ended) }, data: { revokedAt: new Date() } });
    await db.userSession.update({ where: { id: await sidOf(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await db.userSession.update({ where: { id: await sidOf(old) }, data: { tokenVersion: { decrement: 1 } } });
    use(keep);
    const list = ((await call(sessionsRoute.GET)).json as { sessions: { userAgent: string }[] }).sessions;
    expect(list.map((s) => s.userAgent)).toEqual(["Keep/1"]);
  });

  it("an anonymous caller is 401; a person still owing the onboarding is 403", async () => {
    expect((await call(sessionsRoute.GET)).status).toBe(401);
    const { member } = await makeTeam();
    await db.user.update({ where: { id: member.id }, data: { mustChangePassword: true } });
    await loginAs(member.id, { mcp: true });
    expect((await call(sessionsRoute.GET)).status).toBe(403);
  });
});

describe("who may list and end whose sessions", () => {
  it("a person can only end their own: somebody else's id is 404 and the row is untouched", async () => {
    const { member, admin } = await makeTeam();
    const theirs = await signIn(admin.email, "Admin/1");
    const mine = await signIn(member.email);
    use(mine);
    const res = await endSession(await sidOf(theirs));
    expect(res.status).toBe(404);
    expect((await db.userSession.findUniqueOrThrow({ where: { id: await sidOf(theirs) } })).revokedAt).toBeNull();
    expect(await status(theirs)).toBe(200);
    // the answer is the same as for an id that does not exist
    expect((await endSession("does-not-exist-123")).json).toEqual(res.json);
  });

  it("nobody can read another person's list: ?user= names a colleague who is still active, an admin asking, a member asking: all 404", async () => {
    const { owner, admin, member } = await makeTeam();
    const theirs = await signIn(member.email, "Member/1");
    expect(theirs).toBeTruthy();
    for (const asker of [owner, admin]) {
      await loginAs(asker.id);
      const res = await call(sessionsRoute.GET, { url: `http://localhost/api/me/sessions?user=${member.id}` });
      expect(res.status, asker.name).toBe(404);
      expect(res.text).not.toContain("Member/1");
    }
    const { member: stranger } = await makeTeam();
    await loginAs(stranger.id);
    expect((await call(sessionsRoute.GET, { url: `http://localhost/api/me/sessions?user=${member.id}` })).status).toBe(404);
  });

  it("the OWNER may list and end the sessions of somebody who was OFFBOARDED, and only of them", async () => {
    const { owner, admin, member } = await makeTeam();
    const phone = await signIn(member.email, "Phone/1");
    await setMemberStatus(member.id, "OFFBOARDED");
    await db.user.update({ where: { id: member.id }, data: { tokenVersion: { increment: 1 } } }); // what offboarding does
    // the offboarded person's own cookie is already refused
    expect(await status(phone)).toBe(401);
    // the owner sees what was never ended
    await loginAs(owner.id);
    const res = await call(sessionsRoute.GET, { url: `http://localhost/api/me/sessions?user=${member.id}` });
    expect(res.status).toBe(200);
    const list = (res.json as { sessions: { id: string; current: boolean }[] }).sessions;
    expect(list).toHaveLength(1);
    expect(list[0]?.current).toBe(false);
    // an admin does not
    await loginAs(admin.id);
    expect((await call(sessionsRoute.GET, { url: `http://localhost/api/me/sessions?user=${member.id}` })).status).toBe(404);
    expect((await endSession(list[0]?.id as string)).status).toBe(404);
    expect((await db.userSession.findUniqueOrThrow({ where: { id: list[0]?.id as string } })).revokedAt).toBeNull();
    // the owner ends it
    await loginAs(owner.id);
    expect((await endSession(list[0]?.id as string)).status).toBe(200);
    expect((await db.userSession.findUniqueOrThrow({ where: { id: list[0]?.id as string } })).revokedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "auth.session_revoked", actorId: owner.id, target: member.id } })).toBe(1);
    // the owner's own cookie is untouched
    expect((await call(meRoute.GET)).status).toBe(200);
  });

  it("the owner of ANOTHER company cannot reach an offboarded person's sessions", async () => {
    const { member } = await makeTeam();
    const phone = await signIn(member.email, "Phone/1");
    expect(phone).toBeTruthy();
    await setMemberStatus(member.id, "OFFBOARDED");
    const { owner: foreignOwner } = await makeTeam();
    await loginAs(foreignOwner.id);
    expect((await call(sessionsRoute.GET, { url: `http://localhost/api/me/sessions?user=${member.id}` })).status).toBe(404);
  });

  it("an offboarded person who is still ACTIVE in another company is not the owner's to manage", async () => {
    const { org, owner } = await makeTeam();
    const other = await makeUser({ orgId: (await makeTeam()).org.id, role: "MEMBER" });
    await db.organizationMember.create({ data: { organizationId: org.id, userId: other.id, role: "MEMBER", status: "OFFBOARDED" } });
    await loginAs(owner.id);
    expect((await call(sessionsRoute.GET, { url: `http://localhost/api/me/sessions?user=${other.id}` })).status).toBe(404);
  });
});

describe("a password change keeps this device and ends the others", () => {
  it("this device stays signed in under the same session; the others are refused and no longer listed", async () => {
    const { member } = await makeTeam();
    const here = await signIn(member.email, "Here/1");
    const other = await signIn(member.email, "Other/1");
    use(here);
    const before = await sidOf(here);
    const res = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: "Brand-new-pass9" } });
    expect(res.status).toBe(200);
    expect((await sessionClaims())?.sid, "the same session").toBe(before);
    expect((await call(meRoute.GET)).status).toBe(200);
    const refreshed = sessionCookie() as string;
    expect(await status(other)).toBe(401);
    use(refreshed);
    const list = ((await call(sessionsRoute.GET)).json as { sessions: { id: string; current: boolean }[] }).sessions;
    expect(list.map((s) => s.id)).toEqual([before]);
    expect(list[0]?.current).toBe(true);
  });
});

describe("last-seen is throttled", () => {
  it("a fresh session is not written again by the requests that follow; a stale one is written once and then left alone", async () => {
    const { member } = await makeTeam();
    const cookie = await signIn(member.email);
    const sid = await sidOf(cookie);
    const seen = async () => (await db.userSession.findUniqueOrThrow({ where: { id: sid }, select: { lastSeenAt: true } })).lastSeenAt.getTime();
    const first = await seen();
    use(cookie);
    for (let i = 0; i < 6; i++) expect((await call(meRoute.GET)).status).toBe(200);
    expect(await seen(), "six requests right after sign-in wrote last-seen").toBe(first);

    const stale = new Date(Date.now() - 20 * 60_000);
    await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: stale } });
    expect((await call(meRoute.GET)).status).toBe(200);
    const written = await seen();
    expect(written).toBeGreaterThan(stale.getTime() + 10 * 60_000);
    for (let i = 0; i < 6; i++) await call(meRoute.GET);
    expect(await seen(), "the requests after the write wrote again").toBe(written);
  });

  it("a revoked session is never written to by a request (and is refused)", async () => {
    const { member } = await makeTeam();
    const cookie = await signIn(member.email);
    const sid = await sidOf(cookie);
    const stale = new Date(Date.now() - 20 * 60_000);
    await db.userSession.update({ where: { id: sid }, data: { lastSeenAt: stale, revokedAt: new Date() } });
    expect(await status(cookie)).toBe(401);
    expect((await db.userSession.findUniqueOrThrow({ where: { id: sid } })).lastSeenAt.getTime()).toBe(stale.getTime());
  });
});
