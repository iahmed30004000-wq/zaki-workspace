import "./scoping-react";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// The page calls redirect(); its client parts call useRouter(). Neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import HomePage from "@/app/(app)/page";
import { FirstStepsCard } from "@/components/guide/first-steps-card";
import { InstallHint } from "@/components/pwa/install-hint";
import { TodayQuickAdd } from "@/components/today/quick-add";
import { TeamPulse } from "@/components/today/team-pulse";
import { TodayTeamCard } from "@/components/today/team-card";
import { TodayTasksCard } from "@/components/today/today-tasks";
import { fmtLongDate } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import { zonedStandIn } from "@/lib/zoned-time";
import { db, loginAs, logout, makeProject, makeTask, makeUser, makeWorkspace } from "./helpers";
import { makeTwoCompanyPerson } from "./pages-access-helpers";
import { joinWorkspace } from "./scoping-helpers";
import { actorOf, atMoment, hrefsOf, html, put, readable, setMember, todayFor, todayNoon, typesInOrder, world, type World } from "./today-helpers";
import { makeDepartment, makeTicket } from "./guest-helpers";
import { withFeature } from "@/lib/features";
import { waitingRequestCount } from "@/server/services/work-requests";
import type { Prisma } from "@prisma/client";
import { classTokens, PALETTE_COLOUR, PHYSICAL_UTILITY } from "../ui-render";

const { t } = getServerT();

const DAY = 24 * 3600 * 1000;
const ago = (days: number, now: Date = new Date()) => new Date(now.getTime() - days * DAY);
const ahead = (days: number, now: Date = new Date()) => new Date(now.getTime() + days * DAY);

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

const count = (types: unknown[], type: unknown) => types.filter((x) => x === type).length;

/** The company with Arabic names for everybody, and a busy week for the member, every date counted from one `now`. */
async function busyWorld(now: Date = new Date()) {
  const w = await world();
  await db.user.update({ where: { id: w.owner.id }, data: { name: "المالك أحمد" } });
  await db.user.update({ where: { id: w.member.id }, data: { name: "سارة خالد" } });
  await db.user.update({ where: { id: w.lead.id }, data: { name: "عمر قائد" } });
  const overdue = await put(w, "in", { title: "عقد متأخر", assigneeId: w.member.id, priority: "URGENT", due: ago(3, now) });
  const today = await put(w, "in", { title: "تقرير اليوم", assigneeId: w.member.id, priority: "HIGH", due: todayNoon("UTC", now) });
  const later = await put(w, "in", { title: "عرض الأسبوع القادم", assigneeId: w.member.id, due: ahead(4, now) });
  const colleague = await put(w, "in", { title: "مهمة الزميل عمر", assigneeId: w.lead.id, due: ago(9, now) });
  const closed = await put(w, "out", { title: "مهمة المساحة المغلقة", assigneeId: w.member.id, due: now });
  return { w, overdue, today, later, colleague, closed };
}

// `/` is the page itself (a step that says «add your first task»); `/guide…` are the guide pages the
// first-steps card points at; `/chat` is the card's «ابعت أول رسالة بـ«عام»» step (phase 3). None is a
// wall of navigation: each is the one place a first step happens.
const allowedLinks = /^(\/|\/\?view=today|\/tasks\/[\w-]+|\/projects(\/[\w-]+)?|\/my-work(\?tab=\w+)?|\/guide(\/[\w-]+)?|\/chat|\/time)$/;

/**
 * The owner's «لوحة التحكم» (2026-11-02) is a deliberate section of his home: numbers, sentences and who did what, not a wall of navigation. It is
 * checked on its own (its links go to the panel's own page, the list of late work and the ideas, nowhere else) and taken out for the checks that
 * are about the rest of the page.
 */
// B4: the late-work and ideas sentences enter the space they name (`/go?space=…&next=…`: «مهامي» on its late tasks, its «الأفكار»), not `/list?filter=overdue`
const panelLinks = /^(\/owner(\/people\/[\w-]+|\?v=\w+)?|\/go\?space=[\w-]+(&amp;|&)next=[\w%.-]+)$/;
function splitPanel(markup: string): { rest: string; panel: string } {
  const marker = markup.indexOf('data-testid="control-panel"');
  if (marker < 0) return { rest: markup, panel: "" };
  const start = markup.lastIndexOf("<section", marker);
  let depth = 0;
  let end = start;
  for (const m of markup.slice(start).matchAll(/<(\/?)section\b/g)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      end = start + (m.index as number) + "</section>".length;
      break;
    }
  }
  return { rest: markup.slice(0, start) + markup.slice(end), panel: markup.slice(start, end) };
}

