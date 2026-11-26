import { describe, expect, it } from "vitest";
import { GET as overviewGET } from "@/app/api/spaces/overview/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * The phone's door to «كل المساحات» (M2 N6 batch 10): `GET /api/spaces/overview` answers what the page draws (`spacesScreenFor`): a card
 * per space with numbers only, the space the person is in, the archived spaces they may bring back. The owner and the admins; a member and
 * a partner get «not found».
 */

const overview = () => call(overviewGET, { url: "http://localhost/api/spaces/overview" });
type A = { cards: { id: string; name: string; members: number; open: number; overdue: number; unread: number }[]; hereId: string | null; archived: { id: string }[] };

describe("GET /api/spaces/overview", () => {
  it("the owner reads every space as numbers, and the archived ones apart", async () => {
    const t = await makeTeam();
    const live = await makeWorkspace(t.org.id, [{ userId: t.owner.id }]);
    const old = await makeWorkspace(t.org.id, [{ userId: t.owner.id }]);
    await db.workspace.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
    await loginAs(t.owner.id);
    const r = await overview();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const a = r.json as A;
    expect(a.cards.map((c) => c.id)).toContain(live.id);
    expect(a.cards.map((c) => c.id)).not.toContain(old.id);
    expect(a.archived.map((s) => s.id)).toContain(old.id);
    for (const c of a.cards) for (const n of [c.members, c.open, c.overdue, c.unread]) expect(typeof n).toBe("number");
    // numbers only: nothing of a space's work travels in a card
    expect(Object.keys(a.cards[0]!).sort()).toEqual(["emoji", "id", "kind", "members", "name", "open", "overdue", "unread"]);
  });

  it("an admin reads it; a member and a partner get «not found»", async () => {
    const t = await makeTeam();
    await loginAs(t.admin.id);
    expect((await overview()).status).toBe(200);
    for (const who of [t.member, t.guest]) {
      await loginAs(who.id);
      expect((await overview()).status, who.name).toBe(404);
    }
  });
});
