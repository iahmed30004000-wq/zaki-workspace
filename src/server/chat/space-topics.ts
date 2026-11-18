import { db } from "@/server/db";
import { NotFoundError, type OrgAccessContext } from "@/server/auth";
import type { SpaceTopicsDto } from "@/server/chat/dto";

/**
 * The topics every space starts with, so its chat is never an empty page (a space is like a separate site: it
 * opens on its own talk). Fixed ids per space (`cv_ws_<key>_<spaceId>`), so creating them twice, or from two
 * requests at once, makes them once.
 *
 *   «عام» — everybody talks; «التنبيهات» — the space's admins post, everybody reads.
 */
export const SPACE_STARTER_TOPICS = [
  { key: "general", title: "عام", emoji: "💬", topicType: "DISCUSSION", postingPolicy: "ALL", position: 0 },
  { key: "announcements", title: "التنبيهات", emoji: "📢", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS", position: 1 },
] as const;

export const spaceTopicIdOf = (spaceId: string, key: string): string => `cv_ws_${key}_${spaceId}`;

/** Gives a space with no topic at all its starter topics (a space that has any topic is left as it is). */
export async function ensureStarterTopics(orgId: string, spaceId: string): Promise<void> {
  const any = await db.conversation.findFirst({ where: { spaceId, kind: "TOPIC" }, select: { id: true } });
  if (any) return;
  await db.conversation.createMany({
    data: SPACE_STARTER_TOPICS.map((t) => ({
      id: spaceTopicIdOf(spaceId, t.key),
      orgId,
      spaceId,
      kind: "TOPIC" as const,
      title: t.title,
      emoji: t.emoji,
      topicType: t.topicType,
      postingPolicy: t.postingPolicy,
      systemKey: t.key,
      position: t.position,
    })),
    skipDuplicates: true,
  });
}

/**
 * Every space the person is in that has no topic yet gets its starter topics (a space made before spaces had them), so «قائمة وحدة» never
 * hides a space the person belongs to. One cheap query finds them; the common case writes nothing.
 */
export async function ensureStartersForViewer(ctx: OrgAccessContext): Promise<void> {
  const bare = await db.workspace.findMany({
    where: { organizationId: ctx.orgId, members: { some: { userId: ctx.userId } }, conversations: { none: { kind: "TOPIC" } } },
    select: { id: true },
    take: 50,
  });
  for (const s of bare) await ensureStarterTopics(ctx.orgId, s.id);
}

/** The starter topics of ONE space, only when it is the person's own (a space of another company, or one they were never put in, is left alone: nothing is written). */
export async function ensureStartersForSpace(ctx: OrgAccessContext, spaceId: string): Promise<void> {
  const ownerRank = ctx.orgRole === "OWNER"; // oversight-ok: the rank is a space ADMIN of every space; giving a space its starter topics is management, not reading
  const mine = await db.workspace.findFirst({
    where: { id: spaceId, organizationId: ctx.orgId, ...(ownerRank ? {} : { members: { some: { userId: ctx.userId } } }) },
    select: { id: true },
  });
  if (mine) await ensureStarterTopics(ctx.orgId, mine.id);
}

/**
 * `GET /api/chat/spaces/[spaceId]/topics`: the forum view of one space (the same rows as the list, kind TOPIC). A space that is not the person's
 * (another company's, or one they were never put in) does not exist for them. The OWNER rank reads every space.
 */
export async function spaceTopics(ctx: OrgAccessContext, spaceId: string): Promise<SpaceTopicsDto> {
  // loaded here, not at the top: `workspaces.ts` and the department service import this file for the starter topics only, and must not pull the whole chat core with it
  const { chatScope, listViewerOf, spaceTopicRows } = await import("@/server/chat/list");
  const org = await chatScope(ctx).org();
  if (!org || org.status !== "ACTIVE") throw new NotFoundError("chat.e.not_found");
  const v = listViewerOf(ctx, org);
  const space = await db.workspace.findFirst({
    where: { id: spaceId, organizationId: ctx.orgId },
    select: { id: true, name: true, emoji: true, members: { where: { userId: ctx.userId }, select: { role: true } } },
  });
  if (!space || (!v.ownerRank && space.members.length === 0)) throw new NotFoundError("chat.e.not_found");
  // a space made before every space got its starter topics gets them the first time its chat opens
  await ensureStarterTopics(ctx.orgId, space.id);
  const manager = v.ownerRank || space.members[0]?.role === "ADMIN";
  return {
    space: { id: space.id, name: space.name, emoji: space.emoji, canModerate: manager, canCreateTopic: manager },
    rows: await spaceTopicRows(v, space.id),
  };
}
