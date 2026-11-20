import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";
import { StructureBody } from "@/components/control-panel/sections/development-body";

/**
 * «الهيكل» — who answers to whom. One page, three readers (src/server/policy/team-development.ts decides which):
 *   the owner and whoever holds `people.manage_lines`  the whole company's tree, with «غيّر المسؤول» (the shared `ManagerPicker`, for the people the viewer outranks) and the people nobody answers for;
 *   a supervisor                                       themselves and the people below them;
 *   everybody else                                     only their own supervisor and the names of their team mates.
 * An external partner, or the company with «الأداء والتطوير» switched off, gets «not found». Reading writes nothing. The body is `StructureBody`, shared with the section
 * «الهيكل والتطوير» of the control panel (A2.1): with the switch `controlPanelV2` ON this address leads there for whoever may open that section.
 */
export default async function StructurePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { actor } = await pageActor();
  const inPanel = await panelRedirectFor(actor, "/structure", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return StructureBody({ actor });
}

export const dynamic = "force-dynamic";
