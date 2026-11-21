import { buildNav } from "@/lib/nav/places";
import { applyNavOrder, menuOrderFor, pruneNavOrder, readCompanyMenuOrder, readNavOrder } from "@/lib/nav/order";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { NotFoundError } from "@/server/auth";
import { currentSpace } from "@/server/services/current-space";
import { orgSummaryOf, isFeatureOn } from "@/server/services/features";
import { panelAccess, type PanelAccess } from "@/server/services/control-panel";
import { companyGroupOf, type CompanyGroup } from "@/components/settings-me/sections";
import { hasActiveReports, navSubjectOf, oneDoorPanelFor } from "@/server/services/nav-order";
import type { MenuPlace } from "@/components/settings-me/menu-section";

/**
 * C4.1 — what the server-drawn parts of «إعداداتي» read, in one place (a client component never imports this file).
 */

/** «القائمة»: the places the person sees in the order they see them, their own tabs order, and whether the COMPANY has set the order (D-N5: then the screen shows the ⚠️ + 🔧 note). */
export async function menuFor(actor: Actor): Promise<{ places: MenuPlace[]; tabs: Record<string, string[]>; locked: boolean }> {
  const [org, me, space, supervisor] = await Promise.all([
    orgSummaryOf(actor.orgId),
    db.user.findUnique({ where: { id: actor.userId }, select: { navOrder: true } }),
    currentSpace(actor),
    hasActiveReports(actor),
  ]);
  const subject = navSubjectOf(actor, org?.settings, space, supervisor, await oneDoorPanelFor(actor, org?.settings));
  const navV2 = subject.navV2 === true;
  const own = readNavOrder(me?.navOrder);
  const menu = menuOrderFor(readCompanyMenuOrder(org?.settings), own);
  const nav = buildNav(subject);
  const shown = applyNavOrder(nav, navV2 ? menu.order : own);
  return {
    places: shown.places.map((place) => ({ key: place.key as string, labelKey: place.labelKey })),
    // the tabs order is sent back unchanged with a new order of the places, cut down to what the person sees (`User.navOrder` stays as stored)
    tabs: pruneNavOrder(own, nav).tabs,
    locked: navV2 && menu.personalLocked,
  };
}

/**
 * S3.1 — «الإعدادات» is ONE door for this person's company: the switch `settingsOneDoor` AND the one control panel (`controlPanelV2`) it needs. Read from the database, never from the cookie.
 */
export async function oneDoorOnFor(actor: Pick<Actor, "orgId">): Promise<boolean> {
  return (await isFeatureOn(actor.orgId, "settingsOneDoor")) && (await isFeatureOn(actor.orgId, "controlPanelV2"));
}

/**
 * S3.1 — the second group of the frame, «إعدادات الشركة», for this person: null while «الإعدادات» is not ONE door, for an external partner and for anybody who may open no section of the control panel.
 * It is decided by the panel's own list of sections (`panelAccess` → `panelSectionsFor`: the capability checks the panel makes, never a rank check of this file's own), and the panel's
 * access is returned with it for the section bodies, which decide again on their own. A guest never gets it.
 */
export async function companyAccessFor(actor: Actor): Promise<{ group: CompanyGroup; access: PanelAccess } | null> {
  if (actor.isExternal || !(await oneDoorOnFor(actor))) return null;
  let access: PanelAccess;
  try {
    access = await panelAccess(actor);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  const group = companyGroupOf(access.sections, actor.role);
  return group ? { group, access } : null;
}

/** «تواصل مع الإدارة»: the company's primary owner, for somebody who is not that owner and has a staff directory (an external partner has none). */
export async function contactOwnerId(actor: Actor): Promise<string | null> {
  if (actor.isExternal) return null;
  const row = await db.organizationMember.findFirst({
    where: { organizationId: actor.orgId, role: "OWNER", primaryOwner: true, status: "ACTIVE" },
    select: { userId: true },
  });
  return row && row.userId !== actor.userId ? row.userId : null;
}
