import { z } from "zod";
import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, audit } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { assertCanManageLines, devAccess, type DevAccess } from "@/server/policy/team-development";
import { assertManager, assertRankMayAdminister, lockManagerChain, mayAdministerRank } from "@/server/services/accounts";
import { childrenOf, subtreeOf } from "@/lib/team-development";

/**
 * «الهيكل» — who answers to whom. The line is `OrganizationMember.managerId` (a user id), the same column the account
 * screens and the escalations already use: this file is the second door to it, for the owner and for whoever holds
 * `people.manage_lines`, and it applies the SAME checks as the first (`assertManager`: an ACTIVE non-guest manager, no
 * loop, no chain deeper than 6) under the same company-wide lock — and, since A1.3 (D-A5, «بانتظار المالك»), the same RANK
 * LIMIT: a line is changed only for somebody the caller outranks (`accounts.assertRankMayAdminister`), whichever screen asks.
 *
 * Who reads what: the owner and a `people.manage_lines` holder the whole tree of names; a supervisor their own subtree;
 * a plain employee only their own supervisor and the names of the people who answer to the same supervisor.
 * ⚠️ The tree carries names and job titles only: no score, no review, no skill level.
 */

export const setSupervisorSchema = z.object({
  managerId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().min(1).max(64).nullable()),
});

export interface StructureNode {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: OrgRole;
  managerId: string | null;
  /** The viewer may change this person's line (mode all only; the rank limit of the people screen: somebody they outrank). */
  canEdit: boolean;
  /** People who answer to this person directly. */
  direct: number;
  /** Direct and indirect. */
  total: number;
}

export interface Structure {
  /** all: the whole company (owner, `people.manage_lines`); subtree: the viewer and the people below them; own: only `me`. */
  mode: "all" | "subtree" | "own";
  canManage: boolean;
  nodes: StructureNode[];
  /** The top of the tree: the OWNER-rank people (mode all), the viewer (subtree), nobody (own). */
  roots: string[];
  /** Staff with nobody above them («بدون مسؤول»), each with their own people under them; mode all only. */
  unassigned: string[];
  me: {
    userId: string;
    supervisor: { userId: string; name: string } | null;
    /** The names of the people who answer to the same supervisor (the viewer excluded). */
    teamMates: { userId: string; name: string }[];
    /** How many people answer to the viewer. */
    reports: number;
  };
}

/**
 * The line of an ACTIVE person drawn on the screen: their manager, or — when that manager is suspended or offboarded — the
 * nearest ACTIVE person above them, so nobody falls out of the tree because somebody in the middle left.
 */
function drawnLines(access: DevAccess): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const id of access.staff.keys()) {
    const seen = new Set<string>([id]);
    let cursor = access.managerOf.get(id) ?? null;
    while (cursor && !access.staff.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = access.managerOf.get(cursor) ?? null;
    }
    out.set(id, cursor && access.staff.has(cursor) && !seen.has(cursor) ? cursor : null);
  }
  return out;
}

function nodesOf(access: DevAccess, ids: Iterable<string>): StructureNode[] {
  const lines = drawnLines(access);
  const children = childrenOf(lines);
  const out: StructureNode[] = [];
  for (const id of ids) {
    const person = access.staff.get(id);
    if (!person) continue;
    out.push({
      userId: id,
      name: person.name,
      jobTitle: person.jobTitle,
      role: person.role,
      managerId: lines.get(id) ?? null,
      canEdit: false,
      direct: (children.get(id) ?? []).length,
      total: subtreeOf(lines, id).length,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export async function loadStructure(actor: Actor): Promise<Structure> {
  if (actor.spaceOnly) throw new NotFoundError("teamdev.not_found"); // «الهيكل» is the company's reporting line
  const access = await devAccess(actor);
  const lines = drawnLines(access);
  const myManager = lines.get(access.viewerId) ?? null;
  const supervisor = myManager && access.staff.get(myManager) ? { userId: myManager, name: access.staff.get(myManager)!.name } : null;
  const teamMates = supervisor
    ? [...access.staff]
        .filter(([id]) => id !== access.viewerId && (lines.get(id) ?? null) === supervisor.userId)
        .map(([id, p]) => ({ userId: id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar"))
    : [];
  const reports = [...access.staff.keys()].filter((id) => (lines.get(id) ?? null) === access.viewerId).length;
  const me = { userId: access.viewerId, supervisor, teamMates, reports };

  if (access.canManageLines) {
    const ids = [...access.staff.keys()];
    // the button is drawn only where the server would accept it: never an owner (no supervisor), never a peer or a superior
    const nodes = nodesOf(access, ids).map((n) => ({ ...n, canEdit: n.role !== "OWNER" && mayAdministerRank(actor, { role: n.role }) }));
    const roots = nodes.filter((n) => n.role === "OWNER").map((n) => n.userId);
    const unassigned = nodes.filter((n) => n.role !== "OWNER" && n.managerId === null).map((n) => n.userId);
    return { mode: "all", canManage: true, nodes, roots, unassigned, me };
  }
  if (access.isSupervisor) {
    const ids = [access.viewerId, ...(access.reach ?? [])];
    return { mode: "subtree", canManage: false, nodes: nodesOf(access, ids), roots: [access.viewerId], unassigned: [], me };
  }
  return { mode: "own", canManage: false, nodes: [], roots: [], unassigned: [], me };
}

/**
 * Puts `userId` under `managerId` (null: nobody above them). Owner or `people.manage_lines` only (404 for anybody else: the
 * door is not offered to them). The person must be an ACTIVE non-guest and not an OWNER (the owner has no supervisor); the
 * manager an ACTIVE non-guest (the owner may be one). A loop or a chain deeper than 6 is refused with 422.
 */
export async function setSupervisor(actor: Actor, userId: string, managerId: string | null): Promise<{ userId: string; managerId: string | null }> {
  const access = await devAccess(actor);
  assertCanManageLines(access);
  const person = access.staff.get(userId);
  if (!person) throw new NotFoundError("teamdev.not_found");
  if (person.role === "OWNER") throw new ValidationError([{ path: "managerId", message: "teamdev.owner_no_manager" }]);
  // the people screen's rank limit (D-A5): 403 `orgm.role_denied` for somebody the caller does not outrank
  assertRankMayAdminister(actor, { role: person.role });
  const before = access.managerOf.get(userId) ?? null;
  if (before === managerId) return { userId, managerId };

  await db.$transaction(async (tx) => {
    await lockManagerChain(tx, actor.orgId);
    if (managerId !== null) await assertManager(tx, actor.orgId, managerId, userId);
    // the row is read again under the lock: a person who was suspended or offboarded since is not edited
    const { count } = await tx.organizationMember.updateMany({
      where: { organizationId: actor.orgId, userId, status: "ACTIVE", role: { not: "OWNER" } },
      data: { managerId },
    });
    if (count !== 1) throw new NotFoundError("teamdev.not_found");
  });
  await audit("org.member_updated", { actorId: actor.userId, orgId: actor.orgId, target: userId, meta: { fields: ["managerId"], managerId } });
  return { userId, managerId };
}
