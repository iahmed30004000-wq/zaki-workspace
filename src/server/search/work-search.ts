import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { actorCan, actorCanWork } from "@/server/policy/actor";
import { ideaPlaceWhere } from "@/server/services/ideas";
import { placeWhere, type SpacePlace } from "@/server/services/space-place";
import { projectVisibleWhere, type WorkScope } from "@/server/services/team-scope";
import type { ArabicSearch } from "@/lib/search/arabic";
import { rankedSearch, sqlIn } from "./ranked";

/**
 * W1.8 — THE PALETTE ALSO FINDS BOARDS, IDEAS, TICKETS AND CUSTOMERS, each by the rule of the page that opens it, so a title is never offered to a
 * person who could not open it. `GET /api/search` calls `searchWork` and adds a key to its answer only for a kind that has a hit (the old answer keeps
 * its shape, byte for byte, when nothing of these is found).
 *
 *   boards     `projects.view` and the projects the person may see (`projectVisibleWhere`: the space and its teams), inside the space they are in,
 *              not archived. A guest finds none: they reach a board through its project, which the search already offers them.
 *   ideas      the ideas row of the grid (`ideas.view`), staff only; the ideas the page reads in the space they are in (`ideaPlaceWhere`: the space's own,
 *              and in «الشركة» also the shared ones and the old ones).
 *   tickets    `tickets.view` AND `directory.view` — the tickets page needs both while D-W3 is pending (docs/restructure/DECISIONS.md), and a title the page
 *              would refuse is never offered — staff only; then the ticket's own reader rule (`canReadTicket` in src/server/services/tickets.ts): the
 *              OWNER and the ADMINs read every ticket of the company; anybody else the tickets they raised or hold and those of the departments they are in or lead.
 *              Never the description, the customer's number, the reference or the people.
 *   customers  `crm.view`, staff only, the customers the page reads in the space they are in (`placeWhere`). Name and company only: no phone, no e-mail, no notes.
 *
 * Every kind goes through `rankedSearch`: the pool of ids by spelling, then the SAME access `where` as the page on those ids.
 * When D-W3 is answered «آه للموظفين», the `directory.view` of the tickets line goes with the pages' (one commit).
 */

export interface BoardHit {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}
export interface IdeaHit {
  id: string;
  title: string;
  status: string;
}
export interface TicketHit {
  id: string;
  key: string;
  title: string;
  status: string;
}
export interface CustomerHit {
  id: string;
  name: string;
  company: string | null;
}

export interface WorkHits {
  boards: BoardHit[];
  ideas: IdeaHit[];
  tickets: TicketHit[];
  customers: CustomerHit[];
}

export const NO_WORK_HITS: WorkHits = { boards: [], ideas: [], tickets: [], customers: [] };

/** What each kind shows at most: the palette is a place to jump from, not a list. */
const TAKE = 5;

/** Does the person's rank read EVERY ticket of the company (the OWNER and the ADMINs: `seesDepartment` of tickets.ts)? */
const readsEveryTicket = (actor: Pick<Actor, "role">): boolean => actor.role === "OWNER" || actor.role === "ADMIN";

/**
 * The tickets a person may read, as a `where`: the rule of `canReadTicket` — raised it, holds it, is in its department or leads it; the OWNER and the ADMINs read
 * all. An instant ticket (no department) is only ever read by its two people and by the OWNER and the ADMINs.
 */
export function ticketReadableWhere(actor: Pick<Actor, "orgId" | "userId" | "role">): Prisma.TicketWhereInput {
  if (readsEveryTicket(actor)) return { orgId: actor.orgId };
  return {
    orgId: actor.orgId,
    OR: [
      { creatorId: actor.userId },
      { assigneeId: actor.userId },
      { department: { OR: [{ leadId: actor.userId }, { memberships: { some: { userId: actor.userId } } }] } },
    ],
  };
}

/** The same rule as a coarse SQL pool (ids only; the verdict is `ticketReadableWhere` on those ids). */
function ticketPoolSql(actor: Pick<Actor, "orgId" | "userId" | "role">): Prisma.Sql[] {
  const org = sqlIn("orgId", [actor.orgId]);
  if (readsEveryTicket(actor)) return [org];
  return [
    org,
    Prisma.sql`("creatorId" = ${actor.userId} OR "assigneeId" = ${actor.userId} OR "departmentId" IN (SELECT "departmentId" FROM "DepartmentMember" WHERE "userId" = ${actor.userId} UNION SELECT "id" FROM "Department" WHERE "leadId" = ${actor.userId}))`,
  ];
}

