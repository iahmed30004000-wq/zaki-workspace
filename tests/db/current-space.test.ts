import { describe, expect, it, vi } from "vitest";

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

import { effectiveCapabilities } from "@/server/policy/capabilities";
import * as goRoute from "@/app/go/route";
import * as searchRoute from "@/app/api/search/route";
import * as chatHomeRoute from "@/app/api/chat/home/route";
import * as chatUnreadRoute from "@/app/api/chat/unread/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import SpacesPage from "@/app/(app)/spaces/page";
import { ensureHqSpace } from "@/server/chat/hq";
import { SPACE_STARTER_TOPICS, spaceTopicIdOf } from "@/server/chat/space-topics";
import { requireActor } from "@/server/policy/actor";
import { resolveCurrentSpace, SPACE_COOKIE } from "@/server/services/current-space";
import { getMyWork } from "@/server/services/my-work";
import { spacesOverview } from "@/server/services/spaces-overview";
import { getToday } from "@/server/services/today";
import { createWorkspace, deleteEmptyWorkspace } from "@/server/services/workspaces";
import { safeNext } from "@/lib/space-link";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * THE SPACE YOU ARE IN (the owner's decision, 2026-10-25: «العزل شامل… كأني بفتح سايت جديد»). Entering a space is
 * like opening a separate site: the pages show that space's work only, and another space's work is entered, never
 * mixed in. The choice is a cookie the server checks on every request.
 */

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
const enter = (spaceId: string) => jar().set(SPACE_COOKIE, spaceId);

/** A company with «الشركة», two spaces A and B the member is in (a task of theirs in each), and C they are not in. */
async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const hq = await ensureHqSpace(orgId, "الشركة");
  await db.workspaceMember.create({ data: { workspaceId: hq, userId: team.member.id, role: "MEMBER" } });
  const a = await makeWorkspace(orgId, [{ userId: team.member.id }], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: team.member.id }], `B ${uid()}`);
  const c = await makeWorkspace(orgId, [], `C ${uid()}`);
  const pa = await makeProject(a.id, `PA ${uid()}`);
  const pb = await makeProject(b.id, `PB ${uid()}`);
  const pc = await makeProject(c.id, `PC ${uid()}`);
  const task = (p: Awaited<ReturnType<typeof makeProject>>, ws: string, title: string) =>
    makeTask({ orgId, workspaceId: ws, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: team.owner.id, assigneeId: team.member.id, title });
  const ta = await task(pa, a.id, `TA ${uid()}`);
  const tb = await task(pb, b.id, `TB ${uid()}`);
  const tc = await task(pc, c.id, `TC ${uid()}`);
  return { ...team, hq, a, b, c, pa, pb, ta, tb, tc };
}

describe("which space you are in", () => {
  it("the cookie's space when it is yours; «الشركة» when it is not yours or gone; nothing when you are in none", async () => {
    const w = await world();
    const me = { userId: w.member.id, orgId: w.org.id, role: "MEMBER" as const };
    expect((await resolveCurrentSpace(me, w.a.id))?.id).toBe(w.a.id);
    expect((await resolveCurrentSpace(me, w.c.id))?.id).toBe(w.hq); // C is not theirs
    expect((await resolveCurrentSpace(me, "gone"))?.id).toBe(w.hq);
    expect((await resolveCurrentSpace(me, null))?.id).toBe(w.hq);
    const nobody = await db.user.create({ data: { name: "x", email: `${uid()}@t.local`, username: `u${uid()}`, passwordHash: "x" } });
    await db.organizationMember.create({ data: { organizationId: w.org.id, userId: nobody.id, role: "MEMBER", status: "ACTIVE" } });
    expect(await resolveCurrentSpace({ userId: nobody.id, orgId: w.org.id, role: "MEMBER" }, w.a.id)).toBeNull();
  });

  it("the OWNER may be in any space of the company; he manages it", async () => {
    const w = await world();
    const space = await resolveCurrentSpace({ userId: w.owner.id, orgId: w.org.id, role: "OWNER" }, w.c.id);
    expect(space).toMatchObject({ id: w.c.id, manager: true });
  });
});

