import type { ConversationHeaderDto, MemberDto } from "@/server/chat/dto";
import { ct, ctCount } from "@/lib/chat/text";
import { dmSubtitle } from "@/lib/chat/conversation/last-seen-line";
import { privacyState, type PrivacyState } from "@/lib/chat/privacy";
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
