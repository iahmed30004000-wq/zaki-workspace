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
import * as forwardManyRoute from "@/app/api/chat/messages/forward/route";
import * as deleteManyRoute from "@/app/api/chat/messages/delete/route";
import * as taskGet from "@/app/api/tasks/[id]/route";
import * as tasksList from "@/app/api/tasks/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as verifyRoute from "@/app/api/organizations/[id]/members/[userId]/verify/route";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as readMarkRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as deliveredMarkRoute from "@/app/api/chat/conversations/[id]/delivered/route";
import * as mentionsRoute from "@/app/api/chat/conversations/[id]/mentions/route";
import * as personalStateRoute from "@/app/api/chat/conversations/[id]/me/route";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import * as workRequestsRoute from "@/app/api/work/requests/route";
import * as workTasksRoute from "@/app/api/work/tasks/route";
import * as staleRoute from "@/app/api/work/stale/route";
import * as taskSourceDoor from "@/app/api/production/task-source/[taskId]/route";
import * as workTaskDoor from "@/app/api/work/tasks/[id]/route";
import * as chatPrefsRoute from "@/app/api/me/chat-prefs/route";
import * as myPushList from "@/app/api/me/push/route";
import * as myPushOne from "@/app/api/me/push/[id]/route";
import * as previewImageRoute from "@/app/api/chat/messages/[id]/preview/image/route";
import * as previewRemoveRoute from "@/app/api/chat/messages/[id]/preview/route";
import * as scheduleRoute from "@/app/api/chat/conversations/[id]/scheduled/route";
import * as oneRoute from "@/app/api/chat/scheduled/[id]/route";
import * as sendNowRoute from "@/app/api/chat/scheduled/[id]/send/route";
import * as mediaRoute from "@/app/api/chat/conversations/[id]/media/route";
import * as workRoute from "@/app/api/chat/conversations/[id]/media/work/route";
import * as searchRoute from "@/app/api/search/route";
import BoardPage from "@/app/(app)/boards/[id]/page";
import * as boardTrail from "@/app/(app)/boards/[id]/trail/route";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import * as React from "react";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { linkPreviewAfterSend, setLinkPreviewDepsForTests } from "@/server/chat/link-preview";
import { folderRows } from "@/lib/chat/folders";
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
import { notifyMessageToAudience } from "@/server/chat/notify";
import { resetPresenceForTests } from "@/server/realtime/presence";

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

// ───────────────────────────── C1.8: the read and the delivered marks ─────────────────────────────
// A mark is a small WRITE (and an event) made by the reader. Two more tables, in the same columns:
//  - who may MARK a conversation read: the same people who may read it (anybody else is a 404, nothing written);
//  - who LEAVES a trace when they do (a row of their own, and a `conversation.read` event the others see): everybody who may read EXCEPT the silent eye
//    (the primary owner, and the partner who still holds archive.view) — his reading is silent, always (P0.1).
//  - the delivered mark belongs to a private chat's two people only: a topic is a 404 for everybody, the silent eye included.
const READ_TRACE = "0 0 1 0 1 1 1 1 1"; // open: everybody who reads, except the two silent eyes
const READ_TRACE_BY_KIND: Record<string, string> = {
  open: READ_TRACE,
  restricted: "0 0 0 0 0 1 0 0 0", // only its own people leave a mark; the silent eye reads and leaves none
  team: "0 0 1 0 1 0 0 1 0", //       the team's people and the space's managers
  dm: "0 0 0 0 0 1 0 0 0", //         its person (the other one is not a persona)
};
const DELIVERED_MARK: Record<string, string> = {
  open: "0 0 0 0 0 0 0 0 0",
  restricted: "0 0 0 0 0 0 0 0 0",
  team: "0 0 0 0 0 0 0 0 0",
  dm: "0 0 0 0 0 1 0 0 0", // memberIn is one of the two people; the silent eye is not one of them
};

describe("privacy matrix — the C1.8 read and delivered marks", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: who may mark read, who leaves a trace, who may mark delivered`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        await loginAs(person.id);
        // a message newer than anything this person has read: the mark has something to say
        const author = w.people.memberIn;
        const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: author.id, body: `${WORD} mark ${kind} ${who}` } });
        const eventsBefore = await db.realtimeEvent.count({ where: { kind: "conversation.read" } });
        const res = await call(readMarkRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${id}/read?upTo=${msg.id}`, params: { id } });
        const mayMark = res.status === 200;
        const row = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId: person.id } } });
        const traced = (await db.realtimeEvent.count({ where: { kind: "conversation.read" } })) > eventsBefore;
        // a trace is BOTH a row at least as new as the message and an event the others receive; a silent reader leaves neither
        const rowMarked = !!row && row.lastReadAt >= msg.createdAt;
        const wantMark = expected(CONVERSATIONS, kind, who);
        const wantTrace = cells(READ_TRACE_BY_KIND[kind]!)[PERSONAS.indexOf(who)]!;
        if (mayMark !== wantMark) wrong.push(`${who} · may mark read: expected ${wantMark}`);
        if (wantTrace !== (traced && rowMarked)) wrong.push(`${who} · leaves a trace: expected ${wantTrace} (event ${traced}, row ${rowMarked})`);
        if (!wantTrace && (traced || rowMarked)) wrong.push(`${who} · a silent reader left a trace`);

        const del = await call(deliveredMarkRoute.POST, { method: "POST", params: { id } });
        const mayDeliver = del.status < 300;
        const wantDeliver = cells(DELIVERED_MARK[kind]!)[PERSONAS.indexOf(who)]!;
        if (mayDeliver !== wantDeliver) wrong.push(`${who} · may mark delivered: expected ${wantDeliver}`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }

  it("the tables have one cell per persona", () => {
    for (const row of [...Object.values(READ_TRACE_BY_KIND), ...Object.values(DELIVERED_MARK)]) expect(cells(row)).toHaveLength(PERSONAS.length);
  });
});

// ───────────────────────────── C3b.6: the «@» button's list ─────────────────────────────
describe("privacy matrix — the C3b.6 unread mentions of a conversation", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: who may ask (the reading rule), who gets ids (only a person with a read mark of their own), and nobody leaves a trace`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      // «@الكل» by somebody other than the people under test, newer than every mark made so far
      const author = await db.conversationMember.findFirst({ where: { conversationId: id, NOT: { userId: w.people.memberIn.id } }, select: { userId: true } });
      const writer = author?.userId ?? w.people.memberIn.id;
      const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: writer, body: `${WORD} mention ${kind}`, mentions: ["*"], createdAt: new Date(Date.now() + 5_000) } });
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        const row = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId: person.id } } });
        const rowsBefore = await db.conversationMember.count({ where: { conversationId: id } });
        const eventsBefore = await db.realtimeEvent.count();
        await loginAs(person.id);
        const res = await call(mentionsRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/mentions`, params: { id } });
        const mayAsk = res.status === 200;
        const wantAsk = expected(CONVERSATIONS, kind, who);
        if (mayAsk !== wantAsk) wrong.push(`${who} · may ask: expected ${wantAsk} (status ${res.status})`);
        if (mayAsk) {
          // ids only for a person who has a row of their own older than the message, and not for its writer; the silent eye has no row: nothing
          const wantIds = row && row.lastReadAt < msg.createdAt && person.id !== writer ? [msg.id] : [];
          if (JSON.stringify(res.json?.["ids"]) !== JSON.stringify(wantIds)) wrong.push(`${who} · ids: expected ${wantIds.length}, got ${JSON.stringify(res.json?.["ids"])}`);
        } else if (res.text.includes(WORD)) wrong.push(`${who} · a refusal carried the text`);
        if (res.text.includes(WORD)) wrong.push(`${who} · the answer carried a text`);
        // no trace of any kind: no new row, no event
        if ((await db.conversationMember.count({ where: { conversationId: id } })) !== rowsBefore) wrong.push(`${who} · left a row`);
        if ((await db.realtimeEvent.count()) !== eventsBefore) wrong.push(`${who} · left an event`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }
});

// ───────────────────────────── W1.4: the inbox «الطلبات» ─────────────────────────────
// The same table, on one more surface: a task assignment request addressed to a person is in THEIR inbox only when the table says they may open the
// task («المعنيين بس»: a private task is not listed to somebody who is no part of it, and is not counted). A guest has no inbox at all (403), whatever
// the table says about the space they are in.
describe("privacy matrix — the W1.4 inbox (assignment requests)", () => {
  for (const kind of Object.keys(TASKS)) {
    it(`${kind}: a pending request addressed to each person is listed to them only where the table lets them open the task`, async () => {
      const w = await getWorld();
      const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId }, select: { settings: true } });
      const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
      await db.organization.update({ where: { id: w.orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), workRequests: true } } } });
      const taskId = w.tasks[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        const request = await db.taskAssignRequest.create({ data: { orgId: w.orgId, taskId, fromUserId: w.people.memberIn.id, toUserId: person.id } });
        await loginAs(person.id);
        const res = await call(workRequestsRoute.GET, { url: "http://localhost/api/work/requests?tab=waiting" });
        // one request at a time, so each person's number is about this task alone
        await db.taskAssignRequest.delete({ where: { id: request.id } });
        if (who === "guest") {
          if (res.status !== 403 || res.text.includes(request.id)) wrong.push(`${who}: a guest has no inbox (status ${res.status})`);
          continue;
        }
        const listed = res.status === 200 && res.text.includes(request.id);
        const want = expected(TASKS, kind, who);
        if (listed !== want) wrong.push(`${who}: expected ${want ? "listed" : "not listed"}`);
        const section = (res.json?.["sections"] as { key: string; total: number }[] | undefined)?.find((x) => x.key === "assignments");
        if (want && section?.total !== 1) wrong.push(`${who}: the number should count it`);
        if (!want && (section?.total ?? 0) !== 0) wrong.push(`${who}: the number counted a task they cannot open`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }
});

