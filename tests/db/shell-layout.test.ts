import "./scoping-react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Server components call redirect(); it throws in Next as well, so a test can catch where it points.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/my-work",
  useSearchParams: () => new URLSearchParams(),
}));

import AppLayout from "@/app/(app)/layout";
import type { AppShellProps } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import type { PlaceKey } from "@/lib/nav/places";
import { db, loginAs, logout, makeOrg, makeTeam, makeUser } from "./helpers";
import { pendingMember, setMemberStatus } from "./login-helpers";

/**
 * The (app) layout hands every signed-in page the map of THAT person's places, computed on the server
 * from the database (rank and switches of the oldest ACTIVE membership) — and still sends an anonymous
 * visitor to /login and a person who owes the onboarding to /onboarding.
 */

type Shell = ReactElement<AppShellProps>;

async function frame(): Promise<Shell> {
  return (await AppLayout({ children: null })) as Shell;
}

/** Where the layout redirected to (null = it rendered). */
async function redirectOf(render: () => Promise<unknown>): Promise<string | null> {
  try {
    await render();
    return null;
  } catch (err) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec(err instanceof Error ? err.message : "");
    if (!m) throw err;
    return m[1] ?? "";
  }
}

const places = (shell: Shell) => shell.props.nav.places.map((p) => p.key);
const placeOf = (shell: Shell, key: PlaceKey) => shell.props.nav.places.find((p) => p.key === key);
const tabs = (shell: Shell, key: PlaceKey) => placeOf(shell, key)?.tabs.map((t) => t.key);

const WORK_ALL = ["my-work", "projects", "list", "calendar", "goals", "ideas", "production", "departments", "tickets", "campaigns", "crm", "approvals", "checkins"];
// goals and ideas are the team's own (docs/PHASE0-AUDIT.md R10): not offered to an external partner
const WORK_GUEST = ["my-work", "projects", "list", "calendar"];

beforeEach(() => logout());

