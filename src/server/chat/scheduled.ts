import { randomUUID } from "node:crypto";
import { Prisma, type ScheduledChatMessage } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canPost, canRead } from "@/server/policy/conversation";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/server/chat/attachments";
import { guard, sendMessage, type SendInput } from "@/server/chat/messages";
import type { MessageDto } from "@/server/chat/dto";
import { MENTION_ALL_ID } from "@/lib/chat/conversation/mentions";
import { AR } from "@/lib/i18n/dict";
import { resolveTimeZone } from "@/lib/zoned-time";
import { pushNotificationInTx } from "@/server/notify";
import { assertFeatureOn } from "@/server/services/features";
import { PENDING_PATH } from "@/server/services/files";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import { log } from "@/server/log";

/**
 * C3c.3 — «جدول الإرسال»: a message its author wrote now and wants sent later.
 *
 * WHY A TABLE OF ITS OWN (the plan's trap): a message dated in the future inside `ChatMessage` would need a «not yet» filter in every reader (about sixty queries), and one
 * forgotten filter is a leak. So `ScheduledChatMessage` is read by NOTHING but this file, and every read here is `authorId = the caller`: only the author ever sees a row.
 *
 * AT ITS TIME the job (src/server/jobs/chat-scheduled.ts) calls `deliverScheduled`, which sends the row through the NORMAL `sendMessage` AS the author. `sendMessage` checks
 * `canRead` and `canPost` again at that moment, so a person who lost access (left the space, was muted, the topic closed, the chat's other person went) sends nothing: the row is
 * FAILED and the author is told by a bell note to themselves, never a half-send. The message is sent with the clientId `sch:<row id>`: a second run, a retry after a crash
 * between the send and the mark, or «ابعت هلّق» racing the job all find the SAME message and never make a second one. A row is claimed with `SELECT ... FOR UPDATE SKIP LOCKED`.
 *
 * Privacy: the words of a row that was sent or cancelled are blanked (they live on in the message; a cancelled draft is nobody's business); the failure note carries no words of the
 * message and no title of the conversation (the person may have lost access to it), and no link.
 */

/** At least a minute ahead, at most a year (the spec). The composer's dialog repeats both numbers; a test pins that they agree. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;
export const SCHEDULE_MAX_DAYS = 365;
/** A person keeps at most this many rows waiting (a guard against a runaway client; nothing in the spec). */
export const MAX_PENDING_PER_AUTHOR = 100;
/** A row more than this late when the job reaches it (the app was down, or the switch was off for days) is not sent: a message that old would be a surprise. FAILED, and the author is told. */
export const MAX_LATE_MS = 24 * 60 * 60 * 1000;
/** A chat upload that is not attached to a message is deleted after 24 hours (`purgeOrphanUploads`) and cannot be claimed after that (`claimUploads`): a scheduled message with files must go out before. */
const UPLOAD_LIFE_MS = 24 * 60 * 60 * 1000;
const UPLOAD_MARGIN_MS = 10 * 60 * 1000;
/** A scheduled message with files must go out within this long of the files' upload (the dialog repeats it: a test pins that they agree). */
export const FILES_WINDOW_MS = UPLOAD_LIFE_MS - UPLOAD_MARGIN_MS;
/** Finished rows are removed after this long (the job). */
export const KEEP_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 4000;

/** The clientId the message gets when the row is sent. */
export const messageClientIdOf = (rowId: string): string => `sch:${rowId}`;

const createLimiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000 });

// ---------- shapes ----------

