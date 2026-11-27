import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { GET as factsGET } from "@/app/api/desks/facts/route";
import { GET as routinesGET } from "@/app/api/daily-routines/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * «روتين المهام» on the phone (M2 N6 batch 11): the app draws the tab only where the site draws the page — the company's «مهمة
 * متكررة» switch on, not a partner, the tasks section readable (`DeskFacts.routines`, the page's own three checks) — and its form
 * starts «لازم تخلص قبل» on the company's usual due hour, read from the same answer the page reads (`GET /api/daily-routines`).
 */

async function setSettings(orgId: string, change: (s: unknown) => unknown) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: change(org.settings) as Prisma.InputJsonValue } });
}
const routinesOn = (orgId: string, on: boolean) => setSettings(orgId, (s) => withFeature(s, "recurringTasks", on));

const facts = async () => {
  const r = await call(factsGET);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as unknown as { routines: boolean };
};

describe("«روتين المهام» on the phone", () => {
  it("the facts say the tab exists exactly where the page exists", async () => {
    const t = await makeTeam();
    await routinesOn(t.org.id, true);
    await loginAs(t.member.id);
    expect((await facts()).routines).toBe(true);
    // a partner gets the guest notice on the site: no tab
    await loginAs(t.guest.id);
    expect((await facts()).routines).toBe(false);
    // the owner took the tasks section away from this person: the page says «section off»
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } },
      data: { revokedCapabilities: ["tasks.view"] },
    });
    await loginAs(t.member.id);
    expect((await facts()).routines).toBe(false);
    // the switch off: there is no page for anybody
    await routinesOn(t.org.id, false);
    await loginAs(t.admin.id);
    expect((await facts()).routines).toBe(false);
  });

  it("the answer carries the company's usual due hour for a new routine's form", async () => {
    const t = await makeTeam();
    await routinesOn(t.org.id, true);
    await setSettings(t.org.id, (s) => ({ ...(s as object), defaultDueHour: 9 }));
    await loginAs(t.member.id);
    const r = await call(routinesGET);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((r.json as { defaultDueTime: string }).defaultDueTime).toBe("09:00");
    // no hour set: the app's usual 18:00
    await setSettings(t.org.id, (s) => {
      const { defaultDueHour: _drop, ...rest } = s as Record<string, unknown>;
      return rest;
    });
    const again = await call(routinesGET);
    expect((again.json as { defaultDueTime: string }).defaultDueTime).toBe("18:00");
  });

  it("the switch off closes the door the phone reads, as it closes the page", async () => {
    const t = await makeTeam();
    await routinesOn(t.org.id, false);
    await loginAs(t.member.id);
    const r = await call(routinesGET);
    expect(r.status).toBe(404);
  });
});
