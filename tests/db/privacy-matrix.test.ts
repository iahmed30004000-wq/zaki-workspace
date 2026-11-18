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
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import { chatHome } from "@/server/chat/home";
import { chatList } from "@/server/chat/list";
import { syncFeed } from "@/server/chat/sync";
import { emitRealtime } from "@/server/realtime/emit";
import { listOversight } from "@/server/chat/oversight";
import { searchChat } from "@/server/chat/search";
import { canReadConversation } from "@/server/policy/conversation";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { NextRequest } from "next/server";
import * as rtRoute from "@/app/api/rt/route";
import { addClient, deliverEvent, resetHubForTests, type RtEvent } from "@/server/realtime/hub";
import { setPolicyStubs } from "@/server/realtime/policy-gate";
import { stopRealtimeListenerForTests } from "@/server/realtime/listener";

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

// ───────────────────────────── C1.2: the list, the topics, the header, the messages and the sync feed ─────────────────────────────
// The same table. Two of the five surfaces are the DOORS (header, messages: the policy's own answer, so the silent eye reads a private chat of two others
// there); three are LISTS (list, topics, sync): what is in a person's chat list and feed. A private chat of two others is not in the silent eye's list or
// feed — he reaches it through the oversight list — and that is the one difference, written here as data.
const LISTED_EXCEPT: Record<string, Persona[]> = { dm: ["owner", "partnerWith"] };
const listedWant = (kind: string, who: Persona) => expected(CONVERSATIONS, kind, who) && !(LISTED_EXCEPT[kind] ?? []).includes(who);

describe("privacy matrix — the C1.2 surfaces", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: the header, the messages, the list, the space's topics and the sync feed agree with the table`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const ctxOf = async (who: Persona) => ({ orgId: w.orgId, userId: w.people[who].id, orgRole: await w.roleOf(w.people[who].id) });
      // a fresh message with its event, after every persona took their cursor
      const cursors = new Map<Persona, string>();
      for (const who of PERSONAS) cursors.set(who, (await syncFeed(await ctxOf(who))).cursor);
      const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: w.people.memberIn.id, body: `${WORD} sync ${kind}` } });
      await emitRealtime(db, w.orgId, "message.created", { conversationId: id, messageId: msg.id, spaceId: w.space.id });

      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        await loginAs(person.id);
        const door = expected(CONVERSATIONS, kind, who);
        const header = (await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/header`, params: { id } })).status === 200;
        const messages = (await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/messages`, params: { id } })).status === 200;
        const listed = listedWant(kind, who);
        const inList = JSON.stringify(await chatList(await ctxOf(who))).includes(id);
        const inSpace = JSON.stringify(await chatList(await ctxOf(who), { spaceId: w.space.id })).includes(id);
        const topicsRes = kind === "dm" ? null : await call(topicsRoute.GET, { url: "http://localhost/api/x", params: { spaceId: w.space.id } });
        const inTopics = topicsRes ? topicsRes.status === 200 && JSON.stringify(topicsRes.json).includes(id) : null;
        const inSync = JSON.stringify(await syncFeed(await ctxOf(who), { after: BigInt(cursors.get(who)!) })).includes(WORD + " sync " + kind);
        const cells: Record<string, boolean | null> = { header, messages, list: inList, space: inSpace, topics: inTopics, sync: inSync };
        for (const [surface, got] of Object.entries(cells)) {
          if (got === null) continue;
          const want = surface === "header" || surface === "messages" ? door : listed;
          if (got !== want) wrong.push(`${who} · ${surface}: expected ${want ? "sees" : "does not see"}`);
        }
      }
      expect(wrong, kind).toEqual([]);
    });
  }
});

// ───────────────────────────── C1.3: the live line ─────────────────────────────
// WHO receives a frame on an open stream. The live gate is the same question as the door: a frame of a conversation reaches exactly the people the
// table above lets read it (the silent eye included — it reads everything, and a frame carries ids only). So the expected cells are the SAME table,
// not a new one: a live gate that disagreed with the door would be a leak or a lost message. A second table is for the people dock's nudge
// (`presence.changed`): everybody on the staff roster hears it, a guest never.
// A colleague of THE SPACE comes online: the owners (in every space), the space's people hear it; an org admin who is not in the space does not (their
// roster could not show the person), and a guest never does.
const PRESENCE_NUDGE = "1 1 1 0 1 1 1 1 0"; // owner pW pWo oAO sA mIn mOut tM guest