describe("the home page: «اليوم»", () => {
  it("greets by first name, writes the date in Arabic, and shows the member's own tasks in three groups with the done button", async () => {
    // one clock for the fixtures and the page (which reads the time itself): midnight cannot fall between them
    const now = new Date();
    const { w, overdue, today, later } = await busyWorld(now);
    const markup = await atMoment(now, async () => {
      await loginAs(w.member.id);
      return html(HomePage({}));
    });

    // «نجمة وطريق»: the most overdue task is the mission, the page's one heading; the greeting is under it
    expect([...markup.matchAll(/<h1\b/g)]).toHaveLength(1);
    expect(markup).toMatch(/<h1 id="today-mission"[^>]*><bdi>عقد متأخر<\/bdi><\/h1>/);
    expect(markup).toMatch(/(صباح|مساء) الخير يا سارة · /);
    expect(markup).toContain(fmtLongDate(zonedStandIn(todayNoon("UTC", now), "UTC")));

    for (const [task, title] of [[overdue, "عقد متأخر"], [today, "تقرير اليوم"], [later, "عرض الأسبوع القادم"]] as const) {
      expect(hrefsOf(markup), title).toContain(`/tasks/${task.id}`);
      expect(markup, title).toContain(`aria-label="${t("today.done_aria", { title })}"`);
    }
    expect(markup).toContain(t("mywork.tab.overdue"));
    expect(markup).toContain(t("today.tasks.later"));
    expect(markup).toContain("قبل 3 أيام");
    expect(markup).toContain(t("priority.URGENT"));
    expect(markup).toContain(t("priority.HIGH"));
    expect(markup).toContain("مشروع الفريق");
  });

  it("never shows a colleague's task or one from a space the person is not in", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    const markup = await html(HomePage({}));
    expect(markup).not.toContain("مهمة الزميل عمر");
    expect(markup).not.toContain("مهمة المساحة المغلقة");
    expect(markup).not.toContain("مشروع مغلق");
  });

  it("carries the tour's hooks: the task list and the quick add, once each (the first-steps card brings its own)", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    const markup = await html(HomePage({}));
    expect([...markup.matchAll(/data-tour="today-tasks"/g)]).toHaveLength(1);
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(1);
    // the inline line at the foot of the list, and «المشروع والموعد» for the full sheet
    expect(markup).toContain(`placeholder="${t("today.quick.inline_placeholder")}"`);
    expect(markup).toContain(t("today.quick.more"));
  });

  it("mounts the first-steps card for the person's own actor, then the install hint once, then the tasks", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    const page = await HomePage({});
    const order = typesInOrder(page);
    expect(count(order, FirstStepsCard)).toBe(1);
    expect(count(order, InstallHint)).toBe(1);
    // 01-FIX-WAVE-BRIEFS item 1(a): the hint sat above the task list and pushed it down 100-300px
    // after load, so people tapped the wrong row. The agreed order is card, tasks, hint.
    expect(order.indexOf(FirstStepsCard)).toBeLessThan(order.indexOf(TodayTasksCard));
    expect(order.indexOf(TodayTasksCard)).toBeLessThan(order.indexOf(InstallHint));
    const card = findType(page, FirstStepsCard);
    expect((card?.props as { actor: { userId: string; orgId: string } }).actor).toMatchObject({ userId: w.member.id, orgId: w.org.id });
  });

  it("draws the strip once: the mission and the greeting on a scrim; its only controls are the mission's two, on the panel", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    const markup = await html(HomePage({}));
    expect([...markup.matchAll(/zk-decor-strip/g)]).toHaveLength(1);
    // the strip wires the owner's picture by its agreed name; with no artwork shipped it draws nothing at
    // all (`ArtSlot` returns null while `ART_AVAILABLE` is empty — tests/art-available.test.ts owns that rule)
    expect(markup).not.toContain("data-art-slot");
    expect(readFileSync("src/components/today/today-hero.tsx", "utf8")).toContain('"today-strip"');
    const hero = /<section[^>]*aria-labelledby="today-mission"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
    expect(hero).toContain("zk-scrim");
    expect(hero).toContain("الخير يا سارة");
    const panelAt = hero.indexOf('class="zk-scrim');
    expect(hero.slice(0, panelAt)).not.toMatch(/<(a|button)\b/);
    expect([...hero.matchAll(/href="\/tasks\//g)]).toHaveLength(1); // «ابدأ المهمّة», the mission's own page
    // no count, no list over the picture
    expect(hero).not.toMatch(/<ul|مفتوحة/);
  });

  it("is not a wall of navigation cards: no card grid, no link to a place that has its own tab, no module counters", async () => {
    const { w } = await busyWorld();
    for (const person of [w.member.id, w.owner.id]) {
      await loginAs(person);
      const { rest: markup, panel } = splitPanel(await html(HomePage({})));
      expect(classTokens(markup).filter((c) => /(^|:)grid-cols-/.test(c))).toEqual([]);
      expect(hrefsOf(markup).filter((h) => !allowedLinks.test(h))).toEqual([]);
      expect(hrefsOf(panel).filter((h) => !panelLinks.test(h))).toEqual([]);
      if (person === w.member.id) expect(panel).toBe("");
      for (const old of ["home.sectionWork", "home.sectionLib", "home.sectionTools", "home.unit_chats", "home.unit_files", "home.unit_depts"]) {
        expect(markup).not.toContain(t(old));
      }
    }
  });

  it("is made of theme tokens and logical CSS: no palette colour, no inline colour, no left/right", async () => {
    const { w } = await busyWorld();
    for (const person of [w.member.id, w.owner.id, w.guest.id]) {
      await loginAs(person);
      const markup = await html(HomePage({}));
      const tokens = classTokens(markup);
      expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
      expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
      expect(tokens.filter((c) => /^(?:min-|max-)?w-\[\d{3,}px\]$/.test(c))).toEqual([]);
      expect(markup).not.toMatch(/style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/);
    }
  });

  it("says everything in Arabic: no English word reaches a person, not a raw status, priority or key", async () => {
    const { w } = await busyWorld();
    await db.project.update({ where: { id: w.inside.project.id }, data: { status: "AT_RISK", name: "مشروع الهوية" } });
    // the owner's panel names the company's people: they are given Arabic names here, like the two the busy world names already
    let n = 0;
    for (const u of await db.user.findMany({ where: { memberships: { some: { organizationId: w.org.id } }, id: { notIn: [w.owner.id, w.member.id] } }, select: { id: true } })) {
      await db.user.update({ where: { id: u.id }, data: { name: `زميل ${++n}` } });
    }
    for (const person of [w.member.id, w.owner.id]) {
      await loginAs(person);
      const text = readable(await html(HomePage({})));
      expect(text).not.toMatch(/[A-Za-z]{2,}/);
      expect(text).not.toMatch(/\b(?:today|common|task|mywork|proj|time|priority)\.[a-z_]+/);
      expect(text).not.toMatch(/\b(PLANNING|ACTIVE|ON_HOLD|AT_RISK|COMPLETED|URGENT|NORMAL|HIGH|LOW|NONE)\b/);
    }
  });
});

