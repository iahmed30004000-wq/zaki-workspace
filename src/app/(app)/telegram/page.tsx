import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { TelegramBody } from "@/components/control-panel/sections/integrations-bodies";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";

export default async function TelegramPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();

  // The page hands the chat list to the client as initial data, and the chats are customer
  // conversations: an external partner (guest) gets only a notice and the list is never fetched.
  if (actor.isExternal) {
    const { t } = getServerT();
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
  }

  // A2.1: with the switch `controlPanelV2` ON the Telegram bot is a part of the section «التكاملات» for whoever holds `integrations.manage` (the same view, moved)
  const inPanel = await panelRedirectFor(actor, "/telegram", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return TelegramBody({ actor });
}

export const dynamic = "force-dynamic";
