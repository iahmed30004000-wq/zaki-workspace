import { db } from "@/server/db";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * The chat policy: pure `can*` functions over a facts object, plus the DB loaders that
 * collect the facts. Every chat service and route decides here — never inline.
 *
 * Decisions in force (design + coordinator):
 *  - a topic's audience is every ACTIVE member of its space (a WorkspaceMember row; guests
 *    included as GUEST) unless the topic is `restricted`, then only the ConversationMember rows;
 *  - a DM's audience is its two ACTIVE people;
 *  - whoever HOLDS OVERSIGHT (an OWNER-rank person who has the capability `archive.view`: the primary owner, and a
 *    partner unless the primary owner took it away) reads everything silently, without being in any row; he may
 *    WRITE only where he has joined (a ConversationMember row of his own) and never in somebody else's DM. The rank
 *    alone reads nothing private: an OWNER-rank person WITHOUT the capability is a space ADMIN of every space
 *    (open topics, no silence) and reads a restricted topic or a DM only like anybody else, through his own rows;
 *  - a GUEST reads the topics of the spaces they are in, never DMs, never HQ;
 *  - a topic of a «مقطع» (`teamId`, a team of its space) is read by that مقطع's people and the space's managers
 *    (its ADMINs, an org ADMIN who is in it) — and by the OWNER, silently, like everything;
 *  - a suspended or offboarded person is nobody: rows they left behind do not count.
 */

export type ConversationFacts = {
  kind: "DM" | "GROUP" | "TOPIC";
  orgId: string;
  spaceId: string | null;
  restricted: boolean;
  closedAt: Date | null;
  postingPolicy: string; // ALL | ADMINS
  topicType: string; // DISCUSSION | ANNOUNCEMENTS | ...
  /** the «مقطع» (team of the space) the topic belongs to, if any */
  teamId: string | null;
  /** the viewer is one of that مقطع's people */
  viewerInTeam: boolean;
  /** of the viewer's ConversationMember row, when one exists */
  viewerIsMember: boolean;
  /** role of the viewer's group row, when this is a GROUP */
  viewerGroupRole: string | null;
  /** the space member row of the viewer (topics), with the moderators' mute */
  viewerSpaceRole: "ADMIN" | "MEMBER" | "GUEST" | null;
  mutedUntil: Date | null;
  /** the DM's other person is ACTIVE (DM audience only) */
  dmOtherActive: boolean;
  /** ids of the audience members that have a ConversationMember row (restricted topics / DMs) */
  memberIds: string[];
};

export type OrgFacts = {
  /** the organization these facts were loaded for: a viewer's rank counts only in THAT org */
  orgId: string;
  role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
  status: "ACTIVE" | "SUSPENDED" | "OFFBOARDED";
  /**
   * Silent oversight: the person holds the capability `archive.view` (same rule as `holdsArchiveView`). `loadOrgFacts`
   * always sets it; a hand-made fact without it is read as "an OWNER holds it", as before this field existed.
   */
  oversight?: boolean;
};

export const isSpaceAdmin = (role: string | null): boolean => role === "ADMIN";

/** An ACTIVE person of the organization. A suspended or offboarded person is nobody. */
export function isActiveOf(org: OrgFacts | null): boolean {
  return !!org && org.status === "ACTIVE";
}

export function isOwnerOf(org: OrgFacts | null): boolean { // oversight-ok: the rank alone (management); reading uses hasOversight
  return isActiveOf(org) && org!.role === "OWNER"; // oversight-ok: the rank alone
}

/** Silent oversight: an OWNER-rank person who still holds `archive.view`. The rank alone is not enough. */
export function hasOversight(org: OrgFacts | null): boolean {
  return isOwnerOf(org) && org!.oversight !== false; // oversight-ok: rank AND the capability
}

/**
 * The viewer's role in the conversation's space. An OWNER-rank person needs no `WorkspaceMember` row: he is a space
 * ADMIN of every space (as `requireWorkspace` already treats him) — with or without oversight.
 */
function spaceRoleOf(facts: ConversationFacts, org: OrgFacts | null): ConversationFacts["viewerSpaceRole"] {
  return facts.viewerSpaceRole ?? (isOwnerOf(org) ? "ADMIN" : null); // oversight-ok: the rank is a space ADMIN everywhere
}

export function isOrgAdminOf(org: OrgFacts | null): boolean {
  return isActiveOf(org) && org!.role === "ADMIN";
}

/**
 * The viewer's org facts are of the conversation's own org. A rank held in another company
 * (an OWNER there included) never reaches this conversation: every `can*` below starts here.
 */