describe("the home page: what is empty says what to do", () => {
  it("a member with no task today gets the empty state: the next step, «افتح مهامي», and the drawing slot; the quick add is still one tap away", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const markup = await html(HomePage({}));
    expect(markup).toContain(t("today.empty.title"));
    expect(markup).toMatch(new RegExp(`<a[^>]*href="/my-work"[^>]*>${t("today.empty.action")}</a>`));
    expect(readFileSync("src/components/today/today-tasks.tsx", "utf8")).toContain('"empty-tasks"');
    expect([...markup.matchAll(/data-tour="today-tasks"/g)]).toHaveLength(1);
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(1);
  });

  it("a partner who has been put in no space yet is told so, with a way to read about spaces, and is offered no quick add", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const markup = await html(HomePage({}));
    expect(markup).toContain(t("today.empty.no_space_title"));
    expect(hrefsOf(markup)).toContain("/guide/spaces");
    expect(markup).not.toContain('data-tour="quick-add"');
    expect(markup).toContain('data-tour="today-tasks"');
  });

  it("somebody who may open a space, and has none (an admin gets no space by rank), is told to open the first one", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const markup = await html(HomePage({}));
    expect(markup).toContain(t("today.empty.create_space_title"));
    expect(hrefsOf(markup)).toContain("/projects");
    expect(markup).not.toContain(t("today.empty.no_space_title"));
    expect(markup).not.toContain('data-tour="quick-add"'); // no space, nowhere to add
    expect(markup).not.toContain(t("today.pulse.title")); // and nothing to take the pulse of
  });

  it("with only later tasks, says nothing is due today instead of an empty box", async () => {
    const w = await world();
    await put(w, "in", { title: "بعد أيام", assigneeId: w.member.id, due: ahead(5) });
    await loginAs(w.member.id);
    const markup = await html(HomePage({}));
    expect(markup).toContain(t("today.tasks.nothing_today"));
    expect(markup).toContain("بعد أيام");
    expect(markup).not.toContain(t("today.empty.title"));
  });
});

