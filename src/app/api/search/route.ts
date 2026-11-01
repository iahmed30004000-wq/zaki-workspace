import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { currentSpace } from "@/server/services/current-space";
import { actorCan, actorCanWork, requireActor } from "@/server/policy/actor";
import { loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { searchChat } from "@/server/chat/search";
import { searchLibrary } from "@/server/services/files";
import { arabicSearch, cleanQuery } from "@/lib/search/arabic";
import { rankedSearch, sqlIn } from "@/server/search/ranked";
import { Prisma } from "@prisma/client";
import { isFeatureOn } from "@/server/services/features";

const NOTHING = { tasks: [], projects: [], topics: [], messages: [], people: [], files: [] };

/**
 * Search over the tasks/projects of the workspaces the caller can open — and, in the space they are in, its chat
 * (topics and messages, each one only if they could open it: src/server/chat/search.ts), its people and its library
 * (never for a guest: no staff directory, no library).
 * Authorization is enforced in SQL by the same rule every other view uses
 * (`accessibleWorkspaceIds`: the org OWNER sees every workspace of the company, everyone
 * else — an ADMIN included — only the workspaces they were put in, and only while they are
 * an ACTIVE member) — never client-side.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    // what was typed, cleaned (control characters out, spaces collapsed, 100 characters at most)
    const q = cleanQuery(url.searchParams.get("q") ?? "");
    const search = arabicSearch(q);
    if (!search || search.text.length < 2) return NextResponse.json(NOTHING);
    // «البحث الشامل» off (or the company is in economy mode with it held off): an empty answer at once, no database work at all
    const asker = await requireActor();
    if (!(await isFeatureOn(asker.orgId, "search"))) return NextResponse.json(NOTHING);

    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    if (orgIds.length === 0) throw new ForbiddenError("not_org_member");

    // the spaces they may open and, inside a space with teams, the space's own work and their teams'
    // …and only in the space they are in, like a separate site
    const actor = asker;
    const space = await currentSpace(actor);
    const scope = narrowScope(await loadWorkScope(user.id), space?.id);
    const workspaceIds = scopeSpaceIds(scope);
    if (workspaceIds.length === 0) return NextResponse.json(NOTHING);

    // the space's own chat, people and library: only inside a space
    const place = space ? { spaceId: space.id, isHq: space.kind === "HQ" } : null;
    const ctx = { orgId: actor.orgId, userId: actor.userId, orgRole: actor.role };
    const taskSpaces = actorCanWork(actor, "tasks.view") ? workspaceIds : [];
    const projectSpaces = actorCanWork(actor, "projects.view") ? workspaceIds : [];
    const [tasks, projects, chat, people, files] = await Promise.all([
      // the pool of ids by spelling (src/server/search/ranked.ts), then the SAME access where as ever on those ids
      taskSpaces.length === 0
        ? []
        : rankedSearch({
            query: {
              table: "Task",
              search,
              rank: true,
              where: [sqlIn("orgId", orgIds), sqlIn("workspaceId", taskSpaces), Prisma.sql`"archived" = FALSE`],
              order: Prisma.sql`"updatedAt" DESC`,
            },
            take: 8,
            load: (ids) =>
              db.task.findMany({
                where: {
                  orgId: { in: orgIds },
                  // the tasks «يشوف» box of the section grid
                  workspaceId: { in: taskSpaces },
                  AND: [taskVisibleWhere(scope)],
                  archived: false,
                  id: { in: ids },
                },
                select: {
                  id: true,
                  number: true,
                  title: true,
                  priority: true,
                  organization: { select: { keyPrefix: true } },
                  project: { select: { id: true, name: true } },
                },
              }),
          }),
      projectSpaces.length === 0
        ? []
        : rankedSearch({
            query: { table: "Project", search, rank: true, where: [sqlIn("workspaceId", projectSpaces)], order: Prisma.sql`"createdAt" DESC` },
            take: 6,
            load: (ids) =>
              db.project.findMany({
                where: { workspaceId: { in: projectSpaces }, AND: [projectVisibleWhere(scope)], id: { in: ids } },
                select: {
                  id: true,
                  name: true,
                  workspace: { select: { id: true, name: true } },
                },
              }),
          }),
      place ? searchChat(ctx, { id: place.spaceId, isHq: place.isHq }, q) : { topics: [], messages: [] },
      // the people of this space (a guest gets no staff directory)
      actor.isExternal || !place
        ? []
        : rankedSearch({
            query: {
              table: "User",
              search,
              rank: true,
              where: [Prisma.sql`"id" IN (SELECT "userId" FROM "WorkspaceMember" WHERE "workspaceId" = ${place.spaceId})`],
              order: Prisma.sql`"name" ASC`,
            },
            take: 6,
            load: async (ids) => {
              const rows = await db.workspaceMember.findMany({
                where: {
                  workspaceId: place.spaceId,
                  userId: { in: ids },
                  user: { memberships: { some: { organizationId: actor.orgId, status: "ACTIVE" } } },
                },
                select: { userId: true, user: { select: { id: true, name: true } } },
              });
              // `rankedSearch` orders by `id`: the person's id, not the membership row's
              return rows.map((m) => ({ id: m.userId, user: m.user }));
            },
          }),
      // the library's files only for whoever holds its «يشوف» box
      actor.isExternal || !place || !actorCan(actor, "files.view") ? [] : searchLibrary(actor.orgId, place, q),
    ]);

    return NextResponse.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        key: `${t.organization.keyPrefix}-${t.number}`,
        title: t.title,
        priority: t.priority,
        projectId: t.project.id,
        projectName: t.project.name,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        workspaceId: p.workspace.id,
        workspaceName: p.workspace.name,
      })),
      topics: chat.topics,
      messages: chat.messages,
      people: people.map((m) => m.user),
      files,
    });
  });
}
