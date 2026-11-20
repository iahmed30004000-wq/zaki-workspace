import "./scoping-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
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

import GoalsPage from "@/app/(app)/goals/page";
import IdeasPage from "@/app/(app)/ideas/page";
import ProductionPage from "@/app/(app)/production/page";
import DepartmentsPage from "@/app/(app)/departments/page";
import TicketsPage from "@/app/(app)/tickets/page";
import CampaignsPage from "@/app/(app)/campaigns/page";
import CrmPage from "@/app/(app)/crm/page";
import CardsPage from "@/app/(app)/cards/page";
import * as searchRoute from "@/app/api/search/route";
import { CardsView } from "@/components/cards/cards-view";
import { TodayQuickAdd } from "@/components/today/quick-add";
import { getServerT } from "@/lib/i18n/server";
import { buildNav, canOpenTab, type NavRole, type NavSubject, type TabKey } from "@/lib/nav/places";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { makeDepartment } from "./guest-helpers";
import { html } from "./pages-access-helpers";
import { resolveServerTree, typesInOrder } from "./today-helpers";

/**
 * W1.8 — the work tabs are honest, the search palette finds boards, ideas, tickets and customers by their OWN rules, and
 * «جديد → مهمة» keeps its intent in a space of cards.
 *
 * D-W3 (docs/restructure/DECISIONS.md) is PENDING: «الأقسام» «التذاكر» «الحملات» still need `directory.view` on the page, so the TAB needs it too and no page is
 * relaxed. Part A pins that refusal; when the owner answers «آه للموظفين» the change is one commit (tabs, pages, this part).
 */

const { t } = getServerT();
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const enter = (spaceId: string) => jar().set(SPACE_COOKIE, spaceId);

// ───────────────────────────── A. every work tab opens exactly for whom it is offered to ─────────────────────────────

/** The notices a page shows instead of an area that is not for this person. */
const REFUSALS = [t("guest.no_access"), t("orgm.members_only"), t("chat.guest_forbidden"), t("access.section_off"), t("spaces.manage.not_yours")];
const refused = (markup: string) => REFUSALS.some((notice) => markup.includes(notice));

type PageCall = () => Promise<ReactElement> | ReactElement;

/** The optional work tools of «الشغل» that are pages with a box (the new map's «المزيد»), each with its page and the section box it needs besides the directory. */
const TOOLS: { tab: TabKey; page: PageCall; box: string; needsDirectory: boolean }[] = [
  { tab: "goals", page: () => GoalsPage(), box: "goals.view", needsDirectory: false },
  { tab: "ideas", page: () => IdeasPage(), box: "ideas.view", needsDirectory: false },
  { tab: "production", page: () => ProductionPage(), box: "production.view", needsDirectory: false },
  { tab: "crm", page: () => CrmPage(), box: "crm.view", needsDirectory: false },
  // the three department pages: the directory AND (for the last two) the section's own box — D-W3 pending, nothing relaxed
  { tab: "departments", page: () => DepartmentsPage(), box: "directory.view", needsDirectory: true },
  { tab: "tickets", page: () => TicketsPage(), box: "tickets.view", needsDirectory: true },
  { tab: "campaigns", page: () => CampaignsPage(), box: "campaigns.view", needsDirectory: true },
];

async function renders(page: PageCall): Promise<{ refused: boolean }> {
  try {
    const tree = await resolveServerTree(await page());
    return { refused: refused(await html(tree as ReactElement)) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // a redirect or a not-found is not «the page»: it counts as refused
    if (/^NEXT_REDIRECT:|^NEXT_NOT_FOUND$/.test(message)) return { refused: true };
    throw err;
  }
}

async function personWith(orgId: string, role: "ADMIN" | "LEAD" | "MEMBER", revokedCapabilities: string[], spaceId: string) {
  const person = await makeUser({ orgId, role, name: `P ${uid()}` });
  if (revokedCapabilities.length > 0) {
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: person.id } }, data: { revokedCapabilities } });
  }
  await db.workspaceMember.create({ data: { workspaceId: spaceId, userId: person.id, role: "MEMBER" } });
  return person;
}

async function subjectOf(userId: string): Promise<NavSubject> {
  await loginAs(userId);
  const actor = await requireActor();
  return { role: actor.role as NavRole, caps: [...actor.caps] };
}