describe("the home page: who sees what", () => {
  it("an external partner sees their own tasks to read, no done button, no quick add, no pulse, and none of the company", async () => {
    const { w } = await busyWorld();
    await joinWorkspace(w.guest.id, w.wsIn.id, "GUEST");
    await put(w, "in", { title: "مهمة الشريك", assigneeId: w.guest.id, due: todayNoon() });
    await loginAs(w.guest.id);
    const page = await HomePage({});
    const markup = await html(page);

    expect(markup).toContain("مهمة الشريك");
    expect(markup).not.toContain("عقد متأخر"); // the member's work, in the same space
    expect(markup).not.toContain("مهمة الزميل عمر");
    expect(markup).not.toContain('aria-label="إنجاز المهمة');
    // No act on a task: the done control (asserted by its aria-label above) and the quick add are
    // what a partner must not get. A blanket "<button" is too broad — the first-steps card's own
    // fold and dismiss buttons are not an action on anybody's work.
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(0);
    expect(markup).not.toContain('data-tour="quick-add"');
    expect(markup).not.toContain(t("today.pulse.title"));
    expect(markup).toContain('data-tour="today-tasks"');
    expect(markup).toContain(t("today.projects.open_mine", { n: 1 }));
    const order = typesInOrder(page);
    expect(count(order, TodayQuickAdd)).toBe(0);
    expect(count(order, TeamPulse)).toBe(0);
    expect(count(order, FirstStepsCard)).toBe(1); // the card decides for itself what a partner is asked to do
  });

  it("the team pulse is the owner's and the people managers', with the most overdue tasks and who holds them", async () => {
    const { w, colleague } = await busyWorld();
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "موقوف سامي" });
    await setMember(w.org.id, suspended.id, { status: "SUSPENDED" });
    await put(w, "in", { title: "مهمة الموقوف", assigneeId: suspended.id, due: ago(30) });

    await loginAs(w.owner.id);
    const owner = await html(HomePage({}));
    expect(owner).toContain(t("today.pulse.title"));
    expect(owner).toContain(t("today.pulse.worst"));
    expect(hrefsOf(owner)).toContain(`/tasks/${colleague.id}`);
    expect(owner).toContain("مهمة الزميل عمر");
    expect(owner).toContain("عمر قائد"); // who holds it
    expect(owner).not.toContain("مهمة الموقوف");
    expect(owner).not.toContain("موقوف سامي");

    // A2.3: «فريقي» — an admin has the pulse only once somebody answers to them (users.manage no longer decides it)
    await joinWorkspace(w.admin.id, w.wsIn.id); // an admin gets no space by rank
    await loginAs(w.admin.id);
    expect(await html(HomePage({}))).not.toContain(t("today.pulse.title"));
    await setMember(w.org.id, w.lead.id, { managerId: w.admin.id }); // «عمر قائد» holds the colleague's task
    await loginAs(w.admin.id);
    const admin = await html(HomePage({}));
    expect(admin).toContain(t("today.pulse.title"));
    expect(admin).toContain("مهمة الزميل عمر"); // the person under them holds it
    expect(admin).toContain(t("today.team.scope_mine")); // and the card says whose numbers they are

    for (const person of [w.member, w.lead]) {
      await loginAs(person.id);
      expect(await html(HomePage({})), person.name).not.toContain(t("today.pulse.title"));
    }
    await loginAs(w.member.id);
    expect(await html(HomePage({}))).not.toContain("مهمة الزميل عمر"); // a colleague's task is not a plain member's business

    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    await loginAs(w.member.id);
    expect(await html(HomePage({}))).not.toContain(t("today.pulse.title")); // the box alone makes no team
  });

  it("serves the ACTIVE company: somebody whose older membership is suspended sees the newer company's work and nothing of the old one", async () => {
    // the old pages took the person's OLDEST membership, suspended or not, and read the wrong company
    const w = await makeTwoCompanyPerson({ oldRole: "ADMIN", newRole: "MEMBER" });
    const workIn = async (orgId: string, ownerId: string, label: string) => {
      const space = await makeWorkspace(orgId, [{ userId: w.person.id }], `مساحة ${label}`);
      const made = await makeProject(space.id, `مشروع ${label}`);
      return makeTask({
        orgId,
        workspaceId: space.id,
        projectId: made.project.id,
        boardId: made.board.id,
        columnId: made.todo.id,
        creatorId: ownerId,
        assigneeId: w.person.id,
        title: `مهمة ${label}`,
        dueDate: todayNoon("Asia/Damascus"),
      });
    };
    await workIn(w.oldOrg.id, w.oldOwner.id, "الشركة القديمة");
    await workIn(w.newOrg.id, w.newOwner.id, "الشركة الجديدة");
    await loginAs(w.person.id);
    const markup = await html(HomePage({}));
    expect(markup).toContain("مهمة الشركة الجديدة");
    expect(markup).toContain("مشروع الشركة الجديدة");
    expect(markup).not.toContain("القديمة");
    expect(markup).not.toContain(t("today.pulse.title")); // a plain member there, whatever the rank was in the company that suspended them
  });

  it("lists the active projects as links to the project", async () => {
    const { w } = await busyWorld();
    await db.project.update({ where: { id: w.inside.project.id }, data: { status: "ACTIVE" } });
    await loginAs(w.member.id);
    const markup = await html(HomePage({}));
    expect(markup).toContain(t("today.projects.title"));
    expect(hrefsOf(markup)).toContain(`/projects/${w.inside.project.id}`);
    expect(markup).toContain(t("today.projects.open", { n: 4 })); // the project's open tasks: three of the member's and the lead's
  });
});

