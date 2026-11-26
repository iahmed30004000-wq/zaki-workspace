/**
 * S5.5 follow-up — «إشارة التوثيق» on the REAL feeds of the people lists (not a hand-made DTO):
 *
 *  - the people dock's roster (`presenceRoster` and `GET /api/presence`), the people picker and the quick chat (`chatDirectory`, `companyDirectory`, `GET /api/chat/directory`),
 *    the staff directory page (`staffDirectory`) and the owner's roster (`GET /api/organizations/[id]/members`) each carry `verified: true` for a verified colleague;
 *  - the others carry no such key at all (never `false`), a GUEST viewer is sent nothing, and the switch `verifiedBadge` off sends it to nobody (the grants stay stored);
 *  - the time of the grant never travels.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as presenceRoute from "@/app/api/presence/route";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import { chatDirectory, companyDirectory, staffDirectory } from "@/server/chat/directory";
import { presenceRoster } from "@/server/services/presence-roster";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  resetPresenceForTests();
  const t = await makeTeam();
  const orgId = t.org.id;
  const star = await makeUser({ orgId, role: "MEMBER", name: "Star" });
  const plain = await makeUser({ orgId, role: "MEMBER", name: "Plain" });
  const gone = await makeUser({ orgId, role: "MEMBER", name: "Gone" });
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: star.id }, { userId: plain.id }, { userId: t.admin.id, role: "ADMIN" }], "Space");
  const now = new Date();
  await db.organizationMember.updateMany({ where: { organizationId: orgId, userId: { in: [star.id, t.admin.id] } }, data: { verifiedAt: now } });
  // a suspended person keeps the stored grant but is nobody's colleague now; a guest's stale grant must never show either
  await db.organizationMember.updateMany({ where: { organizationId: orgId, userId: gone.id }, data: { verifiedAt: now, status: "SUSPENDED" } });
  await db.organizationMember.updateMany({ where: { organizationId: orgId, userId: t.guest.id }, data: { verifiedAt: now } });
  return { ...t, orgId, star, plain, gone, space };
}
type World = Awaited<ReturnType<typeof world>>;
let w: World;
beforeAll(async () => {
  w = await world();
});

const setSwitch = (on: boolean) => db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { verifiedBadge: on } } } });
async function withSwitchOff<T>(run: () => Promise<T>): Promise<T> {
  await setSwitch(false);
  try {
    return await run();
  } finally {
    await setSwitch(true);
  }
}
type Row = { userId?: string; id?: string; verified?: boolean };
const idOf = (r: Row) => (r.userId ?? r.id)!;
const verifiedIds = (rows: Row[]) => rows.filter((r) => r.verified === true).map(idOf).sort();
const noKey = (rows: Row[]) => rows.every((r) => !("verified" in r));

describe("the people dock's roster", () => {
  it("carries `verified: true` for the verified staff, no key for the others, and never the time", async () => {
    await loginAs(w.member.id);
    const res = await call(presenceRoute.GET);
    expect(res.status).toBe(200);
    const people = res.json?.["people"] as Row[];
    expect(verifiedIds(people)).toEqual([w.star.id, w.admin.id].sort());
    expect(people.find((p) => p.userId === w.plain.id)).not.toHaveProperty("verified");
    // the suspended person and the guest are not on the roster, with or without a stored grant
    expect(people.some((p) => [w.gone.id, w.guest.id].includes(idOf(p)))).toBe(false);
    expect(res.text).not.toContain("verifiedAt");
  });

  it("a GUEST viewer is sent nothing (the badge is not a way to read ranks), even straight from the service", async () => {
    const roster = await presenceRoster(w.orgId, w.guest.id);
    expect(roster.people.length).toBeGreaterThan(0);
    expect(noKey(roster.people)).toBe(true);
    expect(JSON.stringify(roster)).not.toContain("verified");
  });

  it("the switch off: nobody carries it; the grants stay stored and the marks come back with the switch", async () => {
    await withSwitchOff(async () => {
      await loginAs(w.member.id);
      const res = await call(presenceRoute.GET);
      expect(noKey(res.json?.["people"] as Row[])).toBe(true);
      expect(await db.organizationMember.count({ where: { organizationId: w.orgId, userId: w.star.id, verifiedAt: { not: null } } })).toBe(1);
    });
    const back = await presenceRoster(w.orgId, w.member.id);
    expect(verifiedIds(back.people)).toEqual([w.star.id, w.admin.id].sort());
  });
});

describe("the people picker and the quick chat", () => {
  it("`chatDirectory` and `companyDirectory` carry `verified: true` for staff viewers only, and the route passes it on", async () => {
    const picker = await chatDirectory(w.orgId, undefined, w.member.id, "MEMBER");
    expect(verifiedIds(picker)).toEqual([w.star.id, w.admin.id].sort());
    expect(picker.find((p) => p.userId === w.plain.id)).not.toHaveProperty("verified");
    const company = await companyDirectory(w.orgId, w.member.id, w.space.id);
    expect(verifiedIds(company)).toEqual([w.star.id, w.admin.id].sort());
    expect(company.find((p) => p.userId === w.plain.id)).not.toHaveProperty("verified");

    await loginAs(w.member.id);
    const space = await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory" });
    expect(space.status).toBe(200);
    const inSpace = space.json?.["people"] as (Row & { user: { id: string } })[];
    expect(verifiedIds(inSpace.map((p) => ({ ...p, userId: p.userId })))).toContain(w.star.id);
    const all = await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory?scope=company" });
    const everyone = all.json?.["people"] as Row[];
    expect(verifiedIds(everyone)).toEqual([w.star.id, w.admin.id].sort());
    expect(all.text).not.toContain("verifiedAt");
  });

  it("a GUEST viewer is sent nothing; an unknown viewer is sent nothing", async () => {
    expect(noKey(await chatDirectory(w.orgId, undefined, w.guest.id, "GUEST"))).toBe(true);
    expect(noKey(await chatDirectory(w.orgId, undefined))).toBe(true);
    expect(noKey(await companyDirectory(w.orgId, w.guest.id, null))).toBe(true);
  });

  it("the switch off: nobody carries it", async () => {
    await withSwitchOff(async () => {
      expect(noKey(await chatDirectory(w.orgId, undefined, w.member.id, "MEMBER"))).toBe(true);
      expect(noKey(await companyDirectory(w.orgId, w.member.id, w.space.id))).toBe(true);
      await loginAs(w.member.id);
      const all = await call(directoryRoute.GET, { url: "http://localhost/api/chat/directory?scope=company" });
      expect(all.text).not.toContain("verified");
    });
  });
});

describe("the staff directory page", () => {
  it("`staffDirectory` marks the verified ACTIVE staff for a staff viewer, nothing for a guest, nothing while the switch is off", async () => {
    const rows = await staffDirectory(w.orgId, "MEMBER", w.member.id);
    expect(verifiedIds(rows)).toEqual([w.star.id, w.admin.id].sort());
    expect(rows.find((p) => p.id === w.plain.id)).not.toHaveProperty("verified");
    // ACTIVE only: the suspended person is not there; the same list as before for everything else
    expect(rows.some((p) => p.id === w.gone.id)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("verifiedAt");
    expect(noKey(await staffDirectory(w.orgId, "GUEST", w.member.id))).toBe(true);
    await withSwitchOff(async () => expect(noKey(await staffDirectory(w.orgId, "MEMBER", w.member.id))).toBe(true));
  });
});

describe("the owner's roster", () => {
  it("`GET /members` carries `verified: true` for the verified and no key for the rest, and drops it while the switch is off", async () => {
    await loginAs(w.owner.id);
    const url = `http://localhost/api/organizations/${w.orgId}/members`;
    const on = await call(membersRoute.GET, { url, params: { id: w.orgId } });
    const rows = on.json?.["members"] as Row[];
    expect(verifiedIds(rows)).toEqual([w.star.id, w.admin.id].sort());
    expect(rows.find((r) => r.id === w.plain.id)).not.toHaveProperty("verified");
    // a suspended person's grant is kept but draws no mark; a guest's stale grant is never shown
    expect(rows.find((r) => r.id === w.gone.id)).not.toHaveProperty("verified");
    expect(rows.find((r) => r.id === w.guest.id)).not.toHaveProperty("verified");
    expect(on.text).not.toContain("verifiedAt");
    await withSwitchOff(async () => {
      await loginAs(w.owner.id);
      const off = await call(membersRoute.GET, { url, params: { id: w.orgId } });
      expect(noKey(off.json?.["members"] as Row[])).toBe(true);
    });
  });
});
