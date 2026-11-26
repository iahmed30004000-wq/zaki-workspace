import { Prisma } from "@prisma/client";
import { spacePeopleWhere } from "@/server/chat/space-people";
import { db } from "@/server/db";
import { mayMeet, reachableWhere } from "@/server/policy/space-only";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { assignedTo } from "@/server/services/tasks";
import { can } from "@/server/policy/capabilities";
import { RANK } from "@/server/policy/rank";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { avatarHue } from "@/lib/format";
import { lastSeenReader } from "@/server/services/last-seen";
import { isOnline } from "@/server/realtime/presence";
import { taskParticipantFilter } from "@/server/services/team-scope";

export interface ProfilePatch {
  name?: string;
  jobTitle?: string;
  bio?: string | null;
  locale?: string;
}

/** Self-service profile update. Locale/theme are constrained at the API layer. */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const data: Prisma.UserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.jobTitle !== undefined) data.jobTitle = patch.jobTitle;
  if (patch.bio !== undefined) data.bio = patch.bio;
  if (patch.locale !== undefined) data.locale = patch.locale;
  await db.user.update({ where: { id: userId }, data });
}

// Changing one's own password lives in services/onboarding.ts (changeOwnPassword): it also ends the
// person's other sessions and clears a temporary password.

export interface PublicProfile {
  id: string;
  name: string;
  jobTitle: string | null;
  bio: string | null;
  createdAt: Date;
  organizationId: string;
  organizationName: string;
  organizationRole: string;
  /** `/api/avatars/<id>` — the picture they uploaded, or null for their initials. */
  avatarUrl: string | null;
  stats: {
    ideasCreated: number;
    ideasVotesReceived: number;
    openTasksAssigned: number;
    tasksCompleted: number;
  };
  /** the spaces both people are in (the owner: every space the person is in); never one the viewer may not open */
  sharedSpaces: { id: string; name: string; emoji: string | null }[];
  /**
   * «آخر ظهور» (src/server/services/last-seen.ts), for ANOTHER person's profile: an ISO time, or null (unknown or hidden).
   * ABSENT on one's own profile, when the company's switch is off, or when the viewer may not be told (a guest never reaches
   * this view). `online` and `lastSeenTimeZone` come with it, so the card can say «متصل الآن» and «اليوم» / «أمس».
   */
  lastSeenAt?: string | null;
  online?: boolean;
  lastSeenTimeZone?: string;
}

/**
 * What a viewer may see of another person.
 *  - "full": the whole profile (everyone who is not an org GUEST and holds `directory.view`; their
 *    own profile is always open to them).
 *  - "limited": an org GUEST sees `{ id, name }` and nothing else (no job title, bio,
 *    email, role or stats), and only for people who share a workspace with them
 *    (and themselves). Anybody else is "not found".
 * Only ACTIVE people count on both sides: a suspended or offboarded person has no profile to look at
 * ("not found"), and a viewer who is suspended or offboarded is not a member anywhere.
 */
export type ProfileView =
  | { kind: "full"; profile: PublicProfile }
  | { kind: "limited"; profile: { id: string; name: string } };

/**
 * Profile of another member, visible only through a shared organization.
 * Cross-org ids → not found (no existence oracle). A viewer who is only a GUEST
 * in every organization they share with the target gets the "limited" view.
 */
