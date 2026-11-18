import { db } from "@/server/db";
import { canArchive, canRead, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * WHO may read this conversation, among the people who are connected — in a few queries, however many people are asked about.
 *
 * The fan-out used to ask `canReadConversation` once per open stream (about six reads each); with a browser holding several tabs,
 * and several people online, one message cost dozens of reads. This answers for all of them at once.
 *
 * It is NOT a second rule. The decision is `canRead(facts, org)` of `policy/conversation.ts` — the same pure function the policy's own
 * `canReadConversation` ends in — and the facts are built exactly as `loadConversationFacts` / `loadOrgFacts` build them, only for
 * many people in one pass. `tests/db/realtime-live-gate.test.ts` proves, over a real database, that both give the same answer for
 * every kind of conversation and every kind of person.
 *
 * A person with no ACTIVE membership in the conversation's company has no row here, so reads nothing: a suspended or offboarded
 * person is nobody, and so is somebody of another company (their rank there never reaches this conversation).
 */
export interface Readers {
  /** the asked people who may read it */
  readers: Set<string>;
  /** the conversation's kind, or null when it does not exist (nobody reads a conversation that is gone) */
  kind: "DM" | "GROUP" | "TOPIC" | null;
}

export async function readersAmong(conversationId: string, userIds: readonly string[]): Promise<Readers> {
  const ids = [...new Set(userIds)];
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      orgId: true,
      kind: true,
      spaceId: true,
      restricted: true,
      closedAt: true,
      postingPolicy: true,
      topicType: true,
      teamId: true,
      dmKey: true,
      members: { select: { userId: true } },
    },
  });
  if (!conv) return { readers: new Set(), kind: null };
  const kind = conv.kind as "DM" | "GROUP" | "TOPIC";
  if (ids.length === 0) return { readers: new Set(), kind };

  const memberIds = new Set(conv.members.map((m) => m.userId));
  // a DM's pair comes from its key when it has one (a DM of a space ends its key in `@<spaceId>`), not from the rows that are left
  const pair = kind === "DM" ? (conv.dmKey ? (conv.dmKey.split("@")[0] ?? "").split("|") : [...memberIds]) : [];

  const [orgRows, spaceRows, teamRows, pairRows] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: conv.orgId, userId: { in: ids }, status: "ACTIVE" },
      select: { userId: true, role: true, status: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
    }),
    conv.spaceId ? db.workspaceMember.findMany({ where: { workspaceId: conv.spaceId, userId: { in: ids } }, select: { userId: true, role: true } }) : Promise.resolve([]),
    conv.teamId ? db.teamMember.findMany({ where: { teamId: conv.teamId, userId: { in: ids } }, select: { userId: true } }) : Promise.resolve([]),
    pair.length > 0 ? db.organizationMember.findMany({ where: { organizationId: conv.orgId, userId: { in: pair }, status: "ACTIVE" }, select: { userId: true } }) : Promise.resolve([]),
  ]);
  const orgOf = new Map(orgRows.map((r) => [r.userId, r]));
  const spaceRole = new Map(spaceRows.map((r) => [r.userId, r.role]));
  const inTeam = new Set(teamRows.map((r) => r.userId));
  const activePair = new Set(pairRows.map((r) => r.userId));

  const memberList = [...memberIds];
  const readers = new Set<string>();
  for (const userId of ids) {
    const m = orgOf.get(userId);
    if (!m) continue;
    // oversight is a capability, not a rank: the same rule as `loadOrgFacts`
    const org: OrgFacts = { orgId: conv.orgId, role: m.role, status: m.status, oversight: m.status === "ACTIVE" && canArchive(m.role) && effectiveCapabilities(m).has("archive.view") };
    const otherId = pair.find((id) => id !== userId);
    const facts: ConversationFacts = {
      kind,
      orgId: conv.orgId,
      spaceId: conv.spaceId,
      restricted: conv.restricted,
      closedAt: conv.closedAt,
      postingPolicy: conv.postingPolicy,
      topicType: conv.topicType,
      teamId: conv.teamId,
      viewerInTeam: inTeam.has(userId),
      viewerIsMember: memberIds.has(userId),
      viewerGroupRole: null,
      viewerSpaceRole: spaceRole.get(userId) ?? null,
      mutedUntil: null,
      dmOtherActive: otherId ? activePair.has(otherId) : false,
      memberIds: memberList,
    };
    if (canRead(facts, org)) readers.add(userId);
  }
  return { readers, kind };
}
