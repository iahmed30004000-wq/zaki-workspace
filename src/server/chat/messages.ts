import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import type { OrgAccessContext } from "@/server/auth";
import {
  canModerate,
  canPost,
  canRead,
  hasOversight,
  loadConversationFacts,
  loadOrgFacts,
  type ConversationFacts,
  type OrgFacts,
} from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { moveLastMessageAt, writeSystemMessage } from "@/server/chat/system";
import { markDeliveredForUser } from "@/server/chat/read-state";
import { log } from "@/server/log";
import { claimUploads, MAX_ATTACHMENTS_PER_MESSAGE } from "@/server/chat/attachments";
import { presentMessage, previewOf, type Viewer } from "@/server/chat/redact";
import { cleanPollOptions, pollCreateData, pollInclude, pollInputSchema } from "@/server/chat/poll-shared";
import { notifyMessageToAudience, notifyCandidates, readersAmong, rewriteMessagePreviews, topicAudienceIds, DELETED_PREVIEW } from "@/server/chat/notify";
import { ASSISTANT_MENTION_ID, MENTION_ALL_ID, mentionsAll } from "@/lib/chat/conversation/mentions";
import { afterMessageSent } from "@/server/services/chat-assistant";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { queueSync } from "@/server/services/search-embed-index";
import { applyAutoTicketRules } from "@/server/services/problem-tickets";
import { canMark } from "@/server/chat/must-read-policy";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import type { Prisma } from "@prisma/client";
import type { MessageDto } from "@/server/chat/dto";

/** Every `chat.e.*` key a caller may see is defined in src/lib/i18n/ar.chat-errors.json. */

/** 30 sends per minute per user, process-wide (the design's number). */
export const sendLimiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000 });
/** Retries of a message already sent are free of the send quota, but not unlimited: each still costs a few queries. */
const retryLimiter = new FixedWindowLimiter({ limit: 300, windowMs: 60_000 });

const MAX_BODY = 4000;

/** Any single emoji up to 16 characters (the grapheme count decides, not the code units). */
export function isSingleEmoji(emoji: string): boolean {
  if (!emoji) return false;
  const chars = [...emoji];
  if (chars.length > 16) return false;
  return true;
}