export async function getProfileForViewer(viewerId: string, targetId: string): Promise<ProfileView> {
  const viewMemberships = await db.organizationMember.findMany({
    where: { userId: viewerId, status: "ACTIVE" },
    select: { organizationId: true, role: true, capabilities: true, revokedCapabilities: true, spaceOnly: true },
  });
  const visibleOrgIds = viewMemberships.map((m) => m.organizationId);
  if (visibleOrgIds.length === 0) throw new ForbiddenError("not_org_member");
  // organizations where the viewer is a real member (guests see no profiles there)
  const staffOrgIds = viewMemberships.filter((m) => m.role !== "GUEST").map((m) => m.organizationId);

  const target = await db.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      bio: true,
      createdAt: true,
      avatarUrl: true,
      memberships: {
        // somebody who is no longer ACTIVE in a shared organization is not there to be looked at
        where: { organizationId: { in: visibleOrgIds }, status: "ACTIVE" },
        select: { role: true, organization: { select: { id: true, name: true } } },
      },
    },
  });
  if (!target) throw new NotFoundError("user.not_found");
  if (target.memberships.length === 0) throw new NotFoundError("user.not_found"); // no shared org
  // «محصور بمساحة»: a colleague outside the viewer's spaces is not there to be looked at
  for (const v of viewMemberships) {
    if (!v.spaceOnly || target.id === viewerId || !target.memberships.some((m) => m.organization.id === v.organizationId)) continue;
    if (!(await mayMeet(v.organizationId, viewerId, target.id))) throw new NotFoundError("user.not_found");
  }

  const sharedStaff = target.memberships.filter((m) => staffOrgIds.includes(m.organization.id));
  const firstShared = sharedStaff[0];
  if (!firstShared) {
    // the viewer is only a guest in every organization they share with the target
    if (target.id !== viewerId) {
      const sharedWorkspace = await db.workspaceMember.findFirst({
        where: {
          userId: target.id,
          workspace: {
            organizationId: { in: target.memberships.map((m) => m.organization.id) },
            members: { some: { userId: viewerId } },
          },
        },
        select: { id: true },
      });
      if (!sharedWorkspace) throw new NotFoundError("user.not_found");
    }
    return { kind: "limited", profile: { id: target.id, name: target.name } };
  }

  // The staff directory is a capability: whoever may not see it may not read a colleague's profile
  // by id either (their own stays open to them). The profile shown is the one of a shared
  // organization where the viewer holds it.
  const membership =
    target.id === viewerId
      ? firstShared
      : sharedStaff.find((m) => {
          const viewerRow = viewMemberships.find((v) => v.organizationId === m.organization.id);
          return viewerRow !== undefined && can(viewerRow, "directory.view");
        });
  if (!membership) throw new ForbiddenError("insufficient_role");

  // a space is like a separate site: the numbers count the work of the spaces the VIEWER may open (an idea
  // from before spaces had them belongs to the company and counts)
  const viewerSpaces = await accessibleWorkspaceIds(viewerId);
  const ideaScope = { orgId: { in: staffOrgIds }, OR: [{ workspaceId: { in: viewerSpaces } }, { workspaceId: null }] };
  const taskScope = { orgId: { in: staffOrgIds }, workspaceId: { in: viewerSpaces }, AND: [await taskParticipantFilter(viewerId)] };
  const stats = await Promise.all([
    db.idea.count({ where: { creatorId: targetId, ...ideaScope } }),
    db.ideaVote.count({ where: { idea: { creatorId: targetId, ...ideaScope } } }),
    db.task.count({ where: { ...assignedTo(targetId), ...taskScope, completedAt: null, archived: false } }),
    db.task.count({ where: { ...assignedTo(targetId), ...taskScope, completedAt: { not: null }, archived: false } }),
  ]);
  const targetSpaces = await db.workspaceMember.findMany({
    where: { userId: targetId, workspaceId: { in: viewerSpaces }, workspace: { organizationId: { in: staffOrgIds } } },
    select: { workspace: { select: { id: true, name: true, emoji: true } } },
    orderBy: { workspace: { name: "asc" } },
  });
  const votesReceived = stats[1];

  // «آخر ظهور»: the person's time in the company whose profile this is, through the one privacy reader
  let seenFields: Pick<PublicProfile, "lastSeenAt" | "online" | "lastSeenTimeZone"> = {};
  if (target.id !== viewerId) {
    const orgId = membership.organization.id;
    const reader = await lastSeenReader(orgId, viewerId);
    if (reader.enabled) {
      const row = await db.organizationMember.findUnique({
        // all-statuses: the reader answers null for anybody who is not ACTIVE (the target is ACTIVE here anyway)
        where: { organizationId_userId: { organizationId: orgId, userId: target.id } },
        select: { userId: true, role: true, status: true, lastSeenAt: true, hideLastSeen: true },
      });
      if (row) {
        // the owner who hides from the company (`ownerHiddenOnline`) does not light up here either
        const atScreen = (await isOnline(target.id)) && !(row.role === "OWNER" && reader.ownerHidden);
        seenFields = { lastSeenAt: reader.read(row) ?? null, online: atScreen, lastSeenTimeZone: reader.timeZone };
      }
    }
  }

  return {
    kind: "full",
    profile: {
      id: target.id,
      name: target.name,
      jobTitle: target.jobTitle,
      bio: target.bio,
      createdAt: target.createdAt,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationRole: membership.role,
      // the picture is the person's, and this branch is only reached by somebody who may see the
      // staff directory: a GUEST stops at `limited` above and never gets here
      avatarUrl: target.avatarUrl,
      stats: {
        ideasCreated: stats[0],
        ideasVotesReceived: votesReceived,
        openTasksAssigned: stats[2],
        tasksCompleted: stats[3],
      },
      sharedSpaces: targetSpaces.map((m) => m.workspace),
      ...seenFields,
    },
  };
}

/**
 * The full profile page of a member (the /u/[id] page). Guests have no profile
 * pages: they only ever get the names-only view of getProfileForViewer, so for
 * them this is "not found".
 */
