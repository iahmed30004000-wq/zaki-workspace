import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { PollDto, PollOptionDto } from "./dto";

/**
 * «استطلاع»: the parts of a poll that both the send path (messages.ts) and the vote path (polls.ts) need.
 * No import from messages.ts here, so messages.ts can use it without a cycle.
 *
 * A poll is a ChatMessage of kind POLL whose body is the question. The question, the options and the
 * deadline are fixed at creation: a poll cannot be edited (an edit would change what people voted on).
 */

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_OPTION_LENGTH = 100;
/** the longest deadline a poll may carry: seven days */
export const MAX_POLL_MINUTES = 7 * 24 * 60;

/** The `poll` field of a send: the question travels as the message body. */
export const pollInputSchema = z.object({
  options: z.array(z.string().max(MAX_POLL_OPTION_LENGTH * 3)).max(MAX_POLL_OPTIONS),
  multiple: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  // «يُغلق بعد»: minutes from now, at most 7 days; absent: stays open until somebody closes it
  closesInMinutes: z.number().int().min(1).max(MAX_POLL_MINUTES).optional(),
});

export type PollInput = z.infer<typeof pollInputSchema>;

/** The options as they will be stored: trimmed, blanks dropped; null when they are not 2-10 distinct texts. */
export function cleanPollOptions(options: string[]): string[] | null {
  const cleaned = options.map((o) => o.trim().replace(/\s+/g, " ")).filter((o) => o.length > 0);
  if (cleaned.some((o) => [...o].length > MAX_POLL_OPTION_LENGTH)) return null;
  if (new Set(cleaned).size !== cleaned.length) return null;
  if (cleaned.length < MIN_POLL_OPTIONS || cleaned.length > MAX_POLL_OPTIONS) return null;
  return cleaned;
}

/** What the message row creates alongside itself (the nested write of `chatMessage.create`). */
export function pollCreateData(input: PollInput, options: string[], now = new Date()): Prisma.PollCreateWithoutMessageInput {
  return {
    multiple: input.multiple === true,
    anonymous: input.anonymous === true,
    closesAt: input.closesInMinutes ? new Date(now.getTime() + input.closesInMinutes * 60_000) : null,
    options: { create: options.map((text, position) => ({ text, position })) },
  };
}

/** The include every message query carries so `presentPoll` has what it needs. */
export const pollInclude = {
  options: {
    orderBy: { position: "asc" as const },
    select: { id: true, text: true, votes: { select: { userId: true, user: { select: { name: true } } } } },
  },
} satisfies Prisma.PollInclude;

export type PollRow = {
  id: string;
  multiple: boolean;
  anonymous: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  options: { id: string; text: string; votes: { userId: string; user: { name: string } }[] }[];
};

/** Closed by hand, or its deadline has passed: decided here, so no job has to flip a flag. */
export function pollIsClosed(poll: { closesAt: Date | null; closedAt: Date | null }, now = new Date()): boolean {
  return poll.closedAt !== null || (poll.closesAt !== null && poll.closesAt <= now);
}

export type PollViewer = {
  userId: string;
  role: string;
  /** the viewer holds silent oversight (`archive.view`); absent: an OWNER-rank viewer is read as holding it */
  oversight?: boolean;
  /** the viewer is a row of the conversation (the owner only where he joined) */
  isMember: boolean;
  canModerateHere: boolean;
};

/** The owner reading without a row is in silent oversight: he neither votes nor closes (that would leave a trace). */
export function isSilentOwner(viewer: Pick<PollViewer, "role" | "isMember"> & { oversight?: boolean }): boolean {
  return (viewer.oversight ?? viewer.role === "OWNER") && !viewer.isMember; // oversight-ok: the fallback of a hand-made viewer
}

/**
 * One poll for one viewer. Counts and percentages are for everybody who reads. Who voted for what is
 * shown only on a poll that is not anonymous, and never to a GUEST. A guest holds no vote and never
 * receives one, and the silent owner has none either (voting makes him join first), so neither is counted.
 */
export function presentPoll(poll: PollRow, viewer: PollViewer, authorId: string, deleted: boolean, now = new Date()): PollDto {
  const closed = pollIsClosed(poll, now);
  const voterIds = new Set<string>();
  for (const o of poll.options) for (const v of o.votes) voterIds.add(v.userId);
  const total = voterIds.size;
  const showNames = !poll.anonymous && viewer.role !== "GUEST";
  const options: PollOptionDto[] = poll.options.map((o) => {
    const dto: PollOptionDto = {
      id: o.id,
      text: o.text,
      count: o.votes.length,
      percent: total === 0 ? 0 : Math.round((o.votes.length * 100) / total),
      mine: o.votes.some((v) => v.userId === viewer.userId),
    };
    if (showNames) dto.voters = o.votes.map((v) => ({ id: v.userId, name: v.user.name }));
    return dto;
  });
  const silent = isSilentOwner(viewer);
  return {
    id: poll.id,
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
    closed,
    voters: total,
    options,
    canVote: !closed && !deleted && viewer.role !== "GUEST" && !silent,
    canClose: !closed && !deleted && !silent && viewer.role !== "GUEST" && (viewer.userId === authorId || viewer.canModerateHere),
  };
}
