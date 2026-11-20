import { notFound, redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { AssistantSettingsBody } from "@/components/control-panel/sections/assistant-bodies";
import { NotFoundError } from "@/server/auth";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";

/**
 * «مساعد المالك» — the settings, /owner/assistant/settings. The OWNER alone, else «not found». The page is handed `hasKey` and the last
 * four characters and nothing else about the key: it is write-only (the cipher is never selected for a page). With the switch `controlPanelV2` ON the AI connection is ONE place:
 * this address leads to «التكاملات» › «الذكاء الاصطناعي» (A2.1).
 */
export default async function OwnerAssistantSettingsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { actor } = await pageActor();
  const access = await assistantAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const inPanel = await panelRedirectFor(actor, "/owner/assistant/settings", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return AssistantSettingsBody({ access });
}

export const dynamic = "force-dynamic";
