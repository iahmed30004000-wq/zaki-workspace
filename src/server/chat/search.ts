import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { stripFormatting } from "@/lib/chat/format/parse";
import { z } from "zod";
import { arabicSearch, cleanQuery, findSpelled, foldedIncludes } from "@/lib/search/arabic";
import { rankedSearch } from "@/server/search/ranked";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts, type OrgFacts } from "@/server/policy/conversation";
import type { MessageHitDto, TopicHitDto } from "@/server/chat/dto";
import { isFeatureOn } from "@/server/services/features";
import { dmPlaceWhere, isSelfDmKey, SAVED_TITLE_KEY } from "@/server/chat/dm";
import { AR } from "@/lib/i18n/dict";
import { currentSpace } from "@/server/services/current-space";
import type { Actor } from "@/server/policy/actor";
import { loadWorkScope, scopeSpaceIds } from "@/server/services/team-scope";
import { notHiddenFor, notHiddenSql } from "@/server/chat/hidden-messages";

/**
 * SEARCH IN THE CHAT (the owner's ask, 2026-10-25): inside one conversation, and across the topics and messages of
 * the space the person is in. Every hit passes the same reading rule as opening it (`canRead`): a topic of another
 * «مقطع», a restricted topic, somebody else's DM — none of them is found by somebody who could not open it.
 * Never a deleted message or a system line («انضم»، «ثبّت»).
 */

/** Strip LIKE wildcards so what the person typed is a literal piece of text. */
export function searchText(q: string): string {
  return q.replace(/[%_\\]/g, " ").trim().slice(0, 80);
}

