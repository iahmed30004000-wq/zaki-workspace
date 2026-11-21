import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

// the pages call redirect() / notFound(); the client parts call useRouter() / usePathname(): no running Next app is needed here
const where = vi.hoisted(() => ({ pathname: "/settings/me" }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => where.pathname,
}));

import type { Prisma } from "@prisma/client";
import SettingsPage from "@/app/(app)/settings/page";
import ProfilePage from "@/app/(app)/profile/page";
import SettingsMeLayout from "@/app/(app)/settings/me/layout";
import SettingsMeSectionPage from "@/app/(app)/settings/me/[section]/page";
import MembersPage from "@/app/(app)/members/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import { withFeature, type FeatureKey } from "@/lib/features";
import { PANEL_REDIRECT_ADDRESSES, panelRedirectHref } from "@/lib/legacy-routes";
import { buildNav } from "@/lib/nav/places";
import { COMPANY_SECTION_KEYS, type CompanySectionKey } from "@/components/settings-me/sections";
import { companyAccessFor, oneDoorOnFor } from "@/components/settings-me/server-data";
import { requireActor } from "@/server/policy/actor";
import { navSubjectOf, oneDoorPanelFor, visibleNavFor } from "@/server/services/nav-order";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { ToastProvider } from "@/components/ui/toast";
import { db, loginAs, makeTeam, makeUser } from "./helpers";
import { readable, resolveServerTree } from "./today-helpers";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/**
 * S3.1 — «الإعدادات» as ONE door (switch `settingsOneDoor`), against a real PostgreSQL.
 *
 * What this pins:
 *  - OFF (the default), and ON without the one control panel it needs: `/settings` is the page it was, the frame of «إعداداتي» has no second group, the company sections
 *    are «not found», and every person's map is today's;
 *  - ON: the frame has a second group «إعدادات الشركة» for the people the control panel offers a section (the OWNER: four sections and the row «لوحة التحكم»; an ADMIN: the
 *    sections the panel offers them), never for a lead, a member or a guest; each section answers only the people the panel offers it (404 for everybody else, from the same
 *    capability checks the panel makes) and a partner follows what they HOLD;
 *  - the old addresses keep answering: `/settings` leads into the frame (a guest still gets the refusal it always had), `/profile` leads to «حسابي», and every old address of the
 *    control panel's parts still redirects to its section;
 *  - the place «الإدارة» leaves the map of an ADMIN or OWNER who holds the panel, and only theirs: a lead keeps it, a member keeps «الناس».
 */

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(opts: { door?: boolean; panel?: boolean; navV2?: boolean } = {}) {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "ليلى" });
  const partner = await makeUser({ orgId: t.org.id, role: "OWNER", name: "الشريك" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: partner.id } }, data: { primaryOwner: false } });
  if (opts.door) await setFeature(t.org.id, "settingsOneDoor", true);
  if (opts.panel ?? opts.door) await setFeature(t.org.id, "controlPanelV2", true);
  if (opts.navV2) await setFeature(t.org.id, "navV2", true);
  return { ...t, lead, partner };
}

type World = Awaited<ReturnType<typeof world>>;
type Person = "owner" | "admin" | "lead" | "member" | "guest" | "partner";

async function as(w: World, who: Person) {
  await loginAs(w[who].id);
}

type Outcome = { kind: "rendered"; text: string; markup: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

/** Opens a page the way Next does: an element, a redirect or «not found» (anything else is a thrown error and fails the test). */
async function open(page: () => Promise<React.ReactNode | void> | React.ReactNode): Promise<Outcome> {
  try {
    const tree = await resolveServerTree((await page()) as React.ReactNode);
    const markup = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, tree as ReactElement))));
    return { kind: "rendered", markup, text: readable(markup) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) return { kind: "redirect", to: message.slice("NEXT_REDIRECT:".length) };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
}

const settings = () => open(() => SettingsPage());
const profile = () => open(() => ProfilePage());
const frame = (pathname = "/settings/me") => {
  where.pathname = pathname;
  return open(() => SettingsMeLayout({ children: createElement("p", null, "المحتوى") }));
};
const section = (key: string, searchParams: Record<string, string> = {}) => {
  where.pathname = `/settings/me/${key}`;
  return open(() => SettingsMeSectionPage({ params: { section: key }, searchParams }));
};
const groupHeadings = (markup: string) => markup.includes("data-settings-groups");
const rowsOf = (markup: string): string[] => {
  const company = markup.slice(markup.indexOf('data-settings-group-list="company"'));
  return [...company.matchAll(/href="\/settings\/me\/([a-z]+)"/g)].map((m) => m[1] as string);
};