export async function searchWork(args: {
  actor: Actor;
  search: ArabicSearch;
  /** The space the person is in (null: none, and then no board, idea or customer is offered). */
  place: SpacePlace | null;
  /** The person's work scope narrowed to that space. */
  scope: WorkScope;
  /** The spaces of the scope where the person may read projects (already empty without the projects box). */
  projectSpaces: readonly string[];
}): Promise<WorkHits> {
  const { actor, search, place, scope, projectSpaces } = args;
  // an external partner (a guest) finds none of these: the staff's company data, whatever the space says
  if (actor.isExternal) return NO_WORK_HITS;

  // a board is read in the space the person is in: the scope was narrowed to it, and this keeps it so even if a caller forgets
  const boardSpaces = place?.spaceId ? projectSpaces.filter((id) => id === place.spaceId) : [];
  // the four kinds are asked together: the palette waits for the slowest, not for the sum
  const [boards, ideas, tickets, customers] = await Promise.all([
    boardSpaces.length === 0 || !actorCanWork(actor, "projects.view")
      ? []
      : rankedSearch({
          query: {
            table: "Board",
            search,
            rank: true,
            where: [
              Prisma.sql`"archived" = FALSE`,
              Prisma.sql`"projectId" IN (SELECT "id" FROM "Project" WHERE ${sqlIn("workspaceId", boardSpaces)})`,
            ],
            order: Prisma.sql`"updatedAt" DESC`,
          },
          take: TAKE,
          load: (ids) =>
            db.board.findMany({
              where: {
                id: { in: ids },
                archived: false,
                project: { AND: [projectVisibleWhere(scope)], workspaceId: { in: boardSpaces }, workspace: { organizationId: actor.orgId } },
              },
              select: { id: true, name: true, project: { select: { id: true, name: true } } },
            }),
        }),

    !place || !actorCan(actor, "ideas.view")
      ? []
      : rankedSearch({
          query: {
            table: "Idea",
            search,
            rank: true,
            where: [sqlIn("orgId", [actor.orgId]), ideaPoolSql(place)],
            order: Prisma.sql`"updatedAt" DESC`,
          },
          take: TAKE,
          load: (ids) => db.idea.findMany({ where: { id: { in: ids }, orgId: actor.orgId, AND: [ideaPlaceWhere(place)] }, select: { id: true, title: true, status: true } }),
        }),

    // the tickets page needs the directory too (D-W3 pending): offer nothing the page would refuse
    !actorCan(actor, "tickets.view") || !actorCan(actor, "directory.view")
      ? []
      : rankedSearch({
          query: { table: "Ticket", search, rank: true, where: ticketPoolSql(actor), order: Prisma.sql`"updatedAt" DESC` },
          take: TAKE,
          load: (ids) =>
            db.ticket.findMany({
              where: { AND: [ticketReadableWhere(actor), { id: { in: ids } }] },
              select: { id: true, number: true, title: true, status: true, organization: { select: { keyPrefix: true } } },
            }),
        }),

    !place || !actorCan(actor, "crm.view")
      ? []
      : rankedSearch({
          query: { table: "Customer", search, rank: true, where: [sqlIn("orgId", [actor.orgId]), customerPoolSql(place)], order: Prisma.sql`"updatedAt" DESC` },
          take: TAKE,
          load: (ids) => db.customer.findMany({ where: { id: { in: ids }, orgId: actor.orgId, AND: [placeWhere(place)] }, select: { id: true, name: true, company: true } }),
        }),
  ]);

  return {
    boards: boards.map((b) => ({ id: b.id, name: b.name, projectId: b.project.id, projectName: b.project.name })),
    ideas: ideas.map((i) => ({ id: i.id, title: i.title, status: i.status })),
    tickets: tickets.map((x) => ({ id: x.id, key: `${x.organization.keyPrefix}-T${x.number}`, title: x.title, status: x.status })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, company: c.company })),
  };
}

/** The coarse pool of ideas read in this place (`ideaPlaceWhere` decides). */
function ideaPoolSql(place: SpacePlace): Prisma.Sql {
  if (!place.spaceId) return Prisma.sql`FALSE`;
  return place.isHq
    ? Prisma.sql`("workspaceId" = ${place.spaceId} OR "workspaceId" IS NULL OR "sharedAt" IS NOT NULL)`
    : Prisma.sql`"workspaceId" = ${place.spaceId}`;
}

/** The coarse pool of customers read in this place (`placeWhere` decides). */
function customerPoolSql(place: SpacePlace): Prisma.Sql {
  if (!place.spaceId) return Prisma.sql`FALSE`;
  return place.isHq ? Prisma.sql`("workspaceId" = ${place.spaceId} OR "workspaceId" IS NULL)` : Prisma.sql`"workspaceId" = ${place.spaceId}`;
}
