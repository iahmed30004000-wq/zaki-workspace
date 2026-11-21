import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { sectionMay } from "@/lib/section-may";
import { getServerT } from "@/lib/i18n/server";
import { db } from "@/server/db";
import { currentSpace } from "@/server/services/current-space";
import { TicketsDesk } from "@/components/work-desks";

/**
 * «التذاكر» (the owner's ask, 2026-10-25): a page of its own under «الشغل» — one's own tickets, then a department's desk. A guest gets a notice (the departments' work is the
 * company's, and the API refuses guests); somebody whose `directory.view` is off gets the «not enabled» notice, like
 * the departments page. Inside a department's space, that department's desk opens first.
 */
export default async function TicketsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { t } = await getServerT();
  const { user, actor } = await pageActor();
  if (actor.isExternal) {
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
  }
  if (!actorCan(actor, "directory.view") || !actorCan(actor, "tickets.view")) return <SectionOffNotice />;
  const space = await currentSpace(actor);
  const here = space?.kind === "DEPARTMENT"
    ? await db.workspace.findUnique({ where: { id: space.id }, select: { departmentId: true } })
    : null;
  // `?ticket=<id>`: «مواعيد اليوم» (and any link to one ticket) opens that ticket's sheet; the detail door decides again whether the person may read it
  const asked = searchParams?.["ticket"];
  const openTicketId = typeof asked === "string" && asked.length > 0 && asked.length <= 64 ? asked : null;
  return <TicketsDesk me={{ id: user.id, role: actor.role, may: sectionMay(actor.caps, "tickets") }} defaultDepartmentId={here?.departmentId ?? null} openTicketId={openTicketId} />;
}

export const dynamic = "force-dynamic";
