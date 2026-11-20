/**
 * C3c.1 — «قائمة مهام»: the checklist in chat, against a real database.
 *
 *  - sending one: a CHECKLIST message whose body is the title, 1-30 items of at most 200 characters, never with files, never for a guest; a retry is the same list
 *  - who adds (the author, or anybody who may post when `othersCanAdd`), who ticks (the author, or anybody who may post while `othersCanTick`), who rewords and removes
 *    (the item's author, the list's author, a moderator); a guest and the owner in silent oversight do none of it (no trace)
 *  - `checklist.changed` carries ids only; sync returns the presented message; a deleted message hides its list
 *  - the items' words reach no reader of a message but the presenter (the list, the search, the bell)
 *  - «اعمل منها مهمة»: one step per item, done items done, only for the task made from the message, private conversations make private tasks
 *  - the switch `chatChecklists` closes every door
 */
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as itemsRoute from "@/app/api/chat/messages/[id]/checklist/items/route";
import * as itemRoute from "@/app/api/chat/messages/[id]/checklist/items/[itemId]/route";
import * as stepsRoute from "@/app/api/chat/messages/[id]/checklist/steps/route";
import * as taskGet from "@/app/api/tasks/[id]/route";
import type { ChecklistDto, ConversationDto, ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { MAX_CHECKLIST_ITEMS } from "@/lib/chat/checklist";
import { withFeature } from "@/lib/features";
import { chatList } from "@/server/chat/list";
import { searchChat } from "@/server/chat/search";
import { syncFeed } from "@/server/chat/sync";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";

const WORD = "بندسريمصفوفة";

const detail = async (id: string) =>
  (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).json as unknown as ConversationDto;
const listOf = async (conversationId: string, messageId: string): Promise<ChecklistDto | undefined> =>
  (await detail(conversationId)).messages.find((m) => m.id === messageId)?.checklist;
const send = (id: string, body: string, checklist: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  call(messagesRoute.POST, { params: { id }, body: { body, checklist, ...extra } });
const add = (id: string, text: string) => call(itemsRoute.POST, { params: { id }, body: { text } });
const tick = (id: string, itemId: string, done: boolean) => call(itemRoute.PUT, { method: "PUT", params: { id, itemId }, body: { done } });
const reword = (id: string, itemId: string, text: string) => call(itemRoute.PATCH, { method: "PATCH", params: { id, itemId }, body: { text } });
const remove = (id: string, itemId: string) => call(itemRoute.DELETE, { method: "DELETE", params: { id, itemId } });
const asMessage = (res: { json: unknown }) => res.json as unknown as MessageDto;

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.member.id },
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  const second = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Second" });
  await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: second.id, role: "MEMBER" } });
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, ws, second, topic };
}
type World = Awaited<ReturnType<typeof world>>;

/** The member makes a list in the open topic: the message id and its item ids (in order). */
async function make(w: World, checklist: Record<string, unknown> = {}, author = w.member.id, conversationId = w.topic.id) {
  await loginAs(author);
  const res = await send(conversationId, "مشتريات الحفلة", { items: ["كاسات", "صحون", "عصير"], ...checklist });
  expect(res.status, res.text).toBe(201);
  const dto = asMessage(res);
  return { id: dto.id, items: dto.checklist!.items.map((i) => i.id), dto };
}