export const sendSchema = z
  .object({
    body: z.string().max(MAX_BODY).optional(),
    replyToId: z.string().min(1).max(64).optional(),
    mentions: z.array(z.string().min(1)).max(50).optional(),
    // «@الكل»: honoured only with the word in the body, in a topic, for somebody who is not a guest
    mentionAll: z.boolean().optional(),
    // «لازم ينقرأ» (Q1.6): a moderator or a holder of «إعلانات للجميع» sends the message as one that must be acknowledged
    mustRead: z.boolean().optional(),
    attachmentIds: z.array(z.string().min(1)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
    clientId: z.string().min(1).max(64).optional(),
    // a voice note: exactly one recorded audio attachment (the schema used to drop this flag, so
    // every recording arrived as an ordinary message with a file)
    voice: z.boolean().optional(),
    // «نتفرّج سوا»: the second of the video it was written at; kept only in a watching session's topic
    videoAtSec: z.number().finite().min(0).max(86_400).optional(),
    // «استطلاع»: the question is the body; a topic only, never with files or a voice note
    poll: pollInputSchema.optional(),
  })
  .refine((v) => (v.body?.trim().length ?? 0) > 0 || (v.attachmentIds?.length ?? 0) > 0, {
    message: "chat.e.empty",
    path: ["body"],
  });

export type SendInput = z.infer<typeof sendSchema>;

export async function guard(ctx: OrgAccessContext, conversationId: string) {
  const [facts, org] = await Promise.all([
    loadConversationFacts(ctx.userId, conversationId),
    loadOrgFacts(ctx.userId, ctx.orgId),
  ]);
  if (!facts || !org || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST" && facts.kind !== "TOPIC") throw new ForbiddenError("chat.guest_forbidden");
  return { facts, org };
}

/** A viewer object for presentMessage, from the policy facts. */
export function viewerOf(facts: ConversationFacts, org: OrgFacts): Viewer {
  return {
    userId: "",
    role: org.role,
    oversight: hasOversight(org),
    canModerateHere: canModerate(facts, org),
    isMember: facts.viewerIsMember,
  };
}

export function withViewer(viewer: Viewer, userId: string): Viewer {
  return { ...viewer, userId };
}

// ---------- send ----------

/** What only the server's own callers may add to a message (the public schema has no such field): a card the message points at. */
export interface SendInternal {
  card?: { type: "product"; cardId: string } | { type: "order"; number: string };
}

export async function sendMessage(
  ctx: OrgAccessContext,
  conversationId: string,
  input: SendInput,
  internal: SendInternal = {},
): Promise<MessageDto> {
  // a retry of a message that already went (the phone's outbox re-sends until it hears back) is answered with that message and does
  // not use the quota: the same `clientId` of the same author, in this conversation, checked BEFORE the limiter (F0.7). It still goes
  // through the guard below, so nobody is handed a message they may not read.
  const retry =
    input.clientId !== undefined &&
    (await db.chatMessage.findUnique({
      where: { authorId_clientId: { authorId: ctx.userId, clientId: input.clientId } },
      select: { conversationId: true },
    }))?.conversationId === conversationId;
  if (retry) {
    if (!retryLimiter.check(`chat.retry.${ctx.userId}`).ok) throw new RateLimitedError(60, "chat.e.rate_limited");
    retryLimiter.hit(`chat.retry.${ctx.userId}`);
  } else {
    if (!sendLimiter.check(`chat.send.${ctx.userId}`).ok) {
      throw new RateLimitedError(60, "chat.e.rate_limited");
    }
    sendLimiter.hit(`chat.send.${ctx.userId}`);
  }

  const { facts, org } = await guard(ctx, conversationId);
  const joined = facts.viewerIsMember;
  if (!canPost(facts, org, { ownerJoined: joined })) throw new ForbiddenError("chat.e.post_denied");

  const body = (input.body ?? "").trim();
  const attachments = input.attachmentIds ?? [];
  if (body.length > MAX_BODY) throw new ValidationError([{ path: "body", message: "chat.e.too_long" }]);
  if (body.length === 0 && attachments.length === 0) throw new ValidationError([{ path: "body", message: "chat.e.empty" }]);

  // «الرسائل الصوتية» off: no new voice note (the ones already sent still play)
  if (input.voice === true) await assertFeatureOn(ctx.orgId, "voiceNotes");
  // a VOICE message carries exactly one AUDIO attachment and no other kind
  const isVoice = attachments.length === 1 && (await attachmentKind(attachments[0]!)) === "AUDIO" && input.voice === true;
  if (input.voice === true && (!isVoice || attachments.length !== 1)) {
    throw new ValidationError([{ path: "attachmentIds", message: "chat.e.voice_needs_one_audio" }]);
  }

  // a poll: a topic's, with 2-10 options and nothing else attached; a guest only votes, never asks
  let pollOptions: string[] | null = null;
  if (input.poll) {
    if (facts.kind !== "TOPIC") throw new ForbiddenError("chat.e.poll_topic_only");
    if (org.role === "GUEST") throw new ForbiddenError("chat.e.poll_guest");
    if (attachments.length > 0 || input.voice === true) throw new ValidationError([{ path: "poll", message: "chat.e.poll_alone" }]);
    if (body.length === 0) throw new ValidationError([{ path: "body", message: "chat.e.poll_question" }]);
    pollOptions = cleanPollOptions(input.poll.options);
    if (!pollOptions) throw new ValidationError([{ path: "poll.options", message: "chat.e.poll_options" }]);
  }

  // «لازم ينقرأ»: only where the switch is on, in a topic, for somebody who may mark a message; a plain member's flag is refused, never dropped silently
  let mustRead = false;
  if (input.mustRead === true) {
    if (!(await isFeatureOn(ctx.orgId, "mustRead")) || internal.card || input.poll || input.voice === true || !(await canMark(ctx, facts, org))) throw new ForbiddenError("chat.e.must_read_denied");
    mustRead = true;
  }

  // a card stands alone: no files, no voice, no poll
  if (internal.card && (attachments.length > 0 || input.voice === true || input.poll)) throw new ValidationError([{ path: "card", message: "chat.e.card_alone" }]);
  const kind = internal.card ? "CARD" : input.poll ? "POLL" : input.voice === true && isVoice ? "VOICE" : "TEXT";

  // a moment of the video means something only in a «نتفرّج سوا» session's talk; anywhere else it is dropped
  const videoAtSec =
    input.videoAtSec !== undefined && (await db.watchSession.count({ where: { conversationId } })) > 0 ? input.videoAtSec : null;

  // the reply target must belong to the same conversation
  if (input.replyToId) {
    const parent = await db.chatMessage.findFirst({ where: { id: input.replyToId, conversationId }, select: { id: true } });
    if (!parent) throw new NotFoundError("chat.e.reply_not_found");
  }

  // mentions must be people who may read the conversation (the policy decides, not a member row:
  // an open topic's audience is its whole space, and a row left behind by a removal counts for nothing)
  // («@المساعد» is not a person: it is found in the body after the send, never stored among the mentions)
  const mentionIds = await readersAmong(conversationId, [...new Set(input.mentions ?? [])].filter((id) => id !== ASSISTANT_MENTION_ID));
  // «@الكل»: everybody the topic reaches (a guest may not, and it means nothing in a DM or a group)
  const wantsAll = input.mentionAll === true && facts.kind === "TOPIC" && mentionsAll(body);
  if (wantsAll && org.role === "GUEST") throw new ForbiddenError("chat.e.mention_all_denied");
  const allIds = wantsAll ? await readersAmong(conversationId, await topicAudienceIds(facts, conversationId)) : [];

  // idempotent send: the same clientId of the same author returns the same message
  if (input.clientId) {
    const existing = await db.chatMessage.findUnique({
      where: { authorId_clientId: { authorId: ctx.userId, clientId: input.clientId } },
      include: messageInclude(),
    });
    if (existing) {
      return presentMessage(existing, withViewer(viewerOf(facts, org), ctx.userId));
    }
  }

  const created = await db.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({
      data: {
        orgId: ctx.orgId,
        conversationId,
        authorId: ctx.userId,
        body,
        kind,
        replyToId: input.replyToId ?? null,
        mentions: wantsAll ? [...mentionIds, MENTION_ALL_ID] : mentionIds,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(mustRead ? { ackRequired: true, ackMeta: { markedAt: new Date().toISOString() } } : {}),
        ...(videoAtSec !== null ? { videoAtSec } : {}),
        ...(internal.card ? { card: internal.card as unknown as Prisma.InputJsonValue } : {}),
        ...(input.poll && pollOptions ? { poll: { create: pollCreateData(input.poll, pollOptions) } } : {}),
      },
      include: messageInclude(),
    });
    if (attachments.length) {
      await claimUploads(tx, {
        orgId: ctx.orgId,
        uploaderId: ctx.userId,
        conversationId,
        messageId: msg.id,
        attachmentIds: attachments,
      });
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    // C1.1: the chat list's "last message" time moves with the message, in this same transaction (never backwards)
    await moveLastMessageAt(tx, conversationId, msg.createdAt);
    // my own read mark: the author has read the thread up to their message
    if (joined) {
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: ctx.userId } },
        data: { lastReadAt: new Date() },
      });
    }
    await emitRealtime(tx, ctx.orgId, "message.created", { conversationId, messageId: msg.id, spaceId: facts.spaceId ?? undefined });
    // the row was read before its files were claimed: read it again so the answer carries them (the
    // sender's screen shows the message from this answer: a voice note without its audio was an empty bubble)
    return attachments.length ? tx.chatMessage.findUniqueOrThrow({ where: { id: msg.id }, include: messageInclude() }) : msg;
  });

  // my own fresh DM message starts at ✓ (sent): the screen shows it from this answer before any refetch
  const dto = presentMessage(created, withViewer(viewerOf(facts, org), ctx.userId), facts.kind === "DM" ? "sent" : undefined);
  // C1.8: the answer goes back as soon as the commit is done. The bell and the push (and the company's auto-ticket rules) run AFTER it: the
  // sender's ✓ never waits for them, and a failure there is logged with its step (never swallowed) and never fails the send.
  const after: AfterSendStep[] = [{ step: "notify", run: () => notifyAfterSend(ctx, facts, conversationId, mentionIds, allIds, input.replyToId ?? null, dto) }];
  // «المشاكل تصير تذاكر»: the rules of the company, after the message is stored (a failure there never stops a message)
  if (kind === "TEXT" && !internal.card) {
    after.push({ step: "auto_tickets", run: () => applyAutoTicketRules(ctx, { id: created.id, body, conversationId }, { spaceId: facts.spaceId ?? null, kind: facts.kind, restricted: Boolean(facts.restricted), teamId: facts.teamId ?? null }) });
  }
  const afterJob = runAfterSend(after);
  // «@المساعد»: one answer in this conversation, written when the model has answered (never delays this reply)
  if (kind === "TEXT") afterMessageSent({ orgId: ctx.orgId, conversationId, messageId: created.id, body });
  // «بحث بالمعنى»: its vector is made in the background (a no-op without the switch and a service)
  if (kind === "TEXT") queueSync(ctx.orgId, "message", created.id);
  if (afterSendMode() === "inline") await afterJob;
  return dto;
}

