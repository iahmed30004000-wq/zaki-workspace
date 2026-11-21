import { notFound, redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { AssistantBody } from "@/components/control-panel/sections/assistant-bodies";
import { NotFoundError } from "@/server/auth";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";

/**
 * «مساعد المالك» — /owner/assistant. The OWNER alone (the owner and his partners); everybody else, and everybody while the switch is
 * off, gets «not found» and the menu never offers it. `?c=<id>` opens one of the owner's own conversations (somebody else's, or one
 * that does not exist, opens an empty one: the page never says it exists). Reading writes nothing. The body is `AssistantBody`, shared with the
 * section «مساعد المالك» of the control panel (A2.1): with the switch `controlPanelV2` ON this address leads there.
 */
export default async function OwnerAssistantPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const access = await assistantAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const inPanel = await panelRedirectFor(actor, "/owner/assistant", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return AssistantBody({ access, searchParams });
}

export const dynamic = "force-dynamic";