/** The words searched with some text on each side (the whole message when it is short). */
export function snippetOf(body: string, q: string, width = 120, format = true): string {
  // C3b.1: the words without the formatting markers (a message), found the way the search found them; the text a picture's OCR read is not formatting (`format` false)
  const flat = (format ? stripFormatting(body, { math: true }) : body).replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  // found the way the search found it: «احمد» centres on «أحمد», with or without marks
  const at = findSpelled(flat, q);
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 40, flat.length - width));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width).trim()}${start + width < flat.length ? "…" : ""}`;
}

/** Never a deleted message or a system line. The words themselves are matched by the pool of ids (`rankedSearch`). */
const searchable = { deletedAt: null, kind: { not: "SYSTEM" as const } };
const searchableSql = [Prisma.sql`"deletedAt" IS NULL`, Prisma.sql`"kind" <> 'SYSTEM'`];

/**
 * C3d — what the in-chat search adds to the words, both optional and both only ever NARROWING what the reading rule already lets through:
 *  - `from`: «من:» — only the messages of this person (an id; a person who wrote nothing here, or of another company, leaves nothing);
 *  - `since`: the date jump — the FIRST message at or after this instant (the screen sends the local midnight of the day picked); the words are not used.
 * `from` alone lists that person's messages, newest first.
 */
export interface ConversationSearchOptions {
  from?: string | undefined;
  since?: Date | undefined;
}

/** The messages of ONE conversation that carry the words (newest first). Not readable: «not found». */
export async function searchConversation(ctx: OrgAccessContext, conversationId: string, raw: string, options: ConversationSearchOptions = {}): Promise<MessageHitDto[]> {
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  if (!canRead(facts, await loadOrgFacts(ctx.userId, ctx.orgId))) throw new NotFoundError("chat.e.not_found");
  const q = searchText(raw);
  const search = arabicSearch(q);
  const extras = options.from !== undefined || options.since !== undefined;
  if (extras) {
    // «البحث الشامل» off: the jump and the person filter are part of the search, so they are off with it
    if (!(await isFeatureOn(ctx.orgId, "search"))) return [];
    if (options.since) return conversationJump(ctx.userId, conversationId, options.since, options.from);
    if (!search || search.text.length < 2) return options.from ? personMessages(ctx.userId, conversationId, options.from) : [];
  }
  if (!search || search.text.length < 2) return [];
  // «البحث الشامل» off (or economy mode with it held off): no hits, and no query over the messages
  if (!(await isFeatureOn(ctx.orgId, "search"))) return [];
  const byPerson = options.from ? { authorId: options.from } : {};
  const rows = await rankedSearch({
    query: {
      table: "ChatMessage",
      search,
      rank: false,
      where: [Prisma.sql`"conversationId" = ${conversationId}`, ...(options.from ? [Prisma.sql`"authorId" = ${options.from}`] : []), ...searchableSql, notHiddenSql(ctx.userId, "ChatMessage")],
      order: Prisma.sql`"createdAt" DESC`,
    },
    take: 30,
    load: (ids) =>
      db.chatMessage.findMany({
        where: { conversationId, ...searchable, ...notHiddenFor(ctx.userId), ...byPerson, id: { in: ids } },
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      }),
  });
  const hits: MessageHitDto[] = rows.map((m) => ({
    id: m.id,
    conversationId,
    conversationTitle: "",
    authorName: m.author.name,
    at: m.createdAt.toISOString(),
    snippet: snippetOf(m.body, q),
  }));
  // …and the messages whose pictures carry the words (the same conversation, already judged readable above)
  const seen = new Set(hits.map((h) => h.id));
  const pictures = await pictureTextHits(
    ctx.orgId,
    search,
    options.from ? Prisma.sql`m."conversationId" = ${conversationId} AND m."authorId" = ${options.from} AND ${notHiddenSql(ctx.userId)}` : Prisma.sql`m."conversationId" = ${conversationId} AND ${notHiddenSql(ctx.userId)}`,
    { conversationId, ...notHiddenFor(ctx.userId), ...byPerson },
    30,
  );
  for (const pic of pictures) {
    for (const link of pic.file.chatLinks) {
      const m = link.message;
      if (!m || seen.has(m.id) || hits.length >= 30) continue;
      seen.add(m.id);
      hits.push({ id: m.id, conversationId, conversationTitle: "", authorName: m.author.name, at: m.createdAt.toISOString(), snippet: snippetOf(pic.text, q, 120, false) });
    }
  }
  return hits;
}

const hitSelect = { id: true, body: true, createdAt: true, author: { select: { name: true } } } as const;
const hitOf = (conversationId: string, m: { id: string; body: string; createdAt: Date; author: { name: string } }): MessageHitDto => ({
  id: m.id,
  conversationId,
  conversationTitle: "",
  authorName: m.author.name,
  at: m.createdAt.toISOString(),
  snippet: snippetOf(m.body, ""),
});

/** C3d — the date jump: the first message (of this person, when given) at or after the instant. */
async function conversationJump(userId: string, conversationId: string, since: Date, from: string | undefined): Promise<MessageHitDto[]> {
  const first = await db.chatMessage.findFirst({
    where: { conversationId, ...searchable, ...notHiddenFor(userId), createdAt: { gte: since }, ...(from ? { authorId: from } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: hitSelect,
  });
  return first ? [hitOf(conversationId, first)] : [];
}

/** C3d — «من:» alone: the person's messages here, newest first. */
async function personMessages(userId: string, conversationId: string, from: string): Promise<MessageHitDto[]> {
  const rows = await db.chatMessage.findMany({
    where: { conversationId, ...searchable, ...notHiddenFor(userId), authorId: from },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
    select: hitSelect,
  });
  return rows.map((m) => hitOf(conversationId, m));
}

/**
 * The messages whose PICTURES carry the words (`FileText`, «قراءة نص الصور»; off with the switch `imageOcr`), newest first. The pool is coarse
 * (`poolMessages`: a SQL condition on the message alias `m`); the real rule is `messageWhere` on the message of each link, and the caller
 * still asks `canRead` for the conversation of every hit, exactly as for a message that carries the words itself. Never a deleted message
 * or a system line.
 */
async function pictureTextHits(
  orgId: string,
  search: NonNullable<ReturnType<typeof arabicSearch>>,
  poolMessages: Prisma.Sql,
  messageWhere: Prisma.ChatMessageWhereInput,
  take: number,
) {
  if (!(await isFeatureOn(orgId, "imageOcr"))) return [];
  return rankedSearch({
    query: {
      table: "FileText",
      search,
      rank: false,
      where: [
        Prisma.sql`"orgId" = ${orgId}`,
        Prisma.sql`"fileId" IN (SELECT a."fileId" FROM "MessageAttachment" a JOIN "ChatMessage" m ON m."id" = a."messageId" WHERE m."orgId" = ${orgId} AND m."deletedAt" IS NULL AND m."kind" <> 'SYSTEM' AND ${poolMessages})`,
      ],
      order: Prisma.sql`"createdAt" DESC`,
    },
    take,
    load: (ids) =>
      db.fileText.findMany({
        where: { id: { in: ids }, orgId, file: { orgId, deletedAt: null } },
        select: {
          id: true,
          text: true,
          file: {
            select: {
              chatLinks: {
                where: { message: { orgId, ...searchable, ...messageWhere } },
                select: {
                  message: {
                    select: {
                      id: true,
                      createdAt: true,
                      conversationId: true,
                      author: { select: { name: true } },
                      conversation: { select: { kind: true, title: true, dmKey: true, members: { take: 2, select: { userId: true, user: { select: { name: true } } } } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
  });
}

/** One reading check per conversation, whatever the number of hits in it. */
function readerOf(userId: string, org: OrgFacts | null) {
  const seen = new Map<string, boolean>();
  return async (conversationId: string): Promise<boolean> => {
    if (!seen.has(conversationId)) {
      const facts = await loadConversationFacts(userId, conversationId);
      seen.set(conversationId, !!facts && canRead(facts, org));
    }
    return seen.get(conversationId)!;
  };
}

/**
 * The topics and messages of the space the person is in that carry the words — inside «الشركة» (`isHq`) also the
 * DMs from before spaces had them. An archived topic is not offered by its name (its messages still are, read-only).
 */
export async function searchChat(
  ctx: OrgAccessContext,
  space: { id: string; isHq: boolean },
  raw: string,
  caps: { topics: number; messages: number } = { topics: 6, messages: 8 },
): Promise<{ topics: TopicHitDto[]; messages: MessageHitDto[] }> {
  const q = searchText(raw);
  const search = arabicSearch(q);
  if (!search || search.text.length < 2 || !(await isFeatureOn(ctx.orgId, "search"))) return { topics: [], messages: [] };
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const reads = readerOf(ctx.userId, org);
  const here = space.isHq
    ? { OR: [{ spaceId: space.id }, { spaceId: null, kind: { not: "TOPIC" } }] }
    : { spaceId: space.id };

  // the conversations of this place, as a coarse pool for the ids (the where below is the rule)
  const placeSql = space.isHq
    ? Prisma.sql`("spaceId" = ${space.id} OR ("spaceId" IS NULL AND "kind" <> 'TOPIC'))`
    : Prisma.sql`"spaceId" = ${space.id}`;
  const [topicRows, messageRows] = await Promise.all([
    // a topic whose title STARTS with the words comes before one that only contains them
    rankedSearch({
      query: {
        table: "Conversation",
        search,
        rank: true,
        where: [Prisma.sql`"orgId" = ${ctx.orgId}`, Prisma.sql`"kind" = 'TOPIC'`, Prisma.sql`"spaceId" = ${space.id}`, Prisma.sql`"archivedAt" IS NULL`],
        order: Prisma.sql`"position" ASC`,
      },
      take: 20,
      load: (ids) =>
        db.conversation.findMany({
          where: { orgId: ctx.orgId, kind: "TOPIC", spaceId: space.id, archivedAt: null, id: { in: ids } },
          select: { id: true, title: true, emoji: true },
        }),
    }),
    rankedSearch({
      query: {
        table: "ChatMessage",
        search,
        rank: false,
        where: [
          Prisma.sql`"orgId" = ${ctx.orgId}`,
          ...searchableSql,
          notHiddenSql(ctx.userId, "ChatMessage"),
          Prisma.sql`"conversationId" IN (SELECT "id" FROM "Conversation" WHERE "orgId" = ${ctx.orgId} AND ${placeSql})`,
        ],
        order: Prisma.sql`"createdAt" DESC`,
      },
      take: Math.max(60, caps.messages * 4),
      load: (ids) =>
        db.chatMessage.findMany({
          where: { orgId: ctx.orgId, conversation: { orgId: ctx.orgId, ...here }, ...searchable, ...notHiddenFor(ctx.userId), id: { in: ids } },
          select: {
            id: true,
            body: true,
            createdAt: true,
            conversationId: true,
            author: { select: { name: true } },
            conversation: {
              select: {
                kind: true,
                title: true,
                dmKey: true,
                members: { where: { userId: { not: ctx.userId } }, take: 1, select: { user: { select: { name: true } } } },
              },
            },
          },
        }),
    }),
  ]);

  const topics: TopicHitDto[] = [];
  for (const t of topicRows) {
    if (topics.length >= caps.topics) break;
    if (await reads(t.id)) topics.push({ id: t.id, title: t.title ?? "", emoji: t.emoji });
  }
  const messages: MessageHitDto[] = [];
  for (const m of messageRows) {
    if (messages.length >= caps.messages) break;
    if (!(await reads(m.conversationId))) continue;
    messages.push({
      id: m.id,
      conversationId: m.conversationId,
      conversationTitle: m.conversation.kind === "DM" ? (isSelfDmKey(m.conversation.dmKey) ? (AR[SAVED_TITLE_KEY] ?? "") : (m.conversation.members[0]?.user.name ?? "")) : (m.conversation.title ?? ""),
      authorName: m.author.name,
      at: m.createdAt.toISOString(),
      snippet: snippetOf(m.body, q, 90),
    });
  }
  // the messages whose pictures carry the words: the same place, and the same reading check per conversation as for any message
  const seen = new Set(messages.map((m) => m.id));
  for (const pic of await pictureTextHits(ctx.orgId, search, Prisma.sql`m."conversationId" IN (SELECT "id" FROM "Conversation" WHERE "orgId" = ${ctx.orgId} AND ${placeSql}) AND ${notHiddenSql(ctx.userId)}`, { conversation: { orgId: ctx.orgId, ...here }, ...notHiddenFor(ctx.userId) }, 60)) {
    for (const link of pic.file.chatLinks) {
      if (messages.length >= caps.messages) break;
      const m = link.message;
      if (!m || seen.has(m.id) || !(await reads(m.conversationId))) continue;
      seen.add(m.id);
      messages.push({
        id: m.id,
        conversationId: m.conversationId,
        conversationTitle: m.conversation.kind === "DM" ? (isSelfDmKey(m.conversation.dmKey) ? (AR[SAVED_TITLE_KEY] ?? "") : (m.conversation.members.find((x) => x.userId !== ctx.userId)?.user.name ?? "")) : (m.conversation.title ?? ""),
        authorName: m.author.name,
        at: m.createdAt.toISOString(),
        snippet: snippetOf(pic.text, q, 90, false),
      });
    }
  }
  return { topics, messages };
}

// ───────────────────────────── C3d: the chat list's search — ONE request ─────────────────────────────

/** A chat the list can open: a topic, a private chat (titled by the other person) or a whole space (its forum view). */
export interface ChatHitDto {
  id: string;
  kind: "TOPIC" | "DM" | "SPACE";
  title: string;
  emoji: string | null;
  /** the space a topic lives in; null for a private chat and a space */
  context: string | null;
}

/** A person of the space. A guest's rows carry `id` and `name` ONLY (the directory rule); `dmId` is the private chat already open with them, when there is one. */
export interface PersonHitDto {
  id: string;
  name: string;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  dmId?: string | null;
}

export interface ChatListSearchDto {
  chats: ChatHitDto[];
  people: PersonHitDto[];
  messages: MessageHitDto[];
}

const NO_CHAT_RESULTS: ChatListSearchDto = { chats: [], people: [], messages: [] };
const CHATS_MAX = 8;
const PEOPLE_MAX = 8;
const LIST_MESSAGES_MAX = 20;

/**
 * `GET /api/search?scope=chat&q=`: the chats, the people and the messages that carry the words — in the space the person is in (the spaces they can open are
 * offered by name), through the SAME arabic-folding pool and the SAME reading rule as every other search here:
 *  - topics and messages: `searchChat` as it is (a hit of a conversation the caller cannot read is never returned; a deleted message and a system line are never found;
 *    the snippet has no formatting markers);
 *  - private chats: the caller's OWN, titled and found by the other person's name (a private chat of two other people is not a result; a guest has none);
 *  - people: the space's people. The directory rule decides what a row carries: the picture and the job title only with `directory.view`; a guest gets the NAME only,
 *    and only of the people of the space they share.
 * It reads and writes nothing else.
 */
export async function searchChatList(actor: Actor, place: { id: string; name: string; isHq: boolean } | null, spaceIds: readonly string[], raw: string): Promise<ChatListSearchDto> {
  const q = searchText(raw);
  const search = arabicSearch(q);
  if (!search || search.text.length < 2 || !(await isFeatureOn(actor.orgId, "search"))) return NO_CHAT_RESULTS;
  const ctx = { orgId: actor.orgId, userId: actor.userId, orgRole: actor.role };
  const [found, dms, spaces, people] = await Promise.all([
    place ? searchChat(ctx, place, q, { topics: CHATS_MAX, messages: LIST_MESSAGES_MAX }) : { topics: [] as TopicHitDto[], messages: [] as MessageHitDto[] },
    place && !actor.isExternal ? privateChatHits(ctx, place, search) : [],
    spaceHits(actor.orgId, spaceIds, q),
    place ? peopleHits(actor, place.id, search) : [],
  ]);
  const chats: ChatHitDto[] = [
    ...found.topics.map((t) => ({ id: t.id, kind: "TOPIC" as const, title: t.title, emoji: t.emoji, context: place?.name ?? null })),
    ...dms.map(({ peerId: _peerId, ...chat }) => chat),
    ...spaces,
  ];
  // the private chat already open with each person found (a guest has none)
  const dmOf = new Map(dms.map((d) => [d.peerId, d.id]));
  const missing = people.filter((p) => !dmOf.has(p.id)).map((p) => p.id);
  if (place && !actor.isExternal && missing.length > 0) for (const [peerId, id] of await openPrivateChats(ctx, place.id, missing)) dmOf.set(peerId, id);
  return {
    chats,
    people: people.map((p) => (actor.isExternal ? { id: p.id, name: p.name } : { ...p, dmId: dmOf.get(p.id) ?? null })),
    messages: found.messages,
  };
}

/**
 * The caller's own private chats whose other person's name carries the words, best first (a name that STARTS with them first): the SAME folded pool as the people
 * (`rankedSearch` over the names of the people the caller has a private chat with in this place), and the rule on top of it is the caller's own membership of that chat
 * — so a private chat of two other people is never a result, and no number of chats hides one.
 */
async function privateChatHits(ctx: OrgAccessContext, place: { id: string; isHq: boolean }, search: NonNullable<ReturnType<typeof arabicSearch>>): Promise<(ChatHitDto & { peerId: string })[]> {
  const placeSql = place.isHq ? Prisma.sql`(c."spaceId" = ${place.id} OR c."spaceId" IS NULL)` : Prisma.sql`c."spaceId" = ${place.id}`;
  const found = await rankedSearch({
    query: {
      table: "User",
      search,
      rank: true,
      where: [
        Prisma.sql`"id" IN (SELECT other."userId" FROM "ConversationMember" mine JOIN "Conversation" c ON c."id" = mine."conversationId" JOIN "ConversationMember" other ON other."conversationId" = c."id" WHERE mine."userId" = ${ctx.userId} AND other."userId" <> ${ctx.userId} AND c."orgId" = ${ctx.orgId} AND c."kind" = 'DM' AND ${placeSql})`,
      ],
      order: Prisma.sql`"name" ASC`,
    },
    take: CHATS_MAX,
    load: async (ids) => {
      const chats = await db.conversation.findMany({
        where: { orgId: ctx.orgId, kind: "DM", AND: [{ members: { some: { userId: ctx.userId } } }, { members: { some: { userId: { in: ids } } } }], ...(await dmPlaceWhere(place.id)) },
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        select: { id: true, members: { where: { userId: { in: ids } }, select: { user: { select: { id: true, name: true } } } } },
      });
      // one chat per person (the newest): «الشركة» also holds the ones from before spaces
      const byPerson = new Map<string, { id: string; chatId: string; name: string }>();
      for (const c of chats) for (const m of c.members) if (!byPerson.has(m.user.id)) byPerson.set(m.user.id, { id: m.user.id, chatId: c.id, name: m.user.name });
      return [...byPerson.values()];
    },
  });
  return found.map((p) => ({ id: p.chatId, kind: "DM" as const, title: p.name, emoji: null, context: null, peerId: p.id }));
}

/** The private chats the caller already has with these people, in this place: person id and chat id. */
async function openPrivateChats(ctx: OrgAccessContext, placeId: string, peerIds: string[]): Promise<[string, string][]> {
  const rows = await db.conversation.findMany({
    where: { orgId: ctx.orgId, kind: "DM", AND: [{ members: { some: { userId: ctx.userId } } }, { members: { some: { userId: { in: peerIds } } } }], ...(await dmPlaceWhere(placeId)) },
    select: { id: true, members: { where: { userId: { in: peerIds } }, select: { userId: true } } },
  });
  return rows.flatMap((c) => c.members.map((m) => [m.userId, c.id] as [string, string]));
}

/** The spaces the person can open whose name carries the words. */
async function spaceHits(orgId: string, spaceIds: readonly string[], q: string): Promise<ChatHitDto[]> {
  if (spaceIds.length === 0) return [];
  const rows = await db.workspace.findMany({ where: { organizationId: orgId, id: { in: [...spaceIds] } }, orderBy: { name: "asc" }, select: { id: true, name: true, emoji: true } });
  return rows.filter((w) => foldedIncludes(w.name, q)).slice(0, CHATS_MAX).map((w) => ({ id: w.id, kind: "SPACE" as const, title: w.name, emoji: w.emoji, context: null }));
}

/**
 * The people of this space whose name carries the words. The pool and the rule are the palette's own (the space's members, ACTIVE in this company); what a row
 * carries is the directory rule: a guest and a person without `directory.view` get id and name only.
 */
async function peopleHits(actor: Actor, spaceId: string, search: NonNullable<ReturnType<typeof arabicSearch>>): Promise<{ id: string; name: string; avatarUrl?: string | null; jobTitle?: string | null }[]> {
  const rich = !actor.isExternal && actor.caps.has("directory.view");
  const rows = await rankedSearch({
    query: {
      table: "User",
      search,
      rank: true,
      where: [Prisma.sql`"id" IN (SELECT "userId" FROM "WorkspaceMember" WHERE "workspaceId" = ${spaceId})`, Prisma.sql`"id" <> ${actor.userId}`],
      order: Prisma.sql`"name" ASC`,
    },
    take: PEOPLE_MAX,
    load: async (ids) => {
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: spaceId, userId: { in: ids }, user: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } } },
        select: { user: { select: { id: true, name: true, avatarUrl: true, jobTitle: true } } },
      });
      return members.map((m) => m.user);
    },
  });
  return rows.map((u) => (rich ? { id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle } : { id: u.id, name: u.name }));
}

// ── the route's glue ──

const scopeQuerySchema = z.object({
  q: z.string().max(400).optional(),
  conversationId: z.string().min(1).max(64).optional(),
  from: z.string().min(1).max(64).optional(),
  since: z.string().datetime().optional(),
});

/**
 * `scope=chat`: one question, two shapes. Without `conversationId` the chat list's search (`searchChatList`: chats, people, messages). With it, the search INSIDE that
 * conversation (`searchConversation`: `{ messages }`, with the optional «من:» `from` and the date jump `since`) — the same door the old screen's own route answers,
 * so a guest still reaches topics only and a conversation the caller cannot read is «not found».
 */
export async function chatScopeAnswer(actor: Actor, params: URLSearchParams): Promise<ChatListSearchDto | { messages: MessageHitDto[] }> {
  const parsed = scopeQuerySchema.safeParse({
    q: params.get("q") ?? undefined,
    conversationId: params.get("conversationId") ?? undefined,
    from: params.get("from") ?? undefined,
    since: params.get("since") ?? undefined,
  });
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const p = parsed.data;
  const ctx = { orgId: actor.orgId, userId: actor.userId, orgRole: actor.role };
  if (p.conversationId) {
    // reading first, so a missing id and a conversation one cannot open answer the same «not found»; only then the guest's «topics only»
    const [facts, org] = await Promise.all([loadConversationFacts(actor.userId, p.conversationId), loadOrgFacts(actor.userId, actor.orgId)]);
    if (!facts || facts.orgId !== actor.orgId || !canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
    if (actor.isExternal && facts.kind !== "TOPIC") throw new ForbiddenError("chat.guest_forbidden");
    return { messages: await searchConversation(ctx, p.conversationId, p.q ?? "", { from: p.from, since: p.since ? new Date(p.since) : undefined }) };
  }
  const space = await currentSpace(actor);
  const place = space ? { id: space.id, name: space.name, isHq: space.kind === "HQ" } : null;
  // every space the person can open (not only the one they are in): the list offers them by name
  const spaceIds = scopeSpaceIds(await loadWorkScope(actor.userId));
  return searchChatList(actor, place, spaceIds, p.q ?? "");
}
