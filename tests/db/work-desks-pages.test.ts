import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import TicketsPage from "@/app/(app)/tickets/page";
import CampaignsPage from "@/app/(app)/campaigns/page";
import { CampaignsDesk, TicketsDesk } from "@/components/work-desks";
import { createDepartment } from "@/server/services/departments";
import { deptSpaceIdOf } from "@/server/services/department-space";
import { ensureHqSpace } from "@/server/chat/hq";
import { SPACE_COOKIE } from "@/server/services/current-space";
import type { OrgAccessContext } from "@/server/auth";
import { db, loginAs, makeTeam, makeUser, uid } from "./helpers";

/**
 * «التذاكر» AND «الحملات» ARE PAGES OF THEIR OWN under «الشغل» (the owner's ask, 2026-10-25): staff get the desk, the
 * department of the space they are in first; a guest gets the notice, never the desk.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
type DeskProps = { me: { id: string; role: string }; defaultDepartmentId: string | null };

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const designer = await makeUser({ orgId, role: "MEMBER", name: `Designer ${uid()}` });
  const admin: OrgAccessContext = { orgId, userId: team.admin.id, orgRole: "ADMIN" };
  const dept = await createDepartment(admin, { name: `Design ${uid()}`, memberIds: [designer.id] });
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.create({ data: { workspaceId: hq, userId: designer.id, role: "MEMBER" } });
  return { ...team, designer, dept, hq };
}

describe("the tickets and campaigns pages", () => {
  it("inside a department's space, its desk opens first; inside «الشركة», the first department", async () => {
    const w = await world();
    await loginAs(w.designer.id);
    enter(deptSpaceIdOf(w.dept.id));
    const tickets = (await TicketsPage({})) as ReactElement<DeskProps>;
    expect(tickets.type).toBe(TicketsDesk);
    expect(tickets.props).toMatchObject({ me: { id: w.designer.id, role: "MEMBER" }, defaultDepartmentId: w.dept.id });
    const campaigns = (await CampaignsPage()) as ReactElement<DeskProps>;
    expect(campaigns.type).toBe(CampaignsDesk);
    expect(campaigns.props.defaultDepartmentId).toBe(w.dept.id);

    enter(w.hq);
    expect(((await TicketsPage({})) as ReactElement<DeskProps>).props.defaultDepartmentId).toBeNull();
  });

  it("a guest gets the notice, never the desk", async () => {
    const w = await world();
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await loginAs(guest.id);
    expect(((await TicketsPage({})) as ReactElement).type).not.toBe(TicketsDesk);
    expect(((await CampaignsPage()) as ReactElement).type).not.toBe(CampaignsDesk);
  });
});