async function setSwitch(orgId: string, key: "chatChecklists" | "taskSteps", on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

describe("checklists: sending one", () => {
  it("a member who may post sends a list: a CHECKLIST message whose body is the title, the items in order, nobody ticked", async () => {
    const w = await world();
    const c = await make(w);
    expect(c.dto.kind).toBe("CHECKLIST");
    expect(c.dto.body).toBe("مشتريات الحفلة");
    expect(c.dto.checklist).toMatchObject({ othersCanAdd: false, othersCanTick: true, done: 0, total: 3, canAdd: true, canTick: true, max: 30 });
    expect(c.dto.checklist!.items.map((i) => i.text)).toEqual(["كاسات", "صحون", "عصير"]);
    expect(c.dto.checklist!.items.every((i) => !i.done && i.canEdit)).toBe(true);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: c.id }, include: { checklist: { include: { items: { orderBy: { position: "asc" } } } } } });
    expect(row.kind).toBe("CHECKLIST");
    expect(row.checklist?.items.map((i) => [i.position, i.addedById])).toEqual([[0, w.member.id], [1, w.member.id], [2, w.member.id]]);
    // it rang the same bell as any message
    const rt = await db.realtimeEvent.findMany({ where: { orgId: w.org.id, kind: "message.created" } });
    expect(rt.some((e) => (e.ids as { messageId?: string }).messageId === c.id)).toBe(true);

    await loginAs(w.second.id);
    expect(await listOf(w.topic.id, c.id)).toMatchObject({ canAdd: false, canTick: true, total: 3 });
  });

  it("the switches travel: others may add, others may not tick", async () => {
    const w = await world();
    const c = await make(w, { othersCanAdd: true, othersCanTick: false });
    expect(c.dto.checklist).toMatchObject({ othersCanAdd: true, othersCanTick: false });
    const row = await db.chatChecklist.findUniqueOrThrow({ where: { messageId: c.id } });
    expect([row.othersCanAdd, row.othersCanTick]).toEqual([true, false]);
    await loginAs(w.second.id);
    expect(await listOf(w.topic.id, c.id)).toMatchObject({ canAdd: true, canTick: false });
  });

  it("1 to 30 items of at most 200 characters, a title; blanks are dropped and spaces folded", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const bad = async (checklist: Record<string, unknown>, body = "عنوان") => (await send(w.topic.id, body, checklist)).status;
    expect(await bad({ items: [] })).toBe(422);
    expect(await bad({ items: ["  ", ""] })).toBe(422);
    expect(await bad({ items: ["أ", "ب".repeat(201)] })).toBe(422);
    expect(await bad({ items: Array.from({ length: 31 }, (_, i) => `بند ${i}`) })).toBe(422);
    expect(await bad({ items: ["أ"] }, "   ")).toBeGreaterThanOrEqual(400);
    expect(await bad({ items: ["أ"] }, "ع".repeat(201))).toBe(422);
    // an item of invisible characters is a blank one
    expect(await bad({ items: ["\u200b", " \u200f "] })).toBe(422);
    expect(await db.chatChecklist.count({ where: { message: { orgId: w.org.id } } })).toBe(0);
    // an invisible item is dropped from a list that has a visible one, and refused when added
    const visible = asMessage(await send(w.topic.id, "ظاهر", { items: ["\u200b", "أ"] }));
    expect(visible.checklist!.items.map((i) => i.text)).toEqual(["أ"]);
    expect((await add(visible.id, "\u200b")).status).toBe(422);

    expect(await bad({ items: Array.from({ length: 30 }, (_, i) => `بند ${i}`) })).toBe(201);
    const folded = await send(w.topic.id, "نظّفها", { items: ["  واحد   اثنين ", "", "ب".repeat(200)] });
    expect(folded.status).toBe(201);
    expect(asMessage(folded).checklist!.items.map((i) => i.text)).toEqual(["واحد اثنين", "ب".repeat(200)]);
  });

  it("never for a guest, never with a file, a voice note or a poll; in a private chat it is fine", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const guest = await send(w.topic.id, "قائمة", { items: ["أ"] });
    expect(guest.status).toBe(403);
    expect(guest.text).toContain("chat.e.checklist_guest");

    await loginAs(w.member.id);
    const withFile = await send(w.topic.id, "قائمة", { items: ["أ"] }, { attachmentIds: ["nope"] });
    expect(withFile.status).toBe(422);
    const withPoll = await send(w.topic.id, "قائمة", { items: ["أ"] }, { poll: { options: ["أ", "ب"] } });
    expect(withPoll.status).toBe(422);
    const dm = (await call(dmRoute.POST, { body: { userId: w.admin.id } })).json?.["id"] as string;
    const inDm = await send(dm, "قائمة بيني وبينك", { items: ["أ", "ب"] });
    expect(inDm.status).toBe(201);
    expect(asMessage(inDm).kind).toBe("CHECKLIST");
  });

  it("a retry with the same clientId is the same list, not a second one", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const a = await send(w.topic.id, "مرتين؟", { items: ["أ", "ب"] }, { clientId: "list-once" });
    const b = await send(w.topic.id, "مرتين؟", { items: ["أ", "ب"] }, { clientId: "list-once" });
    expect(asMessage(a).id).toBe(asMessage(b).id);
    expect(asMessage(b).checklist!.total).toBe(2);
    expect(await db.chatChecklist.count({ where: { message: { authorId: w.member.id } } })).toBe(1);
  });

  it("it cannot be forwarded (a copy would carry no items); the person is told why", async () => {
    const w = await world();
    const c = await make(w);
    const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Other" } });
    const fwd = await call(forwardRoute.POST, { params: { id: c.id }, body: { conversationId: other.id } });
    expect(fwd.status).toBe(403);
    expect(fwd.text).toContain("chat.e.checklist_immutable");
  });

  it("the header offers it (`canChecklist`) to a person who may post, not to a guest, not in a closed topic", async () => {
    const w = await world();
    const header = async (userId: string, id = w.topic.id) => {
      await loginAs(userId);
      return (await call(headerRoute.GET, { params: { id } })).json as unknown as ConversationHeaderDto;
    };
    expect((await header(w.member.id)).me.canChecklist).toBe(true);
    expect((await header(w.guest.id)).me.canChecklist).toBe(false);
    const closed = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Closed", closedAt: new Date() } });
    expect((await header(w.member.id, closed.id)).me.canChecklist).toBe(false);
  });
});

