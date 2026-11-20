import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";
import type { SpaceTopicsDto } from "@/server/chat/dto";
import { templateTopicIdOf, type TemplateTopic } from "@/lib/spaces/templates";

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

/** The row of one starter topic in one space: the ONE definition both `ensureStarterTopics` and a template's «عام» (I1.2) are made from. */
function starterRow(orgId: string, spaceId: string, t: (typeof SPACE_STARTER_TOPICS)[number]) {
  return {
    id: spaceTopicIdOf(spaceId, t.key),
    orgId,
    spaceId,
    kind: "TOPIC" as const,
    title: t.title,
    emoji: t.emoji,
    topicType: t.topicType,
    postingPolicy: t.postingPolicy,
    systemKey: t.key as string | null,
    position: t.position,
    restricted: false,
  };
}

/** Gives a space with no topic at all its starter topics (a space that has any topic is left as it is). */
export async function ensureStarterTopics(orgId: string, spaceId: string): Promise<void> {
  const any = await db.conversation.findFirst({ where: { spaceId, kind: "TOPIC" }, select: { id: true } });
  if (any) return;
  await db.conversation.createMany({ data: SPACE_STARTER_TOPICS.map((t) => starterRow(orgId, spaceId, t)), skipDuplicates: true });
}

/**
 * I1.2 «قوالب المساحات»: the topics of a template, made INSIDE ONE space. The space must be the company's own and `creatorId` a person of it (nobody is
 * written into a topic of a space they are not in). Each topic has a fixed id (`templateTopicIdOf`), so a second apply, or two at once, makes each once;
 * «عام» is the starter topic (its own id and `systemKey`), never a copy. A `privateByDefault` topic is created restricted with ONLY the creator in it,
 * and only when it is NEW: a person who left it, or a topic a manager opened up by hand, is not put back the way it was. No message, no other member.
 * The whole thing is one transaction, and `createMany` + `skipDuplicates` counts what it really inserted, so of two requests at once only the winner adds the creator.
 */
export async function applyTemplateTopics(orgId: string, spaceId: string, creatorId: string, topics: readonly TemplateTopic[]): Promise<void> {
  const space = await db.workspace.findFirst({ where: { id: spaceId, organizationId: orgId }, select: { id: true } });
  if (!space) throw new NotFoundError("workspace.not_found");
  const inSpace = await db.workspaceMember.count({
    where: { workspaceId: spaceId, userId: creatorId, user: { memberships: { some: { organizationId: orgId, status: "ACTIVE" } } } },
  });
  if (!inSpace) throw new ForbiddenError("teams.member_not_in_space");
  const starter = SPACE_STARTER_TOPICS[0];
  // a new topic goes after the ones the space already has (the starters at least), so a template applied to a space with topics never interleaves with them
  const top = await db.conversation.aggregate({ where: { spaceId, kind: "TOPIC" }, _max: { position: true } });
  let next = Math.max(SPACE_STARTER_TOPICS.length, (top._max.position ?? -1) + 1);
  const rows = topics.map((t) => {
    if (t.key === starter.key) return starterRow(orgId, spaceId, starter);
    return {
      id: templateTopicIdOf(spaceId, t.key),
      orgId,
      spaceId,
      kind: "TOPIC" as const,
      title: t.title,
      emoji: t.emoji,
      topicType: t.topicType,
      postingPolicy: t.postingPolicy,
      systemKey: null as string | null,
      position: next++,
      restricted: t.privateByDefault === true,
    };
  });
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const made = await tx.conversation.createMany({ data: [row], skipDuplicates: true });
      if (made.count === 1 && row.restricted) await tx.conversationMember.createMany({ data: [{ conversationId: row.id, userId: creatorId }], skipDuplicates: true });
    }
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