const fields = {
  body: z.string().max(MAX_BODY).optional(),
  attachmentIds: z.array(z.string().min(1)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  mentions: z.array(z.string().min(1)).max(50).optional(),
  // «@الكل»: the same flag the send route has; stored among the mentions as «*»
  mentionAll: z.boolean().optional(),
  replyToId: z.string().min(1).max(64).nullable().optional(),
  silent: z.boolean().optional(),
  // «لا معاينة» (C3b.2): the ✕ on the link's card in the composer; kept on the row and honoured when it is sent
  noPreview: z.boolean().optional(),
  sendAt: z.string().datetime({ offset: true }),
};

export const scheduleSchema = z
  .object({ ...fields, clientId: z.string().min(1).max(48).optional() })
  .refine((v) => (v.body?.trim().length ?? 0) > 0 || (v.attachmentIds?.length ?? 0) > 0, { message: "chat.e.empty", path: ["body"] });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const scheduleUpdateSchema = z
  .object({ ...fields, sendAt: fields.sendAt.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "chat.sched.e.nothing_to_change", path: ["body"] });
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;

export interface ScheduledDto {
  id: string;
  conversationId: string;
  body: string;
  attachmentIds: string[];
  mentions: string[];
  mentionAll: boolean;
  replyToId: string | null;
  silent: boolean;
  noPreview: boolean;
  /** ISO instant */
  sendAt: string;
  status: "PENDING" | "FAILED";
  /** a `chat.*` dictionary key, set on a FAILED row */
  failReason: string | null;
  createdAt: string;
}

export interface ScheduledListDto {
  items: ScheduledDto[];
  /** the company's time zone: the dialog's date and time are read in it */
  timeZone: string;
  minLeadSec: number;
  maxDays: number;
  /** may the caller write in this conversation now (the menu entry is drawn only then) */
  canSchedule: boolean;
}

const asStrings = (json: unknown): string[] => (Array.isArray(json) ? json.filter((x): x is string => typeof x === "string") : []);

function toDto(row: Pick<ScheduledChatMessage, "id" | "conversationId" | "body" | "attachmentIds" | "mentions" | "replyToId" | "silent" | "noPreview" | "sendAt" | "status" | "failReason" | "createdAt">): ScheduledDto {
  const all = asStrings(row.mentions);
  return {
    id: row.id,
    conversationId: row.conversationId,
    body: row.body,
    attachmentIds: asStrings(row.attachmentIds),
    mentions: all.filter((id) => id !== MENTION_ALL_ID),
    mentionAll: all.includes(MENTION_ALL_ID),
    replyToId: row.replyToId,
    silent: row.silent,
    noPreview: row.noPreview,
    sendAt: row.sendAt.toISOString(),
    status: row.status === "FAILED" ? "FAILED" : "PENDING",
    failReason: row.failReason,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------- rules ----------

/** The key of what is wrong with the moment, or null. Pure. */
export function sendAtProblem(sendAt: Date, now: Date): string | null {
  if (Number.isNaN(sendAt.getTime())) return "chat.sched.e.bad_time";
  const lead = sendAt.getTime() - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) return "chat.sched.e.too_soon";
  if (lead > SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000) return "chat.sched.e.too_far";
  return null;
}

/**
 * Who may use scheduling in this conversation. Reading comes first (a person who may not read gets «not found», like any chat route); writing needs the same `canPost` the send has
 * (with the same «joined» rule: the silent eye, who has not joined, cannot post and so cannot schedule). The company's switch is checked first: off, everything is «not found».
 */
async function access(ctx: OrgAccessContext, conversationId: string, write: boolean) {
  await assertFeatureOn(ctx.orgId, "chatScheduled");
  const { facts, org } = await guard(ctx, conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  const may = canPost(facts, org, { ownerJoined: facts.viewerIsMember });
  if (write && !may) throw new ForbiddenError("chat.e.post_denied");
  return { facts, org, may };
}

/** Files must be the author's, uploaded, not attached anywhere, not held by another waiting row, and still alive when the row goes out. */
async function checkFiles(ctx: OrgAccessContext, ids: string[], sendAt: Date, selfId: string | null): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const files = await db.storedFile.findMany({
    where: { id: { in: unique }, orgId: ctx.orgId, uploaderId: ctx.userId, deletedAt: null, path: { not: PENDING_PATH }, purpose: "CHAT" },
    select: { id: true, createdAt: true },
  });
  if (files.length !== unique.length) throw new NotFoundError("chat.f.not_found");
  if ((await db.messageAttachment.count({ where: { fileId: { in: unique } } })) > 0) throw new ForbiddenError("chat.f.already_claimed");
  if ((await db.approvalAttachment.count({ where: { fileId: { in: unique } } })) > 0) throw new ForbiddenError("chat.f.already_claimed");
  const mine = await db.scheduledChatMessage.findMany({ where: { authorId: ctx.userId, status: "PENDING", ...(selfId ? { id: { not: selfId } } : {}) }, select: { attachmentIds: true } });
  const held = new Set(mine.flatMap((r) => asStrings(r.attachmentIds)));
  if (unique.some((id) => held.has(id))) throw new ForbiddenError("chat.f.already_claimed");
  const oldest = Math.min(...files.map((f) => f.createdAt.getTime()));
  if (sendAt.getTime() > oldest + FILES_WINDOW_MS) throw new ValidationError([{ path: "sendAt", message: "chat.sched.e.files_window" }]);
}

async function checkReply(conversationId: string, replyToId: string | null | undefined): Promise<void> {
  if (!replyToId) return;
  const parent = await db.chatMessage.findFirst({ where: { id: replyToId, conversationId }, select: { id: true } });
  if (!parent) throw new NotFoundError("chat.e.reply_not_found");
}

const isUniqueViolation = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

// ---------- the author's own routes ----------

/** The caller's own waiting (and failed) messages in one conversation, with what the dialog needs. */
export async function listScheduled(ctx: OrgAccessContext, conversationId: string): Promise<ScheduledListDto> {
  const { may } = await access(ctx, conversationId, false);
  const [rows, org] = await Promise.all([
    db.scheduledChatMessage.findMany({
      where: { conversationId, authorId: ctx.userId, orgId: ctx.orgId, status: { in: ["PENDING", "FAILED"] } },
      orderBy: [{ sendAt: "asc" }, { id: "asc" }],
    }),
    db.organization.findUnique({ where: { id: ctx.orgId }, select: { timezone: true } }),
  ]);
  return { items: rows.map(toDto), timeZone: resolveTimeZone(org?.timezone), minLeadSec: SCHEDULE_MIN_LEAD_MS / 1000, maxDays: SCHEDULE_MAX_DAYS, canSchedule: may };
}

export async function createScheduled(ctx: OrgAccessContext, conversationId: string, input: ScheduleInput, now: Date = new Date()): Promise<ScheduledDto> {
  await access(ctx, conversationId, true);
  // the same request again (a lost answer): the same row, never a second one
  if (input.clientId) {
    const existing = await db.scheduledChatMessage.findUnique({ where: { authorId_clientId: { authorId: ctx.userId, clientId: input.clientId } } });
    if (existing && existing.conversationId === conversationId && existing.orgId === ctx.orgId) return toDto(existing);
    if (existing) throw new ValidationError([{ path: "clientId", message: "chat.sched.e.client_id_used" }]);
  }
  // the quota counts rows that are really made: a request that fails its checks below costs nothing (a person fixing a time must not run out of tries)
  if (!createLimiter.check(`chat.sched.${ctx.userId}`).ok) throw new RateLimitedError(60, "chat.e.rate_limited");
  const sendAt = new Date(input.sendAt);
  const problem = sendAtProblem(sendAt, now);
  if (problem) throw new ValidationError([{ path: "sendAt", message: problem }]);
  const body = (input.body ?? "").trim();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (body.length === 0 && attachmentIds.length === 0) throw new ValidationError([{ path: "body", message: "chat.e.empty" }]);
  if ((await db.scheduledChatMessage.count({ where: { authorId: ctx.userId, status: "PENDING" } })) >= MAX_PENDING_PER_AUTHOR) {
    throw new ValidationError([{ path: "body", message: "chat.sched.e.too_many" }]);
  }
  await checkReply(conversationId, input.replyToId);
  await checkFiles(ctx, attachmentIds, sendAt, null);
  const clientId = input.clientId ?? `sc_${randomUUID()}`;
  createLimiter.hit(`chat.sched.${ctx.userId}`);
  const mentions = [...new Set(input.mentions ?? [])].filter((id) => id !== MENTION_ALL_ID);
  try {
    const row = await db.scheduledChatMessage.create({
      data: {
        orgId: ctx.orgId,
        conversationId,
        authorId: ctx.userId,
        body,
        attachmentIds,
        mentions: input.mentionAll === true ? [...mentions, MENTION_ALL_ID] : mentions,
        replyToId: input.replyToId ?? null,
        silent: input.silent === true,
        noPreview: input.noPreview === true,
        sendAt,
        clientId,
      },
    });
    return toDto(row);
  } catch (err) {
    // two requests with one clientId at the same moment: the loser answers with the winner's row
    if (isUniqueViolation(err)) {
      const existing = await db.scheduledChatMessage.findUnique({ where: { authorId_clientId: { authorId: ctx.userId, clientId } } });
      if (existing && existing.conversationId === conversationId) return toDto(existing);
    }
    throw err;
  }
}

/** The caller's own row, or «not found» (somebody else's row is not found: nobody learns that it exists). */
async function ownRow(ctx: OrgAccessContext, id: string): Promise<ScheduledChatMessage> {
  await assertFeatureOn(ctx.orgId, "chatScheduled");
  const row = await db.scheduledChatMessage.findFirst({ where: { id, authorId: ctx.userId, orgId: ctx.orgId } });
  if (!row) throw new NotFoundError("chat.e.not_found");
  return row;
}

export async function updateScheduled(ctx: OrgAccessContext, id: string, input: ScheduleUpdateInput, now: Date = new Date()): Promise<ScheduledDto> {
  const row = await ownRow(ctx, id);
  if (row.status !== "PENDING") throw new ValidationError([{ path: "status", message: "chat.sched.e.not_pending" }]);
  await access(ctx, row.conversationId, true);
  const sendAt = input.sendAt !== undefined ? new Date(input.sendAt) : row.sendAt;
  // a moment that is changed must be in the window; one that is left alone only has to still be ahead (the row may be a few seconds from going out)
  if (input.sendAt !== undefined) {
    const problem = sendAtProblem(sendAt, now);
    if (problem) throw new ValidationError([{ path: "sendAt", message: problem }]);
  } else if (sendAt.getTime() <= now.getTime()) {
    throw new ValidationError([{ path: "sendAt", message: "chat.sched.e.too_soon" }]);
  }
  const body = input.body !== undefined ? input.body.trim() : row.body;
  const attachmentIds = input.attachmentIds !== undefined ? [...new Set(input.attachmentIds)] : asStrings(row.attachmentIds);
  if (body.length === 0 && attachmentIds.length === 0) throw new ValidationError([{ path: "body", message: "chat.e.empty" }]);
  if (input.replyToId !== undefined) await checkReply(row.conversationId, input.replyToId);
  await checkFiles(ctx, attachmentIds, sendAt, row.id);
  const ids = input.mentions !== undefined ? [...new Set(input.mentions)].filter((m) => m !== MENTION_ALL_ID) : asStrings(row.mentions).filter((m) => m !== MENTION_ALL_ID);
  const all = input.mentionAll !== undefined ? input.mentionAll : asStrings(row.mentions).includes(MENTION_ALL_ID);
  // the job holds a row it is sending with a lock: this waits for it and then finds the row no longer PENDING (count 0)
  const done = await db.scheduledChatMessage.updateMany({
    where: { id: row.id, authorId: ctx.userId, status: "PENDING" },
    data: {
      body,
      attachmentIds,
      mentions: all ? [...ids, MENTION_ALL_ID] : ids,
      sendAt,
      ...(input.replyToId !== undefined ? { replyToId: input.replyToId } : {}),
      ...(input.silent !== undefined ? { silent: input.silent } : {}),
      ...(input.noPreview !== undefined ? { noPreview: input.noPreview } : {}),
    },
  });
  if (done.count === 0) throw new ValidationError([{ path: "status", message: "chat.sched.e.not_pending" }]);
  return toDto(await db.scheduledChatMessage.findUniqueOrThrow({ where: { id: row.id } }));
}

/** «احذف»: a waiting or failed row becomes CANCELLED and its words are blanked. Cancelling twice is fine; a row that was already sent cannot be cancelled. */
export async function cancelScheduled(ctx: OrgAccessContext, id: string): Promise<void> {
  const row = await ownRow(ctx, id);
  if (row.status === "CANCELLED") return;
  const done = await db.scheduledChatMessage.updateMany({
    where: { id: row.id, authorId: ctx.userId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "CANCELLED", body: "", attachmentIds: [], failReason: null },
  });
  if (done.count === 0) {
    const now = await db.scheduledChatMessage.findUnique({ where: { id: row.id }, select: { status: true } });
    if (now?.status === "CANCELLED") return;
    throw new ValidationError([{ path: "status", message: "chat.sched.e.not_pending" }]);
  }
}

/** «ابعت هلّق»: the row goes out now, through the same claim the job uses. A refusal (the person may no longer write there) is told to the person and leaves the row as it is. */
export async function sendScheduledNow(ctx: OrgAccessContext, id: string, now: Date = new Date()): Promise<MessageDto | null> {
  const row = await ownRow(ctx, id);
  if (row.status !== "PENDING") throw new ValidationError([{ path: "status", message: "chat.sched.e.not_pending" }]);
  const result = await deliverScheduled(row.id, now, "now");
  if (result.kind === "sent") return result.message;
  if (result.kind === "gone") {
    // the job sent it a moment before: the answer is the message it made
    const after = await db.scheduledChatMessage.findUnique({ where: { id: row.id }, select: { status: true } });
    if (after?.status === "SENT") return null;
    throw new ValidationError([{ path: "status", message: "chat.sched.e.not_pending" }]);
  }
  throw new RateLimitedError(60, "chat.e.rate_limited");
}

// ---------- the delivery (the job and «ابعت هلّق») ----------

export type DeliverResult =
  | { kind: "sent"; message: MessageDto | null }
  | { kind: "failed"; reason: string }
  | { kind: "later" }
  | { kind: "gone" };

interface Claimed {
  id: string;
  orgId: string;
  conversationId: string;
  authorId: string;
  body: string;
  attachmentIds: unknown;
  mentions: unknown;
  replyToId: string | null;
  silent: boolean;
  noPreview: boolean;
  sendAt: Date;
}

/** The reason key the author is shown for an error the send raised. */
function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("chat.")) return message;
  if (err instanceof ValidationError) {
    const keyed = err.issues.find((i) => i.message.startsWith("chat."));
    if (keyed) return keyed.message;
  }
  return "chat.sched.e.failed";
}

