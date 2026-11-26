import { describe, expect, it } from "vitest";
import { GET as homeGET } from "@/app/api/watch/home/route";
import { startWatch } from "@/server/services/watch";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * The phone's «نتفرّج سوا» door (`GET /api/watch/home`, M2 N6 batch 6): the very `watchHome` the place's page reads. Proven against a
 * real database: the sessions of the person's space and who may be picked (never themselves, never a partner), «may start» only for a
 * person of the space holding `watch.edit`; a partner is refused, a switched-off feature is «not found», no `watch.view` is refused.
 */

type Home = { spaceId: string | null; sessions: { id: string; title: string; live: boolean }[]; candidates: { id: string; name: string }[]; canStart: boolean };

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.member.id, role: "MEMBER" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  const s = await startWatch({ orgId: t.org.id, orgRole: "ADMIN", userId: t.admin.id }, ws.id, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Together", memberIds: [], everyone: true });
  return { ...t, ws, s };
}

const home = async () => {
  const r = await call(homeGET);
  return { status: r.status, body: r.json as unknown as Home };
};

describe("GET /api/watch/home — «نتفرّج سوا» on the phone", () => {
  it("a member of the space reads its session, may start one, and is offered the staff of the space but not themselves nor the partner", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const { status, body } = await home();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.spaceId).toBe(w.ws.id);
    expect(body.sessions.map((s) => s.id)).toContain(w.s.id);
    expect(body.canStart).toBe(true);
    const ids = body.candidates.map((c) => c.id);
    expect(ids).toContain(w.admin.id);
    expect(ids).not.toContain(w.member.id);
    expect(ids).not.toContain(w.guest.id);
  });

  it("an external partner is refused", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    expect((await home()).status).toBe(403);
  });

  it("the feature switched off is «not found»", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { watch: false } } } });
    await loginAs(w.member.id);
    expect((await home()).status).toBe(404);
  });

  it("a person whose «نتفرّج سوا» row is off is refused, and without `watch.edit` may not start one", async () => {
    const w = await world();
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { revokedCapabilities: ["watch.view"] },
    });
    await loginAs(w.member.id);
    expect((await home()).status).toBe(403);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { revokedCapabilities: ["watch.edit"] },
    });
    const r = await home();
    expect(r.status).toBe(200);
    expect(r.body.canStart).toBe(false);
  });
});