export function isOrgOf(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  return !!facts && !!org && facts.orgId === org.orgId;
}

/** May the viewer READ the conversation (they exist in the audience, or the OWNER silently)? */
export function canRead(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!facts || !isActiveOf(org) || !isOrgOf(facts, org)) return false;
  if (hasOversight(org)) return true; // the silent eye (archive.view) reads everything
  if (facts.kind === "DM") return facts.viewerIsMember && facts.dmOtherActive;
  if (facts.kind === "GROUP") return facts.viewerIsMember && org!.role !== "GUEST";
  const spaceRole = spaceRoleOf(facts, org);
  if (!spaceRole) return false; // not in the space, not in the topic
  // a مقطع's topic: its people and the space's managers (the space's ADMIN, an org ADMIN who is in it)
  if (facts.teamId && !facts.viewerInTeam && !(isSpaceAdmin(spaceRole) || org!.role === "ADMIN")) return false;
  if (!facts.restricted) return true; // the space's people are the audience
  return facts.viewerIsMember; // a restricted topic takes its own rows
}

/** May the viewer POST here right now? Reading comes first, always. */
export function canPost(
  facts: ConversationFacts,
  org: OrgFacts,
  opts: { ownerJoined: boolean } = { ownerJoined: false },
): boolean {
  if (!canRead(facts, org)) return false;
  if (facts.kind === "DM") return facts.viewerIsMember && facts.dmOtherActive;
  if (facts.kind === "GROUP") return facts.viewerIsMember && org!.role !== "GUEST";
  if (facts.closedAt) return false; // a closed topic takes no messages until an admin reopens it
  const role = org!.role;
  if (hasOversight(org)) return opts.ownerJoined; // the silent eye posts only where he joined
  if (isSpaceAdmin(spaceRoleOf(facts, org))) return true; // the mute never binds the space's admins
  if (facts.mutedUntil && facts.mutedUntil > new Date()) return false; // muted in the space
  if (facts.postingPolicy === "ADMINS") return false; // only space admins (or the owner) post
  if (role === "GUEST" && facts.topicType === "ANNOUNCEMENTS") return false; // guests read announcements
  return true;
}

/** May the viewer moderate this conversation (mute, delete others, pin, close, settings, notes)? */
export function canModerate(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!facts || !isActiveOf(org) || !isOrgOf(facts, org)) return false;
  // a DM is its two people's: nobody moderates it, the OWNER included (he never writes in it)
  if (facts.kind === "DM") return false;
  if (hasOversight(org)) return true;
  // nobody moderates what they may not read (a restricted topic they are not in, a space they left)
  if (!canRead(facts, org)) return false;
  if (facts.kind === "GROUP") return facts.viewerIsMember && facts.viewerGroupRole === "admin";
  // design §26: "space ADMIN or OWNER". The org rank ADMIN gives no space by itself (AGENTS.md access
  // model): an org admin moderates the spaces where they are a space ADMIN — HQ included, where the
  // space role follows the org rank (accounts.ts alignSpaceRoles)
  return isSpaceAdmin(spaceRoleOf(facts, org));
}

/** May the viewer PIN this message's conversation? Topics: moderators; DMs: either participant. */
export function canPin(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!facts || !isActiveOf(org) || !isOrgOf(facts, org)) return false;
  if (facts.kind === "DM") return facts.viewerIsMember && (isOwnerOf(org) || org!.role !== "GUEST"); // oversight-ok: pinning in his own DM
  return canModerate(facts, org);
}

/** May the viewer EDIT or DELETE this message? Own messages always; others need moderation. */
export function canModifyMessage(opts: {
  authorId: string;
  viewerId: string;
  facts: ConversationFacts | null;
  org: OrgFacts | null;
}): boolean {
  if (!opts.facts || !isActiveOf(opts.org) || !isOrgOf(opts.facts, opts.org)) return false;
  if (opts.authorId === opts.viewerId) return canRead(opts.facts, opts.org);
  return canModerate(opts.facts, opts.org);
}

/** May the viewer read the archive (the owner's archive + oversight)? `archive.view`, OWNER only. */
export function canArchive(role: string | null | undefined): boolean {
  return role === "OWNER"; // oversight-ok: the rank half of the archive rule (the capability is the other half)
}

/**
 * May the viewer (a MODERATOR muting) act on the target? Nobody mutes the OWNER, nobody mutes
 * somebody of equal or higher standing (an ADMIN cannot mute an ADMIN; the OWNER can mute anybody).
 */
