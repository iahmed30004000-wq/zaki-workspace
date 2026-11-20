import type { ConversationHeaderDto } from "@/server/chat/dto";
import { ct, ctCount } from "@/lib/chat/text";
import { dmSubtitle } from "@/lib/chat/conversation/last-seen-line";
import { privacyLabel, privacyState } from "@/lib/chat/privacy";
import { isChannelTopic, typingText } from "@/lib/chat/row-preview";

/**
 * C2.4 — what the conversation's header says and offers, as pure functions of the header the cache holds.
 *
 * Privacy (P0.4): a private row says «🔒 خاص» with HOW MANY people, never WHO — the header carries a count, not names; the names are in the sheet that
 * the person opens, which only people inside the conversation can reach.
 */

/** The middle dot between two parts of the line (a symbol, not a word). */
const SEP = " · ";

export interface SubtitleModel {
  /** the lock chip («🔒 خاص · 4 أشخاص», «🔒 بينكم بس»); null for an open topic */
  privacy: string | null;
  /** the line itself: «عم يكتب…», the other person's last seen, or «المساحة · 42 عضو»; null when there is nothing to say */
  line: string | null;
  typing: boolean;
}

export function subtitleOf(header: ConversationHeaderDto, opts: { typingNames: readonly string[]; now?: Date; /** C3a.3: the saved chat: nobody types there, so no typing line */ saved?: boolean }): SubtitleModel {
  const state = privacyState(header);
  const privacy = privacyLabel(state, header.memberCount);
  if (opts.typingNames.length > 0 && opts.saved !== true) return { privacy, line: typingText(opts.typingNames, { kind: header.kind === "DM" ? "DM" : "TOPIC" }), typing: true };
  if (header.kind === "DM") return { privacy, line: dmSubtitle(header, opts.now), typing: false };
  const space = header.space?.name ?? null;
  // an open topic: the space and its people (the count is the header's own, never a guess); a private one has the count in its lock chip already
  const line = state === "open" ? [space, ctCount("chatc.members", header.memberCount)].filter(Boolean).join(SEP) : space;
  return { privacy, line: line || null, typing: false };
}

/** C3c.4: «قناة» in the header (with the megaphone) when the topic is announcements that only admins post in; the header carries both fields, so nothing is guessed. */
export function channelOf(header: Pick<ConversationHeaderDto, "kind" | "topicType" | "postingPolicy">): string | null {
  return isChannelTopic(header) ? ct("chatch.word") : null;
}

export type HeaderMenuId = "search" | "whiteboard" | "watch" | "digest" | "info" | "settings" | "close" | "reopen" | "archive" | "unarchive";

/**
 * The items of the header's «⋮» — ONLY what already has a server door: search (the search route), the board (its page, when the switch is on),
 * watch together (its page, when the server says the person may), the summary (the header says `digest`), the info (the panel the header toggles),
 * and for a topic's moderators the settings, close and archive (the topics route). A starter topic is never closed or archived (the server refuses).
 * «اكتم الإشعارات» is NOT here, not even disabled: it has no per-person door until C3a.
 */
export function headerMenuOf(i: {
  kind: "DM" | "GROUP" | "TOPIC";
  whiteboard: boolean;
  watch: boolean;
  digest: boolean;
  canModerate: boolean;
  closed: boolean;
  archived: boolean;
  system: boolean;
}): HeaderMenuId[] {
  const out: HeaderMenuId[] = ["search"];
  if (i.whiteboard) out.push("whiteboard");
  if (i.watch) out.push("watch");
  if (i.digest) out.push("digest");
  out.push("info");
  if (i.kind === "TOPIC" && i.canModerate) {
    out.push("settings");
    if (!i.system && !i.archived) out.push(i.closed ? "reopen" : "close");
    if (!i.system) out.push(i.archived ? "unarchive" : "archive");
  }
  return out;
}
