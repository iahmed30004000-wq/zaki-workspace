import "./scoping-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// the pages call redirect() / notFound(); the client parts call useRouter(): no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/spaces/x/settings",
  useSearchParams: () => new URLSearchParams(),
}));

import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Prisma } from "@prisma/client";
import SettingsPage from "@/app/(app)/spaces/[id]/settings/page";
import CurrentSpacePage from "@/app/(app)/spaces/current/page";
import ProjectsPage from "@/app/(app)/projects/page";
import * as spaceRoute from "@/app/api/workspaces/[id]/route";
import * as archiveRoute from "@/app/api/workspaces/[id]/archive/route";
import * as deleteAllRoute from "@/app/api/workspaces/[id]/delete-all/route";
import { withFeature, type FeatureKey } from "@/lib/features";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { ToastProvider } from "@/components/ui/toast";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { ensureHqSpace } from "@/server/chat/hq";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { hrefsOf, readable, resolveServerTree } from "./today-helpers";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

async function html(page: Promise<ReactNode> | ReactNode): Promise<string> {
  const tree = await resolveServerTree(await page);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, tree as ReactElement))));
}

/**
 * A2.2 — ONE settings page per space (`/spaces/[id]/settings`) behind the switch `controlPanelV2`, against a real PostgreSQL.
 *
 *  - OFF (the default): the page does not exist («not found») and the old pages / dialogs are what they were;
 *  - ON: a person sees ONLY the tabs they can use (a plain member reads the people and the «المقاطع»; the manager gets every tab but «خطر»; «خطر» only for
 *    whoever can really archive or delete), a space they cannot open is «not found» (never forbidden), an external partner never gets the page;
 *  - `/spaces/current` leads there for a manager; archive stays the OWNER's and the ADMINs', delete stays the OWNER's alone (the routes);
 *  - the space's emoji is written through the same door as its name, by its manager only, and never as text.
 */

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

async function world() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  const outsider = await makeUser({ orgId: team.org.id, role: "ADMIN", name: "Outside Admin" });
  const space = await makeWorkspace(
    team.org.id,
    [
      { userId: team.admin.id, role: "MEMBER" }, // an org ADMIN in the space manages it by rank
      { userId: lead.id, role: "ADMIN" }, // the space's own ADMIN
      { userId: team.member.id, role: "MEMBER" },
      { userId: team.guest.id, role: "GUEST" },
    ],
    "Secret Launch Space",
  );
  const other = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "Other Space");
  return { ...team, lead, outsider, space, other };
}
type World = Awaited<ReturnType<typeof world>>;

type Outcome = { kind: "rendered"; markup: string; text: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

async function open(page: () => Promise<ReactNode> | ReactNode): Promise<Outcome> {
  try {
    const markup = await html(page());
    return { kind: "rendered", markup, text: readable(markup) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) return { kind: "redirect", to: message.slice("NEXT_REDIRECT:".length) };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
}

const settings = (spaceId: string, searchParams: Record<string, string> = {}) => open(() => SettingsPage({ params: { id: spaceId }, searchParams }));
const tabsOf = (markup: string): string[] => [...markup.matchAll(/data-space-settings-tab="([a-z]+)"/g)].map((m) => m[1] as string);
const panelOf = (markup: string): string | null => markup.match(/data-space-settings-panel="([a-z]+)"/)?.[1] ?? null;
const rendered = (out: Outcome): string => {
  if (out.kind !== "rendered") throw new Error(`expected a page, got ${out.kind}`);
  return out.markup;
};

beforeEach(() => logout());

describe("A2.2 · the switch is OFF (as merged)", () => {
  it("the settings page does not exist for anybody, the owner included", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect(await settings(w.space.id)).toEqual({ kind: "not-found" });
  });

  it("/spaces/current is the page it was: a manager gets the two dialogs' buttons, nobody is redirected", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    enter(w.space.id);
    const page = await open(() => CurrentSpacePage());
    expect(page.kind).toBe("rendered");
    if (page.kind === "rendered") {
      expect(page.text).toContain(AR["ws.edit"] as string);
      expect(page.text).toContain(AR["ws.members"] as string);
    }
  });

  it("the projects page keeps «المقاطع» as a dialog button and links to no settings page", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    enter(w.space.id);
    const page = await open(() => ProjectsPage({ searchParams: {} }));
    expect(page.kind).toBe("rendered");
    if (page.kind === "rendered") {
      expect(page.text).toContain(AR["spaceteams.title"] as string);
      expect(hrefsOf(page.markup).some((h) => h.includes("/settings"))).toBe(false);
    }
  });
});