describe("checklists: adding an item", () => {
  it("the author adds; another person only when the author allowed it; a guest never", async () => {
    const w = await world();
    const c = await make(w);
    const mine = await add(c.id, "  شمع   ");
    expect(mine.status, mine.text).toBe(201);
    expect(asMessage(mine).checklist!.items.map((i) => i.text)).toEqual(["كاسات", "صحون", "عصير", "شمع"]);
    expect(asMessage(mine).checklist!.total).toBe(4);

    await loginAs(w.second.id);
    const denied = await add(c.id, "بالونات");
    expect(denied.status).toBe(403);
    expect(denied.text).toContain("chat.e.checklist_add_denied");
    await loginAs(w.guest.id);
    const guest = await add(c.id, "بالونات");
    expect(guest.status).toBe(403);
    expect(guest.text).toContain("chat.e.checklist_guest");
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: c.id } } })).toBe(4);

    const open = await make(w, { othersCanAdd: true });
    await loginAs(w.second.id);
    const theirs = await add(open.id, "بالونات");
    expect(theirs.status).toBe(201);
    const row = await db.chatChecklistItem.findFirstOrThrow({ where: { checklist: { messageId: open.id }, text: "بالونات" } });
    expect(row.addedById).toBe(w.second.id);
    expect(row.position).toBe(3);
    await loginAs(w.guest.id);
    expect((await add(open.id, "بالونات 2")).status).toBe(403);
  });

  it("an empty or too long text is refused, and a list holds at most 30 items", async () => {
    const w = await world();
    const c = await make(w, { items: Array.from({ length: MAX_CHECKLIST_ITEMS - 1 }, (_, i) => `بند ${i}`) });
    expect((await add(c.id, "   ")).status).toBe(422);
    expect((await add(c.id, "ب".repeat(201))).status).toBe(422);
    expect((await add(c.id, "الأخير")).status).toBe(201);
    const full = await add(c.id, "زيادة");
    expect(full.status).toBe(422);
    expect(full.text).toContain("chat.e.checklist_full");
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: c.id } } })).toBe(30);
    expect((await listOf(w.topic.id, c.id))!.canAdd).toBe(false);
  });

  it("two people adding at the same moment never pass the limit of 30", async () => {
    const w = await world();
    const c = await make(w, { othersCanAdd: true, items: Array.from({ length: MAX_CHECKLIST_ITEMS - 1 }, (_, i) => `بند ${i}`) });
    await loginAs(w.member.id);
    const results = await Promise.all([add(c.id, "سباق 1"), add(c.id, "سباق 2"), add(c.id, "سباق 3")]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: c.id } } })).toBe(30);
  });

  it("a change rings `checklist.changed` with the conversation and the message only, never who or what", async () => {
    const w = await world();
    const c = await make(w);
    await add(c.id, WORD);
    const events = await db.realtimeEvent.findMany({ where: { orgId: w.org.id, kind: "checklist.changed" } });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!.ids as object).sort()).toEqual(["conversationId", "messageId", "spaceId"]);
    expect(JSON.stringify(events[0]!.ids)).not.toContain(WORD);
    expect(JSON.stringify(events[0]!.ids)).not.toContain(w.member.id);
  });
});

