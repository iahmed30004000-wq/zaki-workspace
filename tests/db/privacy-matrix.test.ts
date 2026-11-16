/**
 * P0.5 — the privacy regression matrix (docs/restructure/P0-privacy.md, README rule R8).
 *
 * WHO can see WHAT, on every surface that shows it. The expected answers are DATA at the top of the file, so the owner's
 * decisions are readable there: a row is a thing that exists (a conversation or a task), a column is a kind of person, a
 * `1` means «sees it». Every surface must agree with the table (a conversation: the door, the chat home, the search, the
 * policy; a task: the door, the task list).
 *
 * If a cell is red, the CODE is wrong — never loosen a cell without the owner's recorded answer. A later step that adds a
 * place where people or work show up adds one row here (or one surface below) in one line.
 */
import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as taskGet from "@/app/api/tasks/[id]/route";
import * as tasksList from "@/app/api/tasks/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { chatHome } from "@/server/chat/home";
import { listOversight } from "@/server/chat/oversight";
import { searchChat } from "@/server/chat/search";
import { canReadConversation } from "@/server/policy/conversation";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

// ───────────────────────────── the expected matrix (the owner's decisions) ─────────────────────────────
const PERSONAS = [
  "owner", //          the primary owner: reads everything silently (archive.view)
  "partnerWith", //    a partner (OWNER rank) who still holds archive.view
  "partnerWithout", // a partner whose archive.view was taken away: an ordinary manager of every space
  "orgAdminOut", //    an ADMIN of the company who is NOT in the space
  "spaceAdmin", //     the space's own ADMIN (a plain member of the company)
  "memberIn", //       a member in the restricted topic, the DM and the task's people
  "memberOut", //      a member of the space in none of them
  "teamMember", //     a member of the «مقطع» (not of the restricted topic)
  "guest", //          an external partner in the space
] as const;
type Persona = (typeof PERSONAS)[number];

//                                  owner pW  pWo oAO sA  mIn mOut tM  guest
const CONVERSATIONS: Record<string, string> = {
  open: "1 1 1 0 1 1 1 1 1", //      an open topic: the space's people (and the owner's eyes)
  restricted: "1 1 0 0 0 1 0 0 0", // a restricted topic: its own people and the silent eye, nobody else — no manager either
  team: "1 1 1 0 1 0 0 1 0", //       a «مقطع»'s topic: its people, the space's managers, the silent eye
  dm: "1 1 0 0 0 1 0 0 0", //         a DM: its two people and the silent eye
};
const TASKS: Record<string, string> = {
  public: "1 1 1 0 1 1 1 1 1", //       «المساحة كلها»: the space's people
  private: "1 1 0 0 1 1 0 0 0", //      «المعنيين بس»: its people, the space's managers, the silent eye (P0.2)
  fromPrivate: "1 1 0 0 1 1 0 0 0", //  made from a private topic (P0.3): private by default
};
const cells = (row: string) => row.split(" ").map((c) => c === "1");
const expected = (table: Record<string, string>, key: string, who: Persona) => cells(table[key]!)[PERSONAS.indexOf(who)]!;