// ───────────────────────────── C3a.1: a person's own pin, archive and «علّم كغير مقروء» ─────────────────────────────
// `PUT /api/chat/conversations/[id]/me` is a small WRITE made by the reader (a row of their own, and an event for them alone). Who may make it is the reading rule
// plus the markRead rule: the same people who may read, EXCEPT the silent eye, whose reading leaves no trace (no row, no event — a 404 as if there were nothing
// there); a restricted topic and a private chat need a row the person already has (no row = no audience).
const PERSONAL_STATE: Record<string, string> = {
  open: "0 0 1 0 1 1 1 1 1", //       an open topic: everybody who reads it, except the two silent eyes (an open topic gets the reader a row, like markRead)
  restricted: "0 0 0 0 0 1 0 0 0", // only the people who already have a row in it
  team: "0 0 1 0 1 0 0 1 0", //       the team's people and the space's managers
  dm: "0 0 0 0 0 1 0 0 0", //         the private chat's own person
};

describe("privacy matrix — the C3a.1 personal state", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: who may set their own pin, archive and mark, and who leaves a trace`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        await loginAs(person.id);
        const rowsBefore = await db.conversationMember.count({ where: { conversationId: id } });
        const eventsBefore = await db.realtimeEvent.count({ where: { kind: "conversation.changed" } });
        const res = await call(personalStateRoute.PUT, { method: "PUT", params: { id }, body: { markedUnread: true } });
        const may = res.status === 200;
        const want = cells(PERSONAL_STATE[kind]!)[PERSONAS.indexOf(who)]!;
        if (may !== want) wrong.push(`${who} · may set: expected ${want} (status ${res.status})`);
        const row = await db.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId: person.id } } });
        const events = (await db.realtimeEvent.count({ where: { kind: "conversation.changed" } })) - eventsBefore;
        if (want && (row?.markedUnread !== true || events !== 1)) wrong.push(`${who} · should have a mark and one event for them (row ${row?.markedUnread}, events ${events})`);
        if (!want) {
          // a refusal is 404 and leaves nothing: no row made, no event, no word of what the conversation is
          if (res.status !== 404) wrong.push(`${who} · a refusal must be a 404 (got ${res.status})`);
          if (row?.markedUnread) wrong.push(`${who} · a refused person got a mark`);
          if (events !== 0) wrong.push(`${who} · a refused person left an event`);
          if ((await db.conversationMember.count({ where: { conversationId: id } })) !== rowsBefore) wrong.push(`${who} · a refused person got a row`);
          if (res.text.includes(WORD)) wrong.push(`${who} · the refusal carried a text`);
        }
        if (want) {
          // the event is for the person alone: ids only, no text
          const last = await db.realtimeEvent.findFirst({ where: { kind: "conversation.changed" }, orderBy: { id: "desc" } });
          const ids = (last?.ids ?? {}) as Record<string, unknown>;
          if (ids["targetUserId"] !== person.id) wrong.push(`${who} · the event is not aimed at them alone`);
          if (JSON.stringify(ids).includes(WORD)) wrong.push(`${who} · the event carried a text`);
        }
      }
      expect(wrong, kind).toEqual([]);
    });
  }

  it("the table has one cell per persona in every row", () => {
    for (const row of Object.values(PERSONAL_STATE)) expect(cells(row)).toHaveLength(PERSONAS.length);
  });
});

// ───────────────────────────── C3a.2: a person's own folders (User.chatPrefs) ─────────────────────────────
// `GET/PUT /api/me/chat-prefs` keeps ONE person's folders, which list conversations by id. A folder is only a FILTER over the rows of that person's own list: it
// can show only conversations the list already holds a row for, never one the table says the person cannot read, and what the route answers carries ids, never a
// title or a word of a message. One person's folders never reach another person.
describe("privacy matrix — the C3a.2 folders", () => {
  it("a folder that lists every conversation shows each person exactly the ones their own list holds; the route names none of them and keeps each person's folders apart", async () => {
    const w = await getWorld();
    const kinds = Object.keys(CONVERSATIONS);
    const wrong: string[] = [];
    for (const [index, who] of PERSONAS.entries()) {
      const person = w.people[who];
      await loginAs(person.id);
      const folder = { id: `f${index}`, name: `م${index}`, include: { conversationIds: kinds.map((k) => w.ids[k]!), spaceIds: [] }, exclude: {} };
      const saved = await call(chatPrefsRoute.PUT, { method: "PUT", url: "http://localhost/api/me/chat-prefs", body: { folders: { [w.orgId]: [folder] } } });
      if (saved.status !== 200) wrong.push(`${who} · save: ${saved.status}`);
      const read = await call(chatPrefsRoute.GET, { method: "GET", url: "http://localhost/api/me/chat-prefs" });
      // ids only: no title of any conversation, no word of any message
      for (const secret of [WORD, "Restricted", "Team", "Open"]) if (read.text.includes(secret)) wrong.push(`${who} · the prefs carried «${secret}»`);
      // only this person's folder
      const mine = (read.json?.["prefs"] as { folders?: Record<string, { id: string }[]> }).folders?.[w.orgId]?.map((f) => f.id);
      if (JSON.stringify(mine) !== JSON.stringify([folder.id])) wrong.push(`${who} · saw folders ${JSON.stringify(mine)}`);

      // the one list (a space is ONE row, its topics are chips) and the list of the one space (its topics are rows): a folder keeps or drops rows of THESE and makes none
      const ctx = { orgId: w.orgId, userId: person.id, orgRole: await w.roleOf(person.id) };
      for (const [shape, list] of [
        [{ scope: "all" as const, spaceId: null }, await chatList(ctx)],
        [{ scope: "space" as const, spaceId: w.space.id }, await chatList(ctx, { spaceId: w.space.id })],
      ] as const) {
        const shown = new Set(folderRows(list.rows, folder, shape).map((r) => r.id));
        for (const kind of kinds) {
          const id = w.ids[kind]!;
          const inRows = list.rows.some((r) => r.id === id);
          if (shown.has(id) !== inRows) wrong.push(`${who} · ${kind} · ${shape.scope}: the folder ${shown.has(id) ? "shows" : "hides"} it but the list ${inRows ? "has" : "has no"} row for it`);
          if (shown.has(id) && !expected(CONVERSATIONS, kind, who)) wrong.push(`${who} · ${kind} · ${shape.scope}: the folder shows a conversation the person cannot read`);
        }
        for (const id of shown) if (!list.rows.some((r) => r.id === id)) wrong.push(`${who} · the folder made a row of its own (${id})`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ───────────────────────────── C3a.3: «الرسائل المحفوظة» (a DM with oneself) ─────────────────────────────
// A person's saved chat is a DM whose two people are the same person (`dmKey = <me>|<me>`, ONE row). Who reads it is the DM row of the table above and nothing else:
// the person, and the silent eye (D-C3: the same oversight rule as every DM, the owner's decision recorded as «آه»). An outsider, a partner without `archive.view`, an org
// admin, a space admin, a team member and a guest read nothing of it, on any surface. And everybody who may have private chats can make their own (a guest cannot).
const SAVED_READ = "1 1 0 0 0 1 0 0 0"; //  the person (memberIn) and the silent eyes — exactly the `dm` row
describe("privacy matrix — the C3a.3 saved messages", () => {
  it("a person's saved chat is read by the person and the silent eye only: the door, the header, the messages and the policy agree with the DM row", async () => {
    const w = await getWorld();
    expect(SAVED_READ).toBe(CONVERSATIONS["dm"]);
    await loginAs(w.people.memberIn.id);
    const made = await call(dmRoute.POST, { body: { saved: true } });
    expect(made.status).toBe(201);
    const id = made.json?.["id"] as string;
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: w.people.memberIn.id, body: `${WORD} saved` } });
    const wrong: string[] = [];
    for (const who of PERSONAS) {
      const person = w.people[who];
      const want = cells(SAVED_READ)[PERSONAS.indexOf(who)]!;
      await loginAs(person.id);
      const door = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).status === 200;
      const header = await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/header`, params: { id } });
      const messages = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/messages`, params: { id } });
      const policy = await canReadConversation(person.id, id);
      for (const [surface, got] of Object.entries({ door, header: header.status === 200, messages: messages.status === 200, policy })) {
        if (got !== want) wrong.push(`${who} · ${surface}: expected ${want ? "reads" : "does not read"}`);
      }
      if (!want && (header.text.includes(WORD) || messages.text.includes(WORD))) wrong.push(`${who} · a refusal carried the text`);
      // nobody but the person has the chat in their own list, and nobody but the person may write in it (the owner only reads)
      const ctx = { orgId: w.orgId, userId: person.id, orgRole: await w.roleOf(person.id) };
      const listed = JSON.stringify((await chatList(ctx)).rows).includes(id);
      if (listed !== (who === "memberIn")) wrong.push(`${who} · the list ${listed ? "holds" : "does not hold"} the saved chat`);
      const posted = await call(messagesRoute.POST, { url: `http://localhost/api/chat/conversations/${id}/messages`, params: { id }, body: { body: "x" } });
      if ((posted.status === 201 || posted.status === 200) !== (who === "memberIn")) wrong.push(`${who} · may post: status ${posted.status}`);
    }
    expect(wrong).toEqual([]);
    // the one who made it still has exactly one row in it
    expect(await db.conversationMember.count({ where: { conversationId: id } })).toBe(1);
  });

  it("every persona may make their OWN (one conversation, one row, theirs); a guest may not (403) and nothing is made for them", async () => {
    const w = await getWorld();
    const wrong: string[] = [];
    for (const who of PERSONAS) {
      const person = w.people[who];
      await loginAs(person.id);
      const res = await call(dmRoute.POST, { body: { saved: true } });
      const again = await call(dmRoute.POST, { body: { saved: true } });
      const rows = await db.conversation.findMany({ where: { orgId: w.orgId, dmKey: `${person.id}|${person.id}` }, include: { members: true } });
      if (who === "guest") {
        if (res.status !== 403) wrong.push(`${who} · expected 403, got ${res.status}`);
        if (rows.length !== 0) wrong.push(`${who} · a guest got a saved chat`);
        continue;
      }
      if (![200, 201].includes(res.status) || again.status !== 200 || again.json?.["id"] !== res.json?.["id"]) wrong.push(`${who} · open: ${res.status} then ${again.status}`);
      if (rows.length !== 1 || rows[0]!.members.length !== 1 || rows[0]!.members[0]!.userId !== person.id) wrong.push(`${who} · not exactly one chat with one row of their own`);
      if (rows[0]?.spaceId !== null || rows[0]?.kind !== "DM") wrong.push(`${who} · not a space-less DM`);
    }
    expect(wrong).toEqual([]);
  });
});

