import { overdueDueFilter } from "@/lib/due-day";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { navExtrasOf } from "@/server/policy/org-settings";
import { featuresOff } from "@/lib/features";
import { buildNav, rankAtLeast, type NavModel, type NavRole, type NavSubject } from "@/lib/nav/places";
import { panelSectionsFor } from "@/lib/control-panel";
import { firstUnseen, readNavOrder, type NavOrder } from "@/lib/nav/order";
import type { SpaceLayout } from "@/lib/cards/shared";
import { parseAddress, settingsOneDoorOf, type AddressKind, type ForeignSpace } from "@/lib/nav/shell-v2";
import { safeNext } from "@/lib/space-link";
import { loadCard } from "./cards";
import { bannerInsteadOfSwitch, currentSpace, spacesOf } from "./current-space";
import { panelFactsOf } from "./control-panel";
import { spaceOfApproval } from "./approvals";
import { orgTimeZone } from "./org-day";
import { spaceFigures } from "./space-figures";
import { loadWorkScope, projectVisibleWhere, scopeSpaceIds, taskVisibleWhere } from "./team-scope";

/**
 * «ترتيبي» — the person's own order of the menu, kept on the account (`User.navOrder`, one nullable JSON column).
 *
 * It is PERSONAL: every function takes the person's id from the session and nothing else, so nobody reads or writes
 * another person's order. It is only an ORDER: it is applied over the map the person may see (`applyNavOrder`), so a
 * saved order never reveals or hides anything, and a save that names something the person may not see is refused.
 */

/**
 * Who the map is drawn for — the one place that turns an actor into a `NavSubject`, shared by the (app) layout and by
 * the save below, so «what the person may see» is decided the same way in both.
 */
export function navSubjectOf(actor: Pick<Actor, "role" | "caps" | "isExternal" | "spaceOnly">, orgSettings: unknown, space: { manager: boolean; layout?: SpaceLayout } | null, supervisor = false, panel = false): NavSubject {
  return {
    role: actor.role,
    caps: [...actor.caps],
    off: featuresOff(orgSettings),
    ...(actor.spaceOnly ? { spaceOnly: true } : {}),
    spaceManager: !actor.isExternal && space?.manager === true,
    // somebody answers to this person («الهيكل»): read by the callers that have the database at hand
    supervisor: !actor.isExternal && supervisor,
    // a space of «لوحات» or «تصنيع» offers «اللوحات» and «الإدارة» only (the pure map decides: src/lib/nav/places.ts)
    ...(space?.layout ? { spaceLayout: space.layout } : {}),
    // N1.1/N1.2: the company's switch `navV2` (the new map, OFF by default) and the work tools the owner pinned as tabs
    ...navExtrasOf(orgSettings),
    // S3.1: «الإعدادات» is ONE door (its switch AND the one control panel): only written when true, so the subject of a company without it is exactly what it was
    ...(settingsOneDoorOf(orgSettings) ? { settingsOneDoor: true, ...(panel && !actor.isExternal ? { panel: true } : {}) } : {}),
  };
}

/**
 * S3.1 — with «الإعدادات» as ONE door, does this ADMIN or OWNER hold the control panel (at least one of its sections, the same capability checks the panel's own list makes:
 * `panelSectionsFor`)? Then the place «الإدارة» leaves their menu (`oneDoorHidesAdmin`). False without the switch, for staff below ADMIN and for a guest, and no database read is made then.
 * Read from the database, never from the cookie (`panelFactsOf` is shared with the panel itself, once per request).
 */
export async function oneDoorPanelFor(actor: Actor, orgSettings: unknown): Promise<boolean> {
  if (!settingsOneDoorOf(orgSettings) || actor.isExternal || !rankAtLeast(actor.role as NavRole, "ADMIN")) return false;
  const { facts } = await panelFactsOf(actor);
  return panelSectionsFor(facts).length > 0;
}

/** Does an ACTIVE, non-guest person answer to this one («الهيكل»)? One indexed count; read from the database on every layout render. */
export async function hasActiveReports(actor: Pick<Actor, "orgId" | "userId" | "isExternal">): Promise<boolean> {
  if (actor.isExternal) return false;
  const n = await db.organizationMember.count({ where: { organizationId: actor.orgId, managerId: actor.userId, status: "ACTIVE", role: { not: "GUEST" } } });
  return n > 0;
}

/**
 * N1.3 — how many tasks assigned to this person are overdue in each space they may open, per company (`{ spaceId: count }`, spaces with none left out):
 * the number beside every space on the switcher, next to the unread messages. «Overdue» is the same line My Work uses (before the START of the
 * company's today, `orgDayStart`); only open, live tasks the person is assigned to (or co-assigned), through the same visibility rule as every task list
 * (`taskVisibleWhere`), so a private task of somebody else is never counted. One grouped query per company.
 */
