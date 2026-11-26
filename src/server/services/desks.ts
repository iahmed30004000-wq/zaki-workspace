import { db } from "@/server/db";
import { actorCan, type Actor } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { sectionMay, type SectionMay } from "@/lib/section-may";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";

/**
 * The facts the pages «الحملات», «الأقسام» and «الروتين اليومي» read on the server before they draw (src/app/(app)/campaigns,
 * departments, production): who the person is to these sections, the department of the space they are in, the company's day. ONE
 * function, so the pages and the phone's door (GET /api/desks/facts) cannot disagree. Every route decides again on its own.
 */
export interface DeskFacts {
  role: string;
  external: boolean;
  spaceOnly: boolean;
  /** the staff directory switch: the departments and the campaigns need it */
  directory: boolean;
  /** OWNER or ADMIN by rank: manages the departments (a rank rule on the server, not a capability) */
  manager: boolean;
  campaigns: SectionMay;
  tickets: SectionMay;
  production: SectionMay;
  /** the department of the space the person is in, when it is a department's space (its campaigns open first) */
  departmentId: string | null;
  /** the company's zone and its today («YYYY-MM-DD»): the routine's day is cut there */
  timeZone: string;
  today: string;
}

export async function deskFactsFor(actor: Actor, now: Date = new Date()): Promise<DeskFacts> {
  const [space, org] = await Promise.all([
    currentSpace(actor),
    db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }),
  ]);
  const here = space?.kind === "DEPARTMENT" ? await db.workspace.findUnique({ where: { id: space.id }, select: { departmentId: true } }) : null;
  const timeZone = resolveTimeZone(org?.timezone);
  const p = zonedParts(now, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    role: actor.role,
    external: actor.isExternal,
    spaceOnly: actor.spaceOnly === true,
    directory: actorCan(actor, "directory.view"),
    manager: actor.role === "OWNER" || actor.role === "ADMIN",
    campaigns: sectionMay(actor.caps, "campaigns"),
    tickets: sectionMay(actor.caps, "tickets"),
    production: sectionMay(actor.caps, "production"),
    departmentId: here?.departmentId ?? null,
    timeZone,
    today: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
  };
}
