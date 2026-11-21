import { describe, expect, it, vi } from "vitest";

// The pages call redirect()/notFound() and their client rows call useRouter(); no running Next app is needed here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import CrmPage from "@/app/(app)/crm/page";
import AutomationPage from "@/app/(app)/automation/page";
import { GuestNotice } from "@/app/(app)/_guest";
import TelegramPage from "@/app/(app)/telegram/page";
import DepartmentsPage from "@/app/(app)/departments/page";
import TeamsPage from "@/app/(app)/teams/page";
import PublicProfilePage from "@/app/(app)/u/[id]/page";
import * as customersRoute from "@/app/api/crm/customers/route";
import * as customerRoute from "@/app/api/crm/customers/[id]/route";
import * as opportunitiesRoute from "@/app/api/crm/opportunities/route";
import * as opportunityRoute from "@/app/api/crm/opportunities/[id]/route";
import * as usersRoute from "@/app/api/users/[id]/route";
import * as chatDirectoryRoute from "@/app/api/chat/directory/route";
import * as departmentsRoute from "@/app/api/departments/route";
import * as departmentRoute from "@/app/api/departments/[id]/route";
import * as n8nRoute from "@/app/api/integrations/n8n/route";
import { CrmView } from "@/components/crm-view";
import { DepartmentsView } from "@/components/departments-view";
import { getServerT } from "@/lib/i18n/server";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeCustomer, makeDepartment, makeOpportunity } from "./guest-helpers";
import { HOOK_URL, connectN8nDirect } from "./integrations-helpers";
import { html, setCapabilities, type PageElement } from "./pages-access-helpers";

const { t } = getServerT();
const SECTION_OFF = t("access.section_off");

/** The whole company: the standard team plus a team lead and a second member to look at. */
async function company() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Team lead" });
  const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Colleague Nour" });
  const customer = await makeCustomer({ orgId: team.org.id, creatorId: team.owner.id });
  const opportunity = await makeOpportunity({ orgId: team.org.id, customerId: customer.id, ownerId: team.owner.id });
  return { ...team, lead, colleague, customer, opportunity };
}

// ---------------------------------------------------------------------------
// CRM: crm.view reads, crm.edit changes
// ---------------------------------------------------------------------------