describe("A2.2 · the switch is ON: who is offered which tab", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
  });

  it("the owner (no row in the space) gets all six tabs, in order, on the first one", async () => {
    await loginAs(w.owner.id);
    const markup = rendered(await settings(w.space.id));
    expect(tabsOf(markup)).toEqual(["general", "people", "teams", "chat", "work", "danger"]);
    expect(panelOf(markup)).toBe("general");
    expect(markup).toContain("Secret Launch Space");
  });

  it("the space's own ADMIN row gets every tab but «خطر» (it can neither archive nor delete the space)", async () => {
    await loginAs(w.lead.id);
    expect(tabsOf(rendered(await settings(w.space.id)))).toEqual(["general", "people", "teams", "chat", "work"]);
  });

  it("an org ADMIN who is in the space manages it and may archive it (as the archive door allows), but delete is the owner's: «خطر» has no delete button", async () => {
    await loginAs(w.admin.id);
    const markup = rendered(await settings(w.space.id, { tab: "danger" }));
    expect(tabsOf(markup)).toEqual(["general", "people", "teams", "chat", "work", "danger"]);
    expect(panelOf(markup)).toBe("danger");
    expect(markup).toContain(AR["spset.danger.archive"] as string);
    expect(markup).not.toContain(AR["spaces.delete.open"] as string);
  });

  it("the owner's «خطر» offers the archive and the delete", async () => {
    await loginAs(w.owner.id);
    const markup = rendered(await settings(w.space.id, { tab: "danger" }));
    expect(markup).toContain(AR["spset.danger.archive"] as string);
    expect(markup).toContain(AR["spaces.delete.open"] as string);
  });

  it("a plain member reads «الناس» and «المقاطع» only; a tab they are not offered falls back to the first, and nothing of the manager's is drawn", async () => {
    await loginAs(w.member.id);
    for (const query of [{}, { tab: "danger" }, { tab: "general" }, { tab: "nonsense" }] as Record<string, string>[]) {
      const markup = rendered(await settings(w.space.id, query));
      expect(tabsOf(markup)).toEqual(["people", "teams"]);
      expect(panelOf(markup)).toBe("people");
      expect(markup).not.toContain(AR["ws.edit"] as string);
      expect(markup).not.toContain(AR["spset.danger.archive"] as string);
    }
    expect(panelOf(rendered(await settings(w.space.id, { tab: "teams" })))).toBe("teams");
  });

  it("an external partner gets «not found», and so does an ADMIN who is not in the space, and a space that does not exist", async () => {
    await loginAs(w.guest.id);
    expect(await settings(w.space.id)).toEqual({ kind: "not-found" });
    await loginAs(w.outsider.id);
    expect(await settings(w.space.id)).toEqual({ kind: "not-found" });
    await loginAs(w.owner.id);
    expect(await settings("no-such-space")).toEqual({ kind: "not-found" });
  });

  it("another company's space is «not found», even for its owner", async () => {
    const stranger = await makeOrg();
    const foreignOwner = await makeUser({ orgId: stranger.id, role: "OWNER", name: "Foreign" });
    await loginAs(foreignOwner.id);
    expect(await settings(w.space.id)).toEqual({ kind: "not-found" });
  });

  it("an archived space has no settings page (it is brought back from «كل المساحات»)", async () => {
    await db.workspace.update({ where: { id: w.space.id }, data: { archivedAt: new Date() } });
    await loginAs(w.owner.id);
    expect(await settings(w.space.id)).toEqual({ kind: "not-found" });
  });

  it("«الشركة» can be neither archived nor deleted: the owner's «خطر» tab is not offered there", async () => {
    const hqId = await ensureHqSpace(w.org.id, "الشركة");
    await loginAs(w.owner.id);
    const markup = rendered(await settings(hqId));
    expect(tabsOf(markup)).toEqual(["general", "people", "teams", "chat", "work"]);
  });

  it("the page follows the database on every request: a demoted space ADMIN loses the manager's tabs at once", async () => {
    await loginAs(w.lead.id);
    expect(tabsOf(rendered(await settings(w.space.id)))).toContain("general");
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.lead.id } }, data: { role: "MEMBER" } });
    expect(tabsOf(rendered(await settings(w.space.id)))).toEqual(["people", "teams"]);
  });
});