describe("/go enters a space", () => {
  it("sets the cookie for a space of yours and goes to `next` (its «اليوم» by default)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(goRoute.GET, { url: `http://localhost/go?space=${w.b.id}&next=/projects` });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects");
    expect(res.headers.get("set-cookie")).toContain(`${SPACE_COOKIE}=${w.b.id}`);
    expect((await call(goRoute.GET, { url: `http://localhost/go?space=${w.b.id}` })).headers.get("location")).toBe("/");
  });

  it("a space that is not yours is not entered; `next` never leaves the app", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await call(goRoute.GET, { url: `http://localhost/go?space=${w.c.id}&next=//evil.example` });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("location")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(safeNext("/tasks/1?x=2")).toBe("/tasks/1?x=2");
  });

  it("`next` never leaves the app, not even encoded: a dropped tab made «//host» of it", async () => {
    const w = await world();
    await loginAs(w.member.id);
    // browsers delete tabs and newlines before they read a URL: "/<TAB>/evil.example" IS "//evil.example".
    // Every one of these is what a link would carry after `URLSearchParams` decoded it.
    for (const evil of ["/\t/evil.example", "/\n/evil.example", "/\u0000/evil.example", "/.//evil.example", "//evil.example"]) {
      expect(safeNext(evil), JSON.stringify(evil)).toBe("/");
    }
    // …and the route answers a location on this site, whatever the link carried
    for (const q of ["%2F%09%2Fevil.example", "%2F%0A%2Fevil.example", "%2F%5Cevil.example", "%2F%2Fevil.example"]) {
      const res = await call(goRoute.GET, { url: `http://localhost/go?next=${q}` });
      const location = res.headers.get("location") ?? "";
      expect(new URL(location, "http://localhost").host, q).toBe("localhost");
    }
  });
});

