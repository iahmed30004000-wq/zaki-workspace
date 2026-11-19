import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";
import { isAssistantChatKey } from "@/lib/chat/assistant-chat";
import { MENTION_ALL_ID } from "@/lib/chat/conversation/mentions";
import { featureOn, type FeatureKey } from "@/lib/features";
import { systemSentenceOfBody } from "@/lib/chat/system-sentence";
import { can as capsCan, effectiveCapabilities, type Capability, type CapabilitySource } from "@/server/policy/capabilities";
import { sectionGridOf } from "@/server/policy/section-grid";
import { canRead, hasOversight, loadOrgFacts, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import type { ChatListDto, ChatRowDto, ChatRowLastMessageDto, MessageKind } from "@/server/chat/dto";
import { previewOf } from "@/server/chat/redact";
import { dmStatusFor } from "@/server/chat/messages";
import { archivedByMeSql, personalOnSql } from "@/server/chat/read-state";
import { SAVED_TITLE_KEY } from "@/server/chat/dm";
import { AR } from "@/lib/i18n/dict";

/**
 * C1.2 — THE CHAT LIST, and the batch of conversation facts the sync feed decides with.
 *
 * ONE query reads the conversations a person may see together with everything a row needs (the newest message, how many
 * are unread, how many mention them, the other person of a private chat, the viewer's own rows in the conversation and
 * its space). Nothing loops over the conversations with a query of its own. The decision itself is `canRead` of
 * `src/server/policy/conversation.ts`, applied to the rows that query returned (never one `canRead` per row against the
 * database): the SQL only narrows what is loaded, the policy has the last word, so the two can only disagree in the safe
 * direction (a row the SQL lets through and the policy refuses is dropped).
 *
 * The rules of the list are the old home's (`chatHome`, `listDms`) plus P0.1: an open topic is its space's people's; a
 * restricted topic its own people's (the silent eye `archive.view` sees them in the list too); a topic of a «مقطع» its
 * people's and the space's managers'; a private chat only its two people (the silent eye reads other people's chats through
 * the oversight list, never through this one); a guest has topics only; an archived topic is its managers' only; somebody
 * else's conversation with the assistant is never listed.
 */

// ───────────────────────────────────────── the request scope ─────────────────────────────────────────

/**
 * What ONE request reads once. React's `cache()` has no scope inside a route handler in Next 14 (F1.1 recorded it), so the
 * company's settings and the person's company facts are kept on the request's own `ctx` object (`activeOrgCtx()` makes a new
 * one for every request). A WeakMap keyed by it lives exactly as long as the request: nothing is shared between two
 * requests, two people or two companies. Pass the SAME ctx through a whole request; a test that flips a switch between
 * two calls builds a fresh ctx.
 */
export interface ChatScope {
  /** `Organization.settings`, read once */
  settings(): Promise<unknown>;
  /** the company's switch (economy mode applied), from the one read of the settings */
  feature(key: FeatureKey): Promise<boolean>;
  /** the viewer's rank, status and oversight in the company, read once */
  org(): Promise<OrgFacts | null>;
  /** the viewer's capabilities (their box of switches), read once: the header asks three or four */
  can(capability: Capability, opts?: { spaceGuestsPass?: boolean }): Promise<boolean>;
}

const scopes = new WeakMap<object, ChatScope>();

export function chatScope(ctx: OrgAccessContext): ChatScope {
  const known = scopes.get(ctx);
  if (known) return known;
  let settings: Promise<unknown> | null = null;
  let org: Promise<OrgFacts | null> | null = null;
  let member: Promise<CapabilitySource & { status: string }  | null> | null = null;
  const scope: ChatScope = {
    settings: () => (settings ??= db.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } }).then((o) => o?.settings ?? {})),
    feature: async (key) => featureOn(await scope.settings(), key),
    org: () => (org ??= loadOrgFacts(ctx.userId, ctx.orgId)),
    can: async (capability, opts = {}) => {
      member ??= db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
        select: { status: true, role: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
      });
      const m = await member;
      if (!m || m.status !== "ACTIVE") return false;
      // the same rule as `memberCan`: a guest passes where the space's own rules decide, everybody else needs the box
      if (opts.spaceGuestsPass && m.role === "GUEST") return true;
      return capsCan(m, capability, { sectionGrid: sectionGridOf(await scope.settings()) });
    },
  };
  scopes.set(ctx, scope);
  return scope;
}