describe("A2.2 · what each tab holds", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await loginAs(w.owner.id);
  });

  it("«عام»: the same edit button as before (same labels), the space's emoji and its layout", async () => {
    await db.workspace.update({ where: { id: w.space.id }, data: { emoji: "🚀", description: "Launch plan" } });
    const markup = rendered(await settings(w.space.id));
    expect(markup).toContain(AR["ws.edit"] as string);
    expect(markup).toContain("🚀");
    expect(markup).toContain("Launch plan");
    expect(markup).toContain(AR["cards.space_type.STANDARD"] as string);
  });

  it("«الناس» and «المقاطع» draw the dialogs' own content in place (no button that opens a dialog)", async () => {
    const people = rendered(await settings(w.space.id, { tab: "people" }));
    expect(people).toContain("data-ws-members-panel");
    expect(people).not.toContain("data-ws-members-open");
    const teams = rendered(await settings(w.space.id, { tab: "teams" }));
    expect(teams).toContain("data-ws-teams-panel");
    expect(teams).toContain(AR["spaceteams.hint"] as string);
    expect(teams).not.toContain("data-ws-teams-open");
  });

  it("«الدردشة»: the topics a space starts with and who opens topics; no topic of the space is listed (a private one stays private)", async () => {
    await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.space.id, title: "Salary talks", restricted: true } });
    const markup = rendered(await settings(w.space.id, { tab: "chat" }));
    expect(markup).toContain(AR["spset.chat.starters"] as string);
    expect(markup).toContain("التنبيهات");
    expect(markup).toContain(AR["spset.chat.who_opens"] as string);
    expect(markup).not.toContain("Salary talks");
  });

  it("«الشغل»: the default board columns with their stage, and each linked part only while its switch is on", async () => {
    const on = rendered(await settings(w.space.id, { tab: "work" }));
    expect(on).toContain(AR["column.backlog"] as string);
    expect(on).toContain(AR["spset.work.columns"] as string);
    expect(on).toContain("data-checkin-settings-open");
    await setFeature(w.org.id, "checkins", false);
    const off = rendered(await settings(w.space.id, { tab: "work" }));
    expect(off).not.toContain("data-checkin-settings-open");
    expect(off).toContain(AR["spset.work.columns"] as string);
  });

  it("«الشغل»: the approval forms and the custom fields are pointed to only while their switches are on", async () => {
    const hrefs = async () => hrefsOf(rendered(await settings(w.space.id, { tab: "work" })));
    await setFeature(w.org.id, "approvals", false);
    await setFeature(w.org.id, "customFields", false);
    expect((await hrefs()).some((h) => h.includes("approvals%2Fforms"))).toBe(false);
    await setFeature(w.org.id, "approvals", true);
    await setFeature(w.org.id, "customFields", true);
    const on = await hrefs();
    expect(on.some((h) => h.includes("approvals%2Fforms"))).toBe(true);
    // the link enters THIS space first (`/go`), so the screen it opens is this space's, not the one the cookie holds
    expect(on.find((h) => h.includes("approvals%2Fforms"))).toContain(encodeURIComponent(w.space.id));
  });
});