export async function overdueBySpace(userId: string, orgIds: readonly string[], now: Date = new Date()): Promise<Record<string, number>> {
  if (orgIds.length === 0) return {};
  const scope = await loadWorkScope(userId);
  const spaceIds = scopeSpaceIds(scope);
  if (spaceIds.length === 0) return {};
  const out: Record<string, number> = {};
  await Promise.all(
    orgIds.map(async (orgId) => {
      // B4: the per-space numbers come from `spaceFigures`, the one source (the same query «كل المساحات», the report and the overview use)
      const figures = await spaceFigures({ orgId, spaceIds, overdue: overdueDueFilter(now, await orgTimeZone(orgId)), scope, assigneeId: userId });
      for (const [spaceId, figure] of figures) if (figure.overdue > 0) out[spaceId] = figure.overdue;
    }),
  );
  return out;
}

/**
 * N1.3 — the space a page's ONE thing lives in, for the banner: «هاد من مساحة «X»». `address` is the page on screen (a task, a project, a board, a card,
 * an approval, a call, a «نتفرّج سوا» session, a chat topic: the pages that called `keepInSpace`); it answers only while the company's switch `navV2` is
 * on, only for a thing THIS person may open (tasks, projects, boards, cards, approvals and topics through the rules their pages apply; a call and a watch
 * session are named by their id inside the company, as their pages do before `keepInSpace`), only when that space is one of theirs, and only
 * when it is not the space they are in. Anything else — a list, a thing that is not theirs, a space that is not theirs — is `null`: the page answers for itself.
 */
export async function foreignSpaceOf(actor: Actor, address: string): Promise<ForeignSpace | null> {
  const found = parseAddress(address);
  if (!found || !(await bannerInsteadOfSwitch(actor))) return null;
  const spaceId = await spaceOfThing(actor, found.kind, found.id);
  if (!spaceId) return null;
  const spaces = await spacesOf(actor);
  const there = spaces.find((s) => s.id === spaceId);
  if (!there) return null;
  const here = await currentSpace(actor);
  if (here?.id === spaceId) return null;
  const next = safeNext(address);
  return { path: next.split(/[?#]/, 1)[0] ?? next, next, spaceId, name: there.name, emoji: there.emoji };
}

/** The space id of one thing the person may open (null: not found for them). The same questions the pages ask before `keepInSpace`. */
async function spaceOfThing(actor: Actor, kind: AddressKind, id: string): Promise<string | null> {
  switch (kind) {
    case "task": {
      const task = await db.task.findFirst({ where: { id, orgId: actor.orgId, AND: [taskVisibleWhere(await loadWorkScope(actor.userId))] }, select: { workspaceId: true } });
      return task?.workspaceId ?? null;
    }
    case "project": {
      const project = await db.project.findFirst({ where: { id, AND: [projectVisibleWhere(await loadWorkScope(actor.userId))] }, select: { workspaceId: true } });
      return project?.workspaceId ?? null;
    }
    case "board": {
      const board = await db.board.findFirst({ where: { id, project: projectVisibleWhere(await loadWorkScope(actor.userId)) }, select: { project: { select: { workspaceId: true } } } });
      return board?.project.workspaceId ?? null;
    }
    case "card":
      return loadCard(actor, id).then(({ row }) => row.workspaceId, () => null);
    case "approval":
      return spaceOfApproval(actor, id).catch(() => null);
    case "call":
      return (await db.call.findFirst({ where: { id, orgId: actor.orgId }, select: { spaceId: true } }))?.spaceId ?? null;
    case "watch":
      return (await db.watchSession.findFirst({ where: { id, orgId: actor.orgId }, select: { spaceId: true } }))?.spaceId ?? null;
    case "topic":
      // a restricted topic and a DM are named only to the people in them; an open topic to anybody of the space (the space check is the caller's)
      return (await db.conversation.findFirst({ where: { id, orgId: actor.orgId, OR: [{ restricted: false, kind: "TOPIC" }, { members: { some: { userId: actor.userId } } }] }, select: { spaceId: true } }))?.spaceId ?? null;
  }
}

/** The map this person is offered right now (read from the database, the cookie decides nothing). */
export async function visibleNavFor(actor: Actor): Promise<NavModel> {
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
  const space = await currentSpace(actor);
  return buildNav(navSubjectOf(actor, org?.settings, space, await hasActiveReports(actor), await oneDoorPanelFor(actor, org?.settings)));
}

/** The person's saved order (null: the code's order). A stored value that is damaged reads as «none», never as an error. */
export async function getNavOrder(userId: string): Promise<NavOrder | null> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { navOrder: true } });
  return readNavOrder(row?.navOrder);
}

/**
 * Saves the person's order (replacing the one before). `order` is already schema-valid (known keys, no duplicates); it
 * must also name only places and tabs this person may see — otherwise 403 `navorder.not_visible` and nothing is written.
 * An order that says nothing is the same as none: the column is cleared.
 */
export async function saveNavOrder(actor: Actor, order: NavOrder): Promise<NavOrder | null> {
  const nav = await visibleNavFor(actor);
  if (firstUnseen(order, nav) !== null) throw new ForbiddenError("navorder.not_visible");
  const clean = readNavOrder(order);
  await db.user.update({ where: { id: actor.userId }, data: { navOrder: clean ? { places: clean.places, tabs: clean.tabs } : Prisma.DbNull } });
  return clean;
}

/** «رجّع الترتيب الأصلي»: back to the code's order. */
export async function resetNavOrder(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { navOrder: Prisma.DbNull } });
}
