/**
 * The sign-in name: the suggestion's door (who may ask, and that it is free) and a person changing their own name (current password, the rule, free in any
 * letter case, not a bot's ending; the audit keeps both names; sessions stay).
 */
import { describe, expect, it } from "vitest";
import * as suggestRoute from "@/app/api/organizations/[id]/members/suggest-username/route";
import * as usernameRoute from "@/app/api/me/username/route";
import { call, db, loginAs, makeTeam, makeUser, TEST_PASSWORD, uid } from "./helpers";

const ask = async (userId: string, orgId: string, name: string) => {
  await loginAs(userId);
  const res = await call(suggestRoute.GET, { url: `http://localhost/api/organizations/${orgId}/members/suggest-username?name=${encodeURIComponent(name)}`, params: { id: orgId } });
  return { status: res.status, username: res.json?.["username"] as string | undefined };
};
const change = async (userId: string, body: Record<string, unknown>) => {
  await loginAs(userId);
  return call(usernameRoute.PATCH, { method: "PATCH", body });
};

describe("the suggested name", () => {
  it("is made from the name and is one nobody has, whatever the letter case", async () => {
    const t = await makeTeam();
    const first = await ask(t.owner.id, t.org.id, "مهند زياد");
    expect(first).toEqual({ status: 200, username: "mohannad.ziad" });
    await makeUser({ username: "Mohannad.Ziad" });
    await makeUser({ username: "mohannad.ziad2" });
    expect((await ask(t.owner.id, t.org.id, "مهند زياد")).username).toBe("mohannad.ziad3");
  });

  it("is answered only to somebody who may add people in this company", async () => {
    const t = await makeTeam();
    const other = await makeTeam();
    expect((await ask(t.member.id, t.org.id, "سلمى")).status).toBe(403);
    expect((await ask(t.guest.id, t.org.id, "سلمى")).status).toBe(403);
    expect([403, 404]).toContain((await ask(other.owner.id, t.org.id, "سلمى")).status);
  });
});

describe("changing my own", () => {
  it("with the current password: stored in lower case, written to the audit with both names, and the session stays", async () => {
    const t = await makeTeam();
    const before = `old-${uid()}`;
    const me = await makeUser({ orgId: t.org.id, username: before });
    const next = `New.${uid()}`;
    const res = await change(me.id, { username: next, currentPassword: TEST_PASSWORD });
    expect(res.status, res.text).toBe(200);
    expect(res.json?.["username"]).toBe(next.toLowerCase());
    const row = await db.user.findUniqueOrThrow({ where: { id: me.id }, select: { username: true, tokenVersion: true } });
    expect(row).toEqual({ username: next.toLowerCase(), tokenVersion: me.tokenVersion });
    const log = await db.auditLog.findFirstOrThrow({ where: { actorId: me.id, action: "auth.username_changed" } });
    expect(JSON.stringify(log.meta)).toContain(before);
    expect(JSON.stringify(log.meta)).toContain(next.toLowerCase());
  });

  it("is refused with a wrong password, a name somebody has, a bot's ending or a name that breaks the rule; nothing changes", async () => {
    const t = await makeTeam();
    const mine = `mine-${uid()}`;
    const theirs = `theirs-${uid()}`;
    const me = await makeUser({ orgId: t.org.id, username: mine });
    await makeUser({ username: theirs });
    expect((await change(me.id, { username: `free-${uid()}`, currentPassword: "not-the-password-1" })).status).toBe(403);
    expect((await change(me.id, { username: theirs.toUpperCase(), currentPassword: TEST_PASSWORD })).status).toBe(409);
    expect((await change(me.id, { username: "helper_bot", currentPassword: TEST_PASSWORD })).status).toBe(409);
    expect((await change(me.id, { username: "ab", currentPassword: TEST_PASSWORD })).status).toBe(422);
    expect((await change(me.id, { username: "اسم", currentPassword: TEST_PASSWORD })).status).toBe(422);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id }, select: { username: true } })).username).toBe(mine);
  });
});
