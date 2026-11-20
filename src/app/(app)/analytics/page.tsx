import { redirect } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorFeatureOn } from "@/server/services/features";
import { actorCan } from "@/server/policy/actor";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { AnalyticsReport } from "@/components/control-panel/sections/analytics-report";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";

export default async function AnalyticsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { user, actor } = await pageActor();
  // Company numbers: the idea funnel, the staff names with their workload. Not for an external partner,
  // whatever their tab shows; for the team, the reports box of the person's grid (a lead's and up by default).
  if (refusedToGuest(actor, "reports")) return <GuestNotice />;
  if (!actorCan(actor, "reports.view")) return <SectionOffNotice />;
  // A2.1: with the switch `controlPanelV2` ON «التقارير» is a section of the one panel, for whoever may open it (the same body, moved); anybody else keeps this page
  const inPanel = await panelRedirectFor(actor, "/analytics", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  // «لوحة التحكم»: for the OWNER rank «التقارير» is a section of the panel while the panel (and the board under it) is on; the page stays as it
  // was for everybody else and for the owner when a switch is off
  if (actor.isOwner && (await actorFeatureOn(actor, "controlPanel")) && (await actorFeatureOn(actor, "ownerBoard"))) redirect("/owner?v=reports");
  return AnalyticsReport({ userId: user.id, actor });
}

export const dynamic = "force-dynamic";