describe("inside a space, only that space's work", () => {
  it("«اليوم» and «مهامي» show the current space's tasks only", async () => {
    const w = await world();
    // a member as the server builds them: their rank's boxes (the tasks «يشوف» of the section grid among them)
    const actor = { userId: w.member.id, orgId: w.org.id, role: "MEMBER" as const, caps: effectiveCapabilities({ role: "MEMBER" }), isOwner: false, isExternal: false };
    const today = await getToday(actor, { spaceId: w.a.id });
    const ids = [...today.tasks.overdue, ...today.tasks.today, ...today.tasks.later].map((t) => t.id);
    expect(ids).toContain(w.ta.id);
    expect(ids).not.toContain(w.tb.id);
    const mine = await getMyWork(w.member.id, new Date(), { spaceId: w.b.id });
    const mineIds = mine.mine.map((r) => r.task.id);
    expect(mineIds).toEqual([w.tb.id]);
    // a space that is not theirs leaves nothing (never the whole company)
    const none = await getMyWork(w.member.id, new Date(), { spaceId: w.c.id });
    expect(none.mine).toEqual([]);
  });

  it("search finds the current space's work only", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.a.id);
    const hunt = async (q: string) => (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` })).json;
    expect(((await hunt(w.ta.title))?.["tasks"] as unknown[]).length).toBe(1);
    expect((await hunt(w.tb.title))?.["tasks"]).toEqual([]);
  });

  it("the chat home shows the current space alone, opened on its starter topics", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.b.id);
    const home = (await call(chatHomeRoute.GET)).json as { spaces: Array<{ id: string; topics: Array<{ title: string }> }> };
    expect(home.spaces.map((s) => s.id)).toEqual([w.b.id]);
    expect(home.spaces[0]?.topics.map((t) => t.title)).toEqual(SPACE_STARTER_TOPICS.map((t) => t.title));
  });

  it("the chat badge counts the current space; the space switcher says what waits in each of the others", async () => {
    const w = await world();
    await loginAs(w.member.id);
    // a message waits in a topic of A the member has read before (a row with lastReadAt)
    enter(w.a.id);
    await call(chatHomeRoute.GET); // A gets its starter topics
    const topic = spaceTopicIdOf(w.a.id, "general");
    await db.conversationMember.create({ data: { conversationId: topic, userId: w.member.id, lastReadAt: new Date(Date.now() - 60_000) } });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: topic, authorId: w.owner.id, body: "hello" } });

    expect((await call(chatUnreadRoute.GET)).json?.["total"]).toBe(1);
    enter(w.b.id);
    expect((await call(chatUnreadRoute.GET)).json?.["total"]).toBe(0);
    const list = (await call(workspacesRoute.GET)).json as { organizations: Array<{ workspaces: Array<{ id: string; unread: number }> }> };
    const spaces = list.organizations.flatMap((o) => o.workspaces);
    expect(spaces.find((s) => s.id === w.a.id)?.unread).toBe(1);
    expect(spaces.find((s) => s.id === w.b.id)?.unread).toBe(0);
  });

  it("a task of another space of yours enters that space first; a task of a space not yours is «not found»", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.a.id);
    await expect(TaskPage({ params: { id: w.tb.id } })).rejects.toThrow(`NEXT_REDIRECT:/go?space=${w.b.id}&next=%2Ftasks%2F${w.tb.id}`);
    await expect(TaskPage({ params: { id: w.tc.id } })).rejects.toThrow("NEXT_NOT_FOUND");
    // inside B it opens in place: no detour (the page itself is rendered by the app, not by this test)
    enter(w.b.id);
    const outcome = await TaskPage({ params: { id: w.tb.id } }).then(() => "rendered", (e: Error) => e.message);
    expect(outcome).not.toMatch(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
  });
});

describe("a new space has its own talk from the first day", () => {
  it("opens with «عام» and «التنبيهات»; while nobody wrote there it can still be deleted", async () => {
    const w = await world();
    const { workspace } = await createWorkspace(w.admin.id, { organizationId: w.org.id, name: `New ${uid()}`, description: null });
    const topics = await db.conversation.findMany({ where: { spaceId: workspace.id, kind: "TOPIC" }, orderBy: { position: "asc" }, select: { title: true } });
    expect(topics.map((t) => t.title)).toEqual(["عام", "التنبيهات"]);
    await deleteEmptyWorkspace(workspace.id);
    expect(await db.workspace.count({ where: { id: workspace.id } })).toBe(0);
  });

  it("once somebody wrote in it, the space is kept (409)", async () => {
    const w = await world();
    const { workspace } = await createWorkspace(w.admin.id, { organizationId: w.org.id, name: `New ${uid()}`, description: null });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: spaceTopicIdOf(workspace.id, "general"), authorId: w.admin.id, body: "hi" } });
    await expect(deleteEmptyWorkspace(workspace.id)).rejects.toThrow("spaces.not_empty");
  });
});

describe("«كل المساحات» — the owner's and the admins' look over every space", () => {
  it("counts what is open, late and waiting per space; a member is sent to their «اليوم»", async () => {
    const w = await world();
    await db.task.update({ where: { id: w.tc.id }, data: { dueDate: new Date(Date.now() - 3 * 86_400_000) } });
    await loginAs(w.owner.id);
    const cards = await spacesOverview(await requireActor());
    expect(cards[0]?.id).toBe(w.hq); // «الشركة» first
    expect(cards.find((c) => c.id === w.c.id)).toMatchObject({ open: 1, overdue: 1 });
    expect(cards.find((c) => c.id === w.a.id)).toMatchObject({ open: 1, overdue: 0, members: 1 });

    await loginAs(w.member.id);
    await expect(SpacesPage({})).rejects.toThrow("NEXT_REDIRECT:/");
  });
});
