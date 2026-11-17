/**
 * F0.5 (server half) — «is the person looking at the app?» for the push. An open stream used to mean «online», so a person whose
 * only tab sat hidden in a background window swallowed every notification. Now a tab reports its visibility
 * (POST /api/rt/visibility) and the push is held back only for a person who has a VISIBLE tab; presence (the green dot) is unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as visibilityRoute from "@/app/api/rt/visibility/route";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { isViewing } from "@/server/realtime/viewing";
import { isOnline, resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
});

async function world() {
  const t = await makeTeam();
  const a = t.member;
  const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
  await makeWorkspace(t.org.id, [{ userId: a.id }, { userId: b.id }]);
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  return { t, a, b, dm };
}
const say = async (userId: string, dm: string, body: string) => {
  await loginAs(userId);
  expect((await call(messagesRoute.POST, { method: "POST", params: { id: dm }, body: { body } })).status).toBe(201);
};
const bells = (userId: string) => db.notification.count({ where: { userId, type: "chat_message" } });
const report = async (userId: string, visible: boolean, tab?: string) => {
  await loginAs(userId);
  return call(visibilityRoute.POST, { method: "POST", body: { visible, ...(tab ? { tab } : {}) } });
};

describe("a hidden tab does not swallow the push", () => {
  it("a person with a visible tab gets no push for a plain message; once the tab reports hidden, the next one reaches them", async () => {
    const w = await world();
    addClient({ userId: w.b.id, orgId: w.t.org.id, tabId: "tab-1", send: () => undefined, close: () => undefined });
    touchPresence(w.b.id, undefined, w.t.org.id);
    await say(w.a.id, w.dm, "واحد");
    expect(await bells(w.b.id)).toBe(0);

    expect((await report(w.b.id, false, "tab-1")).status).toBe(204);
    expect(await isOnline(w.b.id)).toBe(true); // the green dot is unchanged: an open stream is still presence
    expect(await isViewing(w.b.id)).toBe(false);
    await say(w.a.id, w.dm, "اتنين");
    expect(await bells(w.b.id)).toBe(1);

    expect((await report(w.b.id, true, "tab-1")).status).toBe(204);
    expect(await isViewing(w.b.id)).toBe(true);
  });

  it("with two tabs, one visible is enough", async () => {
    const w = await world();
    addClient({ userId: w.b.id, orgId: w.t.org.id, tabId: "tab-1", send: () => undefined, close: () => undefined });
    addClient({ userId: w.b.id, orgId: w.t.org.id, tabId: "tab-2", send: () => undefined, close: () => undefined });
    touchPresence(w.b.id, undefined, w.t.org.id);
    await report(w.b.id, false, "tab-1");
    expect(await isViewing(w.b.id)).toBe(true);
    await report(w.b.id, false, "tab-2");
    expect(await isViewing(w.b.id)).toBe(false);
  });

  it("a «visible» report older than 60 s with nothing to renew it does not count", async () => {
    const w = await world();
    addClient({ userId: w.b.id, orgId: w.t.org.id, tabId: "tab-1", send: () => undefined, close: () => undefined });
    touchPresence(w.b.id, undefined, w.t.org.id);
    expect(await isViewing(w.b.id, Date.now() + 30_000)).toBe(true);
    expect(await isViewing(w.b.id, Date.now() + 61_000)).toBe(false);
  });

  it("a person with no stream at all is not viewing", async () => {
    const w = await world();
    expect(await isViewing(w.b.id)).toBe(false);
  });
});

describe("POST /api/rt/visibility", () => {
  it("needs a session, takes only a boolean, and writes nothing to the database", async () => {
    const w = await world();
    const before = await db.auditLog.count();
    expect((await report(w.b.id, true)).status).toBe(204);
    expect((await call(visibilityRoute.POST, { method: "POST", body: { visible: "yes" } })).status).toBe(422);
    expect(await db.auditLog.count()).toBe(before);
    const { logout } = await import("./helpers");
    logout();
    expect([401, 403]).toContain((await call(visibilityRoute.POST, { method: "POST", body: { visible: true } })).status);
  });
});
