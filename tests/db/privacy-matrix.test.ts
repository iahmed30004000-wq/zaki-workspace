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
import * as readMarkRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as deliveredMarkRoute from "@/app/api/chat/conversations/[id]/delivered/route";
import * as mentionsRoute from "@/app/api/chat/conversations/[id]/mentions/route";
import * as personalStateRoute from "@/app/api/chat/conversations/[id]/me/route";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import * as workRequestsRoute from "@/app/api/work/requests/route";
import * as chatPrefsRoute from "@/app/api/me/chat-prefs/route";
import * as previewImageRoute from "@/app/api/chat/messages/[id]/preview/image/route";
import * as previewRemoveRoute from "@/app/api/chat/messages/[id]/preview/route";
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