// ───────────────────────────── C3b.2: the link card under a message, and its picture ─────────────────────────────
// A link preview is made by the SERVER from a public page and attached to a message. It must reach exactly the people who may read the message: the picture route answers the
// reading rule of the conversation (404 as if nothing were there for everybody else, a guest in a private chat included), the card rides the sync feed only to its readers, nobody
// but the author can take it off, and the event that announces it carries ids and never a word of the page. The network is a stub: nothing here reaches a site.
const CARD_TITLE = "عنوان البطاقة السري";
const CARD_PAGE = "https://matrix-card.example.com/page";
const CARD_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(64).fill(3)]);

describe("privacy matrix — the C3b.2 link preview", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: the card and its picture reach only the readers, only the author removes it, and the event carries no words`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      // link previews work only where the new chat screen (which draws the card and the ✕) is on too
      const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId }, select: { settings: true } });
      const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
      await db.organization.update({ where: { id: w.orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), chatLayoutV2: true } } } });
      setLinkPreviewDepsForTests({
        resolve: async () => ["93.184.216.34"],
        timeoutMs: 3_000,
        fetch: (async (input: RequestInfo | URL) =>
          String(input) === CARD_PAGE
            ? new Response(`<html><head><meta property="og:title" content="${CARD_TITLE}"><meta property="og:image" content="https://matrix-card.example.com/p.png"></head></html>`, { status: 200, headers: { "content-type": "text/html" } })
            : new Response(CARD_PNG, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch,
      });
      try {
        const author = (["memberIn", "teamMember", "spaceAdmin"] as const).map((n) => w.people[n]).find((_p, i) => expected(CONVERSATIONS, kind, (["memberIn", "teamMember", "spaceAdmin"] as const)[i]!))!; // a team's topic is not memberIn's: the author is the first of these who may read it
        const ownerCtx = { orgId: w.orgId, userId: w.people.owner.id, orgRole: "OWNER" as const };
        const before = (await syncFeed(ownerCtx)).cursor;
        const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: author.id, body: `${CARD_PAGE} ${kind}` } });
        const conv = await db.conversation.findUniqueOrThrow({ where: { id }, select: { spaceId: true } });
        await linkPreviewAfterSend({ orgId: w.orgId, userId: author.id, orgRole: "MEMBER" }, { messageId: msg.id, conversationId: id, spaceId: conv.spaceId, body: msg.body });
        expect((await db.chatMessage.findUniqueOrThrow({ where: { id: msg.id } })).previewId).not.toBeNull();

        // the event: ids only
        const events = await db.realtimeEvent.findMany({ where: { orgId: w.orgId, kind: "message.enriched", id: { gt: BigInt(before) } } });
        expect(events).toHaveLength(1);
        if (JSON.stringify(events[0]!.ids).includes(CARD_TITLE)) throw new Error("the event carried a word of the page");

        const wrong: string[] = [];
        const rowsBefore = await db.conversationMember.count({ where: { conversationId: id } });
        for (const who of PERSONAS) {
          const person = w.people[who];
          const may = expected(CONVERSATIONS, kind, who);
          await loginAs(person.id);
          // the picture
          const image = await call(previewImageRoute.GET, { params: { id: msg.id }, url: `http://localhost/api/chat/messages/${msg.id}/preview/image` });
          if ((image.status === 200) !== may) wrong.push(`${who} · picture: expected ${may ? 200 : "a refusal"} (status ${image.status})`);
          if (!may && (image.text.includes(CARD_TITLE) || image.headers.get("content-type") === "image/png")) wrong.push(`${who} · a refusal carried the card or the picture`);
          // the card in the sync feed
          const synced = await syncFeed({ orgId: w.orgId, userId: person.id, orgRole: await w.roleOf(person.id) }, { after: BigInt(before) });
          const got = synced.messages.find((m) => m.id === msg.id);
          // the sync feed never carries somebody else's private chat, not even to the silent eye (he reads it through the archive): that is the feed's own rule
          const viaSync = may && !(kind === "dm" && (who === "owner" || who === "partnerWith"));
          if (viaSync && got?.preview?.title !== CARD_TITLE) wrong.push(`${who} · a reader did not get the card by sync`);
          if (!viaSync && (got || JSON.stringify(synced).includes(CARD_TITLE))) wrong.push(`${who} · sync carried the message or the card to somebody who may not read it`);
          // the removal: not for anybody but the author (a reader is told 403, the others are told nothing)
          if (person.id !== author.id) {
            const removal = await call(previewRemoveRoute.DELETE, { method: "DELETE", params: { id: msg.id } });
            if (removal.status === 200) wrong.push(`${who} · removed somebody else's card`);
            if (may && removal.status !== 403) wrong.push(`${who} · a reader who is not the author should get 403 (got ${removal.status})`);
            if (!may && removal.status !== 404 && removal.status !== 403) wrong.push(`${who} · a refusal should be 404 or 403 (got ${removal.status})`);
          }
        }
        if ((await db.chatMessage.findUniqueOrThrow({ where: { id: msg.id } })).previewId === null) wrong.push("a card was removed by somebody who is not the author");
        // reading the picture and the card left no trace: no row was made for anybody
        if ((await db.conversationMember.count({ where: { conversationId: id } })) !== rowsBefore) wrong.push("reading the card made a membership row");
        // the author removes it, and from then on nobody gets it
        await loginAs(author.id);
        expect((await call(previewRemoveRoute.DELETE, { method: "DELETE", params: { id: msg.id } })).status).toBe(200);
        for (const who of PERSONAS) {
          await loginAs(w.people[who].id);
          if ((await call(previewImageRoute.GET, { params: { id: msg.id } })).status === 200) wrong.push(`${who} · the picture still opens after the author removed the card`);
        }
        expect(wrong, kind).toEqual([]);
      } finally {
        setLinkPreviewDepsForTests(undefined);
      }
    });
  }
});

// ───────────────────────────── C3c.3: «جدول الإرسال» (scheduled messages) ─────────────────────────────
// A scheduled message lives in a table of its own (`ScheduledChatMessage`) that NO message reader reads, and only its AUTHOR sees their own rows. Who may SCHEDULE in a
// conversation is who may POST there (the send's own `canPost`, with the silent eye unable to post where he has not joined): the same cells as the personal-state table above
// (read + post, not the silent eyes). A refused person leaves no row and learns nothing. The words of a waiting row appear on NO surface of a message: the window, the list,
// the search, the sync feed and the oversight list never carry them, for anybody (the author included: they read their own rows only through the scheduled routes).
const SCHEDULE_WRITE: Record<string, string> = {
  open: "0 0 1 0 1 1 1 1 1", //       an open topic: everybody who reads AND may post (the owner's eyes cannot post unjoined; a guest may post in a discussion topic)
  restricted: "0 0 0 0 0 1 0 0 0", // only its own people
  team: "0 0 1 0 1 0 0 1 0", //       the team's people and the space's managers
  dm: "0 0 0 0 0 1 0 0 0", //         the private chat's own person
};
const SCHEDULED_WORD = "نصمجدولبالمصفوفة";

