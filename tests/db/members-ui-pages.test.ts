import "./scoping-react";
import { createElement, isValidElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// The pages call redirect() and some client rows call useRouter(); neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import MembersPage from "@/app/(app)/members/page";
import SettingsPage from "@/app/(app)/settings/page";
import { OrgMembersView } from "@/components/org-members-view";
import { OrgNameForm } from "@/components/org-name-form";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { ToastProvider } from "@/components/ui/toast";
import { db, loginAs, logout, makeTeam, makeUser } from "./helpers";

// the providers' `children` is typed as required, which createElement(type, props, child) cannot express
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

const { t } = getServerT();

/** Renders a server page (with the client providers its client parts need) to HTML. */
async function html(page: Promise<ReactElement> | ReactElement): Promise<string> {
  const element = await page;
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element)),
    ),
  );
}

/** The first element of this component type anywhere in a page's tree (null when there is none). */
function findType(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findType(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findType((node.props as { children?: ReactNode }).children, type);
}

async function setMember(orgId: string, userId: string, data: Record<string, unknown>) {
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId } }, data });
}

/** makeTeam (owner, admin, member, guest) + a suspended and an offboarded colleague. */
async function world() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead Lena" });
  const suspended = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Suspended Sam" });
  const gone = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Offboarded Olga" });
  await setMember(team.org.id, suspended.id, { status: "SUSPENDED" });
  await setMember(team.org.id, gone.id, { status: "OFFBOARDED" });
  await db.user.update({ where: { id: team.member.id }, data: { jobTitle: "Moderator" } });
  return { ...team, lead, suspended, gone };
}

describe("/members: who gets the manager (the capability users.manage, not the rank)", () => {
  it("the OWNER and an ADMIN get the manager, with their own id and capabilities", async () => {
    const w = await world();
    for (const person of [w.owner, w.admin]) {
      await loginAs(person.id);
      const element = findType(await MembersPage({}), OrgMembersView);
      expect(element, person.name).not.toBeNull();
      const props = element?.props as { orgId: string; actorId: string; actorCaps: string[] };
      expect(props.orgId).toBe(w.org.id);
      expect(props.actorId).toBe(person.id);
      expect(props.actorCaps).toContain("users.manage");
    }
  });

  it("an ADMIN whose users.manage was switched off does not get the manager", async () => {
    const w = await world();
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    await loginAs(w.admin.id);
    const page = await MembersPage({});
    expect(findType(page, OrgMembersView)).toBeNull();
  });

  it("a MEMBER or a LEAD to whom users.manage was switched on gets the manager", async () => {
    const w = await world();
    for (const person of [w.member, w.lead]) {
      await setMember(w.org.id, person.id, { capabilities: ["users.manage"] });
      await loginAs(person.id);
      const element = findType(await MembersPage({}), OrgMembersView);
      expect(element, person.name).not.toBeNull();
      expect((element?.props as { actorCaps: string[] }).actorCaps).toContain("users.manage");
    }
  });

  it("a guest still gets the honest notice and nobody's name", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const page = await MembersPage({});
    expect(findType(page, OrgMembersView)).toBeNull();
    const markup = await html(page);
    expect(markup).toContain(t("orgm.members_only"));
    for (const name of ["Owner", "Admin", "Member", "Lead Lena"]) expect(markup).not.toContain(name);
  });

  it("nobody who is not ACTIVE gets the page: a suspended person (stale cookie) goes to login", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await setMember(w.org.id, w.member.id, { status: "SUSPENDED" });
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(MembersPage({})).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("a person who still owes the temporary-password change is sent to onboarding, not shown the team", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.member.id }, data: { mustChangePassword: true } });
    await loginAs(w.member.id, { mcp: true });
    await expect(MembersPage({})).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("an anonymous visitor goes to login", async () => {
    logout();
    await expect(MembersPage({})).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("/members for people who may not manage: a read-only directory of ACTIVE people", () => {
  it("lists active people only (no suspended, no offboarded) and carries no status controls", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const markup = await html(MembersPage({}));
    for (const name of ["Owner", "Admin", "Lead Lena", "Member"]) expect(markup, name).toContain(name);
    expect(markup).not.toContain("Suspended Sam");
    expect(markup).not.toContain("Offboarded Olga");
    for (const key of ["members.status_suspended", "members.status_offboarded"]) expect(markup).not.toContain(t(key));
  });

  it("shows e-mail and job title to whoever holds directory.view", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    const markup = await html(MembersPage({}));
    expect(markup).toContain(w.member.email);
    expect(markup).toContain("Moderator");
    expect(markup).not.toContain(t("access.section_off"));
  });

  it("somebody who has directory.view switched off and holds no users.manage does NOT see the staff list: the same notice /teams shows", async () => {
    const w = await world();
    for (const person of [w.member, w.lead]) {
      await setMember(w.org.id, person.id, { revokedCapabilities: ["directory.view"] });
      await loginAs(person.id);
      const page = await MembersPage({});
      expect(findType(page, OrgMembersView), person.name).toBeNull();
      const markup = await html(page);
      expect(markup, person.name).toContain(t("access.section_off"));
      // no name, no title, no e-mail of anybody reached the page
      for (const name of ["Owner", "Admin", "Member", "Lead Lena", "Suspended Sam", "Offboarded Olga"]) expect(markup, `${person.name}: ${name}`).not.toContain(name);
      for (const user of [w.owner, w.admin, w.member, w.lead]) expect(markup).not.toContain(user.email);
      expect(markup).not.toContain("Moderator");
    }
  });

  it("the notice is the one /teams shows (one wording for 'this is switched off for you')", async () => {
    const w = await world();
    await setMember(w.org.id, w.member.id, { revokedCapabilities: ["directory.view"] });
    await loginAs(w.member.id);
    const members = await html(MembersPage({}));
    const { default: TeamsPage } = await import("@/app/(app)/teams/page");
    const teams = await html(TeamsPage());
    expect(teams).toContain(t("access.section_off"));
    expect(members).toContain(t("access.section_off"));
  });

  it("whoever holds users.manage keeps the manager even with directory.view switched off (managing people is the capability)", async () => {
    const w = await world();
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"], revokedCapabilities: ["directory.view"] });
    await loginAs(w.member.id);
    const element = findType(await MembersPage({}), OrgMembersView);
    expect(element).not.toBeNull();
    expect((element?.props as { actorCaps: string[] }).actorCaps).toContain("users.manage");
    expect((element?.props as { actorCaps: string[] }).actorCaps).not.toContain("directory.view");
  });

  it("a guest keeps the notice they always had, not the new one", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const markup = await html(MembersPage({}));
    expect(markup).toContain(t("orgm.members_only"));
    expect(markup).not.toContain(t("access.section_off"));
  });
});