describe("W1.8 A: a work tab is offered exactly when its page opens (rank × switch)", () => {
  it("the three department pages still refuse a person whose directory switch is off (D-W3 pending: no page relaxed), and their tabs are gone for that person", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `S ${uid()}`);
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      const person = await personWith(team.org.id, role, ["directory.view"], space.id);
      const subject = await subjectOf(person.id);
      for (const { tab, page } of TOOLS.filter((tool) => tool.needsDirectory)) {
        expect((await renders(page)).refused, `${role} without directory.view · ${tab}: the page refuses`).toBe(true);
        expect(canOpenTab(subject, tab), `${role} · ${tab} (old map)`).toBe(false);
        expect(canOpenTab({ ...subject, navV2: true }, tab), `${role} · ${tab} (new map)`).toBe(false);
      }
      const drawn = buildNav({ ...subject, navV2: true });
      const work = drawn.places.find((place) => place.key === "work");
      for (const key of ["departments", "tickets", "campaigns"]) {
        expect([...(work?.tabs ?? []), ...(work?.more ?? [])].map((tab) => tab.key), `${role} · ${key} is not drawn`).not.toContain(key);
      }
    }
  });

  it("with the rank's own boxes the three pages open and their tabs are offered, for every staff rank", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `S ${uid()}`);
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      const person = await personWith(team.org.id, role, [], space.id);
      const subject = await subjectOf(person.id);
      for (const { tab, page } of TOOLS) {
        expect(canOpenTab(subject, tab), `${role} · ${tab}`).toBe(true);
        expect((await renders(page)).refused, `${role} · ${tab}: the page opens`).toBe(false);
      }
    }
  });

  it("one box off at a time: the page and the tab agree, for every tool and for the two ranks that have the box by default", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `S ${uid()}`);
    for (const role of ["LEAD", "MEMBER"] as const) {
      for (const tool of TOOLS) {
        const person = await personWith(team.org.id, role, [tool.box], space.id);
        const subject = await subjectOf(person.id);
        const open = !(await renders(tool.page)).refused;
        expect(open, `${role} without ${tool.box} · ${tool.tab}: the page is closed`).toBe(false);
        expect(canOpenTab(subject, tool.tab), `${role} without ${tool.box} · ${tool.tab}: the tab agrees with the page`).toBe(open);
        expect(canOpenTab({ ...subject, navV2: true }, tool.tab), `${role} without ${tool.box} · ${tool.tab} (new map)`).toBe(open);
      }
    }
  });

  it("a guest: none of the three tabs is offered, and each page still shows the guest notice (a tab not offered to guests refuses them)", async () => {
    const team = await makeTeam();
    const space = await makeWorkspace(team.org.id, [{ userId: team.guest.id, role: "GUEST" }], `S ${uid()}`);
    await makeDepartment(team.org.id, { name: `Secret dept ${uid()}` });
    const subject = await subjectOf(team.guest.id);
    for (const { tab, page } of TOOLS.filter((tool) => tool.needsDirectory)) {
      expect(canOpenTab(subject, tab), tab).toBe(false);
      expect(canOpenTab({ ...subject, navV2: true }, tab), `${tab} (new map)`).toBe(false);
      const markup = await html(await resolveServerTree(await page()) as ReactElement);
      expect(markup, `${tab} shows the guest notice`).toContain(t("guest.no_access"));
      expect(markup).not.toContain("Secret dept");
    }
    expect(space.id).toBeTruthy();
  });
});

// ───────────────────────────── B. the palette finds boards, ideas, tickets and customers — each by its own rule ─────────────────────────────

interface Hits {
  tasks?: unknown[];
  projects?: unknown[];
  boards?: { id: string; name: string; projectId: string; projectName: string }[];
  ideas?: { id: string; title: string }[];
  tickets?: { id: string; key: string; title: string; status: string }[];
  customers?: { id: string; name: string; company: string | null }[];
}

