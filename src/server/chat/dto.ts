/**
 * The TypeScript shapes of every chat response (Phase 3). Dates are ISO strings, so a
 * DTO crosses a JSON boundary unchanged; the UI agents import these with `import type`.
 */

export type TopicType = "DISCUSSION" | "ANNOUNCEMENTS" | "TASKS" | "IDEAS" | "FOLLOWUP";
export type PostingPolicy = "ALL" | "ADMINS";
export type ConversationKind = "DM" | "GROUP" | "TOPIC";
export type MessageKind = "TEXT" | "VOICE" | "SYSTEM" | "POLL";

/** `{k, p}` of a system message — the client composes the Arabic sentence from it. */
export interface SystemMeta {
  k: string; // join | leave | pin | close | reopen | topic_created | member_added | member_removed | forwarded
  p?: Record<string, string | number>;
}

export interface AttachmentDto {
  id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  peaks?: number[];
  url: string;
}

export interface ReactionDto {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface NoteDto {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface PollOptionDto {
  id: string;
  text: string;
  count: number;
  /** of the people who voted (0-100); in a multiple-choice poll the percentages add up to more than 100 */
  percent: number;
  mine: boolean;
  /** who chose it: only on a poll that is not anonymous, and never for a GUEST */
  voters?: { id: string; name: string }[];
}

/** «استطلاع»: the poll a POLL message carries, for ONE viewer (src/server/chat/poll-shared.ts). */
export interface PollDto {
  id: string;
  multiple: boolean;
  anonymous: boolean;
  closesAt: string | null;
  closed: boolean;
  /** how many different people voted */
  voters: number;
  options: PollOptionDto[];
  /** the server decides again: not a guest, not the owner in silent oversight, not closed */
  canVote: boolean;
  /** the creator or a moderator, while it is open */
  canClose: boolean;
}

export interface MessageDto {
  id: string;
  kind: MessageKind;
  /** null for a deleted message (everybody) and for a system message. */
  body: string | null;
  deleted: boolean;
  edited: boolean;
  pinned: boolean;
  mine: boolean;
  authorId: string;
  authorName: string;
  /** `/api/avatars/<id>` — the sender's picture, or null (the initials are drawn). */
  authorAvatar?: string | null;
  createdAt: string;
  clientId?: string | null;
  replyTo?: { id: string; preview: string | null; authorName: string; deleted?: boolean } | null;
  forwardedFrom?: { name: string } | null;
  mentions: string[];
  attachments: AttachmentDto[];
  reactions: ReactionDto[];
  /** DMs only, on my own messages: sent | delivered | read. */
  status?: "sent" | "delivered" | "read";
  /** space admins and the OWNER only. */
  notes?: NoteDto[];
  /** the OWNER only, on a deleted message. */
  original?: { body: string; deletedBy: string; deletedAt: string } | null;
  /** the OWNER only, on an edited message. */
  history?: { body: string; editedAt: string }[];
  system?: SystemMeta | null;
  /** a POLL message's poll (absent on any other message and on a deleted one). */
  poll?: PollDto;
  /** the tasks and tickets made from this message («صارت مهمة»). */
  work?: { kind: "task" | "ticket"; id: string }[];
  /** «نتفرّج سوا»: the second of the video it was written at. */
  videoAtSec?: number | null;
}

export interface SpaceSummaryDto {
  id: string;
  name: string;
  emoji: string | null;
  kind: string;
  hasExternal: boolean;
  canModerate: boolean;
  /** May open a topic here: the space's ADMIN or the OWNER («موضوع جديد»). */
  canCreateTopic: boolean;
  /** The «مقاطع» of the space the viewer sees (a manager: all of them; anybody else: their own). */
  sections: { id: string; name: string }[];
  unread: number;
  topics: TopicSummaryDto[];
}

export interface TopicSummaryDto {
  id: string;
  title: string;
  emoji: string | null;
  topicType: TopicType;
  unread: number;
  mentions: number;
  closed: boolean;
  restricted: boolean;
  /** The «مقطع» the topic belongs to (null: the whole space's). */
  teamId: string | null;
  /** Pinned on top of the space's list. */
  pinned: boolean;
  /** Archived (listed only for the space's managers, under «المؤرشفة»). */
  archived: boolean;
  /** One of the space's starter topics («عام», «التنبيهات»): never deleted. */
  system?: boolean;
  canPost: boolean;
  lastMessage: { at: string; preview: string | null; mine: boolean } | null;
}

export interface DmSummaryDto {
  id: string;
  peer: { id: string; name: string; avatarUrl?: string | null };
  unread: number;
  lastMessage: { at: string; preview: string | null; mine: boolean } | null;
}

export interface HomeDto {
  spaces: SpaceSummaryDto[];
  dms: DmSummaryDto[];
  canOversee: boolean;
  /** «⋯» next to each topic and chat (the «قائمة المحادثة» switch in «الميزات»; absent: off). */
  rowMenu?: boolean;
  /** «حذف نهائي» of any topic or chat with everything in it: the OWNER's, while the menu is on. */
  canPurge?: boolean;
  /** The lists (`space:<id>`, the DM list's own scope) that have the person's own saved order. */
  ordered?: string[];
  /** The scope the person's private chats are ordered under (`dm` or `dm:<spaceId>`). */
  dmScope?: string;
}

export interface MemberDto {
  id: string;
  name: string;
  online: boolean;
  role?: string;
  muted?: boolean;
  avatarUrl?: string | null;
}

export interface ReaderDto {
  userId: string;
  name: string;
  messageId: string;
  /** when this person last read (their own read mark): «who and when» */
  readAt?: string;
  avatarUrl?: string | null;
}

export interface ConversationDto {
  id: string;
  kind: ConversationKind;
  title: string;
  emoji: string | null;
  topicType?: TopicType;
  postingPolicy?: PostingPolicy;
  restricted?: boolean;
  /** The «مقطع» the topic belongs to (null: the whole space's, or not a topic). */
  teamId?: string | null;
  pinned?: boolean;
  archived?: boolean;
  closed: boolean;
  space?: { id: string; name: string; hasExternal: boolean } | null;
  /**
   * «آخر ظهور» of the other person of a PRIVATE chat (a DM only; never on a topic or a group). An ISO time, null (unknown or
   * hidden), or ABSENT (the company's switch is off, or a guest asks). `timeZone` (the company's) comes with it.
   */
  peerLastSeenAt?: string | null;
  timeZone?: string;
  /** `canJoin`: the OWNER in oversight of an open topic may join it («شارك بالمحادثة») to post there. */
  me: {
    canPost: boolean;
    canModerate: boolean;
    muted: boolean;
    oversight: boolean;
    canJoin: boolean;
    /** may turn a message into a task or a ticket (not a guest, not in silent oversight) */
    canMakeWork?: boolean;
    /** may start a call here: the calls row's «يضيف ويعدّل» box of the section grid (absent: yes; the server decides again) */
    canCall?: boolean;
    /** with `canMakeWork`: the tasks / tickets row's «يضيف ويعدّل» box (absent: yes) */
    canMakeTask?: boolean;
    canMakeTicket?: boolean;
    /** may set a reminder for himself on a message (the «ذكّرني» switch is on; not in silent oversight) */
    canRemind?: boolean;
    /** may write «@الكل» here: a topic, not a guest, and may post */
    canMentionAll?: boolean;
    /** may start a poll here: a topic, not a guest, and may post */
    canPoll?: boolean;
    id?: string;
  };
  /** the pinned messages, newest first (the bar on top of the conversation) */
  pinnedMessages?: { id: string; authorName: string; preview: string | null }[];
  members?: MemberDto[];
  /** who the composer offers for «@»: the topic's whole audience (an open topic: its space), not only the rows it has */
  mentionables?: MemberDto[];
  messages: MessageDto[];
  readers: ReaderDto[];
  /** the company's «شكل الرسائل الحديث» switch, read on the server (`src/lib/features.ts`); absent: on */
  chatBubbles?: boolean;
  /** the company's «الرسائل بدون نت» switch (`chatOutbox`): off, the composer neither queues an unsent message nor keeps a draft; absent: on */
  chatOutbox?: boolean;
  /** the company's «المكالمات» switch (`calls`, economy mode applied): off, the header draws no call button; absent: on */
  calls?: boolean;
  /** the company's «السبورة» switch (`whiteboard`, economy mode applied): off, the header draws no link to it; absent: on */
  whiteboard?: boolean;
  /** the company's «الرسائل الصوتية» switch (`voiceNotes`): off, the composer draws no microphone; absent: on */
  voiceNotes?: boolean;
  /** pagination: the oldest message id on the page; pass it as `before` for the next page. */
  oldestId?: string | null;
}

export interface OversightConversationDto {
  id: string;
  kind: ConversationKind;
  title: string;
  emoji: string | null;
  spaceId: string | null;
  spaceName: string | null;
  membersCount: number;
  lastMessageAt: string | null;
  /** a DM's two people («خاص: سارة وأحمد») */
  names?: string[];
}

export type ArchiveType = "deleted" | "edited" | "moderation" | "closed";

export interface ArchiveItemDto {
  type: ArchiveType;
  /** deleted / edited: the message. moderation: the audit entry. closed: the topic. */
  id: string;
  conversationId: string | null;
  spaceId: string | null;
  spaceName: string | null;
  /** deleted / edited */
  messageId?: string;
  body?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  at?: string | null;
  /** deleted: who deleted it and when */
  deletedById?: string | null;
  deletedByName?: string | null;
  deletedAt?: string | null;
  /** edited: the version BEFORE the edit */
  previousBody?: string | null;
  /** moderation */
  action?: string | null;
  actorName?: string | null;
  targetName?: string | null;
  meta?: Record<string, unknown> | null;
  /** closed */
  title?: string | null;
}

export interface ArchivePageDto {
  items: ArchiveItemDto[];
  /** pass as `cursor` for the next page; null when there is nothing older. */
  nextCursor: string | null;
}

export interface DirectoryPersonDto {
  userId: string;
  role: string;
  name: string;
  jobTitle: string | null;
  avatarUrl?: string | null;
  /** «آخر ظهور»: an ISO time, null (unknown or hidden), or ABSENT (switch off / a guest asks); see services/last-seen.ts */
  lastSeenAt?: string | null;
}

/** A search hit in the chat (src/server/chat/search.ts). */
export interface MessageHitDto {
  id: string;
  conversationId: string;
  /** the topic's name, or the other person's name in a DM */
  conversationTitle: string;
  authorName: string;
  at: string;
  /** a piece of the message around the words searched */
  snippet: string;
}

export interface TopicHitDto {
  id: string;
  title: string;
  emoji: string | null;
}
