import type { MessageDto } from "@/server/chat/dto";
import { isMentioned } from "@/lib/chat/conversation/mentions";
import { emojiTokens } from "@/lib/chat/zaki-emoji";
import { avatarHue } from "@/lib/format";

/**
 * C2.4 — what a bubble looks like, as pure functions (the rules of the old `message-item.tsx`, kept: own at the inline end, runs and tails, the name
 * colour by `avatarHue`, the warn tint of a mention of me). The component draws what these say and nothing more, so a test can pin every rule without a
 * browser. Colours are theme tokens only; every side is logical (the screen is right-to-left).
 */

/** The name colour of a sender: `avatarHue(name)` picks one of the six category tokens (a literal each, so Tailwind sees them). */
export const NAME_TONES = ["text-cat-1", "text-cat-2", "text-cat-3", "text-cat-4", "text-cat-5", "text-cat-6"] as const;

export function nameTone(name: string): (typeof NAME_TONES)[number] {
  return NAME_TONES[avatarHue(name) % NAME_TONES.length]!;
}

export type BubbleRun = "single" | "start" | "middle" | "end";

/** Where a bubble stands in a run of one person's messages. */
export function bubbleRun(start: boolean, end: boolean): BubbleRun {
  return start && end ? "single" : start ? "start" : end ? "end" : "middle";
}

/** The sender's name and picture are drawn for the others in a topic or a group; a private chat shows neither, and mine shows neither. */
export function showsSender(mine: boolean, kind: "DM" | "GROUP" | "TOPIC"): boolean {
  return !mine && kind !== "DM";
}

/** «تيليجرام على التلفون»: a message that is ONE emoji and nothing else (no file, card, poll, quote or forwarded header) stands without a bubble. */
export function bigEmojiAlone(message: Pick<MessageDto, "kind" | "body" | "deleted" | "attachments" | "card" | "poll" | "replyTo" | "forwardedFrom" | "crossReply">): boolean {
  if (message.deleted || message.kind !== "TEXT" || !message.body || message.attachments.length > 0 || message.card || message.poll || message.replyTo || message.forwardedFrom || message.crossReply) return false;
  return emojiTokens(message.body)?.length === 1;
}

/** A message that mentions me (by my id or «@الكل»): marked for me, never my own message and never a deleted one. */
export function mentionsMeOf(message: Pick<MessageDto, "mine" | "deleted" | "mentions">, meId: string | undefined): boolean {
  return !message.mine && !message.deleted && Boolean(meId) && isMentioned(message.mentions, meId as string);
}

/**
 * The bubble's box. The tail is the corner toward the author on the LAST bubble of a run: bottom-end for mine (the inline end), bottom-start for the
 * others. Mine takes the accent tint, a mention of me the warn tint; a jump's target gets a ring for two seconds.
 */
export function bubbleClass(o: { mine: boolean; mentionsMe: boolean; tail: boolean; highlighted: boolean }): string {
  const base = "relative min-w-0 max-w-[85%] break-words rounded-[17px] border px-3 py-1.5 shadow-sm sm:max-w-[75%] [@media(hover:none)]:select-none";
  const tone = o.mine
    ? "border-transparent bg-bubble-out text-bubble-out-fg"
    : o.mentionsMe
      ? "border-warn/50 bg-warn/10"
      : "border-transparent bg-bubble-in text-bubble-in-fg";
  const tail = o.tail ? (o.mine ? "rounded-ee-sm" : "rounded-es-sm") : "";
  const ring = o.highlighted ? "ring-2 ring-accent" : "";
  return [base, tone, tail, ring].filter(Boolean).join(" ");
}
