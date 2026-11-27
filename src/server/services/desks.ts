import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { actorCan, actorCanWork, type Actor } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { sectionMay, type SectionMay } from "@/lib/section-may";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";
import { boardAccess, type BoardMode } from "@/server/policy/board";
import { controlPanelAccess } from "@/server/services/control-panel";
import { actorFeatureOn } from "@/server/services/features";
import { mayOverview } from "@/server/services/spaces-overview";

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
  /** «العملاء»: the person's row of the grid, and whether an opportunity's amount is theirs to see (`prices.view`) */
  crm: SectionMay;
  prices: boolean;
  /** «التقارير»: the reports box of the person's grid */
  reports: boolean;
  /** «لوحة المالك»: owner / team / self, or null when the board is not theirs (switched off, a partner, neither switch) */
  board: BoardMode | null;
  /** «لوحة التحكم»: the owner's panel (its switch on and the board company-wide) */
  panel: boolean;
  /** the performance and development section exists for this person: its switch on, and not an external partner (the pages decide reach) */
  development: boolean;
  /** the look over every space: OWNER or ADMIN by rank */
  spaces: boolean;
  /** «الحسابات والصلاحيات»: whoever holds `users.manage` (a partner holds no capability) */
  accounts: boolean;
  /** the company the person is signed in to: the accounts' doors carry it in their path */
  orgId: string;
  /** «روتين المهام» (/my-work/routines) exists for this person: the company's «مهمة متكررة» switch on, not a partner, the tasks section readable — the page's own three checks */
  routines: boolean;
}

/** «not found» from the board's or the panel's gate means «not theirs»; anything else (the database down) is not swallowed. */
const notTheirs = <T,>(value: T) => (err: unknown): T => {
  if (err instanceof NotFoundError) return value;
  throw err;
};

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
    crm: sectionMay(actor.caps, "crm"),
    prices: actorCan(actor, "prices.view"),
    reports: actorCan(actor, "reports.view") && !actor.isExternal,
    // the board and the panel say «not found» to whoever they are not for: here that is simply «not theirs»
    board: await boardAccess(actor).then((a) => a.mode, notTheirs(null)),
    panel: await controlPanelAccess(actor).then(() => true, notTheirs(false)),
    development: !actor.isExternal && (await actorFeatureOn(actor, "teamDevelopment")),
    spaces: mayOverview(actor),
    accounts: actorCan(actor, "users.manage"),
    orgId: actor.orgId,
    routines: !actor.isExternal && actorCanWork(actor, "tasks.view") && (await actorFeatureOn(actor, "recurringTasks")),
  };
}