async function find(q: string): Promise<{ status: number; body: Hits & Record<string, unknown> }> {
  const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` });
  return { status: res.status, body: res.json as unknown as Hits & Record<string, unknown> };
}

/** Ticket numbers are unique per company: one counter for the whole file. */
let seq = 1000;
const ticketNumber = () => ++seq;

const OLD_KEYS = ["documents", "files", "messages", "people", "projects", "tasks", "topics"];

/**
 * A company with two spaces. Everything searchable carries `tk`. In space A (member, lead, admin, a colleague `peer`, the guest): a project with a
 * board, an idea, a customer. In space B (only the colleague): the same three, which nobody else may find. Four tickets in two departments and one
 * instant ticket, held by different people; and a ticket and a customer of ANOTHER company.
 */
async function world() {
  const tk = `Wk${uid()}`;
  const team = await makeTeam();
  const orgId = team.org.id;
  const lead = await makeUser({ orgId, role: "LEAD", name: "Lead" });
  const peer = await makeUser({ orgId, role: "MEMBER", name: "Peer" });
  const inA: { userId: string; role?: "GUEST" }[] = [team.admin, lead, team.member, peer].map((p) => ({ userId: p.id }));
  inA.push({ userId: team.guest.id, role: "GUEST" });
  const a = await makeWorkspace(orgId, inA, `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: peer.id }], `B ${uid()}`);

  const pa = await makeProject(a.id, `Project A ${uid()}`);
  const boardA = await db.board.create({ data: { projectId: pa.project.id, name: `${tk} board A` } });
  const archivedBoard = await db.board.create({ data: { projectId: pa.project.id, name: `${tk} old board`, archived: true } });
  const pb = await makeProject(b.id, `Project B ${uid()}`);
  const boardB = await db.board.create({ data: { projectId: pb.project.id, name: `${tk} board B` } });

  const ideaA = await db.idea.create({ data: { orgId, creatorId: peer.id, workspaceId: a.id, title: `${tk} idea A` } });
  const ideaB = await db.idea.create({ data: { orgId, creatorId: peer.id, workspaceId: b.id, title: `${tk} idea B` } });
  const customerA = await db.customer.create({ data: { orgId, creatorId: peer.id, workspaceId: a.id, name: `${tk} customer A`, company: "ACME", phone: "+962 79 000 0000" } });
  const customerB = await db.customer.create({ data: { orgId, creatorId: peer.id, workspaceId: b.id, name: `${tk} customer B` } });

  // departments: D has the colleague; E is led by nobody the test signs in as
  const deptD = await makeDepartment(orgId, { name: `D ${uid()}`, memberIds: [peer.id] });
  const deptE = await makeDepartment(orgId, { name: `E ${uid()}`, memberIds: [peer.id] });
  const ticket = (data: { departmentId: string | null; creatorId: string; assigneeId?: string | null; title: string }) =>
    db.ticket.create({ data: { orgId, number: ticketNumber(), creatorId: data.creatorId, assigneeId: data.assigneeId ?? null, departmentId: data.departmentId, title: data.title } });
  const tPeer = await ticket({ departmentId: deptD.id, creatorId: peer.id, title: `${tk} ticket of D` });
  const tAssigned = await ticket({ departmentId: deptD.id, creatorId: peer.id, assigneeId: team.member.id, title: `${tk} ticket given to the member` });
  const tRaised = await ticket({ departmentId: deptE.id, creatorId: team.member.id, title: `${tk} ticket raised by the member` });
  const tInstant = await ticket({ departmentId: null, creatorId: peer.id, assigneeId: peer.id, title: `${tk} instant ticket` });
  const tGuest = await ticket({ departmentId: deptD.id, creatorId: team.guest.id, assigneeId: team.guest.id, title: `${tk} guest ticket` });

  // another company: the same word everywhere, never found
  const other = await makeTeam();
  const otherSpace = await makeWorkspace(other.org.id, [{ userId: other.member.id }], `X ${uid()}`);
  const px = await makeProject(otherSpace.id, `Project X ${uid()}`);
  await db.board.create({ data: { projectId: px.project.id, name: `${tk} board of another company` } });
  await db.idea.create({ data: { orgId: other.org.id, creatorId: other.member.id, workspaceId: otherSpace.id, title: `${tk} idea of another company` } });
  await db.customer.create({ data: { orgId: other.org.id, creatorId: other.member.id, workspaceId: otherSpace.id, name: `${tk} customer of another company` } });
  const otherDept = await makeDepartment(other.org.id, { name: `OD ${uid()}`, memberIds: [other.member.id] });
  await db.ticket.create({ data: { orgId: other.org.id, number: 1, creatorId: other.member.id, departmentId: otherDept.id, title: `${tk} ticket of another company` } });

  return { tk, ...team, lead, peer, a, b, boardA, archivedBoard, boardB, ideaA, ideaB, customerA, customerB, tPeer, tAssigned, tRaised, tInstant, tGuest };
}

