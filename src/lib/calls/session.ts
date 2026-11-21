/**
 * The few rules that keep a call alive while the person moves around the app (src/components/calls/call-provider.tsx).
 * Pure, so the rules are tested without a calls server.
 */

/** LiveKit's reasons for a disconnect (its protocol's numbers), the ones these rules read. */
export const REASON = {
  CLIENT_INITIATED: 1,
  DUPLICATE_IDENTITY: 2,
  PARTICIPANT_REMOVED: 4,
  ROOM_DELETED: 5,
  ROOM_CLOSED: 10,
} as const;

/**
 * Was the person dropped by the network (a lost connection, the phone asleep, the server restarting), rather than by a
 * choice — their own «اطلع», being taken out, the call ending, or the same person joining from another device?
 * Only a drop is joined again by itself.
 */
export function isDrop(reason: number | undefined): boolean {
  if (reason === undefined) return true;
  return !([REASON.CLIENT_INITIATED, REASON.DUPLICATE_IDENTITY, REASON.PARTICIPANT_REMOVED, REASON.ROOM_DELETED, REASON.ROOM_CLOSED] as number[]).includes(reason);
}

/** How long to wait before the n-th quiet rejoin (1, 2, 4… seconds, at most 15). */
export function rejoinDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

/** Rejoining stops after this many tries in a row; the person then gets one button. */
export const MAX_REJOINS = 6;

/** The small call window shows on every page of the app except the call's own page. */
export function miniVisible(pathname: string | null, callId: string | null): boolean {
  if (!callId) return false;
  return pathname !== `/calls/${callId}`;
}

/** A pass fetched while the phone was ringing is used for the answer only while it is still fresh. */
export const PASS_FRESH_MS = 90_000;

export function isFresh(fetchedAt: number, now: number): boolean {
  return now - fetchedAt < PASS_FRESH_MS;
}

/**
 * Does a person enter a call with the microphone on? Only a private call (they were rung, they answer and talk) and the
 * person who started the call; everybody who joins a topic's, a group's or a meeting's call comes in muted, like a Telegram
 * video chat, and opens the microphone when they want to speak.
 */
export function micOnAtJoin(call: { kind: string; startedByMe: boolean }): boolean {
  return call.kind === "DM" || call.startedByMe;
}

/** Is the person already in THIS call (connecting, in it, or dropped and coming back)? The join bar is for those who are not. */
export function insideCall(callId: string, state: { callId: string | null; phase: string }): boolean {
  return state.callId === callId && (state.phase === "in" || state.phase === "connecting" || state.phase === "lost");
}

/**
 * Should a ringing card close, given the call as the server tells it now? When it ended (the caller hung up, somebody declined), when the
 * person answered it on another device or tab, or when the call can no longer be read (`null`: it ended and the person's seat is gone).
 */
export function ringIsOver(view: { endedAt: string | null; answered: boolean } | null): boolean {
  return !view || !!view.endedAt || view.answered;
}

/** The dictionary key of the line a call page shows when the call ends under the person (the caller's «رفض المكالمة», nobody answered, taken out, or just over). */
export function endKeyOf(view: { endedHow: "declined" | "missed" | "answered" | null } | null, phase: string): "calls.declined" | "calls.no_answer" | "calls.ended" | "calls.removed_me" {
  if (phase === "removed") return "calls.removed_me";
  if (view?.endedHow === "declined") return "calls.declined";
  if (view?.endedHow === "missed") return "calls.no_answer";
  return "calls.ended";
}