describe("privacy matrix — the C3c.3 scheduled messages", () => {
  for (const kind of Object.keys(SCHEDULE_WRITE)) {
    it(`${kind}: who may schedule, who sees the row, and that no message reader ever carries it`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const wrong: string[] = [];
      const sendAt = () => new Date(Date.now() + 30 * 60_000).toISOString();
      const made = new Map<Persona, string>();
      for (const who of PERSONAS) {
        const person = w.people[who];
        await loginAs(person.id);
        const rowsBefore = await db.scheduledChatMessage.count({ where: { authorId: person.id, conversationId: id } });
        const res = await call(scheduleRoute.POST, { method: "POST", params: { id }, body: { body: `${SCHEDULED_WORD} ${who} ${kind}`, sendAt: sendAt() } });
        const may = res.status === 201;
        const want = cells(SCHEDULE_WRITE[kind]!)[PERSONAS.indexOf(who)]!;
        if (may !== want) wrong.push(`${who} · may schedule: expected ${want} (status ${res.status})`);
        if (may) made.set(who, res.json?.["id"] as string);
        if (!want) {
          if (![403, 404].includes(res.status)) wrong.push(`${who} · a refusal must be 403 or 404 (got ${res.status})`);
          if ((await db.scheduledChatMessage.count({ where: { authorId: person.id, conversationId: id } })) !== rowsBefore) wrong.push(`${who} · a refused person got a row`);
          if (res.text.includes(WORD) || res.text.includes(SCHEDULED_WORD)) wrong.push(`${who} · the refusal carried a text`);
        }
      }

      // every reader of a message, as every person who may read: not one word of any waiting row
      const ctxOf = async (who: Persona) => ({ orgId: w.orgId, userId: w.people[who].id, orgRole: await w.roleOf(w.people[who].id) });
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        const c = await ctxOf(who);
        const surfaces: Record<string, string> = {
          window: (await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/messages`, params: { id } })).text,
          list: JSON.stringify(await chatList(c)),
          space: JSON.stringify(await chatList(c, { spaceId: w.space.id })),
          search: JSON.stringify(await searchChat(c, { id: w.space.id, isHq: false }, SCHEDULED_WORD)),
          sync: JSON.stringify(await syncFeed(c)),
          oversight: JSON.stringify(await listOversight(c, { limit: 100 }).catch(() => null)),
        };
        for (const [surface, text] of Object.entries(surfaces)) if (text.includes(SCHEDULED_WORD)) wrong.push(`${who} · ${surface}: carried the words of a scheduled message`);
      }

      // the scheduled routes: each person sees their OWN row and nobody else's; nobody touches another's row
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        const listed = await call(scheduleRoute.GET, { method: "GET", params: { id } });
        const readsHere = expected(CONVERSATIONS, kind, who);
        if (readsHere !== (listed.status === 200)) wrong.push(`${who} · the list: expected ${readsHere ? 200 : "a refusal"} (status ${listed.status})`);
        if (listed.status === 200) {
          const ids = (listed.json?.["items"] as { id: string }[]).map((i) => i.id);
          const mine = made.get(who);
          if (JSON.stringify(ids) !== JSON.stringify(mine ? [mine] : [])) wrong.push(`${who} · the list shows ${JSON.stringify(ids)}, not only their own row`);
        } else if (listed.text.includes(SCHEDULED_WORD)) wrong.push(`${who} · a refused list carried a text`);
        for (const [owner, rowId] of made) {
          if (owner === who) continue;
          const patch = await call(oneRoute.PATCH, { method: "PATCH", params: { id: rowId }, body: { body: "x" } });
          const del = await call(oneRoute.DELETE, { method: "DELETE", params: { id: rowId } });
          const send = await call(sendNowRoute.POST, { method: "POST", params: { id: rowId } });
          for (const [what, res] of Object.entries({ patch, del, send })) {
            if (res.status !== 404 || res.text.includes(SCHEDULED_WORD)) wrong.push(`${who} · ${what} of ${owner}'s row: expected a bare 404 (got ${res.status})`);
          }
        }
      }
      for (const [owner, rowId] of made) {
        const row = await db.scheduledChatMessage.findUniqueOrThrow({ where: { id: rowId } });
        if (row.status !== "PENDING" || !row.body.includes(SCHEDULED_WORD)) wrong.push(`${owner} · a row was changed by somebody else`);
      }
      // the rows made no message
      if ((await db.chatMessage.count({ where: { conversationId: id, body: { contains: SCHEDULED_WORD } } })) !== 0) wrong.push("a scheduled row became a message before its time");
      expect(wrong, kind).toEqual([]);
    });
  }

  it("the table has one cell per persona in every row", () => {
    for (const row of Object.values(SCHEDULE_WRITE)) expect(cells(row)).toHaveLength(PERSONAS.length);
  });
});

// ───────────────────────────── C3d: the media route, the list's search and the «الشغل» tab ─────────────────────────────
// The same table, three more surfaces:
//  - MEDIA (`GET …/media`): the door's own answer (the table's conversation rows) — and, for everybody who may list, never the file of a deleted message (the owner too);
//  - LIST SEARCH (`GET /api/search?scope=chat`): a message hit of a conversation appears exactly where the table lets the person read it (the silent eye included);
//  - WORK (`GET …/media/work`): a task made from a message of that conversation is named only to a person who may read the conversation AND may see the task
//    (the TASKS table, P0.2) — and a guest learns of no task and no ticket at all, whatever the table says of the task's own door. A ticket is named to whoever raised
//    or holds it and to the OWNER and ADMIN ranks (the ticket door's rule), again only inside a conversation they can read.
const MEDIA_WORD = "ملفمصفوفةسرية";
const WORK_WORD = "شغلمصفوفةسري";
//                                    owner pW pWo oAO sA mIn mOut tM guest
const WORK_TICKET = "1 1 1 0 0 1 0 0 0"; // a ticket the member raised, made from a message of the open topic
const WORK_GUEST_EXCEPT: Persona[] = ["guest"];

describe("privacy matrix — C3d: the media route", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: only the readers list the media; never the file of a deleted message; the silent eye leaves no trace`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const author = w.people.memberIn;
      const file = (name: string) =>
        db.storedFile.create({ data: { orgId: w.orgId, uploaderId: author.id, familyId: `f_${name}`, name, mimeType: "image/png", size: 5, path: `p_${name}`, purpose: "CHAT" } });
      const live = await file(`${MEDIA_WORD}-live-${kind}.png`);
      const gone = await file(`${MEDIA_WORD}-gone-${kind}.png`);
      const liveMsg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: author.id, body: `${MEDIA_WORD} ${kind}` } });
      const goneMsg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: author.id, body: `${MEDIA_WORD} deleted ${kind}`, deletedAt: new Date(), deletedById: author.id } });
      const liveAtt = await db.messageAttachment.create({ data: { messageId: liveMsg.id, fileId: live.id, kind: "IMAGE", name: live.name } });
      await db.messageAttachment.create({ data: { messageId: goneMsg.id, fileId: gone.id, kind: "IMAGE", name: gone.name } });

      const members = await db.conversationMember.count({ where: { conversationId: id } });
      const events = await db.realtimeEvent.count({ where: { orgId: w.orgId } });
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        const want = expected(CONVERSATIONS, kind, who);
        for (const query of ["?kind=IMAGE", "?kind=MEDIA", "?counts=1"]) {
          const res = await call(mediaRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/media${query}`, params: { id } });
          if ((res.status === 200) !== want) wrong.push(`${who} · ${query}: expected ${want ? "sees" : "does not see"} (status ${res.status})`);
          if (res.text.includes(`${MEDIA_WORD}-gone`)) wrong.push(`${who} · ${query}: carried the file of a deleted message`);
          if (!want && (res.text.includes(MEDIA_WORD) || res.text.includes(liveAtt.id))) wrong.push(`${who} · ${query}: a refusal carried the media`);
          if (want && query === "?kind=IMAGE" && !res.text.includes(liveAtt.id)) wrong.push(`${who} · ${query}: a reader did not get the live picture`);
        }
      }
      // listing is a read: no read row for the silent eye, no event for anybody
      if ((await db.conversationMember.count({ where: { conversationId: id } })) !== members) wrong.push("a listing wrote a member row");
      if ((await db.realtimeEvent.count({ where: { orgId: w.orgId } })) !== events) wrong.push("a listing wrote an event");
      expect(wrong, kind).toEqual([]);
    });
  }
});

describe("privacy matrix — C3d: the list's search", () => {
  const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: a message of it is found exactly where the table lets the person read it, and the chats and people never name it to anybody else`, async () => {
      const w = await getWorld();
      const id = w.ids[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        enter(w.space.id);
        const want = expected(CONVERSATIONS, kind, who);
        const res = await call(searchRoute.GET, { url: `http://localhost/api/search?scope=chat&q=${encodeURIComponent(WORD)}` });
        const found = res.status === 200 && ((res.json?.["messages"] as { conversationId: string }[]) ?? []).some((m) => m.conversationId === id);
        if (found !== want) wrong.push(`${who} · messages: expected ${want ? "sees" : "does not see"}`);
        // the three keys, nothing else
        if (res.status === 200 && Object.keys(res.json ?? {}).sort().join() !== "chats,messages,people") wrong.push(`${who} · the answer has other keys`);
        // a person who may not read it never gets its words, nor its id, in any section
        if (!want && (res.text.includes(`${WORD} ${kind}`) || res.text.includes(id))) wrong.push(`${who} · a section named a conversation they cannot read`);
        // the same through the in-chat door: the readers only
        const inside = await call(searchRoute.GET, { url: `http://localhost/api/search?scope=chat&conversationId=${id}&q=${encodeURIComponent(WORD)}` });
        if ((inside.status === 200) !== want) wrong.push(`${who} · inside the conversation: expected ${want ? "200" : "a refusal"} (status ${inside.status})`);
        if (!want && inside.text.includes(WORD)) wrong.push(`${who} · a refusal carried a text`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }

  it("the people section follows the directory rule: a guest's rows are the name only", async () => {
    const w = await getWorld();
    await loginAs(w.people.guest.id);
    enter(w.space.id);
    const res = await call(searchRoute.GET, { url: "http://localhost/api/search?scope=chat&q=Member" });
    expect(res.status).toBe(200);
    const people = (res.json?.["people"] as Record<string, unknown>[]) ?? [];
    expect(people.length).toBeGreaterThan(0);
    for (const p of people) expect(Object.keys(p).sort()).toEqual(["id", "name"]);
    expect((res.json?.["chats"] as { kind: string }[]).filter((c) => c.kind === "DM")).toEqual([]);
  });
});

