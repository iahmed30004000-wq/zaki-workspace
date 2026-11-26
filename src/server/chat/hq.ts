import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";

/**
 * The company space (HQ). Its shape is NOT invented here: it is the shape the data move created
 * (`prisma/migrations/20261024091000_chat_data_move`), so running this on a migrated database is
 * a no-op — same ids (`ws_hq_<orgId>`, `cv_hq_<key>_<orgId>`), same keys, same policies.
 *
 * ONE difference (review B6): the data move named the space «المقر» 🕌, this file names it «الشركة» 🏢,
 * the product's term. A company that existed at deploy time keeps «المقر» until its owner renames
 * the space (an ordinary space rename); the released migration is never edited, and an existing
 * name is never overwritten here (an owner's own choice must stay).
 *
 *   space: key "hq", slug "hq", kind HQ — every ACTIVE non-owner non-guest person (an ADMIN as
 *          space ADMIN), except an account that works only in its spaces (`spaceOnly`);
 *   topics: التنبيهات (announcements, ADMINS post) · المتابعة (followup, ADMINS post) · عام ·
 *          الأفكار · الأرشيف (restricted, nobody in it: only the OWNER reads it).
 *
 * A topic that is not restricted belongs to everybody in the space, so topics carry NO member rows.
 */

export const HQ_SYSTEM_KEY = "hq";

export const HQ_TOPICS: {
  key: string;
  title: string;
  emoji: string;
  topicType: string;
  postingPolicy: "ALL" | "ADMINS";
  restricted: boolean;
  position: number;
}[] = [
  { key: "announcements", title: "التنبيهات", emoji: "📢", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS", restricted: false, position: 0 },
  { key: "followup", title: "المتابعة", emoji: "🔁", topicType: "FOLLOWUP", postingPolicy: "ADMINS", restricted: false, position: 1 },
  { key: "general", title: "عام", emoji: "💬", topicType: "DISCUSSION", postingPolicy: "ALL", restricted: false, position: 2 },
  { key: "ideas", title: "الأفكار", emoji: "💡", topicType: "IDEAS", postingPolicy: "ALL", restricted: false, position: 3 },
  { key: "archive", title: "الأرشيف", emoji: "🗄️", topicType: "DISCUSSION", postingPolicy: "ALL", restricted: true, position: 4 },
];

export const hqSpaceIdOf = (orgId: string): string => `ws_hq_${orgId}`;
export const hqTopicIdOf = (orgId: string, key: string): string => `cv_hq_${key}_${orgId}`;

/** The HQ space id of the org (key "hq"), or null when the org has none. */
export async function hqSpaceId(orgId: string, client: Pick<typeof db, "workspace"> = db): Promise<string | null> {
  const ws = await client.workspace.findFirst({
    where: { organizationId: orgId, systemKey: HQ_SYSTEM_KEY },
    select: { id: true },
  });
  return ws?.id ?? null;
}

/** The topic ids of the HQ space by key (null where one is missing). */
export async function hqTopicIds(orgId: string): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const t of HQ_TOPICS) out[t.key] = null;
  const spaceId = await hqSpaceId(orgId);
  if (!spaceId) return out;
  const rows = await db.conversation.findMany({
    where: { spaceId, systemKey: { not: null } },
    select: { id: true, systemKey: true },
  });
  for (const r of rows) if (r.systemKey && r.systemKey in out) out[r.systemKey] = r.id;
  return out;
}

/**
 * Ensures HQ exists for the org exactly as the data move made it (idempotent, same ids).
 * Returns the space id.
 */
export async function ensureHqSpace(orgId: string, name: string, tx: Prisma.TransactionClient | typeof db = db): Promise<string> {
  const existing = await tx.workspace.findFirst({ where: { organizationId: orgId, systemKey: HQ_SYSTEM_KEY }, select: { id: true } });
  if (existing) return existing.id;

  const spaceId = hqSpaceIdOf(orgId);
  await tx.workspace.upsert({
    where: { id: spaceId },
    create: { id: spaceId, organizationId: orgId, name, slug: "hq", kind: "HQ", emoji: "🏢", systemKey: HQ_SYSTEM_KEY },
    update: {},
  });

  for (const t of HQ_TOPICS) {
    await tx.conversation.upsert({
      where: { id: hqTopicIdOf(orgId, t.key) },
      create: {
        id: hqTopicIdOf(orgId, t.key),
        orgId,
        spaceId,
        kind: "TOPIC",
        title: t.title,
        emoji: t.emoji,
        topicType: t.topicType,
        postingPolicy: t.postingPolicy,
        restricted: t.restricted,
        position: t.position,
        systemKey: t.key,
        // no member rows: the audience of an unrestricted topic is the space's people, and
        // the archive is restricted with nobody in it (only the OWNER reads it)
      },
      update: {},
    });
  }
  return spaceId;
}

/**
 * Puts every ACTIVE person of the org in the HQ space (idempotent): never the OWNER (he is in no
 * row, he reads silently), never a GUEST (a partner is put in a space by a person, on purpose).
 */
export async function addOrgToHq(orgId: string): Promise<void> {
  const spaceId = await ensureHqSpace(orgId, "الشركة");
  const people = await db.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE", role: { notIn: ["OWNER", "GUEST"] }, spaceOnly: false },
    select: { userId: true, role: true },
  });
  if (!people.length) return;
  await db.workspaceMember.createMany({
    data: people.map((m) => ({
      workspaceId: spaceId,
      userId: m.userId,
      role: m.role === "ADMIN" ? "ADMIN" : "MEMBER",
    })),
    skipDuplicates: true,
  });
}

/** Puts one person in HQ (a reactivated member comes back this way). */
export async function addPersonToHq(orgId: string, userId: string, role: string, tx: Prisma.TransactionClient | typeof db = db): Promise<void> {
  if (role === "OWNER" /* oversight-ok: HQ membership by rank */ || role === "GUEST") return;
  const membership = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { status: true, role: true, spaceOnly: true } });
  if (membership?.spaceOnly) return;
  if (!membership || membership.status !== "ACTIVE" || membership.role === "OWNER" /* oversight-ok: HQ membership by rank */ || membership.role === "GUEST") return;
  const spaceId = await ensureHqSpace(orgId, "الشركة", tx);
  await tx.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: spaceId, userId } },
    create: { workspaceId: spaceId, userId, role: membership.role === "ADMIN" ? "ADMIN" : "MEMBER" },
    update: { role: membership.role === "ADMIN" ? "ADMIN" : "MEMBER" },
  });
}

// ---------- hooks for the services (accounts.ts) ----------

/**
 * Takes one person out of the HQ topics (their DMs stay, so the other side keeps the history).
 * Works inside a transaction (the offboarding's) or alone. Idempotent.
 */
export async function removePersonFromHq(
  tx: Prisma.TransactionClient | typeof db,
  orgId: string,
  userId: string,
): Promise<void> {
  const spaceId = await hqSpaceId(orgId);
  if (!spaceId) return;
  await tx.conversationMember.deleteMany({
    where: { userId, conversation: { spaceId } },
  });
}

/** The audit row of a chat removal from HQ (an action of its own, so the archive can find it). */
export async function removePersonAudit(
  orgId: string,
  actorId: string,
  userId: string,
  client: Pick<typeof db, "workspace" | "auditLog"> = db,
): Promise<void> {
  const spaceId = await hqSpaceId(orgId, client);
  await client.auditLog.create({
    data: {
      action: "org.member_offboarded_chat",
      actorId,
      orgId,
      target: userId,
      workspaceId: spaceId,
      meta: { scope: "hq" },
    },
  });
}