describe("/settings", () => {
  it("shows the organization's people count from ACTIVE members only", async () => {
    const w = await world();
    // owner, admin, member, guest, lead are active; one suspended and one offboarded are not
    await loginAs(w.owner.id);
    const markup = await html(SettingsPage());
    expect(markup).toContain(t("settings.membersLink", { n: 5 }));
    expect(markup).not.toContain(t("settings.membersLink", { n: 7 }));
  });

  it("no longer offers the join code (registration is closed), but keeps every other section", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const markup = await html(SettingsPage());
    expect(markup).not.toContain(w.org.joinCode);
    expect(markup).not.toContain(t("teams.joinCode"));
    expect(markup).not.toContain(t("settings.joinHint"));
    for (const key of ["settings.title", "settings.org", "settings.integrations", "settings.profileLink", "settings.passwordLink"]) {
      expect(markup, key).toContain(t(key));
    }
    expect(markup).toContain(w.org.name);
  });

  it("names the rank in Arabic, not as the raw enum", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    const markup = await html(SettingsPage());
    expect(markup).toContain(t("role.lead"));
    expect(markup).not.toMatch(/>LEAD</);
    await loginAs(w.owner.id);
    expect(await html(SettingsPage())).not.toMatch(/>OWNER</);
  });

  it("the rename form is for the OWNER only (the API refuses everybody else)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect(findType(await SettingsPage(), OrgNameForm)).not.toBeNull();
    await loginAs(w.admin.id);
    expect(findType(await SettingsPage(), OrgNameForm)).toBeNull();
  });

  it("the people link follows the capability: /members for users.manage, /teams for everybody else", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect(await html(SettingsPage())).toContain('href="/members"');

    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    const adminWithout = await html(SettingsPage());
    expect(adminWithout).toContain('href="/teams"');
    expect(adminWithout).not.toContain('href="/members"');

    await loginAs(w.member.id);
    expect(await html(SettingsPage())).toContain('href="/teams"');
  });

  it("sends a person who is not ACTIVE (or not signed in) to login", async () => {
    const w = await world();
    logout();
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    await loginAs(w.member.id);
    await setMember(w.org.id, w.member.id, { status: "OFFBOARDED" });
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