describe("the home page and the session", () => {
  it("sends a visitor who is not signed in to login", async () => {
    logout();
    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("sends a suspended person who still has a cookie to login", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await setMember(w.org.id, w.member.id, { status: "SUSPENDED" });
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("sends a person who still owes the temporary-password change to onboarding, and shows them none of the page's data", async () => {
    const { w } = await busyWorld();
    await db.user.update({ where: { id: w.member.id }, data: { mustChangePassword: true } });
    await loginAs(w.member.id, { mcp: true });
    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("refuses a person whose notice is pending too (the layout's redirect alone does not stop a page)", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { transparencyVersion: 2 } } });
    await expect(HomePage({})).rejects.toThrow(/NEXT_REDIRECT:\/onboarding|auth\.onboarding_required/);
  });
});

// ───────────────────────────────────────── W1.7: «اليوم» simplified (navV2) ─────────────────────────────────────────

/**
 * With the switch `navV2` ON, «اليوم» is up to six cards in one order and ONE team card; the parts that moved sit under «المزيد» or in «لوحة التحكم».
 * With it OFF the page is the old one (every test above runs with it OFF, the default). The pure rules are in tests/today-simple.test.ts.
 */
async function setFeatures(orgId: string, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = (org.settings as Record<string, unknown> | null) ?? {};
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

/** «اليوم» itself («/» alone follows the company's landing page while navV2 is on). */
const todayPage = () => HomePage({ searchParams: { view: "today" } });
const cardsOf = (markup: string) => [...markup.matchAll(/data-today-card="(\w+)"/g)].map((m) => m[1] as string);
const slotOf = (markup: string, key: string) => new RegExp(`<div[^>]*data-today-card="${key}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-today-card=|<details[^>]*data-today-more|$)`).exec(markup)?.[0] ?? "";

/** Seven tickets waiting in a department of the member's (and one in a department they are not in), made oldest to newest. */
async function waitingTickets(w: World, memberIds: string[]) {
  const dept = await makeDepartment(w.org.id, { name: "قسم الدعم", memberIds, leadId: w.lead.id });
  const other = await makeDepartment(w.org.id, { name: "قسم آخر", memberIds: [w.lead.id] });
  const titles: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const row = await makeTicket({ orgId: w.org.id, departmentId: dept.id, creatorId: w.lead.id, title: `تذكرة بانتظار ${i}` });
    await db.ticket.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - (8 - i) * 3600 * 1000) } });
    titles.push(row.title);
  }
  await makeTicket({ orgId: w.org.id, departmentId: other.id, creatorId: w.lead.id, title: "تذكرة قسم غريب" });
  return { dept, titles };
}

/** A topic of a space with these people in it (a row each), and messages by `by` that mention `who`. */
async function mentionTopic(w: World, opts: { spaceId: string; title: string; members: string[]; restricted?: boolean }) {
  const old = new Date("2020-01-01T00:00:00Z");
  return db.conversation.create({
    data: {
      orgId: w.org.id,
      kind: "TOPIC",
      spaceId: opts.spaceId,
      title: opts.title,
      restricted: opts.restricted ?? false,
      members: { create: opts.members.map((userId) => ({ userId, lastReadAt: old })) },
    },
  });
}
const say = (w: World, conversationId: string, authorId: string, body: string, mentions: string[] = []) =>
  db.chatMessage.create({ data: { orgId: w.org.id, conversationId, authorId, body, mentions } });

const ALLOWED_ON = /^(\/|\/\?view=today|\/tasks\/[\w-]+|\/projects(\/[\w-]+)?|\/my-work(\?tab=\w+)?|\/guide(\/[\w-]+)?|\/chat(\/[\w-]+|\/s\/[\w-]+)?|\/time|\/requests|\/tickets|\/owner|\/approvals\/[\w-]+|\/cards\/[\w-]+|\/knowledge\/[\w-]+|\/checkins|\/reminders)$/;

describe("W1.7 «اليوم» simplified: with navV2 OFF the page is the old one", () => {
  it("draws no card slot and no «المزيد»; the owner still gets the pulse and the plain member the dashboard, as before", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: false, workRequests: true });
    await waitingTickets(w, [w.member.id]);
    for (const person of [w.owner.id, w.member.id]) {
      await loginAs(person);
      const page = await HomePage({});
      const markup = await html(page);
      expect(markup).not.toContain("data-today-card");
      expect(markup).not.toContain("data-today-more");
      expect(markup).not.toContain(t("today.waiting.title"));
      expect(markup).not.toContain(t("today.mentions.title"));
      expect(count(typesInOrder(page), TodayTeamCard)).toBe(0);
      expect(markup).toContain('id="today-dash-title"');
      if (person === w.owner.id) expect(count(typesInOrder(page), TeamPulse)).toBe(1);
    }
  });
});

