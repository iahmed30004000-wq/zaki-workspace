import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth";
import type { OrgAccessContext } from "@/server/auth";
import { canModerate, canRead } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { presentMessage } from "@/server/chat/redact";
import { guard, messageInclude, viewerOf, withViewer } from "@/server/chat/messages";
import { isSilentOwner, pollIsClosed } from "@/server/chat/poll-shared";
import { FixedWindowLimiter, RateLimitedError } from "@/server/rate-limit";
import { linkPreviewsOn } from "@/server/chat/link-preview";
import type { MessageDto } from "@/server/chat/dto";

/**
 * «استطلاع»: voting on a poll and closing it. Creating one is a send (messages.ts `sendMessage` with a
 * `poll`), so it shares the send limiter, the idempotent client id and `message.created`.
 *
 * - Who votes: whoever reads the topic EXCEPT a guest (a guest reads the results, never votes) and the
 *   OWNER in silent oversight (his reading leaves no trace, and a vote is one: he joins first, like for a
 *   reaction). A person's vote is their set of chosen options; sending the set again replaces it and an
 *   empty set withdraws it — until the poll is closed.
 * - Who closes: its creator or a moderator of the topic, while it is open (the deadline closes it by itself:
 *   `pollIsClosed` compares the clock, so no job is needed).
 * - A deleted message hides its poll: nothing is voted on or closed there.
 * - Both answer with the message as the caller now sees it, and ring `poll.voted` (conversation and message
 *   ids only: never who voted).
 */

/** 60 vote changes a minute per person, process-wide. */
export const voteLimiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000 });

export const voteSchema = z.object({ optionIds: z.array(z.string().min(1).max(64)).max(10) });
export type VoteInput = z.infer<typeof voteSchema>;

async function loadPollMessage(ctx: OrgAccessContext, messageId: string) {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, include: { poll: { select: { id: true } } } });
  if (!msg || msg.orgId !== ctx.orgId || msg.kind !== "POLL" || !msg.poll) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  return { msg, pollId: msg.poll.id, facts, org };
}

async function present(ctx: OrgAccessContext, messageId: string, ctxFacts: Awaited<ReturnType<typeof loadPollMessage>>): Promise<MessageDto> {
  const row = await db.chatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude() });
  return presentMessage(row, { ...withViewer(viewerOf(ctxFacts.facts, ctxFacts.org), ctx.userId), linkPreviews: await linkPreviewsOn(ctx.orgId) });
}

/** Locks the poll's row for the length of the transaction, so two votes of one person never interleave. */
async function lockPoll(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], pollId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Poll" WHERE "id" = ${pollId} FOR UPDATE`;
  return tx.poll.findUniqueOrThrow({ where: { id: pollId }, include: { options: { select: { id: true } } } });
}

export async function votePoll(ctx: OrgAccessContext, messageId: string, input: VoteInput): Promise<MessageDto> {
  if (!voteLimiter.check(`chat.vote.${ctx.userId}`).ok) throw new RateLimitedError(60, "chat.e.rate_limited");
  voteLimiter.hit(`chat.vote.${ctx.userId}`);

  const loaded = await loadPollMessage(ctx, messageId);
  const { msg, pollId, facts, org } = loaded;
  if (org.role === "GUEST") throw new ForbiddenError("chat.e.poll_guest");
  // a vote would break the owner's silent reading: he joins first, and then he is one of the voters
  if (isSilentOwner({ role: org.role, isMember: facts.viewerIsMember })) throw new ForbiddenError("chat.e.join_first");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");

  const chosen = [...new Set(input.optionIds)];
  await db.$transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId);
    if (pollIsClosed(poll)) throw new ForbiddenError("chat.e.poll_closed");
    const valid = new Set(poll.options.map((o) => o.id));
    if (chosen.some((id) => !valid.has(id))) throw new ValidationError([{ path: "optionIds", message: "chat.e.poll_bad_option" }]);
    if (!poll.multiple && chosen.length > 1) throw new ValidationError([{ path: "optionIds", message: "chat.e.poll_single" }]);
    await tx.pollVote.deleteMany({ where: { pollId, userId: ctx.userId } });
    if (chosen.length) await tx.pollVote.createMany({ data: chosen.map((optionId) => ({ pollId, optionId, userId: ctx.userId })) });
    await emitRealtime(tx, ctx.orgId, "poll.voted", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
  });
  return present(ctx, messageId, loaded);
}

export async function closePoll(ctx: OrgAccessContext, messageId: string): Promise<MessageDto> {
  const loaded = await loadPollMessage(ctx, messageId);
  const { msg, pollId, facts, org } = loaded;
  if (org.role === "GUEST") throw new ForbiddenError("chat.e.poll_guest");
  if (isSilentOwner({ role: org.role, isMember: facts.viewerIsMember })) throw new ForbiddenError("chat.e.join_first");
  if (msg.authorId !== ctx.userId && !canModerate(facts, org)) throw new ForbiddenError("chat.e.poll_close_denied");
  if (msg.deletedAt) throw new ForbiddenError("chat.e.deleted");

  await db.$transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId);
    if (pollIsClosed(poll)) throw new ForbiddenError("chat.e.poll_closed");
    await tx.poll.update({ where: { id: pollId }, data: { closedAt: new Date(), closedById: ctx.userId } });
    await emitRealtime(tx, ctx.orgId, "poll.voted", { conversationId: msg.conversationId, messageId, spaceId: facts.spaceId ?? undefined });
  });
  return present(ctx, messageId, loaded);
}