describe("checklists: ticking", () => {
  it("anybody who may post ticks by default; the item says who finished it and when; progress follows; unticking clears", async () => {
    const w = await world();
    const c = await make(w);
    await loginAs(w.second.id);
    const done = await tick(c.id, c.items[0]!, true);
    expect(done.status, done.text).toBe(200);
    const list = asMessage(done).checklist!;
    expect(list).toMatchObject({ done: 1, total: 3 });
    expect(list.items[0]).toMatchObject({ done: true, doneByName: "Second" });
    expect(Math.abs(new Date(list.items[0]!.doneAt!).getTime() - Date.now())).toBeLessThan(60_000);
    expect(list.items[1]!.done).toBe(false);
    expect(list.items[1]!.doneByName).toBeUndefined();

    // ticking again keeps who ticked first and when
    await loginAs(w.admin.id);
    const before = await db.chatChecklistItem.findUniqueOrThrow({ where: { id: c.items[0]! } });
    expect((await tick(c.id, c.items[0]!, true)).status).toBe(200);
    const after = await db.chatChecklistItem.findUniqueOrThrow({ where: { id: c.items[0]! } });
    expect([after.doneById, after.doneAt?.getTime()]).toEqual([before.doneById, before.doneAt?.getTime()]);
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "checklist.changed" } })).toBe(1); // the repeat changed nothing: it rang nothing

    // anyone who may tick may untick
    const undone = asMessage(await tick(c.id, c.items[0]!, false)).checklist!;
    expect(undone).toMatchObject({ done: 0 });
    expect(undone.items[0]).toMatchObject({ done: false });
    const cleared = await db.chatChecklistItem.findUniqueOrThrow({ where: { id: c.items[0]! } });
    expect([cleared.doneById, cleared.doneAt]).toEqual([null, null]);
  });

  it("othersCanTick off: only the author ticks; a guest never ticks, in either case", async () => {
    const w = await world();
    const c = await make(w, { othersCanTick: false });
    await loginAs(w.second.id);
    const denied = await tick(c.id, c.items[0]!, true);
    expect(denied.status).toBe(403);
    expect(denied.text).toContain("chat.e.checklist_tick_denied");
    await loginAs(w.member.id);
    expect((await tick(c.id, c.items[0]!, true)).status).toBe(200);

    await loginAs(w.guest.id);
    const guest = await tick(c.id, c.items[1]!, true);
    expect(guest.status).toBe(403);
    expect(guest.text).toContain("chat.e.checklist_guest");
    const open = await make(w);
    await loginAs(w.guest.id);
    expect((await tick(open.id, open.items[0]!, true)).status).toBe(403);
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: { in: [c.id, open.id] } }, doneAt: { not: null } } })).toBe(1);
  });

  it("an item of another list, or one that is not there, is not found; a person who may not read the conversation finds nothing", async () => {
    const w = await world();
    const a = await make(w);
    const b = await make(w);
    await loginAs(w.member.id);
    expect((await tick(a.id, b.items[0]!, true)).status).toBe(404);
    expect((await tick(a.id, "nope", true)).status).toBe(404);
    expect((await tick("no-such-message", a.items[0]!, true)).status).toBe(404);

    const secret = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Secret", restricted: true, members: { create: [{ userId: w.member.id }] } } });
    const hidden = await make(w, {}, w.member.id, secret.id);
    await loginAs(w.second.id);
    for (const res of [await tick(hidden.id, hidden.items[0]!, true), await add(hidden.id, "x"), await reword(hidden.id, hidden.items[0]!, "x"), await remove(hidden.id, hidden.items[0]!)]) {
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("كاسات");
    }
  });

  it("nobody ticks or adds in a closed topic, or after the message was deleted", async () => {
    const w = await world();
    const c = await make(w);
    const d = await make(w);
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: new Date() } });
    await loginAs(w.second.id);
    expect((await tick(c.id, c.items[0]!, true)).text).toContain("chat.e.post_denied");
    expect((await add(c.id, "x")).status).toBe(403);
    // a closed topic is frozen: not even the author rewords or removes an item (the presenter draws no pencil and no bin either)
    await loginAs(w.member.id);
    expect((await reword(c.id, c.items[0]!, "x")).text).toContain("chat.e.post_denied");
    expect((await remove(c.id, c.items[0]!)).text).toContain("chat.e.post_denied");
    expect((await listOf(w.topic.id, c.id))!.items.some((i) => i.canEdit)).toBe(false);
    expect((await db.chatChecklistItem.findUniqueOrThrow({ where: { id: c.items[0]! } })).text).toBe("كاسات");
    await db.conversation.update({ where: { id: w.topic.id }, data: { closedAt: null } });

    await loginAs(w.member.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: d.id } })).status).toBe(200);
    const gone = await tick(d.id, d.items[0]!, true);
    expect(gone.status).toBe(403);
    expect(gone.text).toContain("chat.e.deleted");
    expect((await add(d.id, "x")).text).toContain("chat.e.deleted");
    // the deleted message hides its list for everybody
    const shown = (await detail(w.topic.id)).messages.find((m) => m.id === d.id)!;
    expect(shown.deleted).toBe(true);
    expect(shown.checklist).toBeUndefined();
    expect(JSON.stringify(shown)).not.toContain("كاسات");
  });
});