// ---------- after the answer (C1.8) ----------

interface AfterSendStep {
  step: string;
  run: () => Promise<unknown>;
}
type AfterSendMode = "inline" | "deferred";
let afterSendOverride: AfterSendMode | null = null;
const afterSendJobs = new Set<Promise<void>>();

/**
 * Where the work that follows a send runs. Production: `deferred` — after the answer (a microtask on the server's own event loop, which
 * keeps running: this is a long-lived Node process, not a function that is frozen when it answers). Under test: `inline`, so the many
 * suites that count bells and tickets right after a send see them, unchanged; a test of the deferred order asks for it with
 * `setAfterSendModeForTests("deferred")`.
 */
function afterSendMode(): AfterSendMode {
  return afterSendOverride ?? (process.env["NODE_ENV"] === "test" ? "inline" : "deferred");
}

/** Tests only: force the mode (`null`: back to the default). */
export function setAfterSendModeForTests(mode: AfterSendMode | null): void {
  afterSendOverride = mode;
}

/** Tests only: wait until every send's after-work has finished. */
export async function settleAfterSendForTests(): Promise<void> {
  while (afterSendJobs.size > 0) await Promise.all([...afterSendJobs]);
}

/**
 * The steps run one after the other, each on its own: one that throws is logged (the step and the kind of error, never the words of the
 * message or of the error) and the next one still runs. The returned promise never rejects.
 */