export async function getPublicProfile(viewerId: string, targetId: string): Promise<PublicProfile> {
  const view = await getProfileForViewer(viewerId, targetId);
  if (view.kind === "limited") throw new NotFoundError("user.not_found");
  return view.profile;
}

/**
 * The people an org GUEST may see in `orgId`: those who share a workspace with them
 * (and the guest). Names only; every other field is blanked.
 */
async function guestDirectoryMembers(viewerId: string, orgId: string) {
  const mine = await db.workspaceMember.findMany({
    where: { userId: viewerId, workspace: { organizationId: orgId } },
    select: { workspaceId: true },
  });
  const mates = mine.length
    ? await db.workspaceMember.findMany({
        where: {
          workspaceId: { in: mine.map((w) => w.workspaceId) },
          // somebody who left or was suspended may still have a workspace row; they are not listed
          user: { memberships: { some: { organizationId: orgId, status: "ACTIVE" } } },
        },
        select: { user: { select: { id: true, name: true } } },
      })
    : [];
  const people = new Map<string, string>();
  for (const row of mates) people.set(row.user.id, row.user.name);
  if (!people.has(viewerId)) {
    const me = await db.user.findUnique({ where: { id: viewerId }, select: { id: true, name: true } });
    if (me) people.set(me.id, me.name);
  }
  return [...people.entries()]
    .map(([userId, name]) => ({ userId, name, jobTitle: null, role: "", email: null, avatarUrl: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type DirectoryOrg = {
  organizationId: string;
  organizationName: string;
  orgRole: string; // viewer's role in this org
  canManage: boolean;
  restricted: boolean; // true for a guest viewer: names only
  members: {
    userId: string;
    name: string;
    jobTitle: string | null;
    role: string;
    email: string | null; // e-mail exposed only to people who hold `users.manage` (the owner, admins by default)
    /** `/api/avatars/<id>` — their picture; null for the names-only list a GUEST gets. */
    avatarUrl: string | null;
  }[];
};

/**
 * Member directory of the viewer's organizations. In an organization where the
 * viewer is a GUEST the list is names only and limited to the people they share a
 * workspace with (`restricted: true`; job title, role and email are blank).
 *
 * Everybody else needs the `directory.view` capability (403 `insufficient_role` when it was taken
 * away), sees ACTIVE people only, and sees e-mail addresses and the manager's panel only with
 * `users.manage`. A viewer who is suspended or offboarded is a member nowhere: an empty list.
 *
 * Inside a space (`space`, the space the person is in): that company lists the space's people only (a space is
 * like a separate site; the whole company's people are on «الإدارة»'s members page).
 */
export async function memberDirectory(viewerId: string, space?: { orgId: string; spaceId: string | null }): Promise<DirectoryOrg[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId: viewerId, status: "ACTIVE" },
    select: {
      organizationId: true,
      organization: { select: { id: true, name: true } },
      role: true,
      capabilities: true,
      revokedCapabilities: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const result = await Promise.all(
    memberships.map(async (m): Promise<DirectoryOrg | "refused"> => {
      if (m.role === "GUEST") {
        return {
          organizationId: m.organizationId,
          organizationName: m.organization.name,
          orgRole: m.role,
          canManage: false,
          restricted: true,
          members: await guestDirectoryMembers(viewerId, m.organizationId),
        };
      }
      if (!can(m, "directory.view")) return "refused";
      const reach = await reachableWhere(m.organizationId, viewerId);
      const canManage = can(m, "users.manage");
      const inSpace =
        space && space.orgId === m.organizationId
          ? { AND: [space.spaceId ? spacePeopleWhere(m.organizationId, space.spaceId) : { userId: { in: [] as string[] } }] }
          : {};
      const rows = await db.organizationMember.findMany({
        where: { organizationId: m.organizationId, status: "ACTIVE", ...inSpace, ...(reach ? { AND: [reach, ...(inSpace.AND ?? [])] } : {}) },
        select: {
          role: true,
          user: { select: { id: true, name: true, jobTitle: true, email: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      // by rank, highest first (the order of the enum in the database means nothing); a stable sort keeps
      // the people of one rank in the order they joined
      rows.sort((a, b) => RANK[b.role] - RANK[a.role]);
      return {
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        orgRole: m.role,
        canManage,
        restricted: false,
        members: rows.map((r) => ({
          userId: r.user.id,
          name: r.user.name,
          jobTitle: r.user.jobTitle,
          role: r.role,
          email: canManage ? r.user.email : null,
          avatarUrl: r.user.avatarUrl,
        })),
      };
    }),
  );
  const listed = result.filter((org): org is DirectoryOrg => org !== "refused");
  // nothing to show only because the capability was taken away: say so (a guest-only list is not that)
  if (listed.length === 0 && result.length > 0) throw new ForbiddenError("insufficient_role");
  return listed;
}