describe("S3.1 · OFF (the default): everything is as it was", () => {
  it("/settings is the page it was for the owner (no redirect), the frame has one list and no company section answers", async () => {
    const w = await world();
    await as(w, "owner");
    expect(await oneDoorOnFor({ orgId: w.org.id })).toBe(false);
    const page = await settings();
    expect(page.kind).toBe("rendered");
    const f = await frame();
    expect(f.kind).toBe("rendered");
    if (f.kind === "rendered") {
      expect(groupHeadings(f.markup)).toBe(false);
      expect(f.markup).not.toContain(AR["settingsOneDoor.group.company"] as string);
    }
    for (const key of COMPANY_SECTION_KEYS) expect((await section(key)).kind, key).toBe("not-found");
    expect(await companyAccessFor(await requireActor())).toBeNull();
  });

  it("the switch alone, without the one control panel it needs, changes nothing either", async () => {
    const w = await world({ door: true, panel: false });
    await as(w, "owner");
    expect(await oneDoorOnFor({ orgId: w.org.id })).toBe(false);
    expect((await settings()).kind).toBe("rendered");
    for (const key of COMPANY_SECTION_KEYS) expect((await section(key)).kind, key).toBe("not-found");
    const actor = await requireActor();
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect(await oneDoorPanelFor(actor, org.settings)).toBe(false);
    expect(buildNav(navSubjectOf(actor, org.settings, null, false, true)).places.map((p) => p.key)).toContain("admin");
  });

  it("every person's map is today's (the owner keeps «الإدارة»)", async () => {
    const w = await world();
    for (const who of ["owner", "admin", "lead", "member"] as const) {
      await as(w, who);
      expect((await visibleNavFor(await requireActor())).places.map((p) => p.key), who).toContain("admin");
    }
  });
});

describe("S3.1 · ON: the second group of the frame", () => {
  it("the OWNER gets the four sections and the row that opens the panel; each section opens", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const f = await frame();
    expect(f.kind).toBe("rendered");
    if (f.kind !== "rendered") return;
    expect(groupHeadings(f.markup)).toBe(true);
    expect(f.markup).toContain(AR["settingsOneDoor.group.company"] as string);
    expect(rowsOf(f.markup)).toEqual(["company", "features", "integrations", "spaces"]);
    // S3.3 (deliberate change): no second door to the panel in the settings, the owner's menu holds the place «لوحة التحكم» (S3.2)
    expect(f.markup).not.toContain('href="/owner"');
    // «إعداداتي» keeps its eleven sections beside it (folders are off here: ten)
    const me = f.markup.slice(f.markup.indexOf('data-settings-group-list="me"'), f.markup.indexOf('data-settings-group-list="company"'));
    expect((me.match(/data-section="/g) ?? []).length).toBeGreaterThanOrEqual(10);
    for (const key of COMPANY_SECTION_KEYS) {
      const page = await section(key);
      expect(page.kind, key).toBe("rendered");
      if (page.kind === "rendered") expect(page.markup, key).toContain(`data-settings-section="${key}"`);
    }
  });

  it("the sections are the control panel's own bodies, not copies: the company's name form, the switches, the integrations' parts, the spaces' board", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const company = await section("company");
    const features = await section("features");
    const integrations = await section("integrations");
    const spaces = await section("spaces");
    if (company.kind !== "rendered" || features.kind !== "rendered" || integrations.kind !== "rendered" || spaces.kind !== "rendered") throw new Error("a section did not render");
    expect(company.markup).toContain('data-testid="cp-company"');
    expect(features.markup).toContain('data-testid="cp-features"');
    expect(integrations.markup).toContain('data-testid="cp-integrations"');
    expect(spaces.markup).toContain('data-testid="cp-spaces"');
    // the way back to the list on the phone
    expect(company.markup).toContain("data-settings-back");
  });

  it("an ADMIN gets only what the panel offers them (integrations, spaces) and the row «لوحة التحكم»; the owner's sections are «not found» for them", async () => {
    const w = await world({ door: true });
    await as(w, "admin");
    const f = await frame();
    if (f.kind !== "rendered") throw new Error("no frame");
    expect(rowsOf(f.markup)).toEqual(["integrations", "spaces"]);
    // S3.3 (deliberate change): no row «لوحة التحكم» here either, the admin's menu holds the place (S3.2)
    expect(f.markup).not.toContain('href="/owner"');
    expect((await section("integrations")).kind).toBe("rendered");
    expect((await section("spaces")).kind).toBe("rendered");
    expect((await section("company")).kind).toBe("not-found");
    expect((await section("features")).kind).toBe("not-found");
  });

  it("a lead, a member and a guest get no group and no section (404), whatever address they type", async () => {
    const w = await world({ door: true });
    for (const who of ["lead", "member", "guest"] as const) {
      await as(w, who);
      const f = await frame();
      expect(f.kind, who).toBe("rendered");
      if (f.kind === "rendered") expect(groupHeadings(f.markup), who).toBe(false);
      expect(await companyAccessFor(await requireActor()), who).toBeNull();
      for (const key of COMPANY_SECTION_KEYS) expect((await section(key)).kind, `${who} ${key}`).toBe("not-found");
    }
  });

  it("a partner follows what they HOLD: taking `integrations.manage` away takes the section away, the row stays while another section is left", async () => {
    const w = await world({ door: true });
    await as(w, "partner");
    let f = await frame();
    if (f.kind !== "rendered") throw new Error("no frame");
    expect(rowsOf(f.markup)).toContain("integrations");
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.partner.id } },
      data: { revokedCapabilities: ["integrations.manage"] },
    });
    expect((await section("integrations")).kind).toBe("not-found");
    f = await frame();
    if (f.kind !== "rendered") throw new Error("no frame");
    expect(rowsOf(f.markup)).not.toContain("integrations");
    expect(rowsOf(f.markup)).toContain("features");
  });

  it("an unknown section is «not found» as before, and the person's own sections still open", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    expect((await section("nothing")).kind).toBe("not-found");
    for (const key of ["account", "chat", "help", "menu"]) expect((await section(key)).kind, key).toBe("rendered");
  });
});