function runAfterSend(steps: AfterSendStep[]): Promise<void> {
  const job = Promise.resolve().then(async () => {
    for (const { step, run } of steps) {
      try {
        await run();
      } catch (err) {
        log.error("chat.after_send_failed", { step, name: err instanceof Error ? err.name : "unknown" });
      }
    }
  });
  afterSendJobs.add(job);
  void job.finally(() => afterSendJobs.delete(job));
  return job;
}

/** Notifications go out AFTER the send transaction commits (online people are skipped). */
async function notifyAfterSend(
  ctx: OrgAccessContext,
  facts: ConversationFacts,
  conversationId: string,
  mentionIds: string[],
  allIds: string[],
  replyToId: string | null,
  dto: MessageDto,
): Promise<void> {
  const parent = replyToId ? await db.chatMessage.findUnique({ where: { id: replyToId }, select: { authorId: true } }) : null;
  const audience = await readersAmong(conversationId, notifyCandidates(facts, ctx.userId, [...mentionIds, ...allIds], parent?.authorId ?? null));
  const isDm = facts.kind === "DM";
  await notifyMessageToAudience({
    conversationId,
    authorId: ctx.userId,
    audienceIds: audience,
    kind: isDm ? "DM" : "TOPIC",
    title: isDm ? dto.authorName : dto.authorName,
    messageId: dto.id,
    mentionedIds: mentionIds,
    allIds: allIds.filter((id) => !mentionIds.includes(id)),
    preview: dto.body ? dto.body.slice(0, 140) : "أرسل مرفقًا",
  });
}