describe("CRM routes: crm.view opens the reads, crm.edit opens the writes", () => {
  it("the default ranks keep what they had; a guest still gets guest.no_access", async () => {
    const w = await company();
    for (const user of [w.owner, w.admin, w.lead, w.member]) {
      await loginAs(user.id);
      expect((await call(customersRoute.GET)).status, `${user.name} reads customers`).toBe(200);
      expect((await call(opportunitiesRoute.GET)).status, `${user.name} reads opportunities`).toBe(200);
      expect((await call(customerRoute.GET, { params: { id: w.customer.id } })).status).toBe(200);
      const made = await call(customersRoute.POST, { body: { name: `Customer of ${user.name}` } });
      expect(made.status, `${user.name} creates a customer`).toBe(201);
    }
    await loginAs(w.guest.id);
    for (const res of [
      await call(customersRoute.GET),
      await call(opportunitiesRoute.GET),
      await call(customerRoute.GET, { params: { id: w.customer.id } }),
      await call(customersRoute.POST, { body: { name: "Guest customer" } }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("guest.no_access");
    }
  });

  it("switching crm.view off closes every CRM read for that person, and with the grid their writes too", async () => {
    const w = await company();
    await setCapabilities(w.org.id, w.member.id, { revoke: ["crm.view"] });
    await loginAs(w.member.id);
    for (const res of [
      await call(customersRoute.GET),
      await call(customerRoute.GET, { params: { id: w.customer.id } }),
      await call(opportunitiesRoute.GET),
      await call(opportunityRoute.GET, { params: { id: w.opportunity.id } }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("insufficient_role");
      expect(res.text).not.toContain(w.customer.name);
    }
    // the customers are a row of the section grid (2026-10-26): without «يشوف», «يضيف ويعدّل» and «يحذف» fall too
    expect((await call(customersRoute.POST, { body: { name: "Not without view" } })).status).toBe(403);
    expect((await call(customerRoute.DELETE, { method: "DELETE", params: { id: w.customer.id } })).status).toBe(403);
    // and a colleague whose switches were not touched still reads
    await loginAs(w.colleague.id);
    expect((await call(customersRoute.GET)).status).toBe(200);
  });

  it("switching crm.edit off closes every CRM add and change for that person (an ADMIN included), and only those", async () => {
    const w = await company();
    for (const person of [w.member, w.admin]) {
      await setCapabilities(w.org.id, person.id, { revoke: ["crm.edit"] });
      await loginAs(person.id);
      const attempts = [
        await call(customersRoute.POST, { body: { name: "Not allowed" } }),
        await call(customerRoute.PATCH, { method: "PATCH", params: { id: w.customer.id }, body: { name: "Renamed" } }),
        await call(opportunitiesRoute.POST, { body: { customerId: w.customer.id, title: "Not allowed either" } }),
        await call(opportunityRoute.PATCH, { method: "PATCH", params: { id: w.opportunity.id }, body: { stage: "WON" } }),
      ];
      for (const res of attempts) {
        expect(res.status, person.name).toBe(403);
        expect(res.json?.["message"]).toBe("insufficient_role");
      }
      // reading is untouched
      expect((await call(customersRoute.GET)).status).toBe(200);
      expect((await call(opportunityRoute.GET, { params: { id: w.opportunity.id } })).status).toBe(200);
    }
    // nothing was changed or removed
    const customer = await db.customer.findUniqueOrThrow({ where: { id: w.customer.id } });
    expect(customer.name).toBe(w.customer.name);
    expect(await db.opportunity.count({ where: { id: w.opportunity.id } })).toBe(1);
    expect(await db.customer.count({ where: { orgId: w.org.id, name: "Not allowed" } })).toBe(0);
  });

  it("switching crm.delete off closes every CRM delete for that person, and only the deletes (its own box since 2026-10-26)", async () => {
    const w = await company();
    await setCapabilities(w.org.id, w.member.id, { revoke: ["crm.delete"] });
    await loginAs(w.member.id);
    for (const res of [
      await call(customerRoute.DELETE, { method: "DELETE", params: { id: w.customer.id } }),
      await call(opportunityRoute.DELETE, { method: "DELETE", params: { id: w.opportunity.id } }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("insufficient_role");
    }
    expect((await call(customerRoute.PATCH, { method: "PATCH", params: { id: w.customer.id }, body: { name: "Renamed by the member" } })).status).toBe(200);
    expect(await db.customer.count({ where: { id: w.customer.id } })).toBe(1);
    expect(await db.opportunity.count({ where: { id: w.opportunity.id } })).toBe(1);
  });
});

describe("the /crm page follows crm.view", () => {
  it("renders the CRM for the default ranks and a notice for a guest", async () => {
    const w = await company();
    for (const user of [w.owner, w.admin, w.lead, w.member]) {
      await loginAs(user.id);
      expect(((await CrmPage()) as PageElement).type, user.name).toBe(CrmView);
    }
    await loginAs(w.guest.id);
    const guestElement = (await CrmPage()) as PageElement;
    expect(guestElement.type).not.toBe(CrmView);
    expect(await html(guestElement)).toContain(t("guest.no_access"));
  });

  it("shows 'this section is off for you' to someone whose crm.view was switched off, never the view", async () => {
    const w = await company();
    await setCapabilities(w.org.id, w.member.id, { revoke: ["crm.view"] });
    await loginAs(w.member.id);
    const element = (await CrmPage()) as PageElement;
    expect(element.type).not.toBe(CrmView);
    expect(await html(element)).toContain(SECTION_OFF);
  });

  it("still renders the view for someone who only lost crm.edit (they may read)", async () => {
    const w = await company();
    await setCapabilities(w.org.id, w.member.id, { revoke: ["crm.edit"] });
    await loginAs(w.member.id);
    expect(((await CrmPage()) as PageElement).type).toBe(CrmView);
  });
});

// ---------------------------------------------------------------------------
// the staff directory: directory.view
// ---------------------------------------------------------------------------

describe("the staff directory routes follow directory.view", () => {
  it("GET /api/users/[id]: default ranks see a colleague's profile; switching it off gives 403; a guest keeps the restricted view", async () => {
    const w = await company();
    for (const user of [w.owner, w.admin, w.lead, w.member]) {
      await loginAs(user.id);
      expect((await call(usersRoute.GET, { params: { id: w.colleague.id } })).status, user.name).toBe(200);
    }

    await setCapabilities(w.org.id, w.member.id, { revoke: ["directory.view"] });
    await setCapabilities(w.org.id, w.admin.id, { revoke: ["directory.view"] });
    for (const person of [w.member, w.admin]) {
      await loginAs(person.id);
      const res = await call(usersRoute.GET, { params: { id: w.colleague.id } });
      expect(res.status, person.name).toBe(403);
      expect(res.json?.["message"]).toBe("insufficient_role");
      expect(res.text).not.toContain("Colleague Nour");
      // a person may always look at their own entry
      expect((await call(usersRoute.GET, { params: { id: person.id } })).status).toBe(200);
    }

    // a guest is unchanged: names only, and only for people they share a workspace with (here: nobody, so 404)
    await loginAs(w.guest.id);
    expect((await call(usersRoute.GET, { params: { id: w.guest.id } })).status).toBe(200);
    expect((await call(usersRoute.GET, { params: { id: w.colleague.id } })).status).toBe(404);
  });

  it("GET /api/chat/directory and the department list are the directory too: off means 403, a guest keeps its old answer", async () => {
    const w = await company();
    const dept = await makeDepartment(w.org.id, { memberIds: [w.colleague.id] });
    await loginAs(w.member.id);
    expect((await call(chatDirectoryRoute.GET)).status).toBe(200);
    expect((await call(departmentsRoute.GET)).status).toBe(200);
    expect((await call(departmentRoute.GET, { params: { id: dept.id } })).status).toBe(200);

    await setCapabilities(w.org.id, w.member.id, { revoke: ["directory.view"] });
    for (const res of [
      await call(chatDirectoryRoute.GET),
      await call(departmentsRoute.GET),
      await call(departmentRoute.GET, { params: { id: dept.id } }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("insufficient_role");
      expect(res.text).not.toContain("Colleague Nour");
    }

    await loginAs(w.guest.id);
    const guestDirectory = await call(chatDirectoryRoute.GET);
    expect(guestDirectory.status).toBe(403);
    expect(guestDirectory.json?.["message"]).toBe("chat.guest_forbidden");
    const guestDepartments = await call(departmentsRoute.GET);
    expect(guestDepartments.status).toBe(403);
    expect(guestDepartments.json?.["message"]).toBe("guest.no_access");
  });
});

describe("the people pages follow directory.view", () => {
  it("/teams lists the colleagues for the default ranks, a notice (and no names) when it is switched off", async () => {
    const w = await company();
    // /teams lists the people of the space one is in (2026-10-25): the member and their colleague share one
    await makeWorkspace(w.org.id, [{ userId: w.member.id }, { userId: w.colleague.id }], "Shared space");
    await loginAs(w.member.id);
    expect(await html(TeamsPage())).toContain("Colleague Nour");

    await setCapabilities(w.org.id, w.member.id, { revoke: ["directory.view"] });
    const off = await html(TeamsPage());
    expect(off).toContain(SECTION_OFF);
    expect(off).not.toContain("Colleague Nour");
  });

  it("/departments renders its view for the default ranks and the notice when it is switched off", async () => {
    const w = await company();
    await loginAs(w.member.id);
    expect(((await DepartmentsPage()) as PageElement).type).toBe(DepartmentsView);

    await setCapabilities(w.org.id, w.member.id, { revoke: ["directory.view"] });
    const element = (await DepartmentsPage()) as PageElement;
    expect(element.type).not.toBe(DepartmentsView);
    expect(await html(element)).toContain(SECTION_OFF);

    await loginAs(w.guest.id);
    expect(await html((await DepartmentsPage()) as PageElement)).toContain(t("guest.no_access"));
  });

  it("/u/[id] shows a colleague's profile, the notice when switched off, and always the person's own", async () => {
    const w = await company();
    await loginAs(w.member.id);
    expect(await html(PublicProfilePage({ params: { id: w.colleague.id } }))).toContain("Colleague Nour");

    await setCapabilities(w.org.id, w.member.id, { revoke: ["directory.view"] });
    const off = await html(PublicProfilePage({ params: { id: w.colleague.id } }));
    expect(off).toContain(SECTION_OFF);
    expect(off).not.toContain("Colleague Nour");
    expect(await html(PublicProfilePage({ params: { id: w.member.id } }))).toContain("Member");
  });
});

// ---------------------------------------------------------------------------
// integrations: integrations.manage
// ---------------------------------------------------------------------------

describe("the automation and Telegram screens show their controls to whoever holds integrations.manage", () => {
  /**
   * The rank the screen was told to believe — or "notice" when the page shows the guest notice
   * instead of the automation view (a staff-only tab: review C6).
   */
  async function automationRole(userId: string): Promise<string> {
    await loginAs(userId);
    const page = (await AutomationPage({})) as PageElement & { type?: unknown };
    if (page.type === GuestNotice) return "notice";
    const view = page.props["children"] as PageElement;
    return (view.props["ctx"] as { orgRole: string }).orgRole;
  }
  async function telegramRole(userId: string): Promise<string> {
    await loginAs(userId);
    const view = (await TelegramPage({})) as PageElement;
    return (view.props["ctx"] as { orgRole: string }).orgRole;
  }

  it("defaults: the owner and admins manage, a lead and a member do not, a guest gets the guest notice", async () => {
    const w = await company();
    expect(await automationRole(w.owner.id)).toBe("OWNER");
    expect(await automationRole(w.admin.id)).toBe("ADMIN");
    expect(await automationRole(w.lead.id)).toBe("MEMBER");
    expect(await automationRole(w.member.id)).toBe("MEMBER");
    expect(await automationRole(w.guest.id)).toBe("notice");
    expect(await telegramRole(w.owner.id)).toBe("OWNER");
    expect(await telegramRole(w.admin.id)).toBe("ADMIN");
    expect(await telegramRole(w.member.id)).toBe("MEMBER");
  });

  it("the switch decides: switched on for a member they manage, switched off for an admin they do not", async () => {
    const w = await company();
    await setCapabilities(w.org.id, w.member.id, { grant: ["integrations.manage"] });
    await setCapabilities(w.org.id, w.admin.id, { revoke: ["integrations.manage"] });
    expect(await automationRole(w.member.id)).toBe("ADMIN");
    expect(await telegramRole(w.member.id)).toBe("ADMIN");
    expect(await automationRole(w.admin.id)).toBe("MEMBER");
    expect(await telegramRole(w.admin.id)).toBe("MEMBER");
  });

  it("a guest can never be given it, even if a stored row says so: still the guest notice", async () => {
    const w = await company();
    await setCapabilities(w.org.id, w.guest.id, { grant: ["integrations.manage"] });
    expect(await automationRole(w.guest.id)).toBe("notice");
  });
});

describe("GET /api/integrations/n8n: the full status goes to whoever holds integrations.manage", () => {
  async function statusFor(userId: string) {
    await loginAs(userId);
    const res = await call(n8nRoute.GET);
    expect(res.status).toBe(200);
    return res.json?.["status"] as { connected: boolean; webhookUrl: string | null; events: string[] };
  }

  it("owner and admin see the webhook address; a lead and a member only whether it is connected", async () => {
    const w = await company();
    await connectN8nDirect(w.org.id, { events: ["task.created"] });
    for (const user of [w.owner, w.admin]) {
      const status = await statusFor(user.id);
      expect(status.webhookUrl, user.name).toBe(HOOK_URL);
      expect(status.events).toEqual(["task.created"]);
    }
    for (const user of [w.lead, w.member]) {
      const status = await statusFor(user.id);
      expect(status.connected, user.name).toBe(true);
      expect(status.webhookUrl).toBeNull();
      expect(status.events).toEqual([]);
    }
  });

  it("the switch decides here too: on for a member shows the address, off for an admin hides it", async () => {
    const w = await company();
    await connectN8nDirect(w.org.id, { events: ["task.created"] });
    await setCapabilities(w.org.id, w.member.id, { grant: ["integrations.manage"] });
    await setCapabilities(w.org.id, w.admin.id, { revoke: ["integrations.manage"] });
    expect((await statusFor(w.member.id)).webhookUrl).toBe(HOOK_URL);
    expect((await statusFor(w.admin.id)).webhookUrl).toBeNull();
  });
});
