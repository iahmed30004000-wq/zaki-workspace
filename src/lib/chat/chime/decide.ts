import type { TopicSoundMode } from "@/lib/chat/chime/prefs";

/**
 * S5.1 — WHO HEARS WHAT, as plain functions. A message in any conversation the person reads makes a short tone on this device unless: it is the person's own, a system line, a
 * deleted one, or sent «ابعت بدون صوت»; the chat is muted for them (a mention included: a mute that rings is not a mute — the same rule as `src/server/chat/notify.ts`); they only
 * watch it in silent oversight; or it is in a topic they put on «الذكر بس» and does not mention them. Every private message sounds. The page's own state is separate (`chimeGate`).
 */

export interface ChimeFacts {
  mine: boolean;
  silent: boolean;
  system: boolean;
  deleted: boolean;
  /** the conversation's kind (a legacy group counts as a topic) */
  convKind: string;
  /** my own mute of this conversation */
  muted: boolean;
  /** a reader who is not a member (the owner's silent oversight) */
  oversight: boolean;
  /** the message names me, or «@الكل» */
  mentionsMe: boolean;
  /** this topic's choice on this device */
  topicMode: TopicSoundMode;
}

/** `plain`: one tone; `mention`: the same tone twice; null: silence. */
export type ChimeKind = "plain" | "mention";

export function chimeFor(f: ChimeFacts): ChimeKind | null {
  if (f.mine || f.system || f.deleted || f.silent) return null;
  if (f.muted || f.oversight) return null;
  if (f.convKind !== "DM" && f.topicMode === "mentions" && !f.mentionsMe) return null;
  return f.mentionsMe ? "mention" : "plain";
}

/**
 * Does the PAGE allow a sound now? Not with the master switch off; not while the tab is hidden (the server sends the push to a person who is not looking, and the push has its
 * own sound: two sounds for one message would be noise); not for the conversation that is open and visible (it makes its own arrival sound).
 */
export function chimeGate(s: { enabled: boolean; visible: boolean; openHere: boolean }): boolean {
  return s.enabled && s.visible && !s.openHere;
}

/** The conversation a path has open (`/chat/<id>`, `/chat/<id>/info`); the forum (`/chat/s/<space>`), the list and every other page have none. */
export function openConversationOf(pathname: string): string | null {
  const m = /^\/chat\/([^/?#]+)/.exec(pathname);
  if (!m || m[1] === "s") return null;
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return m[1] as string;
  }
}

/** A message older than this makes no sound: it came in a replay after a reconnect, not live. */
export const CHIME_FRESH_MS = 30_000;

export function chimeFresh(createdAt: string, now: number): boolean {
  const at = Date.parse(createdAt);
  return Number.isFinite(at) && now - at <= CHIME_FRESH_MS;
}

/** Two sounds are never played closer than this. */
export const CHIME_GAP_MS = 600;

export function chimeThrottled(lastPlayedAt: number | null, now: number): boolean {
  return lastPlayedAt !== null && now - lastPlayedAt < CHIME_GAP_MS;
}