/**
 * Attachments: the kind comes from the StoredFile's mime (FILES-VOICE owns the upload flow); a
 * recording (purpose VOICE, sniffed as audio on upload) is audio, whatever container it came in.
 */
async function attachmentKind(fileId: string): Promise<string> {
  const f = await db.storedFile.findUnique({ where: { id: fileId }, select: { mimeType: true, purpose: true } });
  if (f?.purpose === "VOICE") return "AUDIO";
  const mime = f?.mimeType ?? "";
  return mime.startsWith("audio/") ? "AUDIO" : mime.startsWith("image/") ? "IMAGE" : mime.startsWith("video/") ? "VIDEO" : "FILE";
}

// ---------- edit ----------

export const editSchema = z.object({ body: z.string().trim().min(1, "chat.e.empty").max(MAX_BODY) });

export async function editMessage(ctx: OrgAccessContext, messageId: string, input: z.infer<typeof editSchema>): Promise<MessageDto> {
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    include: { conversation: { select: { id: true, orgId: true } } },
  });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  if (msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (msg.authorId !== ctx.userId) throw new ForbiddenError("chat.e.not_author"); // only the author edits
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  if (msg.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");
  if (msg.kind === "POLL") throw new ForbiddenError("chat.e.poll_immutable"); // people voted on these words
  if (msg.kind === "CARD") throw new ForbiddenError("chat.e.card_immutable"); // its words are the card's name
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");

  const updated = await db.$transaction(async (tx) => {
    // the text BEFORE the edit goes into the history, in the same transaction
    await tx.messageRevision.create({ data: { messageId, body: msg.body, editorId: ctx.userId } });
    const m = await tx.chatMessage.update({ where: { id: messageId }, data: { body: input.body, editedAt: new Date() }, include: messageInclude() });
    // a bell that showed the old words shows the new ones
    await rewriteMessagePreviews(tx, msg.conversationId, messageId, input.body.slice(0, 140));
    await emitRealtime(tx, ctx.orgId, "message.edited", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
    return m;
  });
  // «بحث بالمعنى»: the vector follows the new words
  queueSync(ctx.orgId, "message", messageId);
  return presentMessage(updated, withViewer(viewerOf(facts, org), ctx.userId));
}

// ---------- delete ----------

export async function deleteMessage(ctx: OrgAccessContext, messageId: string): Promise<void> {
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    include: { conversation: { select: { id: true, orgId: true, spaceId: true } } },
  });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  const mine = msg.authorId === ctx.userId;
  if (!mine && !canModerate(facts, org)) throw new ForbiddenError("chat.e.delete_denied");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");

  await db.$transaction(async (tx) => {
    // the body is KEPT (the owner reads it in the archive); only the tombstone hides it
    await tx.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: ctx.userId, pinned: false },
    });
    // the bell never keeps the words of a deleted message
    await rewriteMessagePreviews(tx, msg.conversationId, messageId, DELETED_PREVIEW);
    await recomputeLastMessageAt(tx, msg.conversationId, msg.createdAt);
    await emitRealtime(tx, ctx.orgId, "message.deleted", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
    // an admin deletion is a moderation act: it goes to the audit trail
    if (!mine) {
      await tx.auditLog.create({
        data: {
          action: "chat.delete_by_admin",
          actorId: ctx.userId,
          orgId: ctx.orgId,
          target: msg.authorId,
          workspaceId: facts.spaceId,
          conversationId: msg.conversationId,
          meta: { messageId },
        },
      });
    }
  });
  // «بحث بالمعنى»: a deleted message loses its vector
  queueSync(ctx.orgId, "message", messageId);
}