type World = Awaited<ReturnType<typeof world>>;
const ids = (list: { id: string }[] | undefined) => (list ?? []).map((x) => x.id).sort();

describe("W1.8 B: the search finds boards, ideas, tickets and customers — each by its own rule, never a title the person cannot open", () => {
  it("a member finds, in the space they are in: the boards of their projects, the ideas, the customers and only the tickets they raised, hold or whose department they are in", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.a.id);
    const { status, body } = await find(w.tk);
    expect(status).toBe(200);
    expect(ids(body.boards)).toEqual([w.boardA.id]);
    expect(body.boards?.[0]).toMatchObject({ name: `${w.tk} board A`, projectId: w.boardA.projectId });
    expect(ids(body.ideas)).toEqual([w.ideaA.id]);
    expect(ids(body.customers)).toEqual([w.customerA.id]);
    expect(body.customers?.[0]).toMatchObject({ name: `${w.tk} customer A`, company: "ACME" });
    expect(ids(body.tickets)).toEqual([w.tAssigned.id, w.tRaised.id].sort());
    // the other space, the archived board, a colleague's ticket, the instant ticket, another company: nothing of them reaches the answer in any field
    const raw = JSON.stringify(body);
    for (const hidden of [w.boardB.id, w.archivedBoard.id, w.ideaB.id, w.customerB.id, w.tPeer.id, w.tInstant.id, w.tGuest.id, "another company", "board B", "idea B", "customer B", "+962"]) {
      expect(raw, hidden).not.toContain(hidden);
    }
  });

  it("each box closes its own kind and no other: crm.view → customers, ideas.view → ideas, projects.view → boards, tickets.view or directory.view → tickets", async () => {
    const w = await world();
    const cases: { box: string; gone: keyof Hits; others: (keyof Hits)[] }[] = [
      { box: "crm.view", gone: "customers", others: ["boards", "ideas", "tickets"] },
      { box: "ideas.view", gone: "ideas", others: ["boards", "customers", "tickets"] },
      { box: "projects.view", gone: "boards", others: ["ideas", "customers", "tickets"] },
      { box: "tickets.view", gone: "tickets", others: ["boards", "ideas", "customers"] },
      // the tickets page needs the directory (D-W3 pending): a title it would refuse is not offered
      { box: "directory.view", gone: "tickets", others: ["boards", "ideas", "customers"] },
    ];
    for (const { box, gone, others } of cases) {
      const person = await personWith(w.org.id, "MEMBER", [box], w.a.id);
      // something of every kind that this person may read when the box is on: a ticket they raised
      await db.ticket.create({ data: { orgId: w.org.id, number: ticketNumber(), creatorId: person.id, departmentId: null, title: `${w.tk} mine ${box}` } });
      await loginAs(person.id);
      enter(w.a.id);
      const { body } = await find(w.tk);
      expect(body[gone], `${box} off: no ${gone}`).toBeUndefined();
      for (const other of others) expect((body[other] as unknown[] | undefined)?.length ?? 0, `${box} off: ${other} stay`).toBeGreaterThan(0);
    }
  });

  it("a lead who is in none of the departments and raised nothing finds no ticket; an admin and the owner find every ticket of the company (rank) but none of another company", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    enter(w.a.id);
    const lead = await find(w.tk);
    expect(lead.body.tickets).toBeUndefined();
    expect(ids(lead.body.customers)).toEqual([w.customerA.id]);

    const all = [w.tPeer.id, w.tAssigned.id, w.tRaised.id, w.tInstant.id, w.tGuest.id].sort();
    await loginAs(w.admin.id);
    enter(w.a.id);
    expect(ids((await find(w.tk)).body.tickets)).toEqual(all);
    await loginAs(w.owner.id);
    enter(w.a.id);
    const owner = await find(w.tk);
    expect(ids(owner.body.tickets)).toEqual(all);
    expect(JSON.stringify(owner.body)).not.toContain("another company");
    // the owner enters space B: its own board, idea and customer, and none of space A's
    enter(w.b.id);
    const inB = await find(w.tk);
    expect(ids(inB.body.boards)).toEqual([w.boardB.id]);
    expect(ids(inB.body.ideas)).toEqual([w.ideaB.id]);
    expect(ids(inB.body.customers)).toEqual([w.customerB.id]);
  });

  it("a ticket's key and status travel with it, and nothing of its description, its customer number or its people", async () => {
    const w = await world();
    await db.ticket.update({ where: { id: w.tRaised.id }, data: { description: "SECRET-DESCRIPTION", customerRefCipher: "SECRET-CIPHER", externalRef: "SECRET-REF" } });
    await loginAs(w.member.id);
    enter(w.a.id);
    const { body } = await find(w.tk);
    const hit = body.tickets?.find((x) => x.id === w.tRaised.id);
    expect(hit).toMatchObject({ title: `${w.tk} ticket raised by the member`, status: "OPEN" });
    expect(hit?.key).toMatch(/-T\d+$/);
    expect(JSON.stringify(body)).not.toMatch(/SECRET-/);
  });

  it("an external partner finds none of the four kinds — not the board of their own space, not an idea, ticket or customer they once wrote — and the answer keeps its old shape", async () => {
    const w = await world();
    await db.customer.create({ data: { orgId: w.org.id, creatorId: w.guest.id, workspaceId: w.a.id, name: `${w.tk} guest customer` } });
    await db.idea.create({ data: { orgId: w.org.id, creatorId: w.guest.id, workspaceId: w.a.id, title: `${w.tk} guest idea` } });
    await loginAs(w.guest.id);
    enter(w.a.id);
    const { status, body } = await find(w.tk);
    expect(status).toBe(200);
    for (const key of ["boards", "ideas", "tickets", "customers"]) expect(body[key], key).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(OLD_KEYS);
  });

  it("backward compatible: a kind with no hit has NO key (the old answers are byte for byte what they were), and the old keys are always there", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.a.id);
    const nothing = await find(`zz${uid()}`);
    expect(nothing.body).toEqual({ tasks: [], projects: [], topics: [], messages: [], people: [], files: [], documents: [] });
    const some = await find(w.tk);
    for (const key of OLD_KEYS) expect(Object.keys(some.body), key).toContain(key);
  });

  it("the spelling is forgiving here as everywhere (a hamza, a final heh) and a regular-expression character is only a character", async () => {
    const w = await world();
    const idea = await db.idea.create({ data: { orgId: w.org.id, creatorId: w.peer.id, workspaceId: w.a.id, title: `${w.tk} أحمد مدرسة` } });
    await loginAs(w.member.id);
    enter(w.a.id);
    expect(ids((await find(`${w.tk} احمد مدرسه`)).body.ideas)).toEqual([idea.id]);
    expect((await find(`${w.tk} .*`)).body.ideas).toBeUndefined();
  });
});

