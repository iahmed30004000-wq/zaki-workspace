import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireTaskAccess, ValidationError } from "@/server/auth";
import type { OrgAccessContext } from "@/server/auth";
import { canModerate, canPost, canRead, hasOversight } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { presentMessage } from "@/server/chat/redact";
import { guard, messageInclude, viewerOf, withViewer } from "@/server/chat/messages";
import { linkPreviewsOn } from "@/server/chat/link-preview";
import { crossViewerOf } from "@/server/chat/cross-reply";
import { isSilentOwner } from "@/server/chat/poll-shared";
import { assertFeatureOn } from "@/server/services/features";
import { insertStep } from "@/server/services/task-steps";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import { checklistRights, cleanChecklistText, MAX_CHECKLIST_ITEM_LENGTH, MAX_CHECKLIST_ITEMS, mayEditItem, type ChecklistViewer } from "@/lib/chat/checklist";
import type { MessageDto } from "@/server/chat/dto";

/**
 * «قائمة مهام» (C3c.1): adding, ticking, rewording and removing the items of a checklist. Creating one is a send (messages.ts `sendMessage` with a `checklist`), so it shares
 * the send limiter, the idempotent client id and `message.created`.
 *
 * - Who adds: the list's author, or anybody who may post here when the author allowed it (`othersCanAdd`).
 * - Who ticks (and unticks): the list's author, or anybody who may post here while `othersCanTick` holds (the default). A tick carries a name and a time.
 * - Who rewords or removes an item: the item's author, the list's author, a moderator of the conversation.
 * - Never a guest (he reads the list), and never the owner in silent oversight: his reading leaves no trace and a tick is one, so he joins first (like for a poll).
 * - A deleted message hides its list: nothing is added, ticked or removed there.
 * - Every answer is the message as the caller now sees it, and every change rings `checklist.changed` (conversation and message ids only: never who ticked or what an item says).
 * - The company's switch `chatChecklists` closes every door (404); the lists already made stay in the data.
 */

/** 120 item changes a minute per person, process-wide. */
export const itemLimiter = new FixedWindowLimiter({ limit: 120, windowMs: 60_000 });

export const addItemSchema = z.object({ text: z.string().max(MAX_CHECKLIST_ITEM_LENGTH * 3) });
export const editItemSchema = addItemSchema;
export const tickSchema = z.object({ done: z.boolean() });
export const stepsSchema = z.object({ taskId: z.string().min(1).max(64) });
export type AddItemInput = z.infer<typeof addItemSchema>;
export type TickInput = z.infer<typeof tickSchema>;

type Loaded = Awaited<ReturnType<typeof load>>;

async function load(ctx: OrgAccessContext, messageId: string) {
  await assertFeatureOn(ctx.orgId, "chatChecklists");
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, orgId: true, conversationId: true, kind: true, authorId: true, deletedAt: true, checklist: { select: { id: true, othersCanAdd: true, othersCanTick: true } } },
  });
  if (!msg || msg.orgId !== ctx.orgId || msg.kind !== "CHECKLIST" || !msg.checklist) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  const viewer: ChecklistViewer = {
    userId: ctx.userId,
    role: org.role,
    oversight: hasOversight(org),
    isMember: facts.viewerIsMember,
    canModerateHere: canModerate(facts, org),
    canPost: canPost(facts, org, { ownerJoined: facts.viewerIsMember }),
  };
  return { msg, list: msg.checklist, facts, org, viewer };
}

function limit(ctx: OrgAccessContext): void {
  if (!itemLimiter.check(`chat.checklist.${ctx.userId}`).ok) throw new RateLimitedError(60, "chat.e.rate_limited");
  itemLimiter.hit(`chat.checklist.${ctx.userId}`);
}