/**
 * C1.1: a message was just deleted in `tx`. When it was the newest one of its conversation (or the column was never
 * filled), `lastMessageAt` falls back to the newest message that is still there (NULL when none is), in the same
 * transaction. The write only lands if nobody moved the column in between (a message sent meanwhile is newer than
 * anything computed here), and it keeps `updatedAt`: deleting a message must not reorder the list.
 */
async function recomputeLastMessageAt(tx: Prisma.TransactionClient, conversationId: string, deletedCreatedAt: Date): Promise<void> {
  const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { lastMessageAt: true, updatedAt: true } });
  if (!conv || (conv.lastMessageAt !== null && conv.lastMessageAt > deletedCreatedAt)) return;
  const newest = await tx.chatMessage.aggregate({ where: { conversationId, deletedAt: null }, _max: { createdAt: true } });
  await tx.conversation.updateMany({
    where: { id: conversationId, lastMessageAt: conv.lastMessageAt },
    data: { lastMessageAt: newest._max.createdAt, updatedAt: conv.updatedAt },
  });
}

// ---------- reactions ----------

export const reactSchema = z.object({ emoji: z.string().min(1).max(16) });

export async function toggleReact(ctx: OrgAccessContext, messageId: string, input: z.infer<typeof reactSchema>): Promise<{ mine: boolean }> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { select: { id: true, orgId: true, spaceId: true } } } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  // a reaction would break the silent reading of whoever holds oversight: he joins first
  if (hasOversight(org) && !facts.viewerIsMember) throw new ForbiddenError("chat.e.join_first");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  if (!isSingleEmoji(input.emoji)) throw new ValidationError([{ path: "emoji", message: "chat.e.bad_reaction" }]);
  // the ✅ is «قرأت ✓» (Q1.6, written only by its own door): the reaction bar never writes it, so it counts for nobody by accident
  if (input.emoji === "✅") throw new ValidationError([{ path: "emoji", message: "chat.e.reserved_reaction" }]);

  const distinct = await db.chatReaction.findMany({ where: { messageId }, select: { emoji: true }, distinct: ["emoji"] });
  const existing = await db.chatReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: ctx.userId, emoji: input.emoji } },
  });

  await db.$transaction(async (tx) => {
    if (existing) {
      await tx.chatReaction.delete({ where: { id: existing.id } });
    } else {
      if (distinct.length >= 12 && !distinct.some((d) => d.emoji === input.emoji)) {
        throw new ForbiddenError("chat.e.too_many_reactions");
      }
      await tx.chatReaction.create({ data: { messageId, userId: ctx.userId, emoji: input.emoji } });
    }
    await emitRealtime(tx, ctx.orgId, "message.reacted", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
  });
  return { mine: !existing };
}

// ---------- pin ----------