describe("privacy matrix — C3d: the «الشغل» tab", () => {
  const sourceOf: Record<string, string> = { public: "open", private: "open", fromPrivate: "restricted" };
  it("a task is named to the people who may read the conversation AND see the task; a hidden task is not counted; a guest learns of none", async () => {
    const w = await getWorld();
    // the two tasks of the world become «made from a message» of the open topic (the third was made from the restricted one through the door)
    const openMsg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.ids["open"]!, authorId: w.people.memberIn.id, body: `${WORK_WORD} open` } });
    await db.task.update({ where: { id: w.tasks["public"]! }, data: { sourceMessageId: openMsg.id, title: `${WORK_WORD} public` } });
    await db.task.update({ where: { id: w.tasks["private"]! }, data: { sourceMessageId: openMsg.id, title: `${WORK_WORD} private` } });
    await db.task.update({ where: { id: w.tasks["fromPrivate"]! }, data: { title: `${WORK_WORD} fromPrivate` } });
    const wrong: string[] = [];
    for (const kind of Object.keys(TASKS)) {
      const conv = sourceOf[kind]!;
      const id = w.ids[conv]!;
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        const res = await call(workRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/media/work`, params: { id } });
        const reads = expected(CONVERSATIONS, conv, who);
        const want = reads && expected(TASKS, kind, who) && !WORK_GUEST_EXCEPT.includes(who);
        const named = res.status === 200 && ((res.json?.["tasks"] as { id: string }[]) ?? []).some((t) => t.id === w.tasks[kind]);
        if (named !== want) wrong.push(`${kind} · ${who}: expected ${want ? "named" : "not named"} (status ${res.status})`);
        if ((res.status === 200) !== reads) wrong.push(`${kind} · ${who}: the door expected ${reads ? "200" : "a refusal"} (status ${res.status})`);
        // not named: not a word of it — the hidden task is not even counted
        if (!want && res.text.includes(`${WORK_WORD} ${kind}`)) wrong.push(`${kind} · ${who}: a task they may not see was named`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a ticket is named to whoever raised or holds it and to the OWNER and ADMIN ranks — inside a conversation they can read; a guest to nobody", async () => {
    const w = await getWorld();
    const id = w.ids["open"]!;
    const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: id, authorId: w.people.memberIn.id, body: `${WORK_WORD} ticket` } });
    const number = ((await db.ticket.aggregate({ where: { orgId: w.orgId }, _max: { number: true } }))._max.number ?? 0) + 1;
    const ticket = await db.ticket.create({ data: { orgId: w.orgId, number, title: `${WORK_WORD} ticket title`, creatorId: w.people.memberIn.id, sourceMessageId: msg.id } });
    const wrong: string[] = [];
    for (const who of PERSONAS) {
      await loginAs(w.people[who].id);
      const res = await call(workRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/media/work`, params: { id } });
      const reads = expected(CONVERSATIONS, "open", who);
      const want = reads && cells(WORK_TICKET)[PERSONAS.indexOf(who)]!;
      const named = res.status === 200 && ((res.json?.["tickets"] as { id: string }[]) ?? []).some((t) => t.id === ticket.id);
      if (named !== want) wrong.push(`${who}: expected ${want ? "named" : "not named"} (status ${res.status})`);
      if (!want && res.text.includes(`${WORK_WORD} ticket title`)) wrong.push(`${who}: a ticket they may not read was named`);
    }
    expect(wrong).toEqual([]);
  });

  it("the table has one cell per persona", () => {
    expect(cells(WORK_TICKET)).toHaveLength(PERSONAS.length);
  });
});

// ───────────────────────────── W1.1: the unified «مهامي» ─────────────────────────────
// The same TASKS table on three more surfaces: the panel's door (GET /api/work/tasks/[id]), the screen's list in the scope «المساحة» (the person's current space) and in
// the scope «أنا» (assigned to the person), and the chips' NUMBERS. A task the table hides from a person is not their panel, not in their list, not in their count.