describe("checklists: rewording and removing", () => {
  it("the item's author, the list's author and a moderator may; another member and a guest may not", async () => {
    const w = await world();
    const c = await make(w, { othersCanAdd: true });
    await loginAs(w.second.id);
    const theirs = asMessage(await add(c.id, "بند الثاني")).checklist!.items.at(-1)!;
    expect(theirs.canEdit).toBe(true);
    expect((await listOf(w.topic.id, c.id))!.items[0]!.canEdit).toBe(false);

    // the item's author rewords their own, not another's
    expect((await reword(c.id, theirs.id, "بند الثاني بعد التعديل")).status).toBe(200);
    const notMine = await reword(c.id, c.items[0]!, "خطف");
    expect(notMine.status).toBe(403);
    expect(notMine.text).toContain("chat.e.checklist_edit_denied");
    expect((await remove(c.id, c.items[0]!)).status).toBe(403);

    // the list's author rewords and removes any
    await loginAs(w.member.id);
    expect((await reword(c.id, theirs.id, "الكاتب عدّلها")).status).toBe(200);
    expect(asMessage(await remove(c.id, c.items[1]!)).checklist!.items.map((i) => i.text)).toEqual(["كاسات", "عصير", "الكاتب عدّلها"]);

    // a space admin (a moderator) removes
    await loginAs(w.admin.id);
    expect((await listOf(w.topic.id, c.id))!.items.every((i) => i.canEdit)).toBe(true);
    expect(asMessage(await remove(c.id, theirs.id)).checklist!.total).toBe(2);

    // a guest never
    await loginAs(w.guest.id);
    expect((await reword(c.id, c.items[0]!, "x")).status).toBe(403);
    expect((await remove(c.id, c.items[0]!)).status).toBe(403);
    expect((await listOf(w.topic.id, c.id))!.items.every((i) => !i.canEdit)).toBe(true);
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: c.id } } })).toBe(2);
  });

  it("a blank or too long wording is refused and the item keeps its words", async () => {
    const w = await world();
    const c = await make(w);
    expect((await reword(c.id, c.items[0]!, "  ")).status).toBe(422);
    expect((await reword(c.id, c.items[0]!, "ب".repeat(201))).status).toBe(422);
    expect((await db.chatChecklistItem.findUniqueOrThrow({ where: { id: c.items[0]! } })).text).toBe("كاسات");
  });
});

