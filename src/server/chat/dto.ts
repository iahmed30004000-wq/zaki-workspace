/**
 * The TypeScript shapes of every chat response (Phase 3). Dates are ISO strings, so a
 * DTO crosses a JSON boundary unchanged; the UI agents import these with `import type`.
 */

export type TopicType = "DISCUSSION" | "ANNOUNCEMENTS" | "TASKS" | "IDEAS" | "FOLLOWUP";
export type PostingPolicy = "ALL" | "ADMINS";
export type ConversationKind = "DM" | "GROUP" | "TOPIC";
export type MessageKind = "TEXT" | "VOICE" | "SYSTEM" | "POLL" | "CARD";

/** What a CARD message points at (Q1.3): never a price, never a name — each reader's screen asks for the card. */
export type CardRefDto = { type: "product"; cardId: string } | { type: "order"; number: string };

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

/** One person behind a reaction chip («مين تفاعل», S5.6). `me` only on the viewer's own row. */
export interface ReactorDto {
  id: string;
  name: string;
  /** `/api/avatars/<id>`; never for a guest */
  avatar?: string | null;
  me?: true;
}

export interface ReactionDto {
  /** a unicode emoji, or a known Zaki code (`:zaki_clap:`) */
  emoji: string;
  /** the truth: how many people reacted, whoever the viewer may name */
  count: number;
  mine: boolean;
  /**
   * «مين تفاعل» (S5.6): the people who reacted with it, at most `REACTORS_CAP` of them, only those THIS viewer may be told: a guest sees only himself; the ✅ of «لازم ينقرأ» (a
   * receipt) names its people to the author, the moderators and the owner only. `count` may be larger than `by.length`; absent when nobody is named.
   */
  by?: ReactorDto[];
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

/**
 * «معاينة الرابط» (C3b.2): the card under a message's first link, as ONE viewer receives it. Never on a deleted message. The words are the page's, cleaned by the server
 * (plain text: the screen draws them as text, never as markup). `image` is the app's own address (`/api/chat/messages/<id>/preview/image`), never the site's.
 */
export interface LinkPreviewDto {
  /** the page's address (https, no `#`): what the card opens */
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
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
  /** «إشارة التوثيق» (S5.5): the author carries the check badge. `true` only when it is so (absent otherwise, never `false`), never for a guest viewer, and never while the company's switch `verifiedBadge` is off; no time and no granter travel with it. */
  authorVerified?: boolean;
  createdAt: string;
  clientId?: string | null;
  /** `quote` (S5.7, «رد بالاقتباس»): the piece of the original the sender picked; present only with a live original, plain text (the screen escapes it) */
  replyTo?: { id: string; preview: string | null; authorName: string; deleted?: boolean; quote?: string } | null;
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
  /** A CARD message: the card it points at. */
  card?: CardRefDto;
  /** «معاينة الرابط» (C3b.2): the card of the first link; absent when there is none, on a deleted message, and while the company's switch `linkPreviews` is off. */
  preview?: LinkPreviewDto;
  /** «ابعت بدون صوت» (C3c.2): the sender chose silence; `true` only when it was, absent otherwise. The screen makes no arrival sound for it (`arrivalSoundOf`); it is read, counted as unread and shown like any message. */
  silent?: boolean;
  /** «لازم ينقرأ» (Q1.6): absent unless the message must be read and the viewer is staff. `mine`: the viewer is one of the people it must reach; `acked`: they tapped «قرأت ✓». The author and the moderators also get the count and who has not read. */
  mustRead?: { mine: boolean; acked: boolean; total?: number; read?: number; missing?: { id: string; name: string }[] };
  /** the tasks and tickets made from this message («صارت مهمة»). */
  work?: { kind: "task" | "ticket"; id: string; /** a ticket: its number, state and who holds it (the live chip, Q1.5) */ number?: number; status?: string; assigneeName?: string | null }[];
  /** «نتفرّج سوا»: the second of the video it was written at. */
  videoAtSec?: number | null;
  /**
   * CLIENT ONLY (C1.8) — the server never sends it. A message of mine that is drawn before the server has it: its id is `pending:<clientId>`
   * (a server id never has a colon), `sending` shows the clock, `failed` the red «!» with `reason` (a dictionary key). It is replaced in place by the
   * server's message of the same `clientId`, and a pending copy is never sent to anybody else.
   */
  pending?: { state: "sending" | "failed"; reason?: string };
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
  /** «إشارة التوثيق» (S5.5): `true` only when the person carries the badge; absent otherwise and for a guest viewer. */
  verified?: boolean;
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
  /**
   * A private conversation only (a DM, a group, a restricted or a «مقطع»'s topic): true when somebody who is not in it
   * holds silent oversight (`archive.view`), false when nobody does. ABSENT for an open topic. The sheet says so honestly (P0.4).
   */
  oversightNotice?: boolean;
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
    /** may translate a message (`messageTranslate` and the assistant are on, staff, no guest in the conversation); absent: no «ترجم» item */
    canTranslate?: boolean;
    /** may write «@الكل» here: a topic, not a guest, and may post */
    canMentionAll?: boolean;
    /** may start a poll here: a topic, not a guest, and may post */
    canPoll?: boolean;
    /** may open the «/» menu here (Q1.3): staff who may post, with `quickRecall` and `knowledgeCards` on */
    canRecall?: boolean;
    /** what the «/» menu offers here (Q1.3, Q1.4): «منتج» and «رد» need `knowledgeCards`, «طلب» needs `orderStatus` and `omsLink` */
    recallKinds?: Array<"product" | "reply" | "order">;
    /** an order number in a message may be a chip here (Q1.4): staff, `orderStatus` and `omsLink` on */
    canOrderState?: boolean;
    /** may mark a message «لازم ينقرأ» here (Q1.6): the switch is on, a topic, a moderator or a holder of «إعلانات للجميع» */
    canMustRead?: boolean;
    /** the hint line for customer data typed into an open topic is on (Q1.7): the switch is on and the person is staff */
    orderHints?: boolean;
    /** «🎫 مشكلة» (Q1.5): the kinds of problem, and the company's rules for this open topic so the screen can offer «بدك تعمليها تذكرة؟» (absent: the switch is off or a guest) */
    problemKinds?: Array<{ key: string; label: string; needsFollowUp?: boolean; needsRecording?: boolean }>;
    problemRules?: Array<{ id: string; type: "topic" | "content"; spaceId: string; conversationId?: string; kindKey: string; mode: "suggest" | "auto"; problemWords?: string[] }>;
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
  /** the company's «معاينة الروابط بالدردشة» switch (`linkPreviews`, C3b.2): off, the composer draws no line about a preview and a bubble draws no card; absent: off */
  linkPreviews?: boolean;
  /** the company's «إيموجي زكي» switch (`zakiEmojis`): off, the emoji picker has no «ذكي» tab; absent: on (a bubble draws a code it already holds either way) */
  zakiEmojis?: boolean;
  /** the company's «الإرسال بدون صوت» switch (`chatSilentSend`, C3c.2): off, the send button's menu has no «ابعت بدون صوت»; absent: on */
  silentSend?: boolean;
  /** the company's «تنسيق الرسائل» switch (`chatFormatting`, C3b.1): off, the composer draws no formatting toolbar and a bubble shows its markers as typed; absent: on */
  chatFormatting?: boolean;
  /** the company's «ألبومات الصور» switch (`chatAlbums`, C3b.3): off, a message's pictures are not drawn as one mosaic; absent: on */
  chatAlbums?: boolean;
  /** «جدول الإرسال» (C3c.3): how many messages of MINE are waiting in this conversation. ABSENT: the switch is off, or I may not write here (the composer asks no list then) */
  scheduled?: number;
  /** the company's «المكالمات» switch (`calls`, economy mode applied): off, the header draws no call button; absent: on */
  calls?: boolean;
  /** the company's «السبورة» switch (`whiteboard`, economy mode applied): off, the header draws no link to it; absent: on */
  whiteboard?: boolean;
  /** the company's «الرسائل الصوتية» switch (`voiceNotes`): off, the composer draws no microphone; absent: on */
  voiceNotes?: boolean;
  /** «كتابة نص الرسالة الصوتية» (`voiceTranscript`): the switch is on AND a speech-to-text service is set up; absent or false: no «اكتب النص» button */
  voiceTranscript?: boolean;
  /** «قراءة نص الصور» (`imageOcr`): the switch is on, a vision service is set up AND no guest can reach this conversation; absent or false: no «اقرا النص» button under a picture */
  imageOcr?: boolean;
  /** «لخّصلي» (`morningDigest`): the switches are on, a provider is ready, and this is a topic of staff; absent or false: no button */
  digest?: boolean;
  /** the owner's OWN conversation with the assistant and «المرشد» is on: the header's call button rings the assistant (the guide's voice call) */
  assistantCall?: boolean;
  /** pagination: the oldest message id on the page; pass it as `before` for the next page. */
  oldestId?: string | null;
}

/**
 * ---------- C1.2: the list, the header, the pages and the sync feed ----------
 * The same privacy rules as the old detail: everything here is built from rows the policy let through, and a message only ever
 * leaves through `presentMessage` (redact.ts).
 */

/** What a row of the chat list is: a private chat, a group, a whole space (the forum row of «قائمة وحدة») or one topic of a space. */
export type ChatRowKind = "DM" | "GROUP" | "SPACE" | "TOPIC";

export interface ChatRowLastMessageDto {
  id: string;
  authorName: string;
  /** null: a deleted message (the row says «رسالة محذوفة»); a system line is its own sentence */
  preview: string | null;
  kind: MessageKind;
  at: string;
  mine: boolean;
  /** a private chat, on my own last message: sent | delivered | read (the owner's silent reading never shows) */
  status?: "sent" | "delivered" | "read";
}

export interface ChatRowDto {
  /** the conversation's id; for a SPACE row the space's id */
  id: string;
  kind: ChatRowKind;
  title: string;
  emoji: string | null;
  /** a private chat: the other person's picture (never for a guest, who has no private chats) */
  avatarUrl?: string | null;
  /** a private chat: who is on the other side */
  peerId?: string;
  /** a private chat: the other person carries the check badge «إشارة التوثيق» (S5.5): `true` only, absent otherwise, never for a guest, never while the switch `verifiedBadge` is off */
  verified?: boolean;
  /** the space a topic or a private chat belongs to (the small chip on a row of the one list); a private chat of the old days is «الشركة»'s */
  space: { id: string; name: string } | null;
  lastMessage: ChatRowLastMessageDto | null;
  unread: number;
  mentionsUnread: number;
  /** my own mute of this conversation; a SPACE is muted when every topic I take part in is */
  muted: boolean;
  /** C3a.1, «لإلي بس»: my own pin, my own archive (an unmuted chat that a message came to after the archive is not archived any more) and my «علّم كغير مقروء»; all false while `chatPersonalState` is off */
  pinnedByMe: boolean;
  archivedByMe: boolean;
  markedUnread: boolean;
  /** a topic made for named people (a lock on the row) */
  restricted: boolean;
  /** SPACE: the first three topics (unread first, then the newest), for the chips under the name */
  topicChips?: { id: string; title: string; emoji: string | null; unread: number }[];
  /** SPACE: how many topics of it I read */
  topicCount?: number;
  /** SPACE: an external partner is in it */
  hasExternal?: boolean;
  /** SPACE: the viewer manages it (opens topics, moderates) */
  canModerate?: boolean;
  /** TOPIC */
  topicType?: TopicType;
  /** TOPIC: who may write here (C3c.4): an announcements topic that a manager opened to everybody (`ALL`) is not drawn as a channel */
  postingPolicy?: PostingPolicy;
  closed?: boolean;
  pinned?: boolean;
  archived?: boolean;
  teamId?: string | null;
  system?: boolean;
}

export interface ChatListDto {
  /** `all`: every space and private chat of the person (D-N2 «قائمة وحدة»); `space`: one space, as the old home (D-N2 «كل مساحة حساب») */
  scope: "all" | "space";
  spaceId: string | null;
  rows: ChatRowDto[];
  canOversee: boolean;
  /** the company's switch `chatPersonalState` (C3a.1): off, the menu draws no personal item and no «الأرشيف» tab; a copy saved before it existed has no field and reads as on */
  personal?: boolean;
}

/** `GET /api/chat/spaces/[spaceId]/topics`: the forum view of one space. */
export interface SpaceTopicsDto {
  space: { id: string; name: string; emoji: string | null; canModerate: boolean; canCreateTopic: boolean };
  rows: ChatRowDto[];
}

/** Who reads a conversation, in one line (the header's «ومين بيشوف»). */
export interface AudienceDto {
  type: "SPACE" | "TEAM" | "PEOPLE" | "PAIR" | "GROUP";
  /** how many people it reaches (an open topic: its space's people) */
  count: number;
}

/** `GET /api/chat/conversations/[id]/header`: everything of the old detail except the messages and the member list. */
export type ConversationHeaderDto = Omit<ConversationDto, "messages" | "readers" | "oldestId" | "members" | "mentionables"> & {
  audience: AudienceDto;
  memberCount: number;
  /** a private chat: the other person */
  peer?: { id: string; name: string; avatarUrl?: string | null; /** «إشارة التوثيق» (S5.5): `true` only, absent otherwise and for a guest */ verified?: boolean };
};

/** `GET /api/chat/conversations/[id]/messages`: one window of a conversation, oldest first. */
export interface MessagesPageDto {
  messages: MessageDto[];
  hasOlder: boolean;
  hasNewer: boolean;
  /** the oldest message I have not read (not mine, not deleted, not a system line); null when there is none or I have no read mark here */
  firstUnreadId: string | null;
  /** topics and groups: each person's avatar under the last message of THIS window they have read (a private chat has ticks instead) */
  readers: ReaderDto[];
}

/** `GET /api/chat/sync`: the delta feed («get difference»). Every message in it is presented for the person who asked. */
export interface SyncDto {
  /** the newest `RealtimeEvent.id` this answer covers: send it back as `after` */
  cursor: string;
  /** `after` is older than the 48 h retention (or ahead of anything issued): reload the list and the open chat, then continue from `cursor` */
  reset?: true;
  /** the answer stopped at `limit` events: ask again at once */
  more?: true;
  messages: MessageDto[];
  reads: { conversationId: string; userId: string; lastReadAt: string }[];
  delivered: { conversationId: string; userId: string; lastDeliveredAt: string }[];
  /** the rows whose summary changed: the conversation's own row and the row of its space */
  rows: ChatRowDto[];
  /** conversations the person can no longer read (left, made private, a peer who left the company, deleted) */
  removed: string[];
  /** S5.7, «حذف عندي»: the messages this person hid for themselves since the cursor (ids only: their other devices take them out of the windows); absent when none */
  hidden?: string[];
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
  /** «إشارة التوثيق» (S5.5): `true` only when the person carries the badge; absent otherwise and while the switch is off */
  verified?: boolean;
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
  /** found by meaning, not by the words («بحث بالمعنى»): drawn as «بمعنى قريب» */
  semantic?: boolean;
}

export interface TopicHitDto {
  id: string;
  title: string;
  emoji: string | null;
}
