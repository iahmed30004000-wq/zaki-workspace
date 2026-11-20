import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { AutomationBody } from "@/components/control-panel/sections/integrations-bodies";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";

export default async function AutomationPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  // staff only on the map (its routes already refuse a guest): the notice, not an empty automation view
  if (refusedToGuest(actor, "automation")) return <GuestNotice />;
  // A2.1: with the switch `controlPanelV2` ON the integrations are one section of the control panel for whoever holds `integrations.manage` (the same cards, moved)
  const inPanel = await panelRedirectFor(actor, "/automation", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return AutomationBody({ actor });
}

export const dynamic = "force-dynamic";