describe("checklists: the owner in silent oversight, the guest and the live line", () => {
  it("the owner reading a private chat sees the list but ticks, adds, rewords and removes nothing (no trace); a guest reads and does nothing", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.second.id } })).json?.["id"] as string;
    const c = await make(w, {}, w.member.id, dm);
    const events = () => db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "checklist.changed" } });

    await loginAs(w.owner.id);
    const seen = await listOf(dm, c.id);
    expect(seen).toMatchObject({ total: 3, canAdd: false, canTick: false });
    expect(seen!.items.every((i) => !i.canEdit)).toBe(true);
    for (const res of [await tick(c.id, c.items[0]!, true), await add(c.id, "x"), await reword(c.id, c.items[0]!, "x"), await remove(c.id, c.items[0]!)]) {
      expect(res.status).toBe(403);
      expect(res.text).toContain("chat.e.join_first");
    }
    expect(await events()).toBe(0);
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: c.id }, doneAt: { not: null } } })).toBe(0);
    expect(await db.conversationMember.count({ where: { conversationId: dm, userId: w.owner.id } })).toBe(0);

    // in an open topic he may join first, and then he is one of the people who may
    const open = await make(w);
    await loginAs(w.owner.id);
    expect((await tick(open.id, open.items[0]!, true)).status).toBe(403);
    expect((await call(joinRoute.POST, { params: { id: w.topic.id } })).status).toBeLessThan(300);
    const joined = await tick(open.id, open.items[0]!, true);
    expect(joined.status, joined.text).toBe(200);
  });

  it("a guest reads the list and the ticks, but not who ticked", async () => {
    const w = await world();
    const c = await make(w);
    await loginAs(w.second.id);
    await tick(c.id, c.items[0]!, true);
    await loginAs(w.guest.id);
    const list = (await listOf(w.topic.id, c.id))!;
    expect(list).toMatchObject({ done: 1, total: 3, canAdd: false, canTick: false });
    expect(list.items[0]!.done).toBe(true);
    expect(list.items[0]!.doneByName).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain("Second");
    await loginAs(w.member.id);
    expect((await listOf(w.topic.id, c.id))!.items[0]!.doneByName).toBe("Second");
  });

  it("the sync feed returns the presented message after a change, for the people who read it and nobody else", async () => {
    const w = await world();
    const secret = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Secret", restricted: true, members: { create: [{ userId: w.member.id }, { userId: w.admin.id }] } } });
    const open = await make(w);
    const hidden = await make(w, {}, w.member.id, secret.id);
    const cursor = String((await db.realtimeEvent.findFirst({ orderBy: { id: "desc" } }))?.id ?? 0);
    await loginAs(w.admin.id);
    await tick(open.id, open.items[1]!, true);
    await tick(hidden.id, hidden.items[0]!, true);

    const feedFor = async (userId: string, orgRole: "MEMBER" | "GUEST" | "ADMIN") => syncFeed({ orgId: w.org.id, userId, orgRole }, { after: BigInt(cursor) });
    const member = await feedFor(w.member.id, "MEMBER");
    const seen = member.messages.filter((m) => m.kind === ("CHECKLIST" as never));
    expect(seen.map((m) => m.id).sort()).toEqual([open.id, hidden.id].sort());
    expect(seen.find((m) => m.id === open.id)!.checklist!.items[1]).toMatchObject({ done: true, doneByName: "Admin" });

    // the other member reads the open one and learns nothing of the restricted one
    const second = await feedFor(w.second.id, "MEMBER");
    expect(second.messages.map((m) => m.id)).toEqual([open.id]);
    expect(JSON.stringify(second)).not.toContain(hidden.id);
    const guest = await feedFor(w.guest.id, "GUEST");
    expect(guest.messages.map((m) => m.id)).toEqual([open.id]);
    expect(JSON.stringify(guest)).not.toContain("Admin");
  });
});