describe("W1.7 «اليوم» simplified: the cards (navV2 ON)", () => {
  it("a plain member: «مهامي اليوم» with the quick add, «تذكيراتي», «التسجيل اليومي» — in this order; no team card, no pulse; the hero strip once", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, reminders: true, checkins: true });
    await loginAs(w.member.id);
    const markup = await html(todayPage());
    expect(cardsOf(markup)).toEqual(["tasks", "reminders", "checkin"]);
    expect([...markup.matchAll(/<h1\b/g)]).toHaveLength(1);
    expect([...markup.matchAll(/zk-decor-strip/g)]).toHaveLength(1);
    expect(markup).toContain("عقد متأخر");
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(1);
    expect(markup).not.toContain('id="today-pulse-title"');
    expect(markup).not.toContain('id="today-team-title"');
    expect(markup).not.toContain("data-today-scope");
    expect(markup).not.toContain('id="today-dash-team"');
  });

  it("«بانتظار قرارك»: the count of the inbox and its newest five, only what the person may see; nothing while workRequests is off", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, workRequests: true });
    const { titles } = await waitingTickets(w, [w.member.id]);
    await loginAs(w.member.id);
    const markup = await html(todayPage());
    expect(cardsOf(markup)).toContain("waiting");
    expect(cardsOf(markup).indexOf("waiting")).toBe(1);
    const slot = slotOf(markup, "waiting");
    // the newest five of seven; the other department's ticket is neither listed nor counted
    for (const title of titles.slice(2)) expect(slot, title).toContain(title);
    for (const title of titles.slice(0, 2)) expect(slot, title).not.toContain(title);
    expect(markup).not.toContain("تذكرة قسم غريب");
    expect(slot).toContain(`aria-label="${t("shell.place_waiting", { count: 7 })}"`);
    expect(slot).toContain(t("today.waiting.rest", { n: 2 }));
    expect(hrefsOf(slot)).toContain("/requests");
    expect(await waitingRequestCount(await actorOf(w.member.id))).toBe(7);

    await setFeatures(w.org.id, { workRequests: false });
    await loginAs(w.member.id);
    expect(cardsOf(await html(todayPage()))).not.toContain("waiting");
  });

  it("«بانتظار قرارك» is not drawn when nothing waits, nor for a partner", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, workRequests: true });
    await loginAs(w.member.id);
    expect(cardsOf(await html(todayPage()))).not.toContain("waiting");
    await waitingTickets(w, [w.member.id, w.guest.id]);
    await joinWorkspace(w.guest.id, w.wsIn.id, "GUEST");
    await loginAs(w.guest.id);
    expect(cardsOf(await html(todayPage()))).toEqual(["tasks"]);
  });

  it("«ذكروك»: a conversation the person reads with an unread mention, as a link into it; never the text, never a space they left, never a restricted topic they are not in", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true });
    const open = await mentionTopic(w, { spaceId: w.wsIn.id, title: "موضوع المبيعات", members: [w.member.id, w.lead.id] });
    await say(w, open.id, w.lead.id, "سر المحادثة الأول", [w.member.id]);
    await say(w, open.id, w.lead.id, "سر المحادثة الثاني", [w.member.id]);
    await say(w, open.id, w.lead.id, "بدون ذكر");
    // a space the person is no longer in: a leftover row of theirs must add nothing
    const left = await mentionTopic(w, { spaceId: w.wsOut.id, title: "موضوع مساحة تركتها", members: [w.member.id, w.lead.id] });
    await say(w, left.id, w.lead.id, "ذكر في مساحة غريبة", [w.member.id]);
    // a restricted topic of the space with no row of theirs
    const secret = await mentionTopic(w, { spaceId: w.wsIn.id, title: "موضوع مقيّد", members: [w.lead.id], restricted: true });
    await say(w, secret.id, w.lead.id, "ذكر في موضوع مقيّد", [w.member.id]);

    await loginAs(w.member.id);
    const markup = await html(todayPage());
    expect(cardsOf(markup)[1]).toBe("mentions");
    const slot = slotOf(markup, "mentions");
    expect(hrefsOf(slot)).toContain(`/chat/${open.id}`);
    expect(slot).toContain("موضوع المبيعات");
    expect(slot).toContain(t("today.mentions.count", { n: 2 }));
    expect(markup).not.toContain("سر المحادثة");
    for (const hidden of ["موضوع مساحة تركتها", "موضوع مقيّد", "ذكر في"]) expect(markup, hidden).not.toContain(hidden);
    expect(hrefsOf(markup)).not.toContain(`/chat/${left.id}`);
    expect(hrefsOf(markup)).not.toContain(`/chat/${secret.id}`);

    // somebody nobody mentioned gets no card
    await loginAs(w.lead.id);
    expect(cardsOf(await html(todayPage()))).not.toContain("mentions");
  });

  it("«ذكروك» is silent for the owner who only reads (no row of his own in the conversation)", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true });
    const topic = await mentionTopic(w, { spaceId: w.wsIn.id, title: "موضوع الفريق", members: [w.member.id, w.lead.id] });
    await say(w, topic.id, w.lead.id, "يا مالك", [w.owner.id]);
    await loginAs(w.owner.id);
    expect(cardsOf(await html(todayPage()))).not.toContain("mentions");
    // and the page wrote nothing: still no row for him, no read mark moved
    expect(await db.conversationMember.count({ where: { conversationId: topic.id, userId: w.owner.id } })).toBe(0);
  });

  it("«تذكيراتي» carries «مواعيد اليوم»: my own tickets whose follow-up day has come or passed, in the company's calendar; never another person's, never a later day", async () => {
    const now = new Date();
    const { w } = await busyWorld(now);
    await setFeatures(w.org.id, { navV2: true, reminders: false });
    const dept = await makeDepartment(w.org.id, { memberIds: [w.member.id, w.lead.id], leadId: w.lead.id });
    const day = (offset: number) => {
      const p = zonedStandIn(now, "UTC");
      return new Date(Date.UTC(p.getFullYear(), p.getMonth(), p.getDate() + offset));
    };
    const mk = async (title: string, over: { assigneeId: string; followUpAt: Date | null; status?: "OPEN" | "RESOLVED" }) => {
      const row = await makeTicket({ orgId: w.org.id, departmentId: dept.id, creatorId: w.lead.id, assigneeId: over.assigneeId, title, status: over.status ?? "OPEN" });
      await db.ticket.update({ where: { id: row.id }, data: { followUpAt: over.followUpAt } });
    };
    await mk("اتصال بالزبون اليوم", { assigneeId: w.member.id, followUpAt: day(0) });
    await mk("اتصال فات موعده", { assigneeId: w.member.id, followUpAt: day(-2) });
    await mk("اتصال بكرا", { assigneeId: w.member.id, followUpAt: day(1) });
    await mk("اتصال زميل", { assigneeId: w.lead.id, followUpAt: day(0) });
    await mk("اتصال منتهي", { assigneeId: w.member.id, followUpAt: day(0), status: "RESOLVED" });
    const markup = await atMoment(now, async () => {
      await loginAs(w.member.id);
      return html(todayPage());
    });
    // the switch is off, yet the slot exists because a follow-up day has come
    expect(cardsOf(markup)).toEqual(["tasks", "reminders", "checkin"]);
    const slot = slotOf(markup, "reminders");
    expect(slot).toContain("اتصال بالزبون اليوم");
    expect(slot).toContain("اتصال فات موعده");
    expect(slot).toContain(t("today.follow.title"));
    for (const hidden of ["اتصال بكرا", "اتصال زميل", "اتصال منتهي"]) expect(slot, hidden).not.toContain(hidden);
    expect(hrefsOf(slot)).toContain("/tickets");
    // without the tickets box nothing is read
    await setMember(w.org.id, w.member.id, { revokedCapabilities: ["tickets.view"] });
    await loginAs(w.member.id);
    expect(slotOf(await html(todayPage()), "reminders")).not.toContain("اتصال بالزبون اليوم");
  });
});

