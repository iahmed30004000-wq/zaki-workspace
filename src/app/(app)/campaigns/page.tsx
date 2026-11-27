import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { getServerT } from "@/lib/i18n/server";
import { deskFactsFor } from "@/server/services/desks";
import { CampaignsDesk } from "@/components/work-desks";

/**
 * «الحملات» (the owner's ask, 2026-10-25): a page of its own under «الشغل» — one's own campaigns, then a department's desk. A guest gets a notice (the departments' work is the
 * company's, and the API refuses guests); somebody whose `directory.view` is off gets the «not enabled» notice, like
 * the departments page. Inside a department's space, that department's desk opens first.
 */
export default async function CampaignsPage() {
  const { t } = await getServerT();
  const { user, actor } = await pageActor();
  if (actor.isExternal) {
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
  }
  if (!actorCan(actor, "directory.view") || !actorCan(actor, "campaigns.view")) return <SectionOffNotice />;
  // the department of the space the person is in: the same fact the phone's door reads (GET /api/desks/facts)
  const facts = await deskFactsFor(actor);
  return <CampaignsDesk me={{ id: user.id, role: actor.role, may: facts.campaigns }} defaultDepartmentId={facts.departmentId} />;
}

export const dynamic = "force-dynamic";
