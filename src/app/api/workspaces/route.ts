import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, ForbiddenError, requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { notifyMembership } from "@/server/notify";
import { goHref } from "@/lib/space-link";
import { assertCan, requireActor } from "@/server/policy/actor";
import { can, effectiveCapabilities } from "@/server/policy/capabilities";
import { parseJson } from "@/server/validation";
import { createWorkspace } from "@/server/services/workspaces";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { unreadBySpace } from "@/server/chat/unread";
import { currentSpace } from "@/server/services/current-space";
import { foreignSpaceOf, overdueBySpace } from "@/server/services/nav-order";
import { SPACE_LAYOUTS } from "@/lib/cards/shared";

/**
 * Workspace switcher — only the spaces the caller may open: the OWNER sees every space of the
 * company, everybody else (an ADMIN included) only the spaces they are in, and only while their
 * membership is ACTIVE. `canCreateSpaces` says whether they may open a new one in that organization.
 * Each space carries its emoji and `unread`: the messages and the notifications waiting for the person there (the number
 * beside it on the space switcher, like the accounts of a messaging app). «الشركة» comes first, then by name;
 * `currentSpaceId` is the space the person is in (the shell follows it after every navigation).
 *
 * N1.3 — the same ONE answer also carries `overdue` per space (the tasks assigned to the person that are late there) and, while the company's switch
 * `navV2` is on and `?path=` names ONE thing (a task, a project, …) of another space of the person's, `foreign`: the banner's line
 * («هاد من مساحة «X» [انتقل لها]»). The shell asks once per page (F1), so the spaces, the counts and the banner never cost a second request.
 */
export async function GET(req?: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const orgs = await db.organizationMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        capabilities: true,
        revokedCapabilities: true,
        organization: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
      },
    });
    const wsIds = await accessibleWorkspaceIds(user.id);
    const workspaces = wsIds.length
      ? await db.workspace.findMany({
          // archived spaces are off the switcher; the order is the one set on «كل المساحات»
          where: { id: { in: wsIds }, archivedAt: null },
          select: { id: true, name: true, slug: true, organizationId: true, kind: true, emoji: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
        })
      : [];
    // what waits in each space, per organization (one query each)
    const unread: Record<string, number> = {};
    for (const m of orgs) Object.assign(unread, await unreadBySpace({ userId: user.id, orgId: m.organization.id, orgRole: m.role }));
    // …and the notifications of each space that are not read yet
    const bells = await db.notification.groupBy({
      by: ["workspaceId"],
      where: { userId: user.id, readAt: null, workspaceId: { not: null } },
      _count: { _all: true },
    });
    for (const b of bells) if (b.workspaceId) unread[b.workspaceId] = (unread[b.workspaceId] ?? 0) + b._count._all;
    // …and the overdue tasks of the person in each space (the number beside the unread one)
    const overdue = await overdueBySpace(user.id, orgs.map((m) => m.organization.id));
    type Entry = { id: string; name: string; slug: string; emoji: string | null; holdsProjects: boolean; unread: number; overdue: number };
    const byOrg = new Map<string, Entry[]>();
    const hqFirst = [...workspaces.filter((w) => w.kind === "HQ"), ...workspaces.filter((w) => w.kind !== "HQ")];
    for (const w of hqFirst) {
      const list = byOrg.get(w.organizationId) ?? [];
      // «الشركة» (HQ) is for announcements and the company's talk: no project is opened there
      list.push({ id: w.id, name: w.name, slug: w.slug, emoji: w.emoji, holdsProjects: w.kind !== "HQ", unread: unread[w.id] ?? 0, overdue: overdue[w.id] ?? 0 });
      byOrg.set(w.organizationId, list);
    }
    // the company they work in is the oldest ACTIVE membership (`requireActor`): its current space
    const first = orgs[0];
    const here = first ? await currentSpace({ userId: user.id, orgId: first.organization.id, role: first.role }) : null;
    // the banner: only for a page that is ONE thing of another space (`?path=`), and only while `navV2` is on
    const asked = req ? new URL(req.url).searchParams.get("path") : null;
    const foreign = asked ? await (async () => foreignSpaceOf(await requireActor(), asked))().catch(() => null) : null;
    return NextResponse.json({
      currentSpaceId: here?.id ?? null,
      foreign,
      organizations: orgs.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        keyPrefix: m.organization.keyPrefix,
        role: m.role,
        canCreateSpaces: can(m, "spaces.create"),
        workspaces: byOrg.get(m.organization.id) ?? [],
      })),
    });
  });
}

const createSchema = z.object({
  /** Optional: the organization the caller works in unless they name another one of theirs. */
  organizationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  /** People to put in the new space from the start (ACTIVE members of the same organization). */
  memberIds: z.array(z.string().min(1)).max(200).optional(),
  /** «نوع المساحة»: a general space (default) or a space of «لوحات» only. */
  layout: z.enum(SPACE_LAYOUTS).optional(),
});

/**
 * Opens a space. It needs the capability `spaces.create` (the owner and the admins by default; the owner
 * switches it on for a lead or a member by name, or off for an admin); the creator becomes the space ADMIN.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createSchema, req);

    // the organization they work in, or another one of theirs when they name it: their rights THERE count
    let orgId = actor.orgId;
    let caps = actor.caps;
    if (input.organizationId && input.organizationId !== actor.orgId) {
      const member = await db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: actor.userId } },
        select: { role: true, status: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
      });
      if (!member || member.status !== "ACTIVE") throw new ForbiddenError("spaces.wrong_org");
      orgId = input.organizationId;
      caps = effectiveCapabilities(member);
    }
    assertCan({ caps }, "spaces.create");

    const { workspace, added } = await createWorkspace(actor.userId, {
      organizationId: orgId,
      name: input.name,
      description: input.description ?? null,
      memberIds: input.memberIds,
      layout: input.layout,
    });
    if (added.length) {
      await notifyMembership({
        userIds: added,
        kind: "workspace",
        title: workspace.name,
        linkUrl: goHref(workspace.id),
        actorId: actor.userId,
        workspaceId: workspace.id,
      });
    }
    await audit("workspace.created", {
      actorId: actor.userId,
      orgId,
      target: workspace.id,
      meta: { name: workspace.name },
    });
    return NextResponse.json({ workspace }, { status: 201 });
  });
}
