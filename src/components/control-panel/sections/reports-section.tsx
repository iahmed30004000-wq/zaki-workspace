import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/auth";
import { actorCan } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { companyPanelAccess, loadPanelReports } from "@/server/services/control-panel";
import { parseBoardQuery } from "@/server/services/owner-board-io";
import type { PanelScope } from "@/lib/control-panel";
import { ReportsView } from "@/components/control-panel/panel";
import { SectionHeader } from "@/components/control-panel/frame";
import { AnalyticsReport } from "./analytics-report";
import type { SectionCtx } from "./board-sections";

/**
 * «التقارير» — the old report (`/analytics`, MOVED) and, for the company-wide owner, the same numbers merged with the 8-week series and the table per space (the first
 * panel's «التقارير»). ONE of the two is drawn, never both: the labels of the two are the same («مهام مفتوحة», «متأخرة»…) and one counts the company while the other counts
 * the space the person is in, so drawing both would show the same label with two numbers. The person needs `reports.view` (the section list says so, this asks again).
 */
export async function ReportsSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, userId, searchParams, t } = ctx;
  if (!actorCan(actor, "reports.view")) return notFound();
  const full = await companyPanelAccess(actor);
  if (full) {
    const query = parseBoardQuery(searchParams);
    const reports = await loadPanelReports(full, { space: query.space ?? null }).catch((err: unknown) => {
      if (err instanceof NotFoundError) notFound();
      throw err;
    });
    const chosen = reports.spaceId ? reports.spaces.find((s) => s.id === reports.spaceId) : undefined;
    const scope: PanelScope = chosen ? { kind: "spaces", names: [chosen.name] } : { kind: "company" };
    return (
      <div className="space-y-4" data-testid="cp-reports-section">
        <SectionHeader t={t} section="reports" hint={t("cpv2.reports.hint")} scope={scope} />
        <ReportsView t={t} r={reports} hidden={{ s: "reports" }} />
      </div>
    );
  }
  // not the company-wide owner: the report over the spaces the person can open, and inside a space that space (as the old page always did)
  const here = await currentSpace(actor);
  const scope: PanelScope = here ? { kind: "spaces", names: [here.name] } : { kind: "accessible" };
  return (
    <div className="space-y-4" data-testid="cp-reports-section">
      <SectionHeader t={t} section="reports" hint={t("cpv2.reports.hint")} scope={scope} />
      {await AnalyticsReport({ userId, actor, heading: "h2" })}
    </div>
  );
}