describe("privacy matrix — the W1.1 «مهامي» (panel, list, counts)", () => {
  async function switchOn() {
    const w = await getWorld();
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId }, select: { settings: true } });
    const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), workMyTasks: true } } } });
    return w;
  }
  const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

  for (const kind of Object.keys(TASKS)) {
    it(`${kind}: the panel's door and the space's list agree with the table`, async () => {
      const w = await switchOn();
      const id = w.tasks[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        const want = expected(TASKS, kind, who);
        await loginAs(person.id);
        enter(w.space.id);
        const door = await call(workTaskDoor.GET, { params: { id } });
        const space = await call(workTasksRoute.GET, { url: "http://localhost/api/work/tasks?scope=space" });
        const everything = await call(workTasksRoute.GET, { url: "http://localhost/api/work/tasks?scope=me&chip=nodate" });
        const listed = space.status === 200 && JSON.stringify(space.json).includes(id);
        for (const [surface, got] of Object.entries({ door: door.status === 200, list: listed })) {
          if (got !== want) wrong.push(`${who} · ${surface}: expected ${want ? "sees" : "does not see"}`);
        }
        // «أنا» is only ever a subset of what the person may open: a task the table hides is in neither
        if (!want && JSON.stringify(everything.json).includes(id)) wrong.push(`${who} · me: a hidden task was named`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }

  it("a hidden task is not COUNTED: each person's chip number is the number of the table's tasks they may see", async () => {
    const w = await switchOn();
    const wrong: string[] = [];
    for (const who of PERSONAS) {
      await loginAs(w.people[who].id);
      enter(w.space.id);
      const res = await call(workTasksRoute.GET, { url: "http://localhost/api/work/tasks?scope=space" });
      const seen = Object.keys(TASKS).filter((kind) => expected(TASKS, kind, who)).length;
      const counted = (res.json?.["counts"] as Record<string, number> | undefined)?.["nodate"] ?? 0;
      // a person who is not in the space has no «المساحة» of it: the screen falls back to «أنا» and their own numbers
      const inSpace = who !== "orgAdminOut";
      if (inSpace && counted !== seen) wrong.push(`${who}: counted ${counted}, may see ${seen}`);
      if (!inSpace && counted > seen) wrong.push(`${who}: counted ${counted} tasks of a space they are not in`);
    }
    expect(wrong).toEqual([]);
  });
});

// W1.8: the palette finds boards, ideas, tickets and customers. A row is a thing that exists, a column a kind of person, `1` = «finds it»; the code follows the table.
describe("privacy matrix — the W1.8 palette: boards, ideas, tickets, customers", () => {
  const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
  //                                    owner admin lead involved bystander guest
  const FINDS: Record<string, string> = {
    board: "1 1 1 1 1 0",
    idea: "1 1 1 1 1 0",
    customer: "1 1 1 1 1 0",
    // a ticket raised by «involved»: the OWNER and the ADMINs read every ticket; nobody else but its people and its department
    ticket: "1 1 0 1 0 0",
  };
  const WHO = ["owner", "admin", "lead", "involved", "bystander", "guest"] as const;

  it("every kind is found by exactly the people the table says, and by nobody else, in any field of the answer", async () => {
    const team = await makeTeam();
    const orgId = team.org.id;
    const lead = await makeUser({ orgId, role: "LEAD" });
    const involved = await makeUser({ orgId, role: "MEMBER" });
    const bystander = await makeUser({ orgId, role: "MEMBER" });
    const space = await makeWorkspace(orgId, [team.admin, lead, involved, bystander].map((p) => ({ userId: p.id })).concat([{ userId: team.guest.id }]));
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: space.id, userId: team.guest.id } }, data: { role: "GUEST" } });
    const word = `Pm${Math.random().toString(36).slice(2, 10)}`;
    const project = await makeProject(space.id);
    const board = await db.board.create({ data: { projectId: project.project.id, name: `${word} board` } });
    const idea = await db.idea.create({ data: { orgId, creatorId: involved.id, workspaceId: space.id, title: `${word} idea` } });
    const customer = await db.customer.create({ data: { orgId, creatorId: involved.id, workspaceId: space.id, name: `${word} customer` } });
    const ticket = await db.ticket.create({ data: { orgId, number: 1, creatorId: involved.id, title: `${word} ticket` } });
    const ids: Record<string, string> = { board: board.id, idea: idea.id, customer: customer.id, ticket: ticket.id };
    const answerKey: Record<string, string> = { board: "boards", idea: "ideas", customer: "customers", ticket: "tickets" };
    const people = { owner: team.owner, admin: team.admin, lead, involved, bystander, guest: team.guest };

    const wrong: string[] = [];
    for (const who of WHO) {
      await loginAs(people[who].id);
      enter(space.id);
      const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(word)}` });
      for (const kind of Object.keys(FINDS)) {
        const want = FINDS[kind]!.split(" ")[WHO.indexOf(who)] === "1";
        const hits = (res.json?.[answerKey[kind]!] as { id: string }[] | undefined) ?? [];
        if (hits.some((h) => h.id === ids[kind]) !== want) wrong.push(`${who} · ${kind}: expected ${want ? "finds" : "does not find"}`);
        if (!want && res.text.includes(`${word} ${kind}`)) wrong.push(`${who} · ${kind}: its title is in the answer`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ───────────────────────────── W1.5: the board screen and the project page ─────────────────────────────
// The same TASKS table on two more surfaces: the BOARD page (every card goes through `taskVisibleWhere`; the project page's board tab draws this same screen) and the
// PROJECT PAGE with tabs (switch `navV2`: the cards of the board tab and the counts). A card the table hides from a person is not on the board, not on the page. With
// the switch off the project page is the old page.

type Node_ = { type?: unknown; props?: Record<string, unknown> } | null | undefined;
function walkElements(node: unknown, found: { name: string; props: Record<string, unknown> }[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, found);
    return found;
  }
  const el = node as Node_;
  if (!el || typeof el !== "object" || !("props" in el)) return found;
  const type = el.type as { name?: string; displayName?: string } | string | undefined;
  found.push({ name: typeof type === "string" ? type : (type?.displayName ?? type?.name ?? ""), props: el.props ?? {} });
  walkElements(el.props?.["children"], found);
  return found;
}

async function setFeature(orgId: string, key: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
  await db.organization.update({ where: { id: orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), [key]: on } } } });
}

describe("privacy matrix — the W1.5 board screen and project page", () => {
  (globalThis as { React?: typeof React }).React = React;

  async function board(w: World) {
    return db.board.findFirstOrThrow({ where: { project: { workspaceId: w.space.id } }, select: { id: true, projectId: true } });
  }
  /** The board page as a person gets it: its cards, or null when the shell's «not found» (or the section notice) is what they meet. */
  async function boardCards(boardId: string): Promise<string | null> {
    try {
      const page = (await BoardPage({ params: { id: boardId } })) as React.ReactElement<{ tasks?: unknown }> | null;
      return page && page.props && "tasks" in page.props ? JSON.stringify(page.props.tasks) : null;
    } catch {
      return null;
    }
  }

  for (const kind of Object.keys(TASKS)) {
    it(`${kind}: the board page lists the card exactly when the table says`, async () => {
      const w = await getWorld();
      const b = await board(w);
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        const cards = await boardCards(b.id);
        const listed = cards !== null && cards.includes(w.tasks[kind]!);
        const want = expected(TASKS, kind, who);
        if (listed !== want) wrong.push(`${who}: expected ${want ? "sees" : "does not see"}`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }

  it("the task page's trail door (GET /boards/<id>/trail): names only, 404 for a person who may not open the project, shown only while navV2 is on", async () => {
    const w = await getWorld();
    const b = await board(w);
    await setFeature(w.orgId, "navV2", false);
    try {
      const wrong: string[] = [];
      for (const on of [false, true]) {
        await setFeature(w.orgId, "navV2", on);
        for (const who of PERSONAS) {
          await loginAs(w.people[who].id);
          const res = await call(boardTrail.GET, { params: { id: b.id } });
          // may open the project ⇔ sees the table's public task
          const opens = expected(TASKS, "public", who);
          if ((res.status === 200) !== opens) wrong.push(`${who}: status ${res.status}`);
          if (res.status === 200) {
            if (Object.keys(res.json ?? {}).sort().join() !== "boardId,boardName,projectId,projectName,show,spaceName") wrong.push(`${who}: the answer holds more than names`);
            if (on && res.json?.["show"] !== true) wrong.push(`${who}: navV2 on but not shown`);
            if (!on && res.json?.["show"] !== false) wrong.push(`${who}: navV2 off but shown`);
            if (JSON.stringify(res.json).includes("private task")) wrong.push(`${who}: a task title leaked into the trail`);
          }
        }
      }
      expect(wrong).toEqual([]);
    } finally {
      await setFeature(w.orgId, "navV2", false);
    }
  });

  it("the project page with the switch OFF is the old page (no trail, no strip, its own cards); ON it has the trail, the strip, and the same cards as the board page", async () => {
    const w = await getWorld();
    const b = await board(w);
    const params = { id: b.projectId };
    await setFeature(w.orgId, "navV2", false);
    try {
      await loginAs(w.people.memberIn.id);
      const off = walkElements((await ProjectPage({ params })) as React.ReactElement).map((e) => e.name);
      for (const old of ["TimelineBadgeButton", "ProjectTeamPicker", "PinnedStrip", "BoardCreateButton"]) expect(off, old).toContain(old);
      for (const fresh of ["Breadcrumbs", "ProjectTabs", "BoardView", "BoardPicker"]) expect(off, fresh).not.toContain(fresh);

      await setFeature(w.orgId, "navV2", true);
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        let page: React.ReactElement | null = null;
        try {
          page = (await ProjectPage({ params, searchParams: {} })) as React.ReactElement;
        } catch {
          // a person who cannot open the project meets the shell's «not found»
          page = null;
        }
        const found = page ? walkElements(page) : [];
        const names = found.map((e) => e.name);
        const shownProps = JSON.stringify(found.find((e) => e.name === "BoardView")?.props ?? {});
        for (const kind of Object.keys(TASKS)) {
          const want = expected(TASKS, kind, who);
          const shown = names.includes("ProjectTabs") && shownProps.includes(w.tasks[kind]!);
          if (shown !== want) wrong.push(`${who} · ${kind}: expected ${want ? "sees" : "does not see"} on the board tab`);
        }
      }
      expect(wrong).toEqual([]);

      // the tab strip and the trail say where the person is
      await loginAs(w.people.memberIn.id);
      const page = (await ProjectPage({ params, searchParams: {} })) as React.ReactElement;
      const found = walkElements(page);
      expect(found.find((e) => e.name === "ProjectTabs")?.props["current"]).toBe("board");
      expect((found.find((e) => e.name === "Breadcrumbs")?.props["items"] as { label: string }[]).length).toBe(2);
      // the board inside the tab is dressed for it: no project line, no second trail
      expect(found.find((e) => e.name === "BoardView")?.props["view"]).toMatchObject({ crumbs: null, embedded: true });
      const settings = walkElements((await ProjectPage({ params, searchParams: { tab: "settings" } })) as React.ReactElement);
      expect(settings.find((e) => e.name === "ProjectTabs")?.props["current"]).toBe("settings");
      // a tab that is not offered lands on the board; the list goes to the old page while «مهامي» is off
      const fields = walkElements((await ProjectPage({ params, searchParams: { tab: "fields" } })) as React.ReactElement);
      expect(["board", "fields"]).toContain(String(fields.find((e) => e.name === "ProjectTabs")?.props["current"]));
      await setFeature(w.orgId, "workMyTasks", false);
      await expect(ProjectPage({ params, searchParams: { tab: "list" } })).rejects.toMatchObject({ digest: expect.stringContaining(`/list?project=${b.projectId}`) });

      // with «مهامي» on, «القائمة» is W1.1's view with the scope «مشروع»: the same table decides which rows it holds, and the scope cannot be widened by the address
      await setFeature(w.orgId, "workMyTasks", true);
      const listWrong: string[] = [];
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        let listPage: React.ReactElement | null = null;
        try {
          listPage = (await ProjectPage({ params, searchParams: { tab: "list", scope: "me", project: "someone-else" } })) as React.ReactElement;
        } catch {
          listPage = null;
        }
        const view = listPage ? walkElements(listPage).find((e) => e.name === "ProjectTasksView") : undefined;
        if (view && (view.props["projectId"] !== b.projectId || (view.props["requested"] as { scope: string }).scope !== "project")) listWrong.push(`${who}: the list was not held to this project`);
        const rows = JSON.stringify((view?.props["initial"] as { tasks?: unknown } | undefined)?.tasks ?? []);
        for (const kind of Object.keys(TASKS)) {
          const want = expected(TASKS, kind, who);
          if (rows.includes(w.tasks[kind]!) !== want && (want || view)) listWrong.push(`${who} · ${kind}: expected ${want ? "sees" : "does not see"} in the list tab`);
        }
      }
      expect(listWrong).toEqual([]);
    } finally {
      await setFeature(w.orgId, "navV2", false);
    }
  });
});

// W1.9: «مهام قديمة». The same table, on one more surface: the review list shows a task to a person only when they MANAGE its space (the owner, its ADMIN) AND the table
// lets them open it (a private task is not listed to somebody who is no part of it, and is not counted). Everybody else, a guest included, has no list at all (403).
describe("privacy matrix — the W1.9 review list of old tasks", () => {
  //                      owner pW pWo oAO sA mIn mOut tM guest
  const MANAGES = cells("1 1 1 0 1 0 0 0 0"); // who runs the space: the owner and the partners (OWNER rank), the space's own ADMIN; an org ADMIN outside it does not
  for (const kind of Object.keys(TASKS)) {
    it(`${kind}: it is listed (and counted) for the people who manage the space and may open it, and for nobody else`, async () => {
      const w = await getWorld();
      const org = await db.organization.findUniqueOrThrow({ where: { id: w.orgId }, select: { settings: true } });
      const settings = (org.settings ?? {}) as { features?: Record<string, boolean> };
      await db.organization.update({ where: { id: w.orgId }, data: { settings: { ...settings, features: { ...(settings.features ?? {}), workStaleSweep: true } } } });
      const taskId = w.tasks[kind]!;
      // a month untouched (a write bumps updatedAt, so this is the last write)
      const old = new Date(Date.now() - 30 * 86_400_000);
      await db.task.update({ where: { id: taskId }, data: { updatedAt: old } });
      // a task made through the door has its «created» log line from today: that is a touch too
      await db.taskActivity.updateMany({ where: { taskId }, data: { createdAt: old } });
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        const person = w.people[who];
        await loginAs(person.id);
        const res = await call(staleRoute.GET, { url: "http://localhost/api/work/stale?days=14" });
        const manages = MANAGES[PERSONAS.indexOf(who)]!;
        if (!manages) {
          if (res.status !== 403 || res.text.includes(taskId)) wrong.push(`${who}: manages no space, expected 403 (status ${res.status})`);
          continue;
        }
        const listed = res.status === 200 && res.text.includes(taskId);
        const want = expected(TASKS, kind, who);
        if (listed !== want) wrong.push(`${who}: expected ${want ? "listed" : "not listed"}`);
        const total = ((res.json?.["people"] as { projects: { tasks: { id: string }[] }[] }[] | undefined) ?? []).flatMap((x) => x.projects.flatMap((g) => g.tasks)).filter((t) => t.id === taskId).length;
        if (total !== (want ? 1 : 0)) wrong.push(`${who}: the list holds ${total} of it`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }
});

// W1.6: «مصدر المهمة». The same table, on one more surface: the door that says where a task came from (a ticket, a campaign item, a card) is a door to the task, so it answers
// only to the people the table lets open the task (404 for everybody else, and nothing of the task in the answer); an external partner is told there is nothing.
describe("privacy matrix — the W1.6 task-source door", () => {
  for (const kind of Object.keys(TASKS)) {
    it(`${kind}: the door answers to the people who may open the task, and to nobody else`, async () => {
      const w = await getWorld();
      const taskId = w.tasks[kind]!;
      const wrong: string[] = [];
      for (const who of PERSONAS) {
        await loginAs(w.people[who].id);
        const res = await call(taskSourceDoor.GET, { params: { taskId } });
        const want = expected(TASKS, kind, who);
        if ((res.status === 200) !== want) wrong.push(`${who}: expected ${want ? "200" : "not 200"}, got ${res.status}`);
        if (res.status === 200 && (res.json?.["sources"] as unknown[]).length !== 0) wrong.push(`${who}: a task with no source listed one`);
        if (res.status !== 200 && res.text.includes(taskId)) wrong.push(`${who}: the refusal names the task`);
      }
      expect(wrong, kind).toEqual([]);
    });
  }
});
// ───────────────────────────── C4.1: «إعداداتي» is the caller's alone ─────────────────────────────

describe("C4.1: the settings of a person (their notification choices, their browsers) are theirs: nobody of any rank reads or removes another person's", () => {
  it("every rank sees only its own browsers and notification choices, and cannot remove or read another person's", async () => {
    const t = await makeTeam();
    const people = { owner: t.owner, admin: t.admin, member: t.member, guest: t.guest };
    const subscription: Record<string, string> = {};
    const wrong: string[] = [];
    for (const [who, person] of Object.entries(people)) {
      subscription[who] = (await db.pushSubscription.create({ data: { userId: person.id, endpoint: `https://push.test.local/${person.id}`, p256dh: "p", auth: "a", userAgent: `agent of ${who}` } })).id;
      await loginAs(person.id);
      const saved = await call(chatPrefsRoute.PUT, { method: "PUT", url: "http://localhost/api/me/chat-prefs", body: { notifications: { private: { on: false }, topics: { preview: false } } } });
      if (saved.status !== 200) wrong.push(`${who} · save: ${saved.status}`);
    }
    for (const [who, person] of Object.entries(people)) {
      await loginAs(person.id);
      const list = await call(myPushList.GET);
      const ids = ((list.json?.["subscriptions"] ?? []) as { id: string }[]).map((x) => x.id);
      if (JSON.stringify(ids) !== JSON.stringify([subscription[who]])) wrong.push(`${who} · listed ${JSON.stringify(ids)}`);
      for (const [other, id] of Object.entries(subscription)) {
        if (other === who) continue;
        const removed = await call(myPushOne.DELETE, { method: "DELETE", params: { id } });
        if (removed.status !== 404) wrong.push(`${who} · removing the browser of ${other}: ${removed.status}`);
      }
    }
    expect(await db.pushSubscription.count({ where: { id: { in: Object.values(subscription) } } })).toBe(4);
    expect(wrong).toEqual([]);
  });
});

