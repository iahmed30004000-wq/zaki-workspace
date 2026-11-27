import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { PollDto, PollOptionDto } from "./dto";

/**
 * «استطلاع»: the parts of a poll that both the send path (messages.ts) and the vote path (polls.ts) need.
 * No import from messages.ts here, so messages.ts can use it without a cycle.
 *
 * A poll is a ChatMessage of kind POLL whose body is the question. The question, the options and the
 * deadline are fixed at creation: a poll cannot be edited (an edit would change what people voted on).
 * The one thing that may grow is the list of options, and only on a poll that was SENT as open to it.
 *
 * The extras (the company's switch `chatPollExtras` governs making them): a quiz (one right option and a line
 * shown with it), `openOptions`, `hideResults`, `noRevote`, `shuffle`. WHAT IS SECRET IS CUT HERE, on the
 * server: the right answer and its line are in nobody's payload before they answered (or the poll closed; the
 * asker knows it), and hidden counts are not sent at all, not merely not drawn.
 */

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_OPTION_LENGTH = 100;
export const MAX_POLL_EXPLANATION = 200;
/** the longest deadline a poll may carry: seven days */
export const MAX_POLL_MINUTES = 7 * 24 * 60;

/** The `poll` field of a send: the question travels as the message body. */
export const pollInputSchema = z.object({
  options: z.array(z.string().max(MAX_POLL_OPTION_LENGTH * 3)).max(MAX_POLL_OPTIONS),
  multiple: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  // «يُغلق بعد»: minutes from now, at most 7 days; absent: stays open until somebody closes it
  closesInMinutes: z.number().int().min(1).max(MAX_POLL_MINUTES).optional(),
  // «اختبار»: one right option (`correctOption` is its place in `options` AS SENT) and a line shown with the answer
  quiz: z.boolean().optional(),
  correctOption: z.number().int().min(0).max(MAX_POLL_OPTIONS - 1).optional(),
  explanation: z.string().max(MAX_POLL_EXPLANATION * 3).optional(),
  openOptions: z.boolean().optional(),
  hideResults: z.boolean().optional(),
  noRevote: z.boolean().optional(),
  shuffle: z.boolean().optional(),
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

/** Does the send ask for anything beyond the poll of before? */
export function hasPollExtras(input: PollInput): boolean {
  return !!(input.quiz || input.openOptions || input.hideResults || input.noRevote || input.shuffle || input.correctOption !== undefined || (input.explanation ?? "").trim());
}

export interface PollExtras {
  quiz: boolean;
  /** the place of the right option in the CLEANED list (a quiz only) */
  correct: number | null;
  explanation: string | null;
  openOptions: boolean;
  hideResults: boolean;
  noRevote: boolean;
  shuffle: boolean;
}

const tidy = (text: string): string => text.trim().replace(/\s+/g, " ");

/**
 * The extras as they will be stored, or why they make no sense: a quiz has exactly one right answer (never several choices, and nobody adds options to it), its vote
 * cannot be changed; a right answer or a line without a quiz is refused. `options` is the cleaned list (`cleanPollOptions`).
 */
export function cleanPollExtras(input: PollInput, options: readonly string[]): { extras: PollExtras } | { error: "chat.e.poll_quiz" | "chat.e.poll_explanation" } {
  const quiz = input.quiz === true;
  const explanation = (input.explanation ?? "").trim();
  if (!quiz) {
    if (input.correctOption !== undefined || explanation) return { error: "chat.e.poll_quiz" };
    return { extras: { quiz: false, correct: null, explanation: null, openOptions: input.openOptions === true, hideResults: input.hideResults === true, noRevote: input.noRevote === true, shuffle: input.shuffle === true } };
  }
  if (input.multiple === true || input.openOptions === true || input.correctOption === undefined) return { error: "chat.e.poll_quiz" };
  // the place counts in the list as it was SENT (blanks are dropped from the stored one): the right answer is found by its words
  const chosen = input.options[input.correctOption];
  const correct = chosen === undefined ? -1 : options.indexOf(tidy(chosen));
  if (correct < 0) return { error: "chat.e.poll_quiz" };
  if ([...explanation].length > MAX_POLL_EXPLANATION) return { error: "chat.e.poll_explanation" };
  return { extras: { quiz: true, correct, explanation: explanation || null, openOptions: false, hideResults: input.hideResults === true, noRevote: true, shuffle: input.shuffle === true } };
}

const PLAIN: PollExtras = { quiz: false, correct: null, explanation: null, openOptions: false, hideResults: false, noRevote: false, shuffle: false };

/** What the message row creates alongside itself (the nested write of `chatMessage.create`). */
export function pollCreateData(input: PollInput, options: string[], now = new Date(), extras: PollExtras = PLAIN): Prisma.PollCreateWithoutMessageInput {
  return {
    multiple: input.multiple === true,
    anonymous: input.anonymous === true,
    closesAt: input.closesInMinutes ? new Date(now.getTime() + input.closesInMinutes * 60_000) : null,
    ...(extras.quiz ? { quiz: true, explanation: extras.explanation } : {}),
    ...(extras.openOptions ? { openOptions: true } : {}),
    ...(extras.hideResults ? { hideResults: true } : {}),
    ...(extras.noRevote ? { noRevote: true } : {}),
    ...(extras.shuffle ? { shuffle: true } : {}),
    options: { create: options.map((text, position) => ({ text, position, ...(extras.correct === position ? { correct: true } : {}) })) },
  };
}

/** The include every message query carries so `presentPoll` has what it needs. */
export const pollInclude = {
  options: {
    orderBy: { position: "asc" as const },
    select: { id: true, text: true, correct: true, votes: { select: { userId: true, user: { select: { name: true } } } } },
  },
} satisfies Prisma.PollInclude;

export type PollRow = {
  id: string;
  multiple: boolean;
  anonymous: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  quiz?: boolean;
  explanation?: string | null;
  openOptions?: boolean;
  hideResults?: boolean;
  noRevote?: boolean;
  shuffle?: boolean;
  options: { id: string; text: string; correct?: boolean; votes: { userId: string; user: { name: string } }[] }[];
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
  /** the viewer may post here (adding an option is posting); absent: no */
  canPost?: boolean | undefined;
};

/** A stable number from a string (FNV-1a): the order of a shuffled poll is the same for one person every time, and different between people. Not a secret. */
export function shuffleRank(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

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
  const voted = voterIds.has(viewer.userId);
  const asker = viewer.userId === authorId && viewer.role !== "GUEST";
  const quiz = poll.quiz === true;
  // a quiz's answer: to the one who answered, to the asker, and to everybody once it is closed
  const answerShown = quiz && (closed || voted || asker);
  // hidden until the poll closes (everybody, the asker too); a quiz's counts would tell the answer to somebody who has not answered
  const resultsHidden = (poll.hideResults === true && !closed) || (quiz && !answerShown);
  const showNames = !poll.anonymous && viewer.role !== "GUEST" && !resultsHidden;
  // «ترتيب عشوائي»: each person has an order of their own; the asker keeps the order they wrote
  const ordered = poll.shuffle === true && !asker ? [...poll.options].sort((a, b) => shuffleRank(`${viewer.userId}:${a.id}`) - shuffleRank(`${viewer.userId}:${b.id}`)) : poll.options;
  const options: PollOptionDto[] = ordered.map((o) => {
    const dto: PollOptionDto = {
      id: o.id,
      text: o.text,
      count: resultsHidden ? 0 : o.votes.length,
      percent: resultsHidden || total === 0 ? 0 : Math.round((o.votes.length * 100) / total),
      mine: o.votes.some((v) => v.userId === viewer.userId),
    };
    if (showNames) dto.voters = o.votes.map((v) => ({ id: v.userId, name: v.user.name }));
    if (answerShown) dto.correct = o.correct === true;
    return dto;
  });
  const noRevote = quiz || poll.noRevote === true;
  const silent = isSilentOwner(viewer);
  return {
    id: poll.id,
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
    closed,
    voters: total,
    options,
    canVote: !closed && !deleted && viewer.role !== "GUEST" && !silent && !(noRevote && voted),
    canClose: !closed && !deleted && !silent && viewer.role !== "GUEST" && (viewer.userId === authorId || viewer.canModerateHere),
    ...(quiz ? { quiz: true as const } : {}),
    ...(answerShown && poll.explanation ? { explanation: poll.explanation } : {}),
    ...(poll.openOptions ? { openOptions: true as const } : {}),
    ...(poll.openOptions && !closed && !deleted && !silent && viewer.role !== "GUEST" && viewer.canPost === true && poll.options.length < MAX_POLL_OPTIONS ? { canAddOption: true as const } : {}),
    ...(poll.hideResults ? { hideResults: true as const } : {}),
    ...(resultsHidden ? { resultsHidden: true as const } : {}),
    ...(noRevote ? { noRevote: true as const } : {}),
  };
}