/** The rights of the caller on this list; throws the right refusal when `need` is not held. */
function assertMay(l: Loaded, need: "add" | "tick"): void {
  const rights = checklistRights(l.viewer, { authorId: l.msg.authorId, othersCanAdd: l.list.othersCanAdd, othersCanTick: l.list.othersCanTick }, false);
  if (rights.guest) throw new ForbiddenError("chat.e.checklist_guest");
  // the silent eye writes nothing: he joins first, and then he is one of the people who may
  if (rights.silent) throw new ForbiddenError("chat.e.join_first");
  if (l.msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  if (l.viewer.canPost !== true) throw new ForbiddenError("chat.e.post_denied");
  if (!rights[need]) throw new ForbiddenError(need === "add" ? "chat.e.checklist_add_denied" : "chat.e.checklist_tick_denied");
}

function assertMayEdit(l: Loaded, item: { addedById: string }): void {
  if (l.viewer.role === "GUEST") throw new ForbiddenError("chat.e.checklist_guest");
  if (isSilentOwner(l.viewer)) throw new ForbiddenError("chat.e.join_first");
  if (l.msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  // the same freeze as adding and ticking: a closed topic, a muted person, a poster-only topic
  if (l.viewer.canPost !== true) throw new ForbiddenError("chat.e.post_denied");
  if (!mayEditItem(l.viewer, { authorId: l.msg.authorId }, item)) throw new ForbiddenError("chat.e.checklist_edit_denied");
}

async function present(ctx: OrgAccessContext, l: Loaded): Promise<MessageDto> {
  const row = await db.chatMessage.findUniqueOrThrow({ where: { id: l.msg.id }, include: messageInclude() });
  return presentMessage(row, { ...withViewer(viewerOf(l.facts, l.org), ctx.userId), linkPreviews: await linkPreviewsOn(ctx.orgId), ...(await crossViewerOf(ctx.userId, ctx.orgId, l.org, [row])) });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Locks the list's row for the length of the transaction, so two changes never interleave (the 30-item limit holds under a race). */
async function lockList(tx: Tx, listId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ChatChecklist" WHERE "id" = ${listId} FOR UPDATE`;
}

async function ring(tx: Tx, ctx: OrgAccessContext, l: Loaded): Promise<void> {
  await emitRealtime(tx, ctx.orgId, "checklist.changed", { conversationId: l.msg.conversationId, messageId: l.msg.id, spaceId: l.facts.spaceId ?? undefined });
}

export async function addItem(ctx: OrgAccessContext, messageId: string, input: AddItemInput): Promise<MessageDto> {
  limit(ctx);
  const l = await load(ctx, messageId);
  assertMay(l, "add");
  const text = cleanChecklistText(input.text);
  if (text === null) throw new ValidationError([{ path: "text", message: "chat.e.checklist_item" }]);
  await db.$transaction(async (tx) => {
    await lockList(tx, l.list.id);
    const [count, last] = await Promise.all([
      tx.chatChecklistItem.count({ where: { checklistId: l.list.id } }),
      tx.chatChecklistItem.findFirst({ where: { checklistId: l.list.id }, orderBy: { position: "desc" }, select: { position: true } }),
    ]);
    if (count >= MAX_CHECKLIST_ITEMS) throw new ValidationError([{ path: "text", message: "chat.e.checklist_full" }]);
    await tx.chatChecklistItem.create({ data: { checklistId: l.list.id, text, position: (last?.position ?? -1) + 1, addedById: ctx.userId } });
    await ring(tx, ctx, l);
  });
  return present(ctx, l);
}

/** Ticking an item again keeps who ticked it first and when; unticking clears both. A change that changes nothing rings nothing. */
export async function tickItem(ctx: OrgAccessContext, messageId: string, itemId: string, input: TickInput): Promise<MessageDto> {
  limit(ctx);
  const l = await load(ctx, messageId);
  assertMay(l, "tick");
  await db.$transaction(async (tx) => {
    await lockList(tx, l.list.id);
    const item = await tx.chatChecklistItem.findFirst({ where: { id: itemId, checklistId: l.list.id }, select: { id: true, doneAt: true } });
    if (!item) throw new NotFoundError("chat.e.not_found");
    if (input.done === (item.doneAt !== null)) return;
    await tx.chatChecklistItem.update({ where: { id: itemId }, data: input.done ? { doneById: ctx.userId, doneAt: new Date() } : { doneById: null, doneAt: null } });
    await ring(tx, ctx, l);
  });
  return present(ctx, l);
}

export async function editItem(ctx: OrgAccessContext, messageId: string, itemId: string, input: AddItemInput): Promise<MessageDto> {
  limit(ctx);
  const l = await load(ctx, messageId);
  const text = cleanChecklistText(input.text);
  await db.$transaction(async (tx) => {
    await lockList(tx, l.list.id);
    const item = await tx.chatChecklistItem.findFirst({ where: { id: itemId, checklistId: l.list.id }, select: { id: true, addedById: true } });
    if (!item) throw new NotFoundError("chat.e.not_found");
    assertMayEdit(l, item);
    if (text === null) throw new ValidationError([{ path: "text", message: "chat.e.checklist_item" }]);
    await tx.chatChecklistItem.update({ where: { id: itemId }, data: { text } });
    await ring(tx, ctx, l);
  });
  return present(ctx, l);
}

export async function removeItem(ctx: OrgAccessContext, messageId: string, itemId: string): Promise<MessageDto> {
  limit(ctx);
  const l = await load(ctx, messageId);
  await db.$transaction(async (tx) => {
    await lockList(tx, l.list.id);
    const item = await tx.chatChecklistItem.findFirst({ where: { id: itemId, checklistId: l.list.id }, select: { id: true, addedById: true } });
    if (!item) throw new NotFoundError("chat.e.not_found");
    assertMayEdit(l, item);
    await tx.chatChecklistItem.delete({ where: { id: itemId } });
    await ring(tx, ctx, l);
  });
  return present(ctx, l);
}

/**
 * «اعمل منها مهمة»: the task was made from this message by the one door that makes work of a message (`messageToTask`: its project, its privacy by P0.3 — a list in a private
 * conversation never makes a public task — and `sourceMessageId`). This writes its STEPS: one `TaskStep` per item through the steps service, a done item done (by whoever
 * ticked it, when they did). Only for the task whose source IS this message, only while it has no step, only by a person who may write steps of that task.
 */
export async function checklistToSteps(ctx: OrgAccessContext, messageId: string, taskId: string): Promise<{ steps: number }> {
  limit(ctx);
  const l = await load(ctx, messageId);
  if (l.viewer.role === "GUEST") throw new ForbiddenError("chat.e.checklist_guest");
  if (isSilentOwner(l.viewer)) throw new ForbiddenError("chat.e.join_first");
  if (l.msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  // the task's own guard: its space, its team, and a private task is not even found by a person it does not concern
  const access = await requireTaskAccess(taskId, ["ADMIN", "MEMBER"]);
  if (access.orgId !== ctx.orgId || access.userId !== ctx.userId) throw new NotFoundError("task.not_found");
  // the task of THIS message, made by THIS person: somebody else who reads the message and works in the space has made no task of it, and the list's words are not theirs to copy into one
  const task = await db.task.findUnique({ where: { id: taskId }, select: { sourceMessageId: true, creatorId: true } });
  if (!task || task.sourceMessageId !== messageId || task.creatorId !== ctx.userId) throw new NotFoundError("task.not_found");
  await assertFeatureOn(ctx.orgId, "taskSteps");
  // a person who reads a space without being in it ticks nothing there (the steps service's own rule)
  const member = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: access.task.workspaceId, userId: ctx.userId } }, select: { userId: true } });
  if (!member) throw new ForbiddenError("step.oversight_readonly");

  // under the list's lock: two presses at once make the steps once (the second waits, then finds them), and nobody rewords an item between the read and the writes
  return db.$transaction(
    async (tx) => {
      await lockList(tx, l.list.id);
      if ((await tx.taskStep.count({ where: { taskId } })) > 0) throw new ForbiddenError("chat.e.checklist_steps_exist");
      const items = await tx.chatChecklistItem.findMany({ where: { checklistId: l.list.id }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { text: true, doneById: true, doneAt: true } });
      try {
        for (const item of items) {
          // the steps service writes through its own connection: a failure half way must not leave half a list, so it is taken back by hand (the task had none: checked above, under the lock)
          const step = await insertStep(ctx.orgId, taskId, item.text);
          if (item.doneAt) await db.taskStep.update({ where: { id: step.id }, data: { done: true, doneById: item.doneById, doneAt: item.doneAt } });
        }
      } catch (err) {
        await db.taskStep.deleteMany({ where: { taskId } });
        throw err;
      }
      return { steps: items.length };
    },
    { timeout: 20_000 },
  );
}