describe("checklists: the items' words reach no reader of a message", () => {
  it("the list's row, the search and the bell show the title and never an item", async () => {
    const w = await world();
    await loginAs(w.second.id);
    const read = await db.conversationMember.create({ data: { conversationId: w.topic.id, userId: w.second.id, lastReadAt: new Date(Date.now() - 60_000) } });
    expect(read.userId).toBe(w.second.id);
    await loginAs(w.member.id);
    // @mentioning the second person makes a bell for them (an open topic's message makes none for the others)
    const res = await send(w.topic.id, "عنوان ظاهر", { items: [`${WORD} واحد`, `${WORD} اثنين`] }, { mentions: [w.second.id] });
    expect(res.status, res.text).toBe(201);
    const c = asMessage(res);
    await loginAs(w.second.id);
    await tick(c.id, c.checklist!.items[0]!.id, true);
    await loginAs(w.member.id);
    await add(c.id, `${WORD} ثلاثة`);

    for (const [userId, orgRole] of [[w.member.id, "MEMBER"], [w.second.id, "MEMBER"], [w.admin.id, "ADMIN"], [w.guest.id, "GUEST"], [w.owner.id, "OWNER"]] as const) {
      const ctx = { orgId: w.org.id, userId, orgRole };
      expect(JSON.stringify(await chatList(ctx)), `list of ${orgRole}`).not.toContain(WORD);
      expect(JSON.stringify(await chatList(ctx, { spaceId: w.ws.id })), `space list of ${orgRole}`).not.toContain(WORD);
      expect(JSON.stringify(await searchChat(ctx, { id: w.ws.id, isHq: false }, WORD)), `search of ${orgRole}`).not.toContain(WORD);
    }
    const bells = await db.notification.findMany({ where: { userId: { in: [w.second.id, w.admin.id, w.member.id] } } });
    expect(JSON.stringify(bells)).not.toContain(WORD);
    expect(bells.filter((b) => b.userId === w.second.id && JSON.stringify(b).includes("عنوان ظاهر")).length).toBeGreaterThan(0);
    // the search finds the title
    const titleHit = await searchChat({ orgId: w.org.id, userId: w.second.id, orgRole: "MEMBER" }, { id: w.ws.id, isHq: false }, "عنوان ظاهر");
    expect(titleHit.messages.some((m) => m.id === c.id)).toBe(true);
    // the plain message routes (the old screen's reader) carry the title as the body, the list only in `checklist`
    await loginAs(w.second.id);
    const window = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages`, params: { id: w.topic.id } });
    const row = (window.json?.["messages"] as MessageDto[]).find((m) => m.id === c.id)!;
    expect(row.body).toBe("عنوان ظاهر");
    expect(row.kind).toBe("CHECKLIST");
  });
});

describe("checklists: «اعمل منها مهمة»", () => {
  async function made(w: World, conversationId: string, messageId: string, extra: Record<string, unknown> = {}) {
    const { project, board } = await makeProject(w.ws.id);
    const res = await call(taskRoute.POST, { params: { id: messageId }, body: { workspaceId: w.ws.id, projectId: project.id, boardId: board.id, ...extra } });
    return { res, taskId: res.json?.["taskId"] as string };
  }

  it("one step per item in the list's order, the done ones done by whoever ticked them; the task links back to the message", async () => {
    const w = await world();
    const c = await make(w);
    await loginAs(w.second.id);
    await tick(c.id, c.items[1]!, true);
    await loginAs(w.member.id);
    const { res, taskId } = await made(w, w.topic.id, c.id);
    expect(res.status, res.text).toBe(201);
    const steps = await call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } });
    expect(steps.status, steps.text).toBe(201);
    expect(steps.json).toEqual({ steps: 3 });
    const rows = await db.taskStep.findMany({ where: { taskId }, orderBy: { position: "asc" } });
    expect(rows.map((r) => [r.title, r.done])).toEqual([["كاسات", false], ["صحون", true], ["عصير", false]]);
    expect(rows[1]!.doneById).toBe(w.second.id);
    expect(rows[1]!.doneAt).not.toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).sourceMessageId).toBe(c.id);
    // the message says what it became
    expect((await detail(w.topic.id)).messages.find((m) => m.id === c.id)!.work).toEqual([{ kind: "task", id: taskId }]);
    // only once
    const again = await call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } });
    expect(again.status).toBe(403);
    expect(again.text).toContain("chat.e.checklist_steps_exist");
    expect(await db.taskStep.count({ where: { taskId } })).toBe(3);
  });

  it("only for the task made from THIS message, by a person who may write that task's steps", async () => {
    const w = await world();
    const a = await make(w);
    const b = await make(w);
    await loginAs(w.member.id);
    const first = await made(w, w.topic.id, a.id);
    // a task made from another message gets no steps from this list
    const wrong = await call(stepsRoute.POST, { params: { id: b.id }, body: { taskId: first.taskId } });
    expect(wrong.status).toBe(404);
    expect((await call(stepsRoute.POST, { params: { id: a.id }, body: { taskId: "no-such-task" } })).status).toBe(404);
    // a guest of the space reads the list and writes no step
    await loginAs(w.guest.id);
    const guest = await call(stepsRoute.POST, { params: { id: a.id }, body: { taskId: first.taskId } });
    expect(guest.status).toBe(403);
    expect(await db.taskStep.count({ where: { taskId: first.taskId } })).toBe(0);
    // the owner who reads silently and is not in the space writes none either
    await loginAs(w.owner.id);
    const eye = await call(stepsRoute.POST, { params: { id: a.id }, body: { taskId: first.taskId } });
    expect([403, 404]).toContain(eye.status);
    expect(await db.taskStep.count({ where: { taskId: first.taskId } })).toBe(0);
    // the switch of steps closes the door
    await setSwitch(w.org.id, "taskSteps", false);
    await loginAs(w.member.id);
    expect((await call(stepsRoute.POST, { params: { id: a.id }, body: { taskId: first.taskId } })).status).toBe(404);
    await setSwitch(w.org.id, "taskSteps", true);
  });

  it("a list in a private conversation makes a PRIVATE task: the other members of the space never see it, nor its steps (and a public one needs the confirmation)", async () => {
    const w = await world();
    const secret = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "Secret", restricted: true, members: { create: [{ userId: w.member.id }, { userId: w.admin.id }] } } });
    const c = await make(w, {}, w.member.id, secret.id);
    await loginAs(w.member.id);
    const asked = await made(w, secret.id, c.id, { visibility: "SPACE" });
    expect(asked.res.status).toBe(422); // «work.confirm_public_required»
    const { res, taskId } = await made(w, secret.id, c.id);
    expect(res.status, res.text).toBe(201);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).visibility).toBe("PARTICIPANTS");
    expect((await call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } })).status).toBe(201);

    // a member of the space who is not in the conversation: the task is not found, and the door adds nothing for them
    await loginAs(w.second.id);
    expect((await call(taskGet.GET, { params: { id: taskId } })).status).toBe(404);
    const other = await call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } });
    expect(other.status).toBe(404);
    expect(other.text).not.toContain("كاسات");
  });

  it("the switch closes every door of the list (404) and the header stops offering it; what was made stays", async () => {
    const w = await world();
    const c = await make(w);
    await setSwitch(w.org.id, "chatChecklists", false);
    await loginAs(w.second.id);
    for (const res of [await add(c.id, "x"), await tick(c.id, c.items[0]!, true), await reword(c.id, c.items[0]!, "x"), await remove(c.id, c.items[0]!), await call(stepsRoute.POST, { params: { id: c.id }, body: { taskId: "t" } })]) {
      expect(res.status).toBe(404);
    }
    await loginAs(w.member.id);
    const refused = await send(w.topic.id, "قائمة", { items: ["أ"] });
    expect(refused.status).toBe(404);
    expect((await (async () => (await call(headerRoute.GET, { params: { id: w.topic.id } })).json as unknown as ConversationHeaderDto)()).me.canChecklist).toBe(false);
    // the list is still there, drawn with nothing that works
    const shown = (await listOf(w.topic.id, c.id))!;
    expect(shown.total).toBe(3);
    expect([shown.canAdd, shown.canTick, ...shown.items.map((i) => i.canEdit)].some(Boolean)).toBe(false);
    expect(await db.chatChecklistItem.count({ where: { checklist: { messageId: c.id } } })).toBe(3);
    await setSwitch(w.org.id, "chatChecklists", true);
    expect((await listOf(w.topic.id, c.id))!.canTick).toBe(true);
  });

  it("two presses of «اعمل منها مهمة» at once make the steps once; a person who did not make the task adds none; a failure leaves no half list", async () => {
    const w = await world();
    const c = await make(w);
    await loginAs(w.member.id);
    const { taskId } = await made(w, w.topic.id, c.id);
    // somebody else who reads the message and works in the space: the task is not theirs
    await loginAs(w.second.id);
    const other = await call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } });
    expect(other.status).toBe(404);
    expect(await db.taskStep.count({ where: { taskId } })).toBe(0);
    await loginAs(w.member.id);
    const both = await Promise.all([call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } }), call(stepsRoute.POST, { params: { id: c.id }, body: { taskId } })]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(await db.taskStep.count({ where: { taskId } })).toBe(3);
  });

  it("editing the title of a list is allowed to its author (the words are only the title), within the 200 characters of a title", async () => {
    const w = await world();
    const c = await make(w);
    const edit = await call(messageRoute.PATCH, { method: "PATCH", params: { id: c.id }, body: { body: "عنوان جديد" } });
    expect(edit.status).toBe(200);
    expect(asMessage(edit).body).toBe("عنوان جديد");
    expect(asMessage(edit).checklist!.total).toBe(3);
    const long = await call(messageRoute.PATCH, { method: "PATCH", params: { id: c.id }, body: { body: "ع".repeat(201) } });
    expect(long.status).toBe(422);
    expect(long.text).toContain("chat.e.checklist_title");
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: c.id } })).body).toBe("عنوان جديد");
  });
});