const isRefusal = (err: unknown): boolean => err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof ValidationError || err instanceof z.ZodError;

/** The words of the note a failed row leaves in the author's bell: no words of the message, no title, no link. */
function noteBodyOf(reason: string): string {
  if (reason === "chat.e.post_denied" || reason === "chat.e.not_found" || reason === "chat.guest_forbidden") return AR["chatsched.note.denied"] ?? "";
  if (reason === "chat.sched.e.too_late") return AR["chatsched.note.late"] ?? "";
  if (reason.startsWith("chat.f.")) return AR["chatsched.note.files"] ?? "";
  return AR["chatsched.note.failed"] ?? "";
}

/**
 * NOT ONE TRANSACTION: the row's lock is held by `tx`, but the send itself runs on the shared client (it is the normal send, with its own transaction and its after-work), so a failure after the
 * message was made and before `finish` commits leaves the message live and the row still PENDING for a moment. That is the case the clientId and `twinFirst` exist for: the next run finds the message and only
 * marks the row. Each delivery holds two connections (the lock's and the send's) and rows go one at a time.
 *
 * Sends ONE row, once. `job`: only a row that is due, a failure marks it FAILED and tells the author. `now`: «ابعت هلّق» (due or not), a failure is thrown to the person and the
 * row is left as it was. The row is claimed with a lock and `SKIP LOCKED`: a second caller reaching the same row gets `gone` (it is being sent, or was). Whatever happens the message
 * exists at most once (its clientId is `sch:<id>`).
 */
