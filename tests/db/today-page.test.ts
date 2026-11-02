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
import { TodayTasksCard } from "@/components/today/today-tasks";
import { fmtLongDate } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import { zonedStandIn } from "@/lib/zoned-time";
import { db, loginAs, logout, makeProject, makeTask, makeUser, makeWorkspace } from "./helpers";
import { makeTwoCompanyPerson } from "./pages-access-helpers";
import { joinWorkspace } from "./scoping-helpers";
import { atMoment, hrefsOf, html, put, readable, setMember, todayNoon, typesInOrder, world } from "./today-helpers";
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
const allowedLinks = /^(\/|\/tasks\/[\w-]+|\/projects(\/[\w-]+)?|\/my-work(\?tab=\w+)?|\/guide(\/[\w-]+)?|\/chat|\/time)$/;

/**
 * The owner's «لوحة التحكم» (2026-11-02) is a deliberate section of his home: numbers, sentences and who did what, not a wall of navigation. It is
 * checked on its own (its links go to the panel's own page, the list of late work and the ideas, nowhere else) and taken out for the checks that
 * are about the rest of the page.
 */
const panelLinks = /^(\/owner(\/people\/[\w-]+|\?v=\w+)?|\/list\?filter=overdue|\/ideas)$/;
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
      return html(HomePage());
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
    const markup = await html(HomePage());
    expect(markup).not.toContain("مهمة الزميل عمر");
    expect(markup).not.toContain("مهمة المساحة المغلقة");
    expect(markup).not.toContain("مشروع مغلق");
  });

  it("carries the tour's hooks: the task list and the quick add, once each (the first-steps card brings its own)", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    const markup = await html(HomePage());
    expect([...markup.matchAll(/data-tour="today-tasks"/g)]).toHaveLength(1);
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(1);
    // the inline line at the foot of the list, and «المشروع والموعد» for the full sheet
    expect(markup).toContain(`placeholder="${t("today.quick.inline_placeholder")}"`);
    expect(markup).toContain(t("today.quick.more"));
  });

  it("mounts the first-steps card for the person's own actor, then the install hint once, then the tasks", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    const page = await HomePage();
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
    const markup = await html(HomePage());
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
      const { rest: markup, panel } = splitPanel(await html(HomePage()));
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
      const markup = await html(HomePage());
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
      const text = readable(await html(HomePage()));
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
    const markup = await html(HomePage());
    expect(markup).toContain(t("today.empty.title"));
    expect(markup).toMatch(new RegExp(`<a[^>]*href="/my-work"[^>]*>${t("today.empty.action")}</a>`));
    expect(readFileSync("src/components/today/today-tasks.tsx", "utf8")).toContain('"empty-tasks"');
    expect([...markup.matchAll(/data-tour="today-tasks"/g)]).toHaveLength(1);
    expect([...markup.matchAll(/data-tour="quick-add"/g)]).toHaveLength(1);
  });

  it("a partner who has been put in no space yet is told so, with a way to read about spaces, and is offered no quick add", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const markup = await html(HomePage());
    expect(markup).toContain(t("today.empty.no_space_title"));
    expect(hrefsOf(markup)).toContain("/guide/spaces");
    expect(markup).not.toContain('data-tour="quick-add"');
    expect(markup).toContain('data-tour="today-tasks"');
  });

  it("somebody who may open a space, and has none (an admin gets no space by rank), is told to open the first one", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const markup = await html(HomePage());
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
    const markup = await html(HomePage());
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
    const page = await HomePage();
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
    const owner = await html(HomePage());
    expect(owner).toContain(t("today.pulse.title"));
    expect(owner).toContain(t("today.pulse.worst"));
    expect(hrefsOf(owner)).toContain(`/tasks/${colleague.id}`);
    expect(owner).toContain("مهمة الزميل عمر");
    expect(owner).toContain("عمر قائد"); // who holds it
    expect(owner).not.toContain("مهمة الموقوف");
    expect(owner).not.toContain("موقوف سامي");

    await joinWorkspace(w.admin.id, w.wsIn.id); // an admin gets no space by rank
    await loginAs(w.admin.id);
    expect(await html(HomePage())).toContain(t("today.pulse.title")); // and then manages people by default

    for (const person of [w.member, w.lead]) {
      await loginAs(person.id);
      expect(await html(HomePage()), person.name).not.toContain(t("today.pulse.title"));
    }
    await loginAs(w.member.id);
    expect(await html(HomePage())).not.toContain("مهمة الزميل عمر"); // a colleague's task is not a plain member's business

    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    await loginAs(w.member.id);
    expect(await html(HomePage())).toContain(t("today.pulse.title"));
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
    const markup = await html(HomePage());
    expect(markup).toContain("مهمة الشركة الجديدة");
    expect(markup).toContain("مشروع الشركة الجديدة");
    expect(markup).not.toContain("القديمة");
    expect(markup).not.toContain(t("today.pulse.title")); // a plain member there, whatever the rank was in the company that suspended them
  });

  it("lists the active projects as links to the project", async () => {
    const { w } = await busyWorld();
    await db.project.update({ where: { id: w.inside.project.id }, data: { status: "ACTIVE" } });
    await loginAs(w.member.id);
    const markup = await html(HomePage());
    expect(markup).toContain(t("today.projects.title"));
    expect(hrefsOf(markup)).toContain(`/projects/${w.inside.project.id}`);
    expect(markup).toContain(t("today.projects.open", { n: 4 })); // the project's open tasks: three of the member's and the lead's
  });
});

describe("the home page and the session", () => {
  it("sends a visitor who is not signed in to login", async () => {
    logout();
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("sends a suspended person who still has a cookie to login", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await setMember(w.org.id, w.member.id, { status: "SUSPENDED" });
    await db.user.update({ where: { id: w.member.id }, data: { tokenVersion: { increment: 1 } } });
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("sends a person who still owes the temporary-password change to onboarding, and shows them none of the page's data", async () => {
    const { w } = await busyWorld();
    await db.user.update({ where: { id: w.member.id }, data: { mustChangePassword: true } });
    await loginAs(w.member.id, { mcp: true });
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
  });

  it("refuses a person whose notice is pending too (the layout's redirect alone does not stop a page)", async () => {
    const { w } = await busyWorld();
    await loginAs(w.member.id);
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { transparencyVersion: 2 } } });
    await expect(HomePage()).rejects.toThrow(/NEXT_REDIRECT:\/onboarding|auth\.onboarding_required/);
  });
});
