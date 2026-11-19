import { db } from "@/server/db";
import type { OrgAccessContext } from "@/server/auth";
import { hqSpaceId } from "@/server/chat/hq";
import { archivedByMeSql } from "@/server/chat/read-state";

/**
 * The number on «الدردشة» in the menus: messages waiting for me, in ONE query.
 *
 * - Only conversations I have a row in (I wrote, read or joined there; my DMs): a topic I never opened
 *   is the chat home's business, and counting a company's whole history would make the badge useless.
 * - Never my own messages, deleted ones, or system lines («انضم»، «ثبّت»); never an archived topic.
 * - A topic counts only while I am still in its space (rows outlive leaving it); the OWNER's rows are
 *   the topics he joined and his own DMs, so his silent oversight never adds anything.
 * - A guest: topics only.
 * - A topic of a «مقطع» counts for its people and the space's managers only (the same rule as `canRead`).
 * - A conversation the person archived FOR THEMSELVES (C3a.1) counts nothing while their archive stands (the list's own rule: an unmuted one a message
 *   came to after the archive is back, and counts); while `chatPersonalState` is off nothing is archived.
 * - Inside a space (`spaceId`, the space the person is in): that space's topics and DMs — and in «الشركة»
 *   (`legacyHere`) the DMs from before spaces had them. Another space's are on the space switcher instead
 *   (`unreadBySpace`).
 */
export async function unreadTotal(ctx: OrgAccessContext, spaceId: string | null = null, legacyHere = false): Promise<number> {
  const isOwner = ctx.orgRole === "OWNER"; // oversight-ok: the rank is a space ADMIN of every space; only conversations with HIS row are counted
  const isGuest = ctx.orgRole === "GUEST";
  const rows = await db.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*)::int AS total
    FROM "ChatMessage" m
    JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${ctx.userId}
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."orgId" = ${ctx.orgId}
      AND m."createdAt" > cm."lastReadAt"
      AND m."authorId" <> ${ctx.userId}
      AND m."deletedAt" IS NULL
      AND m.kind <> 'SYSTEM'
      AND c."archivedAt" IS NULL
      AND NOT ${archivedByMeSql(ctx.orgId)}
      AND (${isGuest} = false OR c.kind = 'TOPIC')
      AND (
        c.kind <> 'TOPIC'
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId})
      )
      AND (${spaceId}::text IS NULL OR c."spaceId" = ${spaceId} OR (c."spaceId" IS NULL AND c.kind <> 'TOPIC' AND ${legacyHere} = true))
      AND (
        c."teamId" IS NULL
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId" = c."teamId" AND tm."userId" = ${ctx.userId})
        OR EXISTS (
          SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId}
            AND (w.role = 'ADMIN' OR ${ctx.orgRole === "ADMIN"} = true)
        )
      )`;
  return rows[0]?.total ?? 0;
}

/**
 * The same count per space (the number beside every space on the switcher, like the accounts of a messaging
 * app): its topics and its DMs — the DMs from before spaces count for «الشركة». `{ spaceId: count }`, spaces with
 * nothing waiting left out.
 */
export async function unreadBySpace(ctx: OrgAccessContext): Promise<Record<string, number>> {
  const isOwner = ctx.orgRole === "OWNER"; // oversight-ok: same as unreadTotal — his own rows only
  const isGuest = ctx.orgRole === "GUEST";
  const hq = await hqSpaceId(ctx.orgId);
  const rows = await db.$queryRaw<Array<{ spaceId: string | null; total: number }>>`
    SELECT COALESCE(c."spaceId", ${hq}::text) AS "spaceId", COUNT(*)::int AS total
    FROM "ChatMessage" m
    JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${ctx.userId}
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."orgId" = ${ctx.orgId}
      AND m."createdAt" > cm."lastReadAt"
      AND m."authorId" <> ${ctx.userId}
      AND m."deletedAt" IS NULL
      AND m.kind <> 'SYSTEM'
      AND c."archivedAt" IS NULL
      AND NOT ${archivedByMeSql(ctx.orgId)}
      AND (${isGuest} = false OR c.kind = 'TOPIC')
      AND (
        c.kind <> 'TOPIC'
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId})
      )
      AND (
        c."teamId" IS NULL
        OR ${isOwner} = true
        OR EXISTS (SELECT 1 FROM "TeamMember" tm WHERE tm."teamId" = c."teamId" AND tm."userId" = ${ctx.userId})
        OR EXISTS (
          SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = c."spaceId" AND w."userId" = ${ctx.userId}
            AND (w.role = 'ADMIN' OR ${ctx.orgRole === "ADMIN"} = true)
        )
      )
    GROUP BY 1`;
  return Object.fromEntries(rows.filter((r) => r.spaceId).map((r) => [r.spaceId as string, r.total]));
}