// ───────────────────────────── the world ─────────────────────────────
const WORD = "كلمةسريةمصفوفة";
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const people = {
    owner: t.owner,
    partnerWith: t.admin,
    partnerWithout: await makeUser({ orgId, role: "MEMBER", name: "PartnerWithout" }),
    orgAdminOut: await makeUser({ orgId, role: "ADMIN", name: "OrgAdminOut" }),
    spaceAdmin: await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" }),
    memberIn: t.member,
    memberOut: await makeUser({ orgId, role: "MEMBER", name: "MemberOut" }),
    teamMember: await makeUser({ orgId, role: "MEMBER", name: "TeamMember" }),
    guest: t.guest,
  };
  const memberIn2 = await makeUser({ orgId, role: "MEMBER", name: "MemberIn2" });
  const space = await makeWorkspace(orgId, [
    { userId: people.spaceAdmin.id, role: "ADMIN" },
    { userId: people.memberIn.id },
    { userId: memberIn2.id },
    { userId: people.memberOut.id },
    { userId: people.teamMember.id },
    { userId: people.guest.id },
  ]);
  const { project, board, todo } = await makeProject(space.id);
  const section = await db.team.create({ data: { workspaceId: space.id, name: "Section", members: { create: [{ userId: people.teamMember.id }] } } });

  // two partners: the primary owner promotes both, then takes archive.view away from one
  await loginAs(t.owner.id);
  const patch = (userId: string, body: Record<string, unknown>) => call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId }, body });
  for (const p of [people.partnerWith, people.partnerWithout]) expect((await patch(p.id, { role: "OWNER" })).status).toBe(200);
  expect((await patch(people.partnerWithout.id, { revokedCapabilities: ["archive.view"] })).status).toBe(200);

  const conv = {
    open: await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Open" } }),
    restricted: await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Restricted", restricted: true, members: { create: [{ userId: people.memberIn.id }, { userId: memberIn2.id }] } } }),
    team: await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "Team", teamId: section.id } }),
  };
  await loginAs(people.memberIn.id);
  const dmId = (await call(dmRoute.POST, { body: { userId: memberIn2.id } })).json?.["id"] as string;
  const ids: Record<string, string> = { open: conv.open.id, restricted: conv.restricted.id, team: conv.team.id, dm: dmId };
  for (const [kind, id] of Object.entries(ids)) {
    await db.chatMessage.create({ data: { orgId, conversationId: id, authorId: people.memberIn.id, body: `${WORD} ${kind}` } });
  }

  const base = { orgId, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id };
  const publicTask = await makeTask({ ...base, creatorId: people.memberIn.id, assigneeId: memberIn2.id, title: "public task" });
  const privateTask = await makeTask({ ...base, creatorId: memberIn2.id, assigneeId: people.memberIn.id, title: "private task" });
  await db.task.update({ where: { id: privateTask.id }, data: { visibility: "PARTICIPANTS" } });
  // made from the restricted topic through the door that makes work (P0.3): private by default
  await loginAs(people.memberIn.id);
  const msg = await db.chatMessage.findFirstOrThrow({ where: { conversationId: conv.restricted.id } });
  const made = await call(taskRoute.POST, { method: "POST", params: { id: msg.id }, body: { workspaceId: space.id, projectId: project.id, boardId: board.id } });
  expect(made.status).toBe(201);
  const tasks: Record<string, string> = { public: publicTask.id, private: privateTask.id, fromPrivate: made.json?.["taskId"] as string };
  await db.task.update({ where: { id: publicTask.id }, data: { visibility: "SPACE" } });

  const roleOf = async (userId: string) => (await db.organizationMember.findFirstOrThrow({ where: { organizationId: orgId, userId } })).role;
  return { orgId, space, people, ids, tasks, roleOf };
}

// ───────────────────────────── the surfaces ─────────────────────────────
describe("privacy matrix — conversations", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: the door, the lists, the search and the policy agree with the table`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        const want = expected(CONVERSATIONS, kind, who);
        const ctx = { orgId: w.orgId, userId: person.id, orgRole: await w.roleOf(person.id) };

        await loginAs(person.id);
        const door = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).status === 200;
        const policy = await canReadConversation(person.id, id);
        // listed: on the chat home, or — for the silent eye only — in the oversight list (a DM of two others lives only there)
        const onHome = JSON.stringify(await chatHome(ctx, { spaceId: w.space.id })).includes(id);
        const inOversight = await listOversight(ctx, { limit: 100 }).then((r) => JSON.stringify(r).includes(id), () => false);
        const home = onHome || inOversight;
        const found = (await searchChat(ctx, { id: w.space.id, isHq: false }, WORD)).messages.some((m) => JSON.stringify(m).includes(id));
        for (const [surface, got] of Object.entries({ door, policy, home, search: found })) {
          if (got !== want) wrong.push(`${who} · ${surface}: expected ${want ? "sees" : "does not see"}`);
        }
      }
      expect(wrong, `${kind}`).toEqual([]);
    });
  }
});

describe("privacy matrix — tasks", () => {
  for (const kind of Object.keys(TASKS)) {
    it(`${kind}: the door and the task list agree with the table`, async () => {
      const w = await getWorld();
      const id = w.tasks[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        const want = expected(TASKS, kind, who);
        await loginAs(person.id);
        const door = (await call(taskGet.GET, { params: { id } })).status === 200;
        const list = await call(tasksList.GET, { url: `http://localhost/api/tasks?workspaceId=${w.space.id}&limit=100` });
        const listed = list.status === 200 && JSON.stringify(list.json).includes(id);
        for (const [surface, got] of Object.entries({ door, list: listed })) {
          if (got !== want) wrong.push(`${who} · ${surface}: expected ${want ? "sees" : "does not see"}`);
        }
      }
      expect(wrong, `${kind}`).toEqual([]);
    });
  }
});

describe("privacy matrix — the table itself", () => {
  it("has one cell per persona in every row (a missing cell would silently pass)", () => {
    for (const row of [...Object.values(CONVERSATIONS), ...Object.values(TASKS)]) expect(cells(row)).toHaveLength(PERSONAS.length);
  });
});
