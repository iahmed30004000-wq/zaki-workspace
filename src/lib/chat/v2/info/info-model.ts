import type { ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import { ct, ctCount } from "@/lib/chat/text";
import { dmSubtitle } from "@/lib/chat/conversation/last-seen-line";
import { privacyState, type PrivacyState } from "@/lib/chat/privacy";
import { MUTE_PRESETS } from "@/lib/chat/row-preview";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { headerMenuOf, subtitleOf, type HeaderMenuId } from "@/lib/chat/v2/pane/header-model";

/**
 * C2.7 — what the info panel says, as pure functions of the header the cache holds (and the people, when the existing door gave them). The panel adds NO
 * door of the server's:
 *
 *  - the buttons row has «🔍 بحث» and, only when the person may call here (the header's own `canCall` rule), «📞 اتصال». «🔔 الإشعارات» has no per-person door before
 *    C3a, so it is NOT here — not even disabled;
 *  - a private chat shows what the header carries (the other person, the last-seen line); the profile lines come from the existing profile door, in the component;
 *  - a topic shows the space, who sees it and — for a topic made for NAMED people — the people, but only the ones the server's own door handed over. Privacy
 *    (P0.4): «🔒 خاص — 4 أشخاص» says it is private and how many, and carries NO name for anybody who was not given them (an empty or missing list is no names;
 *    the space's audience list is never used for a private topic, and for a topic of a section only the count and the section's name are shown);
 *  - the moderators' buttons are the topics door's: settings, close or reopen, archive or bring back (a starter topic is only edited);
 *  - NO tabs: «الوسائط · الملفات · الروابط · الصوتيات · الشغل · المثبّتة» are C3d, and an empty placeholder for them is not drawn.
 */
export type InfoButton = "search" | "call";

export interface InfoAudience {
  state: PrivacyState;
  /** the line: «كل أعضاء المساحة (42)», «المقطع: …», «🔒 خاص — 4 أشخاص» */
  line: string;
  /** the people, for a restricted topic and only when the door gave them */
  names: MemberDto[];
}

export interface InfoModel {
  kind: "dm" | "topic";
  title: string;
  avatar: { kind: "person"; name: string; src: string | null } | { kind: "emoji"; emoji: string };
  subtitle: string | null;
  buttons: InfoButton[];
  /** the other person of a private chat (the profile door is asked for this id) */
  peerId: string | null;
  space: string | null;
  audience: InfoAudience | null;
  /** private topic: the owner may read it silently, said honestly (the server's own flag) */
  oversightNotice: boolean;
  moderator: HeaderMenuId[];
}

const MODERATOR_IDS: readonly HeaderMenuId[] = ["settings", "close", "reopen", "archive", "unarchive"];

export function infoModelOf(header: ConversationHeaderDto, opts: { people: PaneMembers | null; teamName: string | null; system: boolean; now?: Date }): InfoModel {
  const dm = header.kind === "DM";
  const state = privacyState(header);
  const canCall = header.calls !== false && !header.assistantCall && header.me.canPost && header.me.canCall !== false;
  const buttons: InfoButton[] = canCall ? ["search", "call"] : ["search"];

  let subtitle: string | null;
  if (dm) subtitle = dmSubtitle(header, opts.now);
  else {
    const line = subtitleOf(header, { typingNames: [] });
    subtitle = [line.privacy, line.line].filter(Boolean).join(" · ") || null;
  }

  let audience: InfoAudience | null = null;
  if (!dm) {
    if (state === "open") audience = { state, line: ct("chatui.info.audience_space", { n: header.audience.count }), names: [] };
    else if (state === "team") audience = { state, line: opts.teamName ? ct("chatui.info.audience_team", { name: opts.teamName }) : ct("chatui.info.audience_team_anon"), names: [] };
    else {
      // «🔒 خاص — الأسماء»: the people come only from the door's own list, and the assistant is not a person
      const names = (opts.people?.members ?? []).filter((m) => m.role !== "AI");
      audience = { state, line: ct("chatui.info.audience_private", { people: ctCount("chatp.people", header.memberCount) }), names: state === "restricted" ? names : [] };
    }
  }

  const moderator =
    header.kind === "TOPIC" && header.me.canModerate
      ? headerMenuOf({ kind: header.kind, whiteboard: false, watch: false, digest: false, canModerate: true, closed: header.closed, archived: header.archived === true, system: opts.system }).filter((id) => MODERATOR_IDS.includes(id))
      : [];

  return {
    kind: dm ? "dm" : "topic",
    title: header.title,
    avatar: dm ? { kind: "person", name: header.title, src: header.peer?.avatarUrl ?? null } : { kind: "emoji", emoji: header.emoji ?? "💬" },
    subtitle,
    buttons,
    peerId: dm ? (header.peer?.id ?? null) : null,
    space: dm ? null : (header.space?.name ?? null),
    audience,
    oversightNotice: !dm && state !== "open" && header.oversightNotice === true,
    moderator,
  };
}

// ───────────────────────────── S5.4: the members tab, the mute row, a video's length ─────────────────────────────

export interface MembersTab {
  /** who sees the conversation: the same four words as the privacy state */
  state: PrivacyState;
  /** the people to list: only what the existing detail door gave AND the conversation's own rule allows (see `membersTabOf`) */
  names: MemberDto[];
  /** how many people the conversation reaches (the header's own count; the list may be shorter while the people are not known) */
  total: number;
}

/**
 * The members tab, from the header and the people the existing door gave (`PaneMembers`). NONE for a private chat (the profile is its tab). Privacy (P0.4):
 *
 *  - an OPEN topic reaches its whole space: its audience is the door's `mentionables` (the people the composer offers for «@»), so the list is that, the assistant
 *    left out; a guest is given only the topic's own rows by the door, and that is all they get here;
 *  - a topic for NAMED people (restricted) lists the door's own `members` — never the `mentionables` (which may be the space's list), and nobody when the door gave
 *    nothing: a person who may not read the topic never has a list (the door answers «not found» before this), a person who may but was not given one sees a count;
 *  - a topic of a SECTION («مقطع») never lists: the door's lists are the space's, not the section's; only the header's count;
 *  - a group lists the people of its own rows.
 */
export function membersTabOf(header: ConversationHeaderDto, people: PaneMembers | null): MembersTab | null {
  if (header.kind === "DM") return null;
  const state = privacyState(header);
  const person = (m: MemberDto): boolean => m.role !== "AI";
  let names: MemberDto[];
  if (header.kind === "GROUP") names = (people?.members ?? []).filter(person);
  else if (state === "open") names = (people?.mentionables ?? people?.members ?? []).filter(person);
  else if (state === "restricted") names = (people?.members ?? []).filter(person);
  else names = [];
  const total = state === "open" && names.length > 0 ? names.length : header.memberCount;
  return { state, names, total };
}

export interface MuteOffers {
  /** `presets`: offer the durations; `lift`: the chat is muted, offer to lift it */
  state: "presets" | "lift";
  presets: typeof MUTE_PRESETS;
}

/**
 * The mute row of the panel: the SAME presets the chat list's menu offers (`MUTE_PRESETS`), through the person's own door. Nothing for «الرسائل المحفوظة» (nobody
 * to be quiet about), for a reader in silent oversight (a mute is a row of THEIR own, which they never leave), or while the company's switch `chatPersonalState` is off.
 */
export function muteOffersOf(i: { muted: boolean; personal: boolean; saved: boolean; oversight: boolean }): MuteOffers | null {
  if (i.saved || i.oversight || !i.personal) return null;
  return { state: i.muted ? "lift" : "presets", presets: MUTE_PRESETS };
}

/** A video's length for its tile: `1:15`, `1:02:05`; Western digits; null when it is not known. */
export function durationLabel(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
