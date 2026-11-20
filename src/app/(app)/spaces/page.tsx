import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { mayOverview } from "@/server/services/spaces-overview";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";
import { SpacesBody } from "@/components/control-panel/sections/spaces-body";

export const metadata = { title: getServerT().t("spaces.overview.title") };

/**
 * «كل المساحات» — the owner's and the admins' look over every space they can open (the body is `SpacesBody`, shared with the section «المساحات» of the control
 * panel: with the switch `controlPanelV2` ON this address leads there for whoever may open that section). Anybody else is sent to their «اليوم».
 */
export default async function SpacesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { actor } = await pageActor();
  if (!mayOverview(actor)) redirect("/");
  const inPanel = await panelRedirectFor(actor, "/spaces", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return SpacesBody({ actor });
}

export const dynamic = "force-dynamic";