describe("privacy matrix — the C1.3 live gate", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: a message frame reaches exactly the people the table lets read it, in every one of their streams`, async () => {
      const w = await getWorld();
      setPolicyStubs({}); // the real policy
      resetHubForTests();
      const got = new Map<string, string[]>();
      for (const who of PERSONAS) {
        for (let tab = 0; tab < 2; tab++) {
          const frames: string[] = [];
          got.set(`${who}#${tab}`, frames);
          addClient({ userId: w.people[who].id, orgId: w.orgId, send: (f) => frames.push(f), close: () => undefined });
        }
      }
      await deliverEvent({ id: "900", orgId: w.orgId, kind: "message.created", ids: { conversationId: w.ids[kind]!, messageId: "m-live" } } as unknown as RtEvent);
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        for (let tab = 0; tab < 2; tab++) {
          const reached = got.get(`${who}#${tab}`)!.some((f) => f.includes('"kind":"message.created"'));
          const want = expected(CONVERSATIONS, kind, who);
          if (reached !== want) wrong.push(`${who} (tab ${tab}): expected ${want ? "receives" : "does not receive"}`);
        }
      }
      resetHubForTests();
      expect(wrong, kind).toEqual([]);
    });
  }

  it("a frame never carries content: ids only, whatever the message says", async () => {
    const w = await getWorld();
    resetHubForTests();
    const frames: string[] = [];
    addClient({ userId: w.people.memberIn.id, orgId: w.orgId, send: (f) => frames.push(f), close: () => undefined });
    await deliverEvent({ id: "901", orgId: w.orgId, kind: "message.created", ids: { conversationId: w.ids["open"]!, messageId: "m-live" } } as unknown as RtEvent);
    resetHubForTests();
    expect(frames).toHaveLength(1);
    expect(frames[0]).not.toContain(WORD);
    expect(Object.keys(JSON.parse(frames[0]!.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as object).sort()).toEqual(["conversationId", "kind", "messageId"]);
  });
});

describe("privacy matrix — the C1.3 presence nudge", () => {
  it("a colleague of the space coming online nudges the owners and the space's people, never an admin outside it, never a guest (a frame with no id and no person)", async () => {
    const w = await getWorld();
    setPolicyStubs({});
    resetHubForTests();
    const newcomer = await makeUser({ orgId: w.orgId, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: newcomer.id, role: "MEMBER" } });
    const streams = new Map<Persona, { text: () => string; cancel: () => Promise<void> }>();
    for (const who of PERSONAS) {
      await loginAs(w.people[who].id);
      const res = await rtRoute.GET(new NextRequest("http://localhost/api/rt"));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      void (async () => {
        for (;;) {
          const next = await reader.read().catch(() => ({ done: true, value: undefined }));
          if (next.done) return;
          text += decoder.decode(next.value);
        }
      })();
      streams.set(who, { text: () => text, cancel: () => reader.cancel().catch(() => undefined) });
    }
    await new Promise((r) => setTimeout(r, 300));
    const base = new Map([...streams].map(([who, s]) => [who, (s.text().match(/presence\.changed/g) ?? []).length]));
    await loginAs(newcomer.id);
    const mine = await rtRoute.GET(new NextRequest("http://localhost/api/rt"));
    await new Promise((r) => setTimeout(r, 400));
    const wrong: string[] = [];
    for (const who of PERSONAS) {
      const nudged = (streams.get(who)!.text().match(/presence\.changed/g) ?? []).length - base.get(who)!;
      const want = cells(PRESENCE_NUDGE)[PERSONAS.indexOf(who)]!;
      if ((nudged > 0) !== want) wrong.push(`${who}: expected ${want ? "nudged" : "not nudged"}`);
      expect(streams.get(who)!.text(), who).not.toContain(newcomer.id);
    }
    await mine.body?.cancel().catch(() => undefined);
    for (const s of streams.values()) await s.cancel();
    resetHubForTests();
    await stopRealtimeListenerForTests();
    expect(wrong).toEqual([]);
  });

  it("the table has one cell per persona", () => {
    expect(cells(PRESENCE_NUDGE)).toHaveLength(PERSONAS.length);
  });
});