export async function togglePin(ctx: OrgAccessContext, messageId: string): Promise<{ pinned: boolean }> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { select: { id: true, orgId: true, kind: true, spaceId: true } } } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  // a pin writes a line everybody sees: whoever reads in oversight joins first, like a reaction
  if (hasOversight(org) && !facts.viewerIsMember) throw new ForbiddenError("chat.e.join_first");
  // topics: space admins (or the owner); DMs: either participant
  const mayPin = facts.kind === "DM" ? facts.viewerIsMember : canModerate(facts, org);
  if (!mayPin) throw new ForbiddenError("chat.e.pin_denied");
  if (msg.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");

  const next = !msg.pinned;
  await db.$transaction(async (tx) => {
    await tx.chatMessage.update({ where: { id: messageId }, data: { pinned: next } });
    await emitRealtime(tx, ctx.orgId, "message.pinned", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
    // pinning (and unpinning) is a system message, so the whole audience sees the moment (live too)
    await writeSystemMessage(tx, {
      orgId: ctx.orgId,
      conversationId: msg.conversationId,
      authorId: ctx.userId,
      k: next ? "pin" : "unpin",
      p: { by: ctx.userId },
      spaceId: facts.spaceId,
    });
  });
  return { pinned: next };
}

// ---------- notes ----------

export const noteSchema = z.object({ body: z.string().trim().min(1, "chat.e.empty").max(2000) });

export async function addNote(ctx: OrgAccessContext, messageId: string, input: z.infer<typeof noteSchema>): Promise<void> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { select: { id: true, orgId: true } } } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canModerate(facts, org)) throw new ForbiddenError("chat.e.moderator_only");
  await db.messageNote.create({ data: { messageId, authorId: ctx.userId, body: input.body } });
}

// ---------- forward ----------

export const forwardSchema = z.object({ conversationId: z.string().min(1) });

export async function forwardMessage(ctx: OrgAccessContext, messageId: string, input: z.infer<typeof forwardSchema>): Promise<{ id: string }> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { select: { id: true, orgId: true } } } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  if (msg.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");
  if (msg.kind === "POLL") throw new ForbiddenError("chat.e.poll_immutable"); // a copy would carry no votes
  const from = await guard(ctx, msg.conversationId);
  const to = await guard(ctx, input.conversationId);
  // the target must be readable AND postable by the viewer; the source must be readable
  if (!canRead(from.facts, from.org)) throw new NotFoundError("chat.e.not_found");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  if (!canPost(to.facts, to.org, { ownerJoined: to.facts.viewerIsMember })) throw new ForbiddenError("chat.e.post_denied");

  const created = await db.$transaction(async (tx) => {
    const copy = await tx.chatMessage.create({
      data: {
        orgId: ctx.orgId,
        conversationId: input.conversationId,
        authorId: ctx.userId,
        body: msg.body,
        kind: msg.kind,
        // a forwarded card is resolved again for its new readers
        ...(msg.card ? { card: msg.card as Prisma.InputJsonValue } : {}),
        forwardedFromId: msg.id,
      },
      include: messageInclude(),
    });
    // attachments: the same files linked again from the new message
    const links = await tx.messageAttachment.findMany({ where: { messageId: msg.id }, orderBy: { position: "asc" } });
    if (links.length) {
      await tx.messageAttachment.createMany({
        data: links.map((l) => ({
          messageId: copy.id,
          fileId: l.fileId,
          kind: l.kind,
          width: l.width,
          height: l.height,
          durationMs: l.durationMs,
          peaks: l.peaks as never,
          position: l.position,
        })),
      });
    }
    await tx.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
    // C1.8: the target's list time moves with the copy, in this transaction (it never goes backwards)
    await moveLastMessageAt(tx, input.conversationId, copy.createdAt);
    await emitRealtime(tx, ctx.orgId, "message.created", {
      conversationId: input.conversationId,
      messageId: copy.id,
      spaceId: to.facts.spaceId ?? undefined,
    });
    return copy;
  });
  return { id: created.id };
}

// ---------- read / delivered ----------