// ───────────────────────────── C. «جديد → مهمة» in a space of cards keeps its intent ─────────────────────────────

describe("W1.8 C: «جديد → مهمة» in a space of cards opens the task sheet on /cards", () => {
  async function cardsWorld() {
    const team = await makeTeam();
    const cardsSpace = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], `Cards ${uid()}`);
    await db.workspace.update({ where: { id: cardsSpace.id }, data: { layout: "CARDS" } });
    return { ...team, cardsSpace };
  }
  type Tree = { type: unknown; props: Record<string, unknown> };

  it("with ?new=task the page mounts the task quick add (its sheet opens by the intent) beside the cards; without it the page is exactly the cards", async () => {
    const w = await cardsWorld();
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    const plain = (await CardsPage()) as Tree;
    expect(plain.type).toBe(CardsView);
    const withIntent = (await CardsPage({ searchParams: { new: "task" } })) as ReactNode;
    const types = typesInOrder(withIntent);
    expect(types).toContain(TodayQuickAdd);
    expect(types).toContain(CardsView);
    expect(types.indexOf(TodayQuickAdd)).toBeLessThan(types.indexOf(CardsView));
    // another intent, or none we serve: the plain page
    expect(((await CardsPage({ searchParams: { new: "project" } })) as Tree).type).toBe(CardsView);
    expect(((await CardsPage({ searchParams: {} })) as Tree).type).toBe(CardsView);
  });

  it("an external partner gets the plain cards page whatever the address says (nothing to add, nothing of the company's tasks)", async () => {
    const w = await cardsWorld();
    await loginAs(w.guest.id);
    enter(w.cardsSpace.id);
    expect(((await CardsPage({ searchParams: { new: "task" } })) as Tree).type).toBe(CardsView);
  });

  it("the page asks for nothing but the person's own quick-add facts, scoped to the space they are in", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/app/(app)/cards/page.tsx"), "utf8");
    expect(source).toContain("getToday(actor, { spaceId: space.id })");
    expect(source).toContain("TodayQuickAdd");
  });
});
