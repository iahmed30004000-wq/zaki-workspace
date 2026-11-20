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
import { checklistCreateData, checklistInclude, checklistInputSchema, cleanChecklistItems, CHECKLIST_KIND, isBlankText, MAX_CHECKLIST_TITLE } from "@/lib/chat/checklist";
import { notifyMessageToAudience, notifyCandidates, readersAmong, rewriteMessagePreviews, topicAudienceIds, DELETED_PREVIEW } from "@/server/chat/notify";
import { ASSISTANT_MENTION_ID, MENTION_ALL_ID, mentionsAll } from "@/lib/chat/conversation/mentions";
import { afterMessageSent } from "@/server/services/chat-assistant";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { queueSync } from "@/server/services/search-embed-index";
import { applyAutoTicketRules } from "@/server/services/problem-tickets";
import { canMark } from "@/server/chat/must-read-policy";
import { assertLinkPreviewsOn, detachPreview, linkPreviewAfterSend, linkPreviewsOn, previewUrlOf } from "@/server/chat/link-preview";
import { openStored } from "@/server/services/files";
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
    // «قائمة مهام» (C3c.1): the title is the body; 1-30 items; never with files, a voice note or a poll
    checklist: checklistInputSchema.optional(),
    // «لا معاينة» (C3b.2): the sender took the card off in the composer: the server does not visit the link
    noPreview: z.boolean().optional(),
    // «ابعت بدون صوت» (C3c.2): no bell, no push, no arrival sound for this message (it still counts as unread); ignored while the company's `chatSilentSend` switch is off
    silent: z.boolean().optional(),
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
    canPost: canPost(facts, org, { ownerJoined: facts.viewerIsMember }),
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

  // a checklist: where the company's switch is on, not for a guest (he reads the list, never writes one), with a title and 1-30 items, alone in its message
  let checklistItems: string[] | null = null;
  if (input.checklist) {
    await assertFeatureOn(ctx.orgId, "chatChecklists");
    if (org.role === "GUEST") throw new ForbiddenError("chat.e.checklist_guest");
    // (the silent eye never gets here: `canPost` above refuses him until he has joined, like for a poll)
    if (attachments.length > 0 || input.voice === true || input.poll || internal.card) throw new ValidationError([{ path: "checklist", message: "chat.e.checklist_alone" }]);
    if (isBlankText(body) || [...body].length > MAX_CHECKLIST_TITLE) throw new ValidationError([{ path: "body", message: "chat.e.checklist_title" }]);
    checklistItems = cleanChecklistItems(input.checklist.items);
    if (!checklistItems) throw new ValidationError([{ path: "checklist.items", message: "chat.e.checklist_items" }]);
  }

  // «لازم ينقرأ»: only where the switch is on, in a topic, for somebody who may mark a message; a plain member's flag is refused, never dropped silently
  let mustRead = false;
  if (input.mustRead === true) {
    if (!(await isFeatureOn(ctx.orgId, "mustRead")) || internal.card || input.poll || input.checklist || input.voice === true || !(await canMark(ctx, facts, org))) throw new ForbiddenError("chat.e.must_read_denied");
    mustRead = true;
  }

  // a card stands alone: no files, no voice, no poll
  if (internal.card && (attachments.length > 0 || input.voice === true || input.poll)) throw new ValidationError([{ path: "card", message: "chat.e.card_alone" }]);
  const kind = internal.card ? "CARD" : input.poll ? "POLL" : input.checklist ? "CHECKLIST" : input.voice === true && isVoice ? "VOICE" : "TEXT";

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

  // «معاينة الرابط»: whether the company has the switch on (it decides the fetch AND whether the answer carries a card)
  const previewsOn = await linkPreviewsOn(ctx.orgId);

  // idempotent send: the same clientId of the same author returns the same message
  if (input.clientId) {
    const existing = await db.chatMessage.findUnique({
      where: { authorId_clientId: { authorId: ctx.userId, clientId: input.clientId } },
      include: messageInclude(),
    });
    if (existing) {
      // a retry is the SAME message: it stays silent whatever the retry's own flag says (a copy that lost the flag must not make it loud)
      return withSilent(presentMessage(existing, { ...withViewer(viewerOf(facts, org), ctx.userId), linkPreviews: previewsOn }), existing.silent);
    }
  }
  // «ابعت بدون صوت»: honoured only while the company's switch is on (off: an ordinary message)
  const silent = input.silent === true && (await isFeatureOn(ctx.orgId, "chatSilentSend"));

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
        ...(silent ? { silent: true } : {}),
        ...(mustRead ? { ackRequired: true, ackMeta: { markedAt: new Date().toISOString() } } : {}),
        ...(videoAtSec !== null ? { videoAtSec } : {}),
        ...(internal.card ? { card: internal.card as unknown as Prisma.InputJsonValue } : {}),
        ...(input.poll && pollOptions ? { poll: { create: pollCreateData(input.poll, pollOptions) } } : {}),
        ...(input.checklist && checklistItems ? { checklist: { create: checklistCreateData(input.checklist, checklistItems, ctx.userId) } } : {}),
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
  const dto = withSilent(presentMessage(created, { ...withViewer(viewerOf(facts, org), ctx.userId), linkPreviews: previewsOn }, facts.kind === "DM" ? "sent" : undefined), silent);
  // C1.8: the answer goes back as soon as the commit is done. The bell and the push (and the company's auto-ticket rules) run AFTER it: the
  // sender's ✓ never waits for them, and a failure there is logged with its step (never swallowed) and never fails the send.
  const after: AfterSendStep[] = [{ step: "notify", run: () => notifyAfterSend(ctx, facts, conversationId, mentionIds, allIds, input.replyToId ?? null, dto) }];
  // «المشاكل تصير تذاكر»: the rules of the company, after the message is stored (a failure there never stops a message)
  if (kind === "TEXT" && !internal.card) {
    after.push({ step: "auto_tickets", run: () => applyAutoTicketRules(ctx, { id: created.id, body, conversationId }, { spaceId: facts.spaceId ?? null, kind: facts.kind, restricted: Boolean(facts.restricted), teamId: facts.teamId ?? null }) });
  }
  // «معاينة الرابط»: LAST of the steps (it waits for another company's web server, up to 3 seconds: the bell and the rules never wait for it). ⚠️ The server visits the
  // link. Only a plain text message, only while the switch is on, never when the sender took the card off; a failure is logged and the message is untouched.
  if (kind === "TEXT" && !internal.card && previewsOn && input.noPreview !== true && previewUrlOf(body) !== null) {
    after.push({ step: "link_preview", run: () => linkPreviewAfterSend(ctx, { messageId: created.id, conversationId, spaceId: facts.spaceId ?? null, body }) });
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

/** C3c.2: the answer says `silent: true` for a silent message (the presenter is `redact.ts`'s; this keeps the sender's own answer and a retry's honest). */
function withSilent(dto: MessageDto, silent: boolean): MessageDto {
  return silent ? { ...dto, silent: true } : dto;
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
    ...(dto.silent === true ? { silent: true } : {}),
    // the WHOLE body: `notify.ts` strips the markers and then cuts (a bold run is never cut inside its markers)
    preview: dto.body ? dto.body : "أرسل مرفقًا",
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
    include: { conversation: { select: { id: true, orgId: true } }, preview: { select: { url: true } } },
  });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  if (msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (msg.authorId !== ctx.userId) throw new ForbiddenError("chat.e.not_author"); // only the author edits
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  if (msg.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");
  if (msg.kind === "POLL") throw new ForbiddenError("chat.e.poll_immutable"); // people voted on these words
  if (msg.kind === "CARD") throw new ForbiddenError("chat.e.card_immutable"); // its words are the card's name
  // a checklist's words are its TITLE: the rule of the send holds for an edit too (a title, at most 200 characters)
  if (msg.kind === CHECKLIST_KIND && (isBlankText(input.body) || [...input.body].length > MAX_CHECKLIST_TITLE)) throw new ValidationError([{ path: "body", message: "chat.e.checklist_title" }]);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");

  const updated = await db.$transaction(async (tx) => {
    // the text BEFORE the edit goes into the history, in the same transaction
    await tx.messageRevision.create({ data: { messageId, body: msg.body, editorId: ctx.userId } });
    // «معاينة الرابط»: the card follows the words — when the edit changed the first link (or took it away), the card of the old one goes. A new link is NOT visited on an edit.
    const cardStays = msg.preview !== null && previewUrlOf(input.body) === msg.preview.url;
    const m = await tx.chatMessage.update({ where: { id: messageId }, data: { body: input.body, editedAt: new Date(), ...(msg.preview !== null && !cardStays ? { previewId: null } : {}) }, include: messageInclude() });
    // a bell that showed the old words shows the new ones
    await rewriteMessagePreviews(tx, msg.conversationId, messageId, input.body);
    await emitRealtime(tx, ctx.orgId, "message.edited", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
    return m;
  });
  // «بحث بالمعنى»: the vector follows the new words
  queueSync(ctx.orgId, "message", messageId);
  return presentMessage(updated, { ...withViewer(viewerOf(facts, org), ctx.userId), linkPreviews: await linkPreviewsOn(ctx.orgId) });
}

// ---------- delete ----------

export async function deleteMessage(ctx: OrgAccessContext, messageId: string): Promise<void> {
  const msg = await db.chatMessage.findUnique({
    where: { id: messageId },
    include: { conversation: { select: { id: true, orgId: true, spaceId: true } } },
  });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  await deleteLoaded(ctx, msg, await guard(ctx, msg.conversationId));
}

/** The rest of `deleteMessage` once the message and the conversation's facts are loaded (the batch loads them once for many ids). The rule is written here and nowhere else. */
async function deleteLoaded(
  ctx: OrgAccessContext,
  msg: { id: string; orgId: string; conversationId: string; authorId: string; createdAt: Date; deletedAt: Date | null },
  { facts, org }: Awaited<ReturnType<typeof guard>>,
): Promise<void> {
  const messageId = msg.id;
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

type MessageLinks = { fileId: string; kind: string; width: number | null; height: number | null; durationMs: number | null; peaks: Prisma.JsonValue | null; position: number }[];

/**
 * ONE copy of a message in a conversation, written by the person who forwards (the ONE implementation: `forwardMessage` and the batch `forwardMessages` both call it).
 * The copy keeps the words, the kind and the card (a card is resolved again for its new readers) and links the same files again; `forwardedFromId` points at the original
 * unless `withoutAuthor` (C3b.5: «بدون اسم المرسل») leaves it out.
 */
async function copyForward(
  tx: Prisma.TransactionClient,
  ctx: OrgAccessContext,
  msg: { id: string; body: string; kind: string; card: Prisma.JsonValue | null },
  links: MessageLinks,
  conversationId: string,
  opts: { createdAt?: Date; withoutAuthor?: boolean } = {},
): Promise<{ id: string; createdAt: Date }> {
  const copy = await tx.chatMessage.create({
    data: {
      orgId: ctx.orgId,
      conversationId,
      authorId: ctx.userId,
      body: msg.body,
      kind: msg.kind,
      ...(msg.card ? { card: msg.card as Prisma.InputJsonValue } : {}),
      ...(opts.withoutAuthor ? {} : { forwardedFromId: msg.id }),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
    select: { id: true, createdAt: true },
  });
  // attachments: the same files linked again from the new message
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
  return copy;
}

export async function forwardMessage(ctx: OrgAccessContext, messageId: string, input: z.infer<typeof forwardSchema>): Promise<{ id: string }> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { select: { id: true, orgId: true } } } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  if (msg.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");
  if (msg.kind === "POLL") throw new ForbiddenError("chat.e.poll_immutable"); // a copy would carry no votes
  if (msg.kind === "CHECKLIST") throw new ForbiddenError("chat.e.checklist_immutable"); // a copy would carry no items
  const from = await guard(ctx, msg.conversationId);
  const to = await guard(ctx, input.conversationId);
  // the target must be readable AND postable by the viewer; the source must be readable
  if (!canRead(from.facts, from.org)) throw new NotFoundError("chat.e.not_found");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  if (!canPost(to.facts, to.org, { ownerJoined: to.facts.viewerIsMember })) throw new ForbiddenError("chat.e.post_denied");

  const created = await db.$transaction(async (tx) => {
    const links = await tx.messageAttachment.findMany({ where: { messageId: msg.id }, orderBy: { position: "asc" } });
    const copy = await copyForward(tx, ctx, msg, links, input.conversationId);
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

// ---------- many at once (C3b.5: «حدّد») ----------
// Forwarding and deleting a selection reuse the single rules message by message (`copyForward` and `deleteLoaded`, the very code `forwardMessage` and `deleteMessage` run): the
// batch adds only the caps, a quota, the report per target / per id and the one oversight rule. The company's switch `chatMultiSelect` is the DOOR's to check
// (`assertFeatureOn`), before anything is read.

/** At most this many messages in one request, and this many conversations to forward them to. */
export const MULTI_MAX_MESSAGES = 100;
export const MULTI_MAX_TARGETS = 10;
/** A batch can write 1000 messages: a person gets 20 of each kind a minute (the single send has its own 30). A request refused before it writes costs nothing. */
const forwardLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 });
const deleteLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 });
function checkQuota(limiter: FixedWindowLimiter, userId: string): void {
  const state = limiter.check(`chat.bulk.${userId}`);
  if (!state.ok) throw new RateLimitedError(state.retryAfterSec, "chat.e.rate_limited");
}

const idShape = z.string().min(1).max(100);
export const forwardManySchema = z.object({
  messageIds: z.array(idShape).min(1).max(MULTI_MAX_MESSAGES),
  targetIds: z.array(idShape).min(1).max(MULTI_MAX_TARGETS),
  /** «بدون اسم المرسل»: the copies carry no link to the original */
  withoutAuthor: z.boolean().optional(),
});
export const deleteManySchema = z.object({ ids: z.array(idShape).min(1).max(MULTI_MAX_MESSAGES) });

export type ForwardManyResult = { targetId: string; ok: true; ids: string[] } | { targetId: string; ok: false; error: string };
export type DeleteManyResult = { id: string; ok: true } | { id: string; ok: false; error: string };

/** Every target that refuses says the same words, whether it does not exist, may not be read or may not be written in: the report must not tell which. */
const TARGET_REFUSED = "chat.e.post_denied";
const FORWARD_FAILED = "chatsel.fwd.failed";
const DELETE_FAILED = "chatsel.del.failed";
const NOT_FOUND = "chat.e.not_found";

type Held = Awaited<ReturnType<typeof guard>>;

/** The facts of a SOURCE conversation, once per conversation. A conversation that is not the person's to know about (unknown, or a guest's no-go) is simply «not found». */
async function sourceFacts(ctx: OrgAccessContext, cache: Map<string, Held>, conversationId: string): Promise<Held> {
  const held = cache.get(conversationId);
  if (held) return held;
  try {
    const loaded = await guard(ctx, conversationId);
    cache.set(conversationId, loaded);
    return loaded;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) throw new NotFoundError(NOT_FOUND);
    throw err;
  }
}

/**
 * «حوّل» for a selection. The WHOLE request is refused (nothing is written anywhere) when a message cannot be forwarded the way forwarding one cannot: not found or not
 * readable (404, the same words for both), a deleted message, a poll, a system line (403). Then, for each target in turn: the target's own rule (I may write there —
 * `canPost`, the same as forwarding one) and ONE transaction that writes every copy in the conversation's order, a millisecond apart in the clock so the order is kept;
 * a target that refuses or fails is reported alone and the others still get their copies. Up to 1000 copies in one request: it is bounded by the caps and the quota.
 */
export async function forwardMessages(ctx: OrgAccessContext, input: z.infer<typeof forwardManySchema>): Promise<{ results: ForwardManyResult[] }> {
  const ids = [...new Set(input.messageIds)];
  const targetIds = [...new Set(input.targetIds)];
  checkQuota(forwardLimiter, ctx.userId);

  const rows = await db.chatMessage.findMany({ where: { id: { in: ids }, orgId: ctx.orgId }, include: { attachments: { orderBy: { position: "asc" } } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sources = new Map<string, Held>();
  for (const id of ids) {
    const msg = byId.get(id);
    if (!msg) throw new NotFoundError(NOT_FOUND);
    const from = await sourceFacts(ctx, sources, msg.conversationId);
    // readable first: what kind of message a person may not read is not theirs to learn
    if (!canRead(from.facts, from.org)) throw new NotFoundError(NOT_FOUND);
    if (msg.kind === "SYSTEM") throw new ForbiddenError("chat.e.system_immutable");
    if (msg.kind === "POLL") throw new ForbiddenError("chat.e.poll_immutable"); // a copy would carry no votes
    if (msg.kind === "CHECKLIST") throw new ForbiddenError("chat.e.checklist_immutable"); // a copy would carry no items
    if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  }
  forwardLimiter.hit(`chat.bulk.${ctx.userId}`);
  const ordered = rows.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));

  const results: ForwardManyResult[] = [];
  for (const targetId of targetIds) {
    try {
      const to = await guard(ctx, targetId);
      if (!canPost(to.facts, to.org, { ownerJoined: to.facts.viewerIsMember })) throw new ForbiddenError(TARGET_REFUSED);
      const copies = await db.$transaction(
        async (tx) => {
          const base = Date.now();
          const made: { id: string; createdAt: Date }[] = [];
          for (const [i, msg] of ordered.entries()) {
            made.push(await copyForward(tx, ctx, msg, msg.attachments, targetId, { createdAt: new Date(base + i), withoutAuthor: input.withoutAuthor === true }));
          }
          await tx.conversation.update({ where: { id: targetId }, data: { updatedAt: new Date() } });
          // C1.8: the target's list time moves with the newest copy, in this transaction (it never goes backwards)
          await moveLastMessageAt(tx, targetId, made[made.length - 1]!.createdAt);
          for (const copy of made) {
            await emitRealtime(tx, ctx.orgId, "message.created", { conversationId: targetId, messageId: copy.id, spaceId: to.facts.spaceId ?? undefined });
          }
          return made;
        },
        { timeout: 30_000, maxWait: 5_000 },
      );
      results.push({ targetId, ok: true, ids: copies.map((c) => c.id) });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof ForbiddenError) results.push({ targetId, ok: false, error: TARGET_REFUSED });
      else {
        log.error("chat.forward_many_failed", { err: err instanceof Error ? err.message : String(err), targetId, userId: ctx.userId });
        results.push({ targetId, ok: false, error: FORWARD_FAILED });
      }
    }
  }
  return { results };
}

/**
 * «احذف» for a selection: the single rule per id, in turn (`deleteLoaded`: own, or a moderator's; each audited as before), with the messages and each conversation's facts
 * loaded once. A message the person may not read (and did not write) is «not found», the same words as an id that does not exist. A person who only READS through silent
 * oversight (the owner not joined to the conversation) deletes nothing here: every such id is refused and NOTHING is written, not even an audit line — no trace. An id
 * that is of another company, already deleted or not mine to delete is reported on its own and the rest still go.
 */
export async function deleteMessages(ctx: OrgAccessContext, input: z.infer<typeof deleteManySchema>): Promise<{ results: DeleteManyResult[] }> {
  const ids = [...new Set(input.ids)];
  checkQuota(deleteLimiter, ctx.userId);
  deleteLimiter.hit(`chat.bulk.${ctx.userId}`);
  const rows = await db.chatMessage.findMany({ where: { id: { in: ids }, orgId: ctx.orgId }, select: { id: true, orgId: true, conversationId: true, authorId: true, createdAt: true, deletedAt: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const facts = new Map<string, Held>();
  const results: DeleteManyResult[] = [];
  for (const id of ids) {
    try {
      const msg = byId.get(id);
      if (!msg) throw new NotFoundError(NOT_FOUND);
      const held = await sourceFacts(ctx, facts, msg.conversationId);
      // somebody else's message in a conversation I cannot read does not exist for me
      if (msg.authorId !== ctx.userId && !canRead(held.facts, held.org)) throw new NotFoundError(NOT_FOUND);
      if (hasOversight(held.org) && !held.facts.viewerIsMember) throw new ForbiddenError("chat.e.delete_denied");
      await deleteLoaded(ctx, msg, held);
      results.push({ id, ok: true });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof ForbiddenError) results.push({ id, ok: false, error: err.message });
      else {
        log.error("chat.delete_many_failed", { err: err instanceof Error ? err.message : String(err), messageId: id, userId: ctx.userId });
        results.push({ id, ok: false, error: DELETE_FAILED });
      }
    }
  }
  return { results };
}

// ---------- link preview (C3b.2) ----------

/**
 * «شيل المعاينة»: the AUTHOR takes the card off their own message (nobody else: not a moderator, not the owner). The message keeps its words and is not marked
 * edited; the other screens are told (`message.enriched`, ids only). A message with no card answers `removed: false`. Switch off: 404.
 */
export async function removeLinkPreview(ctx: OrgAccessContext, messageId: string): Promise<{ removed: boolean }> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, orgId: true, conversationId: true, authorId: true, deletedAt: true } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  await assertLinkPreviewsOn(ctx.orgId);
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (msg.authorId !== ctx.userId) throw new ForbiddenError("chat.e.not_author");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");
  return { removed: await detachPreview(ctx.orgId, { id: msg.id, conversationId: msg.conversationId, spaceId: facts.spaceId ?? null }) };
}

/**
 * The picture of a message's card, opened for streaming — ONLY for somebody who may read the conversation and only while the message is not deleted (for everybody:
 * the owner's original of a deleted message carries no card). The bytes come from the app's own storage (the server's disk, or proxied from Drive): never the
 * site's address and never a Drive link. Anything else is 404, never 403.
 */
export async function openPreviewImage(ctx: OrgAccessContext, messageId: string) {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, select: { orgId: true, conversationId: true, deletedAt: true, preview: { select: { status: true, imageFileId: true } } } });
  if (!msg || msg.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  await assertLinkPreviewsOn(ctx.orgId);
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (msg.deletedAt || msg.preview?.status !== "OK" || !msg.preview.imageFileId) throw new NotFoundError("chat.e.not_found");
  return openStored(ctx.orgId, msg.preview.imageFileId);
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
    // «قائمة مهام» (C3c.1): the list of a CHECKLIST message (presented per viewer in redact.ts)
    checklist: { include: checklistInclude },
    // «معاينة الرابط» (C3b.2): the card of the message's first link (presented per viewer in redact.ts)
    preview: { select: { url: true, title: true, description: true, siteName: true, imageFileId: true, status: true } },
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