describe("the layout draws each person's own places", () => {
  it("the owner: the six places, every work tab, «الإدارة» with all six tabs (the archive is his alone); the managers' guide", async () => {
    const { owner } = await makeTeam();
    await loginAs(owner.id);
    const shell = await frame();
    expect(places(shell)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(shell, "work")).toEqual(WORK_ALL);
    // Phase 3: «الأرشيف» (archive.view, the owner's alone) joined the admin place
    expect(tabs(shell, "admin")).toEqual(["team", "board", "structure", "development", "reports", "automation", "telegram", "settings", "archive"]);
    expect(placeOf(shell, "admin")?.labelKey).toBe("nav.place.admin");
    expect(shell.props).toMatchObject({ rank: "OWNER", isGuest: false, audience: "managers" });
    // the shell gets the three fields it draws, never the session facts (WP-ARABIC2 (g))
    // WP-ARABIC2 (g): only what the shell draws crosses to the browser — never session facts
    expect(Object.keys(shell.props.user).sort()).toEqual(["avatarUrl", "email", "name", "username"]);
    expect(shell.props.user.name).toBe(owner.name);
    expect(shell.props.user).not.toHaveProperty("id");
    expect(shell.props.user).not.toHaveProperty("tv");
    expect(shell.props.user).not.toHaveProperty("locale");
  });

  it("an admin: the same six places and admin tabs", async () => {
    const { admin } = await makeTeam();
    await loginAs(admin.id);
    const shell = await frame();
    expect(places(shell)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(shell, "admin")).toEqual(["team", "board", "reports", "automation", "telegram", "settings"]);
    expect(shell.props).toMatchObject({ rank: "ADMIN", isGuest: false, audience: "managers" });
  });

  it("a team lead: the team and the reports", async () => {
    const org = await makeOrg();
    const lead = await makeUser({ orgId: org.id, role: "LEAD" });
    await loginAs(lead.id);
    const shell = await frame();
    expect(tabs(shell, "admin")).toEqual(["team", "board", "reports"]);
    expect(shell.props).toMatchObject({ rank: "LEAD", audience: "staff" });
  });

  it("a plain member: the admin place is «الفريق» and «لوحتي» (on by rank); the staff guide", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const shell = await frame();
    expect(places(shell)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(shell, "work")).toEqual(WORK_ALL);
    expect(placeOf(shell, "admin")).toMatchObject({ labelKey: "nav.place.admin", href: "/members", tabs: [{ key: "team" }, { key: "board", href: "/owner", labelKey: "nav.tab.boardSelf" }] });
    expect(shell.props).toMatchObject({ rank: "MEMBER", isGuest: false, audience: "staff" });
  });

  it("a guest (external partner): Today, Chat, Work (four work tabs) and the library (documents only) (no goals, no ideas), no space creation; the guide for everyone", async () => {
    const { guest } = await makeTeam();
    await loginAs(guest.id);
    const shell = await frame();
    // Phase 3: a guest reads the topics of the spaces they are in (the policy decides what), so «الدردشة» is theirs too
    expect(places(shell)).toEqual(["today", "chat", "work", "library"]);
    expect(tabs(shell, "work")).toEqual(WORK_GUEST);
    expect(tabs(shell, "library")).toEqual(["documents"]);
    expect(shell.props).toMatchObject({ rank: "GUEST", isGuest: true, audience: "everyone" });
  });

  it("follows the owner's switches, read from the database on every request", async () => {
    const { org, member } = await makeTeam();
    await loginAs(member.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { revokedCapabilities: ["directory.view", "crm.view", "board.self"] },
    });
    let shell = await frame();
    expect(places(shell)).toEqual(["today", "chat", "work", "library", "watch"]);
    expect(tabs(shell, "work")).toEqual(WORK_ALL.filter((t) => t !== "crm"));

    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { revokedCapabilities: [], capabilities: ["users.manage"] },
    });
    shell = await frame();
    expect(tabs(shell, "admin")).toEqual(["team", "board", "settings"]);
    expect(placeOf(shell, "admin")?.labelKey).toBe("nav.place.admin");
    expect(shell.props.audience).toBe("managers");
  });

  it("a person who manages people keeps the Team tab even with the directory switched off: /members is their people manager", async () => {
    const { org, member } = await makeTeam();
    await loginAs(member.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: org.id, userId: member.id } },
      data: { capabilities: ["users.manage"], revokedCapabilities: ["directory.view"] },
    });
    const shell = await frame();
    expect(tabs(shell, "admin")).toEqual(["team", "board", "settings"]);
    expect(placeOf(shell, "admin")).toMatchObject({ labelKey: "nav.place.admin", href: "/members" });
    expect(shell.props.audience).toBe("managers");
  });

  it("decides from the ACTIVE membership: an old guest seat that was closed does not shrink a member's map", async () => {
    const a = await makeTeam();
    const b = await makeTeam();
    await db.organizationMember.create({
      data: { organizationId: a.org.id, userId: b.member.id, role: "GUEST", status: "OFFBOARDED", createdAt: new Date("2020-01-01") },
    });
    await loginAs(b.member.id);
    const shell = await frame();
    expect(shell.props.isGuest).toBe(false);
    expect(places(shell)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
  });

  it("the map reaches the screen: the member's bottom bar and side menu link to their six places", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const shell = await frame();
    const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
    const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
    const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
    const html = renderToStaticMarkup(
      createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, shell))),
    );
    for (const href of ["/", "/chat", "/my-work", "/files", "/members", "/watch"]) expect(html.split(`href="${href}"`).length - 1, href).toBeGreaterThanOrEqual(2);
    expect(html).toContain('data-tour="places"');
    expect(html).toContain('data-tour="tabs"');
  });
});

describe("the layout still guards the door", () => {
  it("sends an anonymous visitor to /login", async () => {
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/login");
  });

  it("sends a person with a temporary password to /onboarding", async () => {
    await pendingMember({ password: true });
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/onboarding");
  });

  it("sends a person to /onboarding when the owner re-issued the notice after their cookie was made", async () => {
    const { org, member } = await makeTeam();
    await loginAs(member.id);
    expect(await redirectOf(() => AppLayout({ children: null }))).toBeNull();
    await db.organization.update({ where: { id: org.id }, data: { settings: { transparencyVersion: 2 } } });
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/onboarding");
  });

  it("sends a suspended person to /login (no ACTIVE membership: the cookie is not honoured)", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await setMemberStatus(member.id, "SUSPENDED");
    expect(await redirectOf(() => AppLayout({ children: null }))).toBe("/login");
  });
});
