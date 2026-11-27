import type { PollDto } from "@/server/chat/dto";
import { arabicPlural } from "@/lib/format";

/**
 * «استطلاع»: the small pure parts of the poll screens, so they can be tested without a browser.
 */

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;
export const POLL_OPTION_MAX = 100;
export const POLL_QUESTION_MAX = 300;
/** «يُغلق بعد»: the choices the dialog offers, in minutes (0: no deadline); the longest is the server's 7 days */
export const POLL_CLOSE_CHOICES = [0, 60, 1440, 4320, 10080] as const;

export type PollDraft = { question: string; options: string[]; multiple: boolean; anonymous: boolean; closesInMinutes: number };

export const emptyPollDraft = (): PollDraft => ({ question: "", options: ["", ""], multiple: false, anonymous: false, closesInMinutes: 0 });

/** The options the server would keep: trimmed, blanks dropped. */
export const filledOptions = (draft: PollDraft): string[] => draft.options.map((o) => o.trim()).filter((o) => o.length > 0);

/** Why the draft cannot be sent yet (null: it can) — the same rules as the server's, so the button never lies. */
export function pollDraftProblem(draft: PollDraft): "question" | "options" | "duplicate" | null {
  if (!draft.question.trim()) return "question";
  const options = filledOptions(draft);
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) return "options";
  if (new Set(options.map((o) => o.replace(/\s+/g, " "))).size !== options.length) return "duplicate";
  return null;
}

/** The body of the send request that creates the poll. */
export function buildPollPayload(draft: PollDraft, clientId: string) {
  return {
    body: draft.question.trim(),
    clientId,
    poll: {
      options: filledOptions(draft),
      ...(draft.multiple ? { multiple: true } : {}),
      ...(draft.anonymous ? { anonymous: true } : {}),
      ...(draft.closesInMinutes > 0 ? { closesInMinutes: draft.closesInMinutes } : {}),
    },
  };
}

/** The options with the one at `from` moved to `to` (the drag handle, or the arrow keys on it); a place outside the list is its nearest end. */
export function moveOption(options: readonly string[], from: number, to: number): string[] {
  const next = [...options];
  const target = Math.min(next.length - 1, Math.max(0, to));
  if (from < 0 || from >= next.length || from === target) return next;
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Where the row at `from` stands after the finger moved `dy` pixels over rows `rowPx` tall. */
export function dragTargetIndex(from: number, dy: number, rowPx: number, count: number): number {
  if (rowPx <= 0) return from;
  return Math.min(count - 1, Math.max(0, from + Math.round(dy / rowPx)));
}

/** How many more option rows fit. */
export const pollRoomLeft = (draft: Pick<PollDraft, "options">): number => Math.max(0, POLL_MAX_OPTIONS - draft.options.length);
/** «يمكنك إضافة N خيارًا إضافيًا»: the key of the sentence in the Arabic form of the number. */
export const pollRoomKey = (left: number): string => `tgsheets.poll.room.${left === 0 ? "zero" : arabicPlural(left)}`;

/** The set of options I would hold after tapping `optionId`: a single-choice tap replaces (tapping mine withdraws), a multiple one toggles. */
export function choiceAfterTap(poll: Pick<PollDto, "multiple" | "options">, optionId: string): string[] {
  const mine = poll.options.filter((o) => o.mine).map((o) => o.id);
  if (poll.multiple) return mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId];
  return mine.includes(optionId) ? [] : [optionId];
}

/** The machine key of an error answer (`chat.e.*`), or null. */
export function errorKeyOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { message?: unknown; details?: unknown };
  if (typeof b.message === "string" && b.message.startsWith("chat.")) return b.message;
  if (Array.isArray(b.details)) {
    for (const d of b.details) {
      const m = (d as { message?: unknown } | null)?.message;
      if (typeof m === "string" && m.startsWith("chat.")) return m;
    }
  }
  return null;
}