describe("S3.1 · ON: the old addresses keep answering", () => {
  it("/settings leads into the frame: the owner to «بيانات الشركة», an admin to «التكاملات», a member to the index; a guest still gets the refusal", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    expect(await settings()).toEqual({ kind: "redirect", to: "/settings/me/company" });
    await as(w, "admin");
    expect(await settings()).toEqual({ kind: "redirect", to: "/settings/me/integrations" });
    await as(w, "member");
    expect(await settings()).toEqual({ kind: "redirect", to: "/settings/me" });
    await as(w, "lead");
    expect(await settings()).toEqual({ kind: "redirect", to: "/settings/me" });
    await as(w, "guest");
    expect((await settings()).kind).toBe("rendered");
  });

  it("/profile leads to «حسابي» with the switch on or off", async () => {
    for (const door of [false, true]) {
      const w = await world({ door });
      await as(w, "member");
      expect(await profile(), `door ${door}`).toEqual({ kind: "redirect", to: "/settings/me/account" });
    }
  });

  it("every old address of the control panel's parts still redirects to its section for the owner (none became a dead end)", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const pages: Record<string, () => Promise<ReactNode> | ReactNode> = {
      "/members": () => MembersPage({}),
      "/analytics": () => AnalyticsPage({}),
    };
    for (const [address, page] of Object.entries(pages)) {
      expect(PANEL_REDIRECT_ADDRESSES, address).toContain(address);
      // S3.2: with the door on, «الحسابات» is a part of «الناس» (the answer of the one-door map)
      expect(await open(page), address).toEqual({ kind: "redirect", to: panelRedirectHref(address, undefined, true) });
    }
  });
});

describe("S3.1 · ON: the place «الإدارة» leaves the map of an admin who holds the panel", () => {
  for (const navV2 of [false, true]) {
    it(`navV2 ${navV2}: «لوحة التحكم» (one row, no tabs) in its slot for the owner, a partner and an admin; a lead keeps it; a member keeps «الناس»; a guest is untouched`, async () => {
      const w = await world({ door: true, navV2 });
      const places = async (who: Person) => {
        await as(w, who);
        return (await visibleNavFor(await requireActor())).places;
      };
      // S3.2 (deliberate change): the slot of «الإدارة» is «لوحة التحكم», one row to /owner with no tab strip
      for (const who of ["owner", "partner", "admin"] as const) {
        const place = (await places(who)).find((p) => p.key === "admin");
        expect(place?.labelKey, who).toBe("nav.place.controlPanel");
        expect(place?.tabs, who).toEqual([]);
      }
      expect((await places("lead")).map((p) => p.key)).toContain("admin");
      const member = (await places("member")).find((p) => p.key === "admin");
      expect(member).toBeTruthy();
      if (navV2) expect(member?.labelKey).toBe("nav.place.people");
      expect((await places("guest")).map((p) => p.key)).not.toContain("admin");
    });
  }

  it("an admin whose boxes were taken away is still served by the panel («المساحات» is the rank rule), so the place goes with the boxes gone too", async () => {
    const w = await world({ door: true, navV2: true });
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } },
      data: { revokedCapabilities: ["users.manage", "integrations.manage", "reports.view", "archive.view"] },
    });
    await as(w, "admin");
    const actor = await requireActor();
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    // «المساحات» is the rank rule (OWNER and ADMIN): the panel still serves this admin one section, so the place goes
    expect(await oneDoorPanelFor(actor, org.settings)).toBe(true);
    expect((await visibleNavFor(actor)).places.find((p) => p.key === "admin")?.labelKey).toBe("nav.place.controlPanel");
  });
});