/**
 * Never backwards: lastReadAt only moves forward.
 *
 * - The OWNER's reading is silent, always: in oversight nothing is written at all; where he joined,
 *   his mark is kept for his own unread counts only and emits nothing (nobody's ticks or reader
 *   avatars ever show him; `dmStatusFor` and `readersOf` leave him out).
 * - A space person reading an open topic they have no row in (the company's topics, every topic
 *   before they wrote in it) gets their row here, instead of a 404 that kept their count stuck.
 */
export async function markRead(ctx: OrgAccessContext, conversationId: string, upToMessageId?: string): Promise<{ ok: boolean }> {
  const { facts, org } = await guard(ctx, conversationId);
  const isOwner = hasOversight(org);
  if (isOwner && !facts.viewerIsMember) {
    // oversight: 204 and nothing written — no read mark, no event, nothing
    return { ok: true };
  }
  const openTopicReader = !facts.viewerIsMember && facts.kind === "TOPIC" && !facts.restricted && canRead(facts, org);
  if (!facts.viewerIsMember && !openTopicReader) throw new NotFoundError("chat.e.not_found");
  let when = new Date();
  if (upToMessageId) {
    const target = await db.chatMessage.findFirst({ where: { id: upToMessageId, conversationId }, select: { createdAt: true } });
    if (!target) throw new NotFoundError("chat.e.not_found");
    when = target.createdAt;
  }
  const member = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: ctx.userId } },
    select: { lastReadAt: true },
  });
  if (member && member.lastReadAt >= when) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId: ctx.userId } },
      create: { conversationId, userId: ctx.userId, lastReadAt: when },
      update: { lastReadAt: when },
    });
    if (!isOwner) {
      await emitRealtime(tx, ctx.orgId, "conversation.read", { conversationId, userId: ctx.userId, spaceId: facts.spaceId ?? undefined });
    }
  });
  return { ok: true };
}

export async function markDelivered(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const { facts } = await guard(ctx, conversationId);
  if (facts.kind !== "DM" || !facts.viewerIsMember) throw new NotFoundError("chat.e.not_found");
  // C1.8: a delivery mark is a delta — it is written (and sent to the other person's screen) only when the other person has written
  // something newer than the last mark; a repeat of the same call changes nothing and emits nothing
  await markDeliveredForUser(ctx.userId, conversationId);
}

// ---------- reads for presentation ----------

/** The include every message query uses, so presentMessage always has what it needs. */
export function messageInclude() {
  return {
    author: { select: { id: true, name: true, avatarUrl: true } },
    deletedBy: { select: { name: true } },
    replyTo: { select: { id: true, body: true, deletedAt: true, author: { select: { name: true } } } },
    forwardedFrom: { select: { author: { select: { name: true } } } },
    reactions: { select: { emoji: true, userId: true } },
    attachments: {
      orderBy: { position: "asc" as const },
      include: { file: { select: { id: true, name: true, mimeType: true, size: true } } },
    },
    revisions: { orderBy: { createdAt: "asc" as const } },
    notes: { orderBy: { createdAt: "asc" as const }, include: { author: { select: { name: true } } } },
    tasks: { select: { id: true, visibility: true, creatorId: true, assigneeId: true } },
    tickets: { select: { id: true, number: true, status: true, assignee: { select: { name: true } } } },
    poll: { include: pollInclude },
  } satisfies Prisma.ChatMessageInclude;
}

/** DM ticks for one of MY messages, from the other person's marks. */
export function dmStatusFor(
  otherMember: { lastDeliveredAt: Date | null; lastReadAt: Date | null } | null,
  at: Date,
): "sent" | "delivered" | "read" {
  if (otherMember?.lastReadAt && otherMember.lastReadAt >= at) return "read";
  if (otherMember?.lastDeliveredAt && otherMember.lastDeliveredAt >= at) return "delivered";
  return "sent";
}

/** Presentation helper for lists: the preview text, deleted excluded. */
export { previewOf };
