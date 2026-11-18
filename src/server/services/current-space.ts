import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { OrgRole, Prisma, WorkspaceKind, WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { perRequest } from "@/server/env";
import { HQ_SYSTEM_KEY } from "@/server/chat/hq";
import { isSpaceManager } from "@/server/workspace-role";

import { goHref } from "@/lib/space-link";
import { layoutOf, type SpaceLayout } from "@/lib/cards/shared";

export { goHref, safeNext } from "@/lib/space-link";

/**
 * THE SPACE YOU ARE IN — the owner's decision (2026-10-25, «العزل شامل… كأني بفتح سايت جديد»): entering a
 * space is like opening a separate site. Its name sits at the top, and every page shows that space's work
 * only (today, my work, projects, list and calendar, reports, search, chat).
 *
 * The choice is a cookie (`zk-space`) holding a space id, written by the server only (`/go`). It is NEVER
 * trusted: every request checks it against the spaces the person may open in their company (the OWNER: all
 * of them; anybody else: the ones they were put in). A stale or foreign id falls back to «الشركة» (HQ), and
 * to the first space by name when HQ is not theirs (a guest).
 */

export const SPACE_COOKIE = "zk-space";

export interface SpaceEntry {
  id: string;
  name: string;
  emoji: string | null;
  kind: WorkspaceKind;
  /** STANDARD, CARDS or MANUFACTURING (the last two are made of «لوحات» only: their home is /cards). */
  layout: SpaceLayout;
  /** The person's own row in the space (none for a space the OWNER sees without being put in it). */
  role: WorkspaceRole | null;
}

export interface CurrentSpace {
  id: string;
  name: string;
  emoji: string | null;
  kind: WorkspaceKind;
  layout: SpaceLayout;
  /** OWNER, the space's ADMIN, an org ADMIN in it: sees every «مقطع» and manages the space. */
  manager: boolean;
}

/** Who is asking: the signed-in person in the company they work in (`requireActor` / `activeOrgCtx`). */
export interface SpaceSubject {
  userId: string;
  orgId: string;
  role: OrgRole;
}

/**
 * The spaces of one person in one company, read ONCE per server render (`perRequest`, F1.1): the layout, the page and
 * `keepInSpace` all ask. The key is three strings (a `SpaceSubject` is a new object on every call and would never hit);
 * nothing outlives the render. The array is shared by the render's callers: nobody changes it.
 */
const spacesFor = perRequest(async (userId: string, orgId: string, role: OrgRole): Promise<SpaceEntry[]> => {
  const who = { userId, orgId, role };
  const [spaces, rows] = await Promise.all([
    db.workspace.findMany({
      where:
        who.role === "OWNER"
          ? { organizationId: who.orgId, archivedAt: null }
          : { organizationId: who.orgId, archivedAt: null, members: { some: { userId: who.userId } } },
      select: { id: true, name: true, emoji: true, kind: true, layout: true, systemKey: true },
      // the order the owner put them in by dragging, then by name
      orderBy: [{ position: "asc" }, { name: "asc" }, { id: "asc" }],
    }),
    db.workspaceMember.findMany({
      where: { userId: who.userId, workspace: { organizationId: who.orgId } },
      select: { workspaceId: true, role: true },
    }),
  ]);
  const roleOf = new Map(rows.map((r) => [r.workspaceId, r.role] as const));
  const hqFirst = [...spaces.filter((s) => s.systemKey === HQ_SYSTEM_KEY), ...spaces.filter((s) => s.systemKey !== HQ_SYSTEM_KEY)];
  return hqFirst.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, kind: s.kind, layout: layoutOf(s.layout), role: roleOf.get(s.id) ?? null }));
});

/** The spaces of the person's company they may open: «الشركة» first, then by name. */
export async function spacesOf(who: SpaceSubject): Promise<SpaceEntry[]> {
  return spacesFor(who.userId, who.orgId, who.role);
}

/** The space the person is in: the wanted one when it is theirs, else «الشركة», else the first; null with none. */
export async function resolveCurrentSpace(who: SpaceSubject, wanted: string | null | undefined): Promise<CurrentSpace | null> {
  const spaces = await spacesOf(who);
  const chosen = spaces.find((s) => s.id === wanted) ?? spaces[0];
  if (!chosen) return null;
  return {
    id: chosen.id,
    name: chosen.name,
    emoji: chosen.emoji,
    kind: chosen.kind,
    layout: chosen.layout,
    manager: isSpaceManager(who.role, chosen.role),
  };
}

/** One person's current space for one cookie value, once per server render (the cookie value is part of the key). */
const spaceFor = perRequest(
  (userId: string, orgId: string, role: OrgRole, wanted: string | undefined): Promise<CurrentSpace | null> => resolveCurrentSpace({ userId, orgId, role }, wanted),
);

/** The current space of this request (the cookie, checked). */
export async function currentSpace(who: SpaceSubject): Promise<CurrentSpace | null> {
  return spaceFor(who.userId, who.orgId, who.role, cookies().get(SPACE_COOKIE)?.value);
}

/**
 * A page of ONE thing (a task, a project, a board, a topic) that lives in another space of the person's: enter that
 * space first and come back (`/go`), so the name at the top always says where the thing is. A space that is not
 * theirs changes nothing: the page answers for itself («not found»), never a loop through `/go`.
 */
export async function keepInSpace(who: SpaceSubject, spaceId: string, path: string): Promise<void> {
  const wanted = cookies().get(SPACE_COOKIE)?.value;
  const spaces = await spacesOf(who);
  const here = spaces.find((s) => s.id === wanted) ?? spaces[0];
  if (here?.id === spaceId || !spaces.some((s) => s.id === spaceId)) return;
  redirect(goHref(spaceId, path));
}

/**
 * The notifications the bell shows inside a space: that space's, and the personal ones OF THE SAME COMPANY
 * (no space: a welcome, a changed rank, a ticket with no space). A person may work in two companies, so a
 * personal notice of one must never ring in the other's bell (review B7); a row from before notices carried a
 * company (`organizationId: null`) is still shown, so nothing disappears. With no space at all: everything.
 */
export function bellWhere(userId: string, spaceId: string | null | undefined, organizationId?: string | null) {
  // without a company (a caller that has none): what the bell always showed
  if (!organizationId) return spaceId ? { userId, OR: [{ workspaceId: spaceId }, { workspaceId: null }] } : { userId };
  const personal: Prisma.NotificationWhereInput = {
    workspaceId: null,
    // a notice from before the column existed belongs to no company: shown once, in the bell of the company
    // open at the moment the switch happened. The backfill gives the rest of them their one company.
    OR: [{ organizationId }, { organizationId: null }],
  };
  // inside a space: that space's, and the personal ones of this company; with no space open: the same, minus
  // another company's spaces (a space row of another company is found by its id, never here)
  return spaceId ? { userId, OR: [{ workspaceId: spaceId }, personal] } : { userId, AND: [personal] };
}
