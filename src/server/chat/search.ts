import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { arabicSearch, cleanQuery, findSpelled } from "@/lib/search/arabic";
import { rankedSearch } from "@/server/search/ranked";
import { NotFoundError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts, type OrgFacts } from "@/server/policy/conversation";
import type { MessageHitDto, TopicHitDto } from "@/server/chat/dto";
import { isFeatureOn } from "@/server/services/features";

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
export function snippetOf(body: string, q: string, width = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  // found the way the search found it: «احمد» centres on «أحمد», with or without marks
  const at = findSpelled(flat, q);
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 40, flat.length - width));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width).trim()}${start + width < flat.length ? "…" : ""}`;
}

/** Never a deleted message or a system line. The words themselves are matched by the pool of ids (`rankedSearch`). */
const searchable = { deletedAt: null, kind: { not: "SYSTEM" as const } };
const searchableSql = [Prisma.sql`"deletedAt" IS NULL`, Prisma.sql`"kind" <> 'SYSTEM'`];

/** The messages of ONE conversation that carry the words (newest first). Not readable: «not found». */
export async function searchConversation(ctx: OrgAccessContext, conversationId: string, raw: string): Promise<MessageHitDto[]> {
  const facts = await loadConversationFacts(ctx.userId, conversationId);
  if (!facts || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  if (!canRead(facts, await loadOrgFacts(ctx.userId, ctx.orgId))) throw new NotFoundError("chat.e.not_found");
  const q = searchText(raw);
  const search = arabicSearch(q);
  if (!search || search.text.length < 2) return [];
  // «البحث الشامل» off (or economy mode with it held off): no hits, and no query over the messages
  if (!(await isFeatureOn(ctx.orgId, "search"))) return [];
  const rows = await rankedSearch({
    query: {
      table: "ChatMessage",
      search,
      rank: false,
      where: [Prisma.sql`"conversationId" = ${conversationId}`, ...searchableSql],
      order: Prisma.sql`"createdAt" DESC`,
    },
    take: 30,
    load: (ids) =>
      db.chatMessage.findMany({
        where: { conversationId, ...searchable, id: { in: ids } },
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
  for (const pic of await pictureTextHits(ctx.orgId, search, Prisma.sql`m."conversationId" = ${conversationId}`, { conversationId }, 30)) {
    for (const link of pic.file.chatLinks) {
      const m = link.message;
      if (!m || seen.has(m.id) || hits.length >= 30) continue;
      seen.add(m.id);
      hits.push({ id: m.id, conversationId, conversationTitle: "", authorName: m.author.name, at: m.createdAt.toISOString(), snippet: snippetOf(pic.text, q) });
    }
  }
  return hits;
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
                      conversation: { select: { kind: true, title: true, members: { take: 2, select: { userId: true, user: { select: { name: true } } } } } },
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
          Prisma.sql`"conversationId" IN (SELECT "id" FROM "Conversation" WHERE "orgId" = ${ctx.orgId} AND ${placeSql})`,
        ],
        order: Prisma.sql`"createdAt" DESC`,
      },
      take: 60,
      load: (ids) =>
        db.chatMessage.findMany({
          where: { orgId: ctx.orgId, conversation: { orgId: ctx.orgId, ...here }, ...searchable, id: { in: ids } },
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
                members: { where: { userId: { not: ctx.userId } }, take: 1, select: { user: { select: { name: true } } } },
              },
            },
          },
        }),
    }),
  ]);

  const topics: TopicHitDto[] = [];
  for (const t of topicRows) {
    if (topics.length >= 6) break;
    if (await reads(t.id)) topics.push({ id: t.id, title: t.title ?? "", emoji: t.emoji });
  }
  const messages: MessageHitDto[] = [];
  for (const m of messageRows) {
    if (messages.length >= 8) break;
    if (!(await reads(m.conversationId))) continue;
    messages.push({
      id: m.id,
      conversationId: m.conversationId,
      conversationTitle: m.conversation.kind === "DM" ? (m.conversation.members[0]?.user.name ?? "") : (m.conversation.title ?? ""),
      authorName: m.author.name,
      at: m.createdAt.toISOString(),
      snippet: snippetOf(m.body, q, 90),
    });
  }
  // the messages whose pictures carry the words: the same place, and the same reading check per conversation as for any message
  const seen = new Set(messages.map((m) => m.id));
  for (const pic of await pictureTextHits(ctx.orgId, search, Prisma.sql`m."conversationId" IN (SELECT "id" FROM "Conversation" WHERE "orgId" = ${ctx.orgId} AND ${placeSql})`, { conversation: { orgId: ctx.orgId, ...here } }, 60)) {
    for (const link of pic.file.chatLinks) {
      if (messages.length >= 8) break;
      const m = link.message;
      if (!m || seen.has(m.id) || !(await reads(m.conversationId))) continue;
      seen.add(m.id);
      messages.push({
        id: m.id,
        conversationId: m.conversationId,
        conversationTitle: m.conversation.kind === "DM" ? (m.conversation.members.find((x) => x.userId !== ctx.userId)?.user.name ?? "") : (m.conversation.title ?? ""),
        authorName: m.author.name,
        at: m.createdAt.toISOString(),
        snippet: snippetOf(pic.text, q, 90),
      });
    }
  }
  return { topics, messages };
}