export function canModerateTarget(actor: { role: string; spaceRole?: string | null }, target: { role: string; spaceRole?: string | null }): boolean {
  // nobody mutes the OWNER, whoever asks: the standing below gives every other rank 1, so without this
  // line a space admin (3) outranked the owner and could silence him in a space
  if (target.role === "OWNER") return false; // oversight-ok: nobody mutes an OWNER-rank person
  if (actor.role === "OWNER") return true; // oversight-ok: muting is management by rank
  const standing = (r: string, s?: string | null): number => {
    if (r === "ADMIN") return s === "ADMIN" ? 3 : 2;
    if (r === "LEAD") return 2;
    return 1;
  };
  return standing(actor.role, actor.spaceRole) > standing(target.role, target.spaceRole);
}

// ---------- DB loaders ----------

/** The viewer's organization facts for the conversation's org (or null: not a member there). */
export async function loadOrgFacts(userId: string, orgId: string): Promise<OrgFacts | null> {
  const m = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true, status: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
  });
  if (!m) return null;
  // oversight is a capability, not a rank: the same rule as `holdsArchiveView` (src/server/chat/archive-access.ts)
  const oversight = m.status === "ACTIVE" && canArchive(m.role) && effectiveCapabilities(m).has("archive.view");
  return { orgId, role: m.role, status: m.status, oversight };
}

/**
 * Everything the pure functions need about one conversation for one viewer, in ONE query round.
 * Returns null when the conversation does not exist (read: 404).
 */
export async function loadConversationFacts(userId: string, conversationId: string): Promise<ConversationFacts | null> {
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
  if (!conv) return null;

  let dmOtherActive = false;
  if (conv.kind === "DM") {
    // the pair comes from the DM's key when it has one, not from the rows that happen to be left:
    // a lost row on one side must not turn the other side into "nobody" (review A7)
    // (a DM of a space ends its key in `@<spaceId>`)
    const pair = conv.dmKey ? (conv.dmKey.split("@")[0] ?? "").split("|") : conv.members.map((m) => m.userId);
    const otherId = pair.find((id) => id !== userId);
    if (otherId) {
      const other = await db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: conv.orgId, userId: otherId } },
        select: { status: true },
      });
      dmOtherActive = other?.status === "ACTIVE";
    }
  }

  const [org, spaceRow, convRow, teamRow] = await Promise.all([
    loadOrgFacts(userId, conv.orgId),
    conv.spaceId
      ? db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: conv.spaceId, userId } },
          select: { role: true, mutedUntil: true },
        })
      : Promise.resolve(null),
    db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true, role: true },
    }),
    conv.teamId
      ? db.teamMember.findUnique({ where: { teamId_userId: { teamId: conv.teamId, userId } }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return {
    kind: conv.kind as "DM" | "GROUP" | "TOPIC",
    orgId: conv.orgId,
    spaceId: conv.spaceId,
    restricted: conv.restricted,
    closedAt: conv.closedAt,
    postingPolicy: conv.postingPolicy,
    topicType: conv.topicType,
    teamId: conv.teamId,
    viewerInTeam: !!teamRow,
    viewerIsMember: !!convRow,
    viewerGroupRole: convRow?.role ?? null,
    viewerSpaceRole: spaceRow?.role ?? null,
    mutedUntil: spaceRow?.mutedUntil ?? null,
    dmOtherActive,
    memberIds: conv.members.map((m) => m.userId),
  };
}

/** The shared contract: true for the audience AND for the OWNER (silent oversight). */
export async function canReadConversation(userId: string, conversationId: string): Promise<boolean> {
  const [facts, org] = await Promise.all([
    loadConversationFacts(userId, conversationId),
    db.conversation.findUnique({ where: { id: conversationId }, select: { orgId: true } }).then((c) =>
      c ? loadOrgFacts(userId, c.orgId) : null,
    ),
  ]);
  return canRead(facts, org);
}

/** May the viewer post in this conversation? (Routes call this before a write.) */
export async function canPostInConversation(userId: string, conversationId: string): Promise<boolean> {
  const facts = await loadConversationFacts(userId, conversationId);
  if (!facts) return false;
  const org = await loadOrgFacts(userId, facts.orgId);
  if (!org) return false;
  return canPost(facts, org, { ownerJoined: facts.viewerIsMember });
}

/** May the viewer moderate this conversation? */
export async function canModerateConversation(userId: string, conversationId: string): Promise<boolean> {
  const facts = await loadConversationFacts(userId, conversationId);
  if (!facts) return false;
  const org = await loadOrgFacts(userId, facts.orgId);
  return canModerate(facts, org);
}