describe("W1.7 «اليوم» simplified: the one team card (navV2 ON)", () => {
  it("the owner gets ONE team card with its scope chip, the numbers of the old pulse and strip, and a link to «لوحة التحكم»; the three old team pieces are gone", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, controlPanel: true });
    await loginAs(w.owner.id);
    const markup = await html(todayPage());
    expect([...markup.matchAll(/id="today-team-title"/g)]).toHaveLength(1);
    expect([...markup.matchAll(/data-today-scope=/g)]).toHaveLength(1);
    expect(cardsOf(markup).at(-1)).toBe("team");
    // the scope is the space the owner is in (the page counts inside one space), said on the card
    const space = await db.workspace.findFirstOrThrow({ where: { organizationId: w.org.id, id: w.wsIn.id }, select: { name: true } });
    expect(slotOf(markup, "team")).toContain(t("today.team.scope_space", { name: space.name }));
    // the old pieces: the pulse card, the dashboard's team strip, the owner's whole panel
    expect(markup).not.toContain('id="today-pulse-title"');
    expect(markup).not.toContain('id="today-dash-team"');
    expect(markup).not.toContain('data-testid="control-panel"');
    // the panel is «لوحة التحكم» at /owner and the card says so
    expect(hrefsOf(slotOf(markup, "team"))).toContain("/owner");
    // the most overdue tasks are still reachable, inside the card
    expect(hrefsOf(slotOf(markup, "team"))).toContain(`/tasks/${(await db.task.findFirstOrThrow({ where: { orgId: w.org.id, title: "مهمة الزميل عمر" } })).id}`);
    expect(markup).toContain("عمر قائد");
    // the numbers: open and overdue of the space, the same as the service's own
    const data = await todayFor(w.owner.id, undefined);
    expect(slotOf(markup, "team")).toContain(`>${data.pulse?.overdue}<`);

    await setFeatures(w.org.id, { controlPanel: false });
    await loginAs(w.owner.id);
    expect(hrefsOf(slotOf(await html(todayPage()), "team"))).not.toContain("/owner");
  });

  it("whoever has people under them gets it (A2.3: users.manage decides nothing); a person with nobody under them, a plain member, a team lead and a partner do not", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true });
    for (const person of [w.member, w.lead]) {
      await loginAs(person.id);
      expect(cardsOf(await html(todayPage())), person.name).not.toContain("team");
    }
    // the box alone makes no team: no card instead of a card of zeros
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    await loginAs(w.member.id);
    expect(cardsOf(await html(todayPage()))).not.toContain("team");
    // somebody answers to them: the card is there, and says whose numbers they are (the page narrows to the space they are in)
    await setMember(w.org.id, w.lead.id, { managerId: w.member.id });
    await loginAs(w.member.id);
    const markup = await html(todayPage());
    expect(cardsOf(markup)).toContain("team");
    expect(slotOf(markup, "team")).toContain(t("today.team.scope_space", { name: "مساحة الفريق" }));
    // and no link to a panel they cannot open
    expect(hrefsOf(slotOf(markup, "team"))).not.toContain("/owner");
  });

  it("is never more than six cards, in the fixed order, even with everything on", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, workRequests: true, reminders: true, checkins: true, controlPanel: true });
    await waitingTickets(w, [w.owner.id]);
    const topic = await mentionTopic(w, { spaceId: w.wsIn.id, title: "موضوع المالك", members: [w.owner.id, w.lead.id] });
    await say(w, topic.id, w.lead.id, "ذكر", [w.owner.id]);
    await loginAs(w.owner.id);
    const markup = await html(todayPage());
    expect(cardsOf(markup)).toEqual(["tasks", "waiting", "mentions", "reminders", "checkin", "team"]);
  });
});