// ───────────────────────────────────────── who is asking ─────────────────────────────────────────

export interface ListViewer {
  userId: string;
  orgId: string;
  org: OrgFacts;
  /** the request's scope: the company's switches are read once from it (the list's answer says whether `chatPersonalState` is on) */
  scope: ChatScope;
  /** the OWNER rank: a space ADMIN of every space (management), with or without oversight */
  ownerRank: boolean;
  /** silent oversight (`archive.view`) */
  oversight: boolean;
  guest: boolean;
  orgAdmin: boolean;
}

export function listViewerOf(ctx: OrgAccessContext, org: OrgFacts): ListViewer {
  return {
    userId: ctx.userId,
    orgId: ctx.orgId,
    org,
    scope: chatScope(ctx),
    ownerRank: org.status === "ACTIVE" && org.role === "OWNER", // oversight-ok: the rank is a space ADMIN of every space; what he reads in silence is `oversight`
    oversight: hasOversight(org),
    guest: org.role === "GUEST",
    orgAdmin: org.status === "ACTIVE" && org.role === "ADMIN",
  };
}

/** The people (of these) whose reading is silent: an OWNER-rank person who still holds `archive.view`. Their read marks never show. */
export async function silentOwnerIds(orgId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db.organizationMember.findMany({
    // all-statuses: the owner's silence holds whatever his status
    // oversight-ok: whose read marks are hidden - the OWNER rank who still holds archive.view (filtered below)
    where: { organizationId: orgId, role: "OWNER", userId: { in: userIds } },
    select: { userId: true, role: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
  });
  return new Set(rows.filter((o) => effectiveCapabilities(o).has("archive.view")).map((o) => o.userId));
}

// ───────────────────────────────────────── the one query ─────────────────────────────────────────

/** One conversation as the query returns it: the policy's facts, the viewer's rows, the other person of a private chat, and (with stats) the row's numbers. */
export interface ConvRecord {
  id: string;
  orgId: string;
  kind: "DM" | "GROUP" | "TOPIC";
  title: string | null;
  emoji: string | null;
  spaceId: string | null;
  topicType: string;
  restricted: boolean;
  postingPolicy: string;
  closedAt: Date | null;
  archivedAt: Date | null;
  pinnedAt: Date | null;
  systemKey: string | null;
  dmKey: string | null;
  teamId: string | null;
  position: number;
  createdAt: Date;
  // the viewer's own rows
  isMember: boolean;
  groupRole: string | null;
  lastReadAt: Date | null;
  mutedUntil: Date | null;
  spaceRole: "ADMIN" | "MEMBER" | "GUEST" | null;
  spaceMutedUntil: Date | null;
  viewerInTeam: boolean;
  // the space the conversation is shown under (a private chat of the old days is «الشركة»'s)
  shownSpaceId: string | null;
  shownSpaceName: string | null;
  // the other person of a private chat
  peerId: string | null;
  peerName: string | null;
  peerAvatar: string | null;
  peerStatus: string | null;
  peerRole: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST" | null;
  peerCapabilities: string[] | null;
  peerRevoked: string[] | null;
  peerPrimaryOwner: boolean | null;
  peerLastReadAt: Date | null;
  peerLastDeliveredAt: Date | null;
  /** C3a.3: «الرسائل المحفوظة» — a private chat whose two people are the same person (no other person, no ticks, no call) */
  selfDm?: boolean;
  /** C3a.3: a saved chat while the company's switch `savedMessages` is off: not listed for anybody (the data stays) */
  savedHidden?: boolean;
  // with stats
  lmId?: string | null;
  lmBody?: string | null;
  lmKind?: string | null;
  lmDeletedAt?: Date | null;
  lmCreatedAt?: Date | null;
  lmAuthorId?: string | null;
  lmAuthorName?: string | null;
  // C3a.1: the viewer's OWN pin, archive (as it stands now: an unmuted one a message came after is not) and mark; all empty while `chatPersonalState` is off
  myPinnedAt?: Date | null;
  archivedByMe?: boolean;
  markedUnreadByMe?: boolean;
  unreadCount?: number;
  mentionCount?: number;
  hasExternal?: boolean;
}

export type ListFilter =
  /** everything the person may see (the one list) */
  | { all: true }
  /** one space: its topics, and its private chats (in «الشركة» also the ones from before spaces had them) */
  | { spaceId: string }
  /** these conversations, and every conversation of these spaces (the rows a sync answer sends) */
  | { ids: string[]; spaceIds?: string[] };

function scopeSql(f: ListFilter, userId: string): Prisma.Sql {
  if ("all" in f) return Prisma.empty;
  if ("spaceId" in f) {
    // the person's saved chat (C3a.3) belongs to them, not to a space: it is in the list of every space they are in
    return Prisma.sql`AND (c."spaceId" = ${f.spaceId} OR c."dmKey" = ${`${userId}|${userId}`} OR (c."spaceId" IS NULL AND c.kind <> 'TOPIC' AND EXISTS (SELECT 1 FROM "Workspace" h WHERE h.id = ${f.spaceId} AND h."systemKey" = 'hq')))`;
  }
  const spaces = f.spaceIds ?? [];
  return spaces.length
    ? Prisma.sql`AND (c.id = ANY(${f.ids}::text[]) OR c."spaceId" = ANY(${spaces}::text[]))`
    : Prisma.sql`AND c.id = ANY(${f.ids}::text[])`;
}

/**
 * SQL: the company's switch `savedMessages` (C3a.3), read INSIDE the list's one query like `personalOnSql` (the sync feed reads no settings of its own). The same rule as
 * `featureOn`: a stored boolean wins, anything else is the default, which is ON.
 */
export function savedOnSql(orgId: string): Prisma.Sql {
  return Prisma.sql`COALESCE(
    (SELECT CASE WHEN jsonb_typeof(o.settings -> 'features' -> 'savedMessages') = 'boolean' THEN (o.settings -> 'features' ->> 'savedMessages')::boolean END
     FROM "Organization" o WHERE o.id = ${orgId}),
    true
  )`;
}

/** The list's own rule, as SQL: what narrows the rows that are loaded. `canRead` decides afterwards. */
function visibleSql(v: ListViewer): Prisma.Sql {
  const notGuest = !v.guest;
  return Prisma.sql`(
    (c.kind = 'DM' AND cm.id IS NOT NULL AND ${notGuest}::boolean AND (${v.oversight}::boolean OR pom.status = 'ACTIVE'))
    OR (c.kind = 'GROUP' AND cm.id IS NOT NULL AND ${notGuest}::boolean)
    OR (
      c.kind = 'TOPIC'
      AND (${v.oversight}::boolean OR wm.id IS NOT NULL OR ${v.ownerRank}::boolean)
      AND (${v.oversight}::boolean OR c.restricted = false OR cm.id IS NOT NULL)
      AND (
        ${v.oversight}::boolean OR c."teamId" IS NULL OR ${v.ownerRank}::boolean OR wm.role = 'ADMIN' OR ${v.orgAdmin}::boolean
        OR EXISTS (SELECT 1 FROM "TeamMember" tmv WHERE tmv."teamId" = c."teamId" AND tmv."userId" = ${v.userId})
      )
      AND (c."archivedAt" IS NULL OR ${v.ownerRank}::boolean OR wm.role = 'ADMIN')
      AND NOT (COALESCE(c."dmKey" LIKE 'assistant|%', false) AND cm.id IS NULL)
    )
  )`;
}

/**
 * The query. `visibleOnly` narrows to the list's own rule (the list); the sync feed loads the facts of every conversation
 * its events name and lets the policy decide, because it also has to know which of them the person lost.
 */
async function queryConversations(v: ListViewer, f: ListFilter, opts: { stats: boolean; visibleOnly: boolean }): Promise<ConvRecord[]> {
  const uid = v.userId;
  const stats = opts.stats;
  // C3a.1: the company's switch is read INSIDE this query (the sync feed reads no settings of its own); off: the row says none of it and the data stays
  const personal = personalOnSql(v.orgId);
  const statSelect = stats
    ? Prisma.sql`,
      CASE WHEN ${personal} THEN cm."pinnedAt" END AS "myPinnedAt",
      ${archivedByMeSql(v.orgId)} AS "archivedByMe",
      (${personal} AND COALESCE(cm."markedUnread", false)) AS "markedUnreadByMe",
      lm.id AS "lmId", lm.body AS "lmBody", lm.kind AS "lmKind", lm."deletedAt" AS "lmDeletedAt", lm."createdAt" AS "lmCreatedAt", lm."authorId" AS "lmAuthorId", lm."authorName" AS "lmAuthorName",
      COALESCE(un.n, 0)::int AS "unreadCount", COALESCE(un.mn, 0)::int AS "mentionCount",
      CASE WHEN c.kind = 'TOPIC' AND ${!v.guest}::boolean THEN EXISTS (
        SELECT 1 FROM "WorkspaceMember" g JOIN "OrganizationMember" gom ON gom."userId" = g."userId" AND gom."organizationId" = c."orgId"
        WHERE g."workspaceId" = c."spaceId" AND g.role = 'GUEST' AND gom.role = 'GUEST' AND gom.status = 'ACTIVE'
      ) ELSE false END AS "hasExternal"`
    : Prisma.empty;
  const statJoin = stats
    ? Prisma.sql`
    LEFT JOIN LATERAL (
      -- the newest message, a deleted one included (its text never leaves the database: the row shows «رسالة محذوفة»)
      SELECT m.id, CASE WHEN m."deletedAt" IS NULL THEN m.body END AS body, m.kind, m."deletedAt", m."createdAt", m."authorId", au.name AS "authorName"
      FROM "ChatMessage" m JOIN "User" au ON au.id = m."authorId"
      WHERE m."conversationId" = c.id
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      -- unread and mentions come from the read mark, never from a stored counter; a system line never counts; silent oversight and an archived topic count nothing
      SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE m.mentions && ARRAY[${uid}, ${MENTION_ALL_ID}]::text[]) AS mn
      FROM "ChatMessage" m
      WHERE m."conversationId" = c.id AND m."authorId" <> ${uid} AND m."deletedAt" IS NULL AND m.kind <> 'SYSTEM'
        AND (cm.id IS NULL OR m."createdAt" > cm."lastReadAt")
        AND (${v.oversight}::boolean = false OR cm.id IS NOT NULL)
        AND c."archivedAt" IS NULL
    ) un ON true`
    : Prisma.empty;
  const where = opts.visibleOnly ? Prisma.sql`AND ${visibleSql(v)}` : Prisma.empty;

  return db.$queryRaw<ConvRecord[]>(Prisma.sql`
    SELECT c.id, c."orgId", c.kind, c.title, c.emoji, c."spaceId", c."topicType", c.restricted, c."postingPolicy", c."closedAt", c."archivedAt", c."pinnedAt",
      c."systemKey", c."dmKey", c."teamId", c.position, c."createdAt",
      (cm.id IS NOT NULL) AS "isMember", cm.role AS "groupRole", cm."lastReadAt" AS "lastReadAt", cm."mutedUntil" AS "mutedUntil",
      wm.role::text AS "spaceRole", wm."mutedUntil" AS "spaceMutedUntil",
      (c."teamId" IS NOT NULL AND EXISTS (SELECT 1 FROM "TeamMember" tmx WHERE tmx."teamId" = c."teamId" AND tmx."userId" = ${uid})) AS "viewerInTeam",
      w.id AS "shownSpaceId", w.name AS "shownSpaceName",
      po.id AS "peerId", pu.name AS "peerName", pu."avatarUrl" AS "peerAvatar", pom.status::text AS "peerStatus", pom.role::text AS "peerRole",
      pom.capabilities AS "peerCapabilities", pom."revokedCapabilities" AS "peerRevoked", pom."primaryOwner" AS "peerPrimaryOwner",
      pcm."lastReadAt" AS "peerLastReadAt", pcm."lastDeliveredAt" AS "peerLastDeliveredAt",
      (c.kind = 'DM' AND po.id = ${uid} AND split_part(split_part(c."dmKey", '@', 1), '|', 1) = split_part(split_part(c."dmKey", '@', 1), '|', 2)) AS "selfDm",
      (c.kind = 'DM' AND split_part(split_part(c."dmKey", '@', 1), '|', 1) <> '' AND split_part(split_part(c."dmKey", '@', 1), '|', 1) = split_part(split_part(c."dmKey", '@', 1), '|', 2) AND NOT ${savedOnSql(v.orgId)}) AS "savedHidden"
      ${statSelect}
    FROM "Conversation" c
    LEFT JOIN "ConversationMember" cm ON cm."conversationId" = c.id AND cm."userId" = ${uid}
    LEFT JOIN "WorkspaceMember" wm ON wm."workspaceId" = c."spaceId" AND wm."userId" = ${uid}
    LEFT JOIN "Workspace" hq ON hq."organizationId" = c."orgId" AND hq."systemKey" = 'hq' AND c."spaceId" IS NULL AND c.kind <> 'TOPIC'
    LEFT JOIN "Workspace" w ON w.id = COALESCE(c."spaceId", hq.id)
    LEFT JOIN LATERAL (
      -- the other person of a private chat: from its key when it has one (a row lost on one side must not turn the other into nobody), else from the rows
      SELECT COALESCE(
        NULLIF(CASE WHEN split_part(split_part(c."dmKey", '@', 1), '|', 1) = ${uid}
                    THEN split_part(split_part(c."dmKey", '@', 1), '|', 2)
                    ELSE split_part(split_part(c."dmKey", '@', 1), '|', 1) END, ''),
        (SELECT x."userId" FROM "ConversationMember" x WHERE x."conversationId" = c.id AND x."userId" <> ${uid} ORDER BY x."joinedAt" LIMIT 1)
      ) AS id
    ) po ON c.kind = 'DM'
    LEFT JOIN "User" pu ON pu.id = po.id
    LEFT JOIN "OrganizationMember" pom ON pom."organizationId" = c."orgId" AND pom."userId" = po.id
    LEFT JOIN "ConversationMember" pcm ON pcm."conversationId" = c.id AND pcm."userId" = po.id
    ${statJoin}
    WHERE c."orgId" = ${v.orgId} ${scopeSql(f, uid)} ${where}
  `);
}

/** The policy's facts for a row the query returned (no database). */
export function factsOfRecord(r: ConvRecord): ConversationFacts {
  return {
    kind: r.kind,
    orgId: r.orgId,
    spaceId: r.spaceId,
    restricted: r.restricted,
    closedAt: r.closedAt,
    postingPolicy: r.postingPolicy,
    topicType: r.topicType,
    teamId: r.teamId,
    viewerInTeam: r.viewerInTeam,
    viewerIsMember: r.isMember,
    viewerGroupRole: r.groupRole,
    viewerSpaceRole: r.spaceRole,
    mutedUntil: r.spaceMutedUntil,
    dmOtherActive: r.peerStatus === "ACTIVE",
    memberIds: [],
  };
}

/**
 * Is this row in the person's chat list (and in their sync feed)? The policy's `canRead`, plus the list's own rules: a private
 * chat only for its two people (the silent eye reads others' through the oversight list), a guest reads topics only, an archived topic
 * is its managers', and somebody else's conversation with the assistant is never listed.
 */
export function listable(r: ConvRecord, v: ListViewer): boolean {
  if (r.orgId !== v.orgId) return false;
  if (r.savedHidden === true) return false; // C3a.3: the saved chat while its switch is off
  if (r.kind !== "TOPIC") {
    if (v.guest || !r.isMember) return false;
  } else {
    if (isAssistantChatKey(r.dmKey) && !r.isMember) return false;
    if (r.archivedAt && !(v.ownerRank || r.spaceRole === "ADMIN")) return false;
  }
  return canRead(factsOfRecord(r), v.org);
}

/** The space role the viewer holds (an OWNER-rank person is a space ADMIN of every space without a row). */
export const spaceRoleHeld = (r: Pick<ConvRecord, "spaceRole">, v: ListViewer): ConvRecord["spaceRole"] => r.spaceRole ?? (v.ownerRank ? "ADMIN" : null);

/** The facts and rows of these conversations for one person, ONE query; `visible` is what the person may see, `all` everything the query found. */
export async function loadConversationBatch(v: ListViewer, ids: string[]): Promise<{ all: Map<string, ConvRecord>; visible: Map<string, ConvRecord> }> {
  const all = new Map<string, ConvRecord>();
  const visible = new Map<string, ConvRecord>();
  if (!ids.length) return { all, visible };
  for (const r of await queryConversations(v, { ids }, { stats: false, visibleOnly: false })) {
    all.set(r.id, r);
    if (listable(r, v)) visible.set(r.id, r);
  }
  return { all, visible };
}

// ───────────────────────────────────────── rows ─────────────────────────────────────────

/** The other person's marks of a private chat, for the ticks on MY messages; the owner's silent reading never shows as «قرأ». */
export function peerMarks(r: ConvRecord): { lastDeliveredAt: Date | null; lastReadAt: Date | null } | null {
  if (r.kind !== "DM" || !r.peerId || r.selfDm === true) return null; // a chat with myself has no other person whose marks could be read
  return { lastDeliveredAt: r.peerLastDeliveredAt, lastReadAt: peerSilent(r) ? null : r.peerLastReadAt };
}

function peerSilent(r: ConvRecord): boolean {
  if (r.peerRole !== "OWNER") return false;
  return effectiveCapabilities({ role: r.peerRole, capabilities: r.peerCapabilities, revokedCapabilities: r.peerRevoked, primaryOwner: r.peerPrimaryOwner }).has("archive.view");
}

function lastOf(r: ConvRecord, v: ListViewer): ChatRowLastMessageDto | null {
  if (!r.lmId || !r.lmCreatedAt) return null;
  const mine = r.lmAuthorId === v.userId;
  const system = r.lmKind === "SYSTEM";
  const out: ChatRowLastMessageDto = {
    id: r.lmId,
    authorName: r.lmAuthorName ?? "",
    preview: system ? systemSentenceOfBody(r.lmBody ?? "", r.lmAuthorName ?? "") : previewOf(r.lmBody ?? null, r.lmDeletedAt ?? null),
    kind: (r.lmKind ?? "TEXT") as MessageKind,
    at: r.lmCreatedAt.toISOString(),
    mine,
  };
  // no ticks in a chat with myself (C3a.3): nobody else is there to deliver to or read it
  if (r.kind === "DM" && mine && !system && r.selfDm !== true) {
    out.status = dmStatusFor(peerMarks(r), r.lmCreatedAt);
  }
  return out;
}

/** When a row's own pin was made (the newest pin is on top); kept off the DTO, which carries only the yes / no. */
const pinStamp = new WeakMap<object, number>();

const hqChip = (r: ConvRecord) => (r.shownSpaceId ? { id: r.shownSpaceId, name: r.shownSpaceName ?? "" } : null);
const muted = (until: Date | null) => !!until && until > new Date();

/** A conversation's own row (a DM, a group or one topic). */
function conversationRow(r: ConvRecord, v: ListViewer): ChatRowDto {
  const topic = r.kind === "TOPIC";
  const saved = r.selfDm === true;
  const row: ChatRowDto = {
    id: r.id,
    kind: r.kind,
    // «الرسائل المحفوظة» (C3a.3): the dictionary's own line, never my own name; it is the person's, not a space's (no chip)
    title: saved ? (AR[SAVED_TITLE_KEY] ?? "") : r.kind === "DM" ? (r.peerName ?? r.title ?? "") : (r.title ?? ""),
    emoji: r.emoji,
    space: saved ? null : hqChip(r),
    lastMessage: lastOf(r, v),
    unread: r.unreadCount ?? 0,
    mentionsUnread: r.isMember ? (r.mentionCount ?? 0) : 0,
    muted: muted(r.mutedUntil),
    pinnedByMe: !!r.myPinnedAt,
    archivedByMe: r.archivedByMe === true,
    markedUnread: r.markedUnreadByMe === true,
    restricted: topic && r.restricted,
  };
  if (r.myPinnedAt) pinStamp.set(row, r.myPinnedAt.getTime());
  if (r.kind === "DM") {
    row.avatarUrl = saved ? null : r.peerAvatar;
    if (r.peerId) row.peerId = r.peerId; // for «المحفوظة» it is me: the screen knows the chat by that (`isSavedRow`)
  }
  if (topic) {
    row.topicType = r.topicType as ChatRowDto["topicType"];
    row.closed = !!r.closedAt;
    row.pinned = !!r.pinnedAt;
    row.archived = !!r.archivedAt;
    row.teamId = r.teamId;
    row.system = !!r.systemKey;
  }
  return row;
}

const at = (row: ChatRowDto) => (row.lastMessage ? Date.parse(row.lastMessage.at) : 0);

/** One space's forum row, folded from the topics of it the person reads. */
function spaceRow(topics: { rec: ConvRecord; row: ChatRowDto }[], v: ListViewer): ChatRowDto {
  const first = topics[0]!.rec;
  // a topic the moderators archived, or this person archived for themselves (C3a.1), is out of the space's numbers and chips; the forum view still lists it
  const live = topics.filter((t) => !t.rec.archivedAt && !t.row.archivedByMe);
  const unread = live.reduce((n, t) => n + t.row.unread, 0);
  const newest = live.map((t) => t.row.lastMessage).filter((m): m is ChatRowLastMessageDto => !!m).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const chips = [...live].sort((a, b) => Number(b.row.unread > 0) - Number(a.row.unread > 0) || at(b.row) - at(a.row) || a.rec.position - b.rec.position);
  const mine = live.filter((t) => t.rec.isMember);
  const manager = v.ownerRank || first.spaceRole === "ADMIN";
  return {
    id: first.spaceId ?? "",
    kind: "SPACE",
    title: first.shownSpaceName ?? "",
    emoji: null,
    space: first.spaceId ? { id: first.spaceId, name: first.shownSpaceName ?? "" } : null,
    lastMessage: newest,
    unread,
    mentionsUnread: live.reduce((n, t) => n + t.row.mentionsUnread, 0),
    muted: mine.length > 0 && mine.every((t) => t.row.muted),
    pinnedByMe: false,
    archivedByMe: false,
    markedUnread: false,
    restricted: false,
    topicChips: chips.slice(0, 3).map((t) => ({ id: t.rec.id, title: t.rec.title ?? "", emoji: t.rec.emoji, unread: t.row.unread })),
    topicCount: live.length,
    hasExternal: topics.some((t) => t.rec.hasExternal),
    canModerate: manager,
  };
}

/**
 * A topic's order inside its space: archived (by the moderators, or by this person) last; then THEIR own pins (the newest pin on top, C3a.1); then the
 * managers' pins (the newest on top); then the newest activity.
 */
export function byTopicOrder(a: { rec: ConvRecord; row: ChatRowDto }, b: { rec: ConvRecord; row: ChatRowDto }): number {
  return (
    Number(!!a.rec.archivedAt || a.row.archivedByMe) - Number(!!b.rec.archivedAt || b.row.archivedByMe) ||
    Number(b.row.pinnedByMe) - Number(a.row.pinnedByMe) ||
    (b.rec.myPinnedAt?.getTime() ?? 0) - (a.rec.myPinnedAt?.getTime() ?? 0) ||
    (b.rec.pinnedAt?.getTime() ?? 0) - (a.rec.pinnedAt?.getTime() ?? 0) ||
    at(b.row) - at(a.row) ||
    a.rec.position - b.rec.position ||
    (a.rec.title ?? "").localeCompare(b.rec.title ?? "", "ar")
  );
}

/** The conversation rows of the viewer's visible records, newest activity first. */
export function toRows(records: ConvRecord[], v: ListViewer): { rec: ConvRecord; row: ChatRowDto }[] {
  return records.filter((r) => listable(r, v)).map((rec) => ({ rec, row: conversationRow(rec, v) }));
}

/** Folds topics into one row per space. */
export function foldSpaces(items: { rec: ConvRecord; row: ChatRowDto }[], v: ListViewer): ChatRowDto[] {
  const bySpace = new Map<string, { rec: ConvRecord; row: ChatRowDto }[]>();
  for (const it of items) {
    if (it.rec.kind !== "TOPIC" || !it.rec.spaceId) continue;
    bySpace.set(it.rec.spaceId, [...(bySpace.get(it.rec.spaceId) ?? []), it]);
  }
  return [...bySpace.values()].map((topics) => spaceRow(topics.sort(byTopicOrder), v));
}

// ───────────────────────────────────────── the list ─────────────────────────────────────────

/**
 * `GET /api/chat/list`. No `spaceId`: every space as one forum row and every private chat, each with a small space chip
 * (D-N2 «قائمة وحدة»). With `spaceId`: that space's topics and its private chats, like the old home (D-N2 «كل مساحة حساب»).
 * The route picks which one by the company's switch `chatOneList`.
 */
export async function chatList(ctx: OrgAccessContext, opts: { spaceId?: string } = {}): Promise<ChatListDto & { saved?: boolean }> {
  const org = await chatScope(ctx).org();
  if (!org || org.status !== "ACTIVE") return { scope: opts.spaceId ? "space" : "all", spaceId: opts.spaceId ?? null, rows: [], canOversee: false };
  const v = listViewerOf(ctx, org);
  const records = await queryConversations(v, opts.spaceId ? { spaceId: opts.spaceId } : { all: true }, { stats: true, visibleOnly: true });
  const items = toRows(records, v);
  // C3a.1: the person's own pins first (the newest pin on top), the chats they archived last, then the newest activity
  const newestFirst = (a: ChatRowDto, b: ChatRowDto) =>
    Number(a.archivedByMe) - Number(b.archivedByMe) ||
    Number(b.pinnedByMe) - Number(a.pinnedByMe) ||
    (pinStamp.get(b) ?? 0) - (pinStamp.get(a) ?? 0) ||
    at(b) - at(a) ||
    a.title.localeCompare(b.title, "ar");
  const rows = opts.spaceId
    ? [...items.filter((i) => i.rec.kind === "TOPIC").sort(byTopicOrder).map((i) => i.row), ...items.filter((i) => i.rec.kind !== "TOPIC").map((i) => i.row).sort(newestFirst)]
    : [...foldSpaces(items, v), ...items.filter((i) => i.rec.kind !== "TOPIC").map((i) => i.row)].sort(newestFirst);
  return { scope: opts.spaceId ? "space" : "all", spaceId: opts.spaceId ?? null, rows, canOversee: v.oversight, personal: await v.scope.feature("chatPersonalState"), saved: !v.guest && (await v.scope.feature("savedMessages")) };
}

/** The forum view of one space: its topics the person reads (pinned first, then the newest activity), each with its numbers. ONE query. */
export async function spaceTopicRows(v: ListViewer, spaceId: string): Promise<ChatRowDto[]> {
  const records = (await queryConversations(v, { spaceId }, { stats: true, visibleOnly: true })).filter((r) => r.kind === "TOPIC");
  return toRows(records, v).sort(byTopicOrder).map((i) => i.row);
}

/**
 * The rows a sync answer sends for these conversations: each one's own row, and the row of the space it is in (its numbers fold
 * every topic of the space the person reads, so the whole space is read). ONE query.
 */
export async function rowsForSync(v: ListViewer, ids: string[], spaceIds: string[]): Promise<ChatRowDto[]> {
  if (!ids.length && !spaceIds.length) return [];
  const records = await queryConversations(v, { ids, spaceIds }, { stats: true, visibleOnly: true });
  const items = toRows(records, v);
  const wanted = new Set(ids);
  const spaces = new Set(spaceIds);
  return [
    ...items.filter((i) => wanted.has(i.rec.id)).map((i) => i.row),
    ...foldSpaces(items.filter((i) => i.rec.spaceId && spaces.has(i.rec.spaceId)), v),
  ];
}
