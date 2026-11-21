import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";
import { DevelopmentBody } from "@/components/control-panel/sections/development-body";

/**
 * «الأداء والتطوير» — the people the viewer reads (the owner: everybody; a supervisor: their subtree) with the score band and the light
 * of a period, sorted by NAME (by score only when the viewer clicks the column). A person who reads nobody but themselves sees their
 * own file («ملفي») right here. Reading writes nothing. The body is `DevelopmentBody`, shared with the section «الهيكل والتطوير» of the control panel
 * (A2.1): with the switch `controlPanelV2` ON this address leads there for whoever may open that section.
 */
export default async function DevelopmentPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const inPanel = await panelRedirectFor(actor, "/development", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return DevelopmentBody({ actor, searchParams });
}

export const dynamic = "force-dynamic";