export async function deliverScheduled(id: string, at: Date, mode: "job" | "now"): Promise<DeliverResult> {
  // the Web Pushes of the notes written in the transaction: sent only after it commits
  const afterCommit: Array<() => void> = [];
  const result = await db.$transaction(
    async (tx): Promise<DeliverResult> => {
      const due = mode === "job" ? Prisma.sql`AND "sendAt" <= ${at}` : Prisma.empty;
      const claimed = await tx.$queryRaw<Claimed[]>(Prisma.sql`
        SELECT "id", "orgId", "conversationId", "authorId", "body", "attachmentIds", "mentions", "replyToId", "silent", "noPreview", "sendAt"
        FROM "ScheduledChatMessage"
        WHERE "id" = ${id} AND "status" = 'PENDING'::"ScheduledChatStatus" ${due}
        FOR UPDATE SKIP LOCKED`);
      const row = claimed[0];
      if (!row) return { kind: "gone" };

      // FAILED and the bell note are ONE commit: a row that failed always has its note (a restart in between cannot lose it). Only an ACTIVE person is told (a suspended one gets nothing).
      const fail = async (reason: string, tell: boolean): Promise<DeliverResult> => {
        await tx.scheduledChatMessage.update({ where: { id: row.id }, data: { status: "FAILED", failReason: reason } });
        if (tell) {
          afterCommit.push(
            await pushNotificationInTx(tx, {
              userId: row.authorId,
              type: "chat_scheduled_failed",
              title: AR["notif.type.chat_scheduled_failed"] ?? "",
              body: noteBodyOf(reason),
              organizationId: row.orgId,
            }),
          );
        }
        return { kind: "failed", reason };
      };
      const finish = async (messageId: string, message: MessageDto | null): Promise<DeliverResult> => {
        await tx.scheduledChatMessage.update({ where: { id: row.id }, data: { status: "SENT", messageId, body: "", attachmentIds: [], failReason: null } });
        return { kind: "sent", message };
      };

      // a crash between the send and the mark left the message made: it IS this row's message, whatever the person may do now (never a second copy, never a false FAILED)
      const twinFirst = await tx.chatMessage.findUnique({ where: { authorId_clientId: { authorId: row.authorId, clientId: messageClientIdOf(row.id) } }, select: { id: true, conversationId: true } });
      if (twinFirst && twinFirst.conversationId === row.conversationId) return finish(twinFirst.id, null);

      // the person must still be an ACTIVE member of the company: the send needs their rank (a suspended or removed person sends nothing, and is not messaged)
      const member = await tx.organizationMember.findFirst({ where: { userId: row.authorId, organizationId: row.orgId, status: "ACTIVE" }, select: { role: true } });
      if (mode === "job" && at.getTime() - row.sendAt.getTime() > MAX_LATE_MS) return fail("chat.sched.e.too_late", member !== null);
      if (!member) {
        if (mode === "now") throw new ForbiddenError("chat.e.post_denied");
        return fail("chat.e.post_denied", false);
      }
      const ctx: OrgAccessContext = { orgId: row.orgId, orgRole: member.role, userId: row.authorId };
      const all = asStrings(row.mentions);
      const input: SendInput = {
        body: row.body,
        attachmentIds: asStrings(row.attachmentIds),
        mentions: all.filter((m) => m !== MENTION_ALL_ID),
        ...(all.includes(MENTION_ALL_ID) ? { mentionAll: true } : {}),
        ...(row.replyToId ? { replyToId: row.replyToId } : {}),
        ...(row.silent ? { silent: true } : {}),
        ...(row.noPreview ? { noPreview: true } : {}),
        clientId: messageClientIdOf(row.id),
      };
      try {
        // the NORMAL send: it reads the conversation's rules again now (canRead, canPost, a closed topic, a mute, a left chat)
        const message = await sendMessage(ctx, row.conversationId, input);
        // the send answers a message that already has this clientId with THAT message, wherever it is: it must be in this row's conversation (it never is, short of a collision made by hand)
        const made = await tx.chatMessage.findUnique({ where: { id: message.id }, select: { conversationId: true } });
        if (made?.conversationId !== row.conversationId) return await fail("chat.sched.e.failed", true);
        return await finish(message.id, message);
      } catch (err) {
        if (err instanceof RateLimitedError) {
          if (mode === "now") throw err;
          return { kind: "later" }; // the author's send quota is used up this minute: the row waits for the next tick
        }
        if (isUniqueViolation(err)) {
          // the other copy of this send won the insert: it IS the message
          const twin = await tx.chatMessage.findUnique({ where: { authorId_clientId: { authorId: row.authorId, clientId: messageClientIdOf(row.id) } }, select: { id: true, conversationId: true } });
          if (twin && twin.conversationId === row.conversationId) return finish(twin.id, null);
        }
        if (mode === "now") throw err;
        if (isRefusal(err)) return fail(reasonOf(err), true);
        throw err; // an unexpected failure (the database): logged by the runner, the row stays PENDING and is tried again next tick
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  // the Web Push of a note goes out only once its row is committed (the bell row is already there)
  for (const push of afterCommit) push();
  return result;
}