describe("W1.7 «اليوم» simplified: what moved is under «المزيد», nothing is lost", () => {
  it("holds the personal numbers, the time line and the projects for a member, closed by default and Arabic; the quick add and the mission stay on the main column", async () => {
    const { w } = await busyWorld();
    await db.project.update({ where: { id: w.inside.project.id }, data: { status: "ACTIVE" } });
    await setFeatures(w.org.id, { navV2: true, timeTracking: true });
    await loginAs(w.member.id);
    const markup = await html(todayPage());
    const start = markup.indexOf("data-today-more");
    expect(start).toBeGreaterThan(0);
    const more = markup.slice(markup.lastIndexOf("<details", start));
    expect(more).not.toMatch(/^<details[^>]*\sopen/);
    for (const part of ["glance", "time", "projects"]) expect(more, part).toContain(`data-today-more-part="${part}"`);
    expect(more).toContain('id="today-dash-title"');
    expect(more).toContain(t("today.projects.title"));
    expect(hrefsOf(more)).toContain(`/projects/${w.inside.project.id}`);
    // not a second team card
    expect(more).not.toContain("today-dash-team");
    // the day's tasks are NOT folded away
    expect(markup.indexOf('data-tour="today-tasks"')).toBeLessThan(start);
  });

  it("a partner: their tasks, and under «المزيد» only the projects they work in", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true });
    await joinWorkspace(w.guest.id, w.wsIn.id, "GUEST");
    await put(w, "in", { title: "مهمة الشريك", assigneeId: w.guest.id, due: todayNoon() });
    await loginAs(w.guest.id);
    const markup = await html(todayPage());
    expect(cardsOf(markup)).toEqual(["tasks"]);
    expect(markup).toContain("مهمة الشريك");
    expect(markup).not.toContain('data-tour="quick-add"');
    expect(markup).not.toContain('id="today-dash-title"');
    expect(markup).toContain(t("today.projects.open_mine", { n: 1 }));
  });

  it("every link is one the page owns (a task, a project, the chat, the inbox, the tickets, the panel) — no wall of navigation; theme tokens and logical CSS only; Arabic only", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, workRequests: true, controlPanel: true, timeTracking: true });
    await waitingTickets(w, [w.owner.id]);
    const topic = await mentionTopic(w, { spaceId: w.wsIn.id, title: "موضوع المالك", members: [w.owner.id, w.lead.id] });
    await say(w, topic.id, w.lead.id, "ذكر", [w.owner.id]);
    let n = 0;
    for (const u of await db.user.findMany({ where: { memberships: { some: { organizationId: w.org.id } }, id: { notIn: [w.owner.id, w.member.id] } }, select: { id: true } })) {
      await db.user.update({ where: { id: u.id }, data: { name: `زميل ${++n}` } });
    }
    for (const person of [w.member.id, w.owner.id, w.guest.id]) {
      await loginAs(person);
      const markup = await html(todayPage());
      expect(hrefsOf(markup).filter((h) => !ALLOWED_ON.test(h)), person).toEqual([]);
      const tokens = classTokens(markup);
      expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
      expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
      expect(tokens.filter((c) => /(^|:)grid-cols-/.test(c))).toEqual([]);
      expect(markup).not.toMatch(/style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/);
      const text = readable(markup);
      expect(text).not.toMatch(/[A-Za-z]{2,}/);
      expect(text).not.toMatch(/\b(?:today|common|task|mywork|proj|time|priority|shell)\.[a-z_]+/);
    }
  });

  it("task data comes through the visibility rule: a private task of a colleague is neither listed nor counted on any card", async () => {
    const { w } = await busyWorld();
    await setFeatures(w.org.id, { navV2: true, taskPrivacy: true });
    const secret = await put(w, "in", { title: "مهمة سرية جدا", assigneeId: w.lead.id, due: ago(20) });
    await db.task.update({ where: { id: secret.id }, data: { visibility: "PARTICIPANTS" } });
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    await loginAs(w.member.id);
    const markup = await html(todayPage());
    expect(markup).not.toContain("مهمة سرية جدا");
    const data = await todayFor(w.member.id);
    expect(data.pulse?.worst.map((r) => r.title) ?? []).not.toContain("مهمة سرية جدا");
  });
});