// ───────────────────────────── C3w.1: the saved chat on the live line, and the personal mute ─────────────────────────────
// (1) A person's saved chat (a DM with oneself) now reaches the person's OTHER tabs on the live line: the readers' batch builds the same facts as the policy for a self key.
//     The frame goes to exactly the people the saved row of the table lets read it, in every one of their streams: nobody gains a reader by it.
// (2) A personal mute («كتم الإشعارات») silences the bell and the push of the person who muted, a mention included. It decides nothing about who may READ: the muted person still
//     reads, and nobody else's notifications or reading move with it.
describe("privacy matrix — the C3w.1 saved chat on the live line", () => {
  it("a message frame of a saved chat reaches the person's own tabs and the silent eye, nobody else", async () => {
    const w = await getWorld();
    setPolicyStubs({}); // the real policy
    resetHubForTests();
    await loginAs(w.people.memberIn.id);
    const made = await call(dmRoute.POST, { body: { saved: true } });
    const id = made.json?.["id"] as string;
    const got = new Map<string, string[]>();
    for (const who of PERSONAS) {
      for (let tab = 0; tab < 2; tab++) {
        const frames: string[] = [];
        got.set(`${who}#${tab}`, frames);
        addClient({ userId: w.people[who].id, orgId: w.orgId, send: (f) => frames.push(f), close: () => undefined });
      }
    }
    await deliverEvent({ id: "901", orgId: w.orgId, kind: "message.created", ids: { conversationId: id, messageId: "m-saved" } } as unknown as RtEvent);
    const wrong: string[] = [];
    for (const who of PERSONAS) {
      for (let tab = 0; tab < 2; tab++) {
        const reached = got.get(`${who}#${tab}`)!.some((f) => f.includes('"kind":"message.created"'));
        const want = cells(CONVERSATIONS["dm"]!)[PERSONAS.indexOf(who)]!;
        if (reached !== want) wrong.push(`${who} (tab ${tab}): expected ${want ? "receives" : "does not receive"}`);
      }
    }
    resetHubForTests();
    expect(wrong).toEqual([]);
  });
});

describe("privacy matrix — the C3w.1 personal mute", () => {
  for (const kind of Object.keys(CONVERSATIONS)) {
    it(`${kind}: the one who muted gets no bell (a mention included), everybody else who reads is told as before, and the mute changes nobody's reading`, async () => {
      const w = await getWorld();
      resetPresenceForTests();
      const id = w.ids[kind]!;
      const muter = w.people.memberIn;
      // a row this test makes (an open topic's reader has none) is removed again: it must not become a member of anything for the tests after it
      const hadRow = (await db.conversationMember.count({ where: { conversationId: id, userId: muter.id } })) > 0;
      await db.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: id, userId: muter.id } },
        create: { conversationId: id, userId: muter.id, mutedUntil: new Date(Date.now() + 3_600_000) },
        update: { mutedUntil: new Date(Date.now() + 3_600_000) },
      });
      const readers = PERSONAS.filter((who) => expected(CONVERSATIONS, kind, who) && who !== "owner" && who !== "partnerWith");
      const audience = readers.map((who) => w.people[who].id);
      await db.notification.deleteMany({ where: { userId: { in: audience } } });
      await notifyMessageToAudience({
        conversationId: id,
        authorId: w.people.spaceAdmin.id,
        audienceIds: audience.filter((userId) => userId !== w.people.spaceAdmin.id),
        kind: kind === "dm" ? "DM" : "TOPIC",
        title: "x",
        preview: "مرحبا",
        messageId: `m-mute-${kind}`,
        mentionedIds: [muter.id],
      });
      const wrong: string[] = [];
      for (const who of readers) {
        if (who === "spaceAdmin") continue; // the author
        const bells = await db.notification.count({ where: { userId: w.people[who].id, type: "chat_message" } });
        const want = who === "memberIn" ? 0 : 1;
        if (bells !== want) wrong.push(`${who}: ${bells} bells, expected ${want}`);
      }
      // reading is untouched: the muted person still reads, and the table is the same for everybody
      for (const who of PERSONAS) if ((await canReadConversation(w.people[who].id, id)) !== expected(CONVERSATIONS, kind, who)) wrong.push(`${who} · reading moved with a mute`);
      if (hadRow) await db.conversationMember.updateMany({ where: { conversationId: id, userId: muter.id }, data: { mutedUntil: null } });
      else await db.conversationMember.deleteMany({ where: { conversationId: id, userId: muter.id } });
      expect(wrong, kind).toEqual([]);
    });
  }
});