describe("A2.2 · /spaces/current and the buttons of /projects lead here (switch ON)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
  });

  it("a manager of the space they are in is sent to its settings page", async () => {
    await loginAs(w.lead.id);
    enter(w.space.id);
    expect(await open(() => CurrentSpacePage())).toEqual({ kind: "redirect", to: `/spaces/${w.space.id}/settings` });
  });

  it("a plain member keeps the old plain notice and is told nothing about the space; an external partner too", async () => {
    for (const who of [w.member, w.guest]) {
      await loginAs(who.id);
      enter(w.space.id);
      const page = await open(() => CurrentSpacePage());
      expect(page.kind).toBe("rendered");
      if (page.kind === "rendered") {
        expect(page.text).toContain(AR["spaces.manage.not_yours"] as string);
        expect(page.text).not.toContain("Secret Launch Space");
      }
    }
  });

  it("the manager's projects page links «المقاطع» to the tab, and a plain member's «الناس» and «المقاطع» too; neither opens a dialog", async () => {
    await loginAs(w.lead.id);
    enter(w.space.id);
    const manager = rendered(await open(() => ProjectsPage({ searchParams: {} })));
    expect(hrefsOf(manager)).toContain(`/spaces/${w.space.id}/settings?tab=teams`);
    expect(manager).toContain(AR["spaceteams.title"] as string);

    await loginAs(w.member.id);
    enter(w.space.id);
    const member = rendered(await open(() => ProjectsPage({ searchParams: {} })));
    expect(hrefsOf(member)).toEqual(expect.arrayContaining([`/spaces/${w.space.id}/settings?tab=people`, `/spaces/${w.space.id}/settings?tab=teams`]));
  });

  it("an external partner keeps the dialogs: the settings page is not theirs", async () => {
    await loginAs(w.guest.id);
    enter(w.space.id);
    const out = await open(() => ProjectsPage({ searchParams: {} }));
    if (out.kind === "rendered") expect(hrefsOf(out.markup).some((h) => h.includes("/settings"))).toBe(false);
  });
});

describe("A2.2 · the space's emoji, through the same door as its name", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });
  const patch = (id: string, body: unknown) => call(spaceRoute.PATCH, { params: { id }, method: "PATCH", body });

  it("the space's manager sets and clears it; the name and description stay as they were", async () => {
    await loginAs(w.lead.id);
    const set = await patch(w.space.id, { emoji: "🚀" });
    expect(set.status).toBe(200);
    expect(await db.workspace.findUnique({ where: { id: w.space.id }, select: { emoji: true, name: true } })).toEqual({ emoji: "🚀", name: "Secret Launch Space" });
    expect((await patch(w.space.id, { emoji: null })).status).toBe(200);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.space.id } })).emoji).toBeNull();
  });

  it("the old body (a name, a description) still works", async () => {
    await loginAs(w.lead.id);
    expect((await patch(w.space.id, { name: "Renamed", description: "d" })).status).toBe(200);
    const row = await db.workspace.findUniqueOrThrow({ where: { id: w.space.id } });
    expect([row.name, row.description]).toEqual(["Renamed", "d"]);
  });

  it("a plain member and an external partner are refused and nothing is saved", async () => {
    for (const who of [w.member, w.guest]) {
      await loginAs(who.id);
      expect((await patch(w.space.id, { emoji: "💥" })).status, who.name).toBe(403);
    }
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.space.id } })).emoji).toBeNull();
  });

  it("text is not an emoji, an empty body is refused, and nothing is saved", async () => {
    await loginAs(w.lead.id);
    for (const body of [{ emoji: "hello" }, { emoji: "x".repeat(40) }, { emoji: "" }, {}]) {
      expect((await patch(w.space.id, body)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.space.id } })).emoji).toBeNull();
  });
});

describe("A2.2 · archive and delete stay where they were", () => {
  it("archive: the OWNER and an ADMIN of the company; a space's own ADMIN row (a LEAD) is refused; delete with its work: the OWNER alone", async () => {
    const w = await world();
    const archive = (id: string) => call(archiveRoute.POST, { params: { id }, body: { archived: true } });
    const wipe = (id: string, name: string) => call(deleteAllRoute.POST, { params: { id }, body: { confirmName: name } });

    await loginAs(w.lead.id);
    expect((await archive(w.space.id)).status).toBe(403);
    expect((await wipe(w.space.id, "Secret Launch Space")).status).toBe(403);

    await loginAs(w.admin.id);
    expect((await wipe(w.space.id, "Secret Launch Space")).status).toBe(403);
    expect((await db.workspace.findUnique({ where: { id: w.space.id } }))?.id).toBe(w.space.id);
    expect((await archive(w.space.id)).status).toBe(200);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: w.space.id } })).archivedAt).not.toBeNull();

    await loginAs(w.owner.id);
    expect((await wipe(w.other.id, "Other Space")).status).toBe(200);
    expect(await db.workspace.findUnique({ where: { id: w.other.id } })).toBeNull();
  });
});