// ───────────────────────────── C3b.5: «حدّد» — forwarding many, deleting many, one task from a selection ─────────────────────────────
// The three batch doors reuse the single rules, so the table above decides them: a persona forwards a message only where they READ it AND may write in the
// destination (the silent eyes read everything and write nowhere they did not join); a persona deletes a message only if it is theirs or they moderate where they read
// it — and the silent eye deletes NOTHING through the batch (no trace); one private source makes the whole task private, exactly like `fromPrivate`.
//                                   owner pW  pWo oAO sA  mIn mOut tM  guest
const DEST_POST = "0 0 1 0 1 1 1 1 1"; //  who may write in an open destination topic of the space (the eyes did not join it, the org admin is outside the space)
const BATCH_DELETE: Record<string, string> = {
  open: "0 0 1 0 1 1 0 0 0", //       the author, the space's managers; not the silent eyes (the batch leaves no trace)
  restricted: "0 0 0 0 0 1 0 0 0", // only the author: no manager reads it
  team: "0 0 1 0 1 1 0 0 0", //       the author (who may always take their own message back) and the space's managers
  dm: "0 0 0 0 0 1 0 0 0", //         the author: nobody moderates a DM, the owner included
};
describe("privacy matrix — the C3b.5 batch doors", () => {
  it("forwarding a selection: a copy is made only where the persona reads the source AND writes in the destination; a refusal carries no text", async () => {
    const w = await getWorld();
    const dest = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "Batch destination" } });
    const wrong: string[] = [];
    for (const kind of Object.keys(CONVERSATIONS)) {
      const source = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.ids[kind]!, body: `${WORD} ${kind}` } });
      for (const who of PERSONAS) {
        const person = w.people[who];
        const want = expected(CONVERSATIONS, kind, who) && cells(DEST_POST)[PERSONAS.indexOf(who)]!;
        await loginAs(person.id);
        const res = await call(forwardManyRoute.POST, { url: "http://localhost/api/chat/messages/forward", body: { messageIds: [source.id], targetIds: [dest.id] } });
        const copies = await db.chatMessage.count({ where: { conversationId: dest.id, authorId: person.id, forwardedFromId: source.id } });
        if ((copies === 1) !== want) wrong.push(`${who} · ${kind}: expected ${want ? "a copy" : "no copy"}, got ${copies} (status ${res.status})`);
        if (!expected(CONVERSATIONS, kind, who) && res.text.includes(WORD)) wrong.push(`${who} · ${kind}: the refusal carried the text`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("deleting a selection: the author and the managers who read it delete; nobody else does and the silent eyes delete nothing", async () => {
    const w = await getWorld();
    const wrong: string[] = [];
    for (const kind of Object.keys(CONVERSATIONS)) {
      for (const who of PERSONAS) {
        const person = w.people[who];
        const want = cells(BATCH_DELETE[kind]!)[PERSONAS.indexOf(who)]!;
        const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.ids[kind]!, authorId: w.people.memberIn.id, body: `${WORD} delete ${kind} ${who}` } });
        await loginAs(person.id);
        const res = await call(deleteManyRoute.POST, { url: "http://localhost/api/chat/messages/delete", body: { ids: [msg.id] } });
        const gone = (await db.chatMessage.findUniqueOrThrow({ where: { id: msg.id } })).deletedAt !== null;
        if (gone !== want) wrong.push(`${who} · ${kind}: expected ${want ? "deleted" : "kept"}, got ${gone ? "deleted" : "kept"} (status ${res.status})`);
        if (!want && res.text.includes(WORD)) wrong.push(`${who} · ${kind}: the refusal carried the text`);
      }
    }
    expect(wrong).toEqual([]);
    // no trace: the silent eyes wrote no audit line anywhere
    const eyes = [w.people.owner.id, w.people.partnerWith.id];
    expect(await db.auditLog.count({ where: { actorId: { in: eyes }, action: "chat.delete_by_admin" } })).toBe(0);
  });

  it("one task from a selection of a private conversation (alone, or mixed with an open message) is as private as one made from a single message: the door and the list agree with the table", async () => {
    const w = await getWorld();
    const { project, board } = await makeProject(w.space.id);
    await loginAs(w.people.memberIn.id);
    const base = { workspaceId: w.space.id, projectId: project.id, boardId: board.id };
    const restricted = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.ids["restricted"]!, authorId: w.people.memberIn.id, body: `${WORD} batch restricted` } });
    const restricted2 = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.ids["restricted"]!, authorId: w.people.memberIn.id, body: `${WORD} batch restricted 2` } });
    const open = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.ids["open"]!, authorId: w.people.memberIn.id, body: `${WORD} batch open`, createdAt: new Date(Date.now() - 60_000) } });
    const alone = await call(taskRoute.POST, { params: { id: restricted.id }, body: { ...base, alsoMessageIds: [restricted2.id] } });
    // the open message is the earliest, so it LEADS the batch: the private one still decides
    const mixed = await call(taskRoute.POST, { params: { id: open.id }, body: { ...base, alsoMessageIds: [restricted2.id] } });
    expect([alone.status, mixed.status]).toEqual([201, 201]);
    const wrong: string[] = [];
    for (const [name, made] of [["private only", alone], ["mixed", mixed]] as const) {
      const id = made.json?.["taskId"] as string;
      for (const who of PERSONAS) {
        const person = w.people[who];
        const want = expected(TASKS, "fromPrivate", who);
        await loginAs(person.id);
        const door = (await call(taskGet.GET, { params: { id } })).status === 200;
        const list = await call(tasksList.GET, { url: `http://localhost/api/tasks?workspaceId=${w.space.id}&limit=100` });
        const listed = list.status === 200 && JSON.stringify(list.json).includes(id);
        if (door !== want) wrong.push(`${name} · ${who} · door: expected ${want ? "sees" : "does not see"}`);
        if (listed !== want) wrong.push(`${name} · ${who} · list: expected ${want ? "sees" : "does not see"}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ───────────────────────────── S5.5: the verification badge «إشارة التوثيق» ─────────────────────────────
// It is only a badge. WHO may give or take it: the OWNER rank (the primary owner and the partners), nobody else, whatever capability they hold. WHO is told of it:
// every persona who READS the message sees it on the author's name (the same cells as the open topic's door), EXCEPT the guest, who is told nothing — it is no way
// to learn ranks — and the surfaces never carry the time or the granter.
describe("privacy matrix — the S5.5 verification badge", () => {
  const GIVES: Record<Persona, boolean> = { owner: true, partnerWith: true, partnerWithout: true, orgAdminOut: false, spaceAdmin: false, memberIn: false, memberOut: false, teamMember: false, guest: false };

  it("only the OWNER rank grants or takes the badge; every persona reads it on the author's name except the guest, who is told nothing", async () => {
    const w = await getWorld();
    const wrong: string[] = [];
    const door = (who: Persona, userId: string, verified: boolean) =>
      loginAs(w.people[who].id).then(() => call(verifyRoute.POST, { url: "http://localhost/api/x", body: { verified }, params: { id: w.orgId, userId } }));
    // the door: a no-op take-back on somebody who has none answers 200 for the owner ranks and 403 for everybody else
    for (const who of PERSONAS) {
      const res = await door(who, w.people.memberOut.id, false);
      if ((res.status === 200) !== GIVES[who]) wrong.push(`${who} · door: expected ${GIVES[who] ? "may" : "may not"} (got ${res.status})`);
    }
    expect(wrong).toEqual([]);
    // the owner verifies the author of the open topic's message; each persona reads it
    expect((await door("owner", w.people.memberIn.id, true)).status).toBe(200);
    const id = w.ids["open"]!;
    for (const who of PERSONAS) {
      await loginAs(w.people[who].id);
      const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/messages`, params: { id } });
      const reads = expected(CONVERSATIONS, "open", who);
      if ((res.status === 200) !== reads) { wrong.push(`${who} · door of the open topic`); continue; }
      if (!reads) continue;
      const marked = res.text.includes('"authorVerified":true');
      const want = who !== "guest";
      if (marked !== want) wrong.push(`${who} · badge: expected ${want ? "sees" : "is told nothing"}`);
      if (res.text.includes("verifiedAt")) wrong.push(`${who} · the time of the grant travelled`);
      if (who === "guest" && res.text.includes("verified")) wrong.push("guest · the word verified travelled");
    }
    expect(wrong).toEqual([]);
    // the private chat's row and the header: the peer's badge for staff, nothing for anybody who may not read it
    const dmId = w.ids["dm"]!;
    await loginAs(w.people.memberIn.id);
    const asPeer = await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${dmId}/header`, params: { id: dmId } });
    expect(asPeer.status).toBe(200);
    for (const who of PERSONAS) {
      await loginAs(w.people[who].id);
      const res = await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${dmId}/header`, params: { id: dmId } });
      if (res.status !== 200) {
        expect(res.text, `${who}`).not.toContain("verified");
        continue;
      }
      if (who === "guest") expect(res.text).not.toContain("verified");
      expect(res.text).not.toContain("verifiedAt");
    }
    await door("owner", w.people.memberIn.id, false);
  });
});
