import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { panelRedirectFor } from "@/server/services/control-panel";
import { carriedQuery } from "@/lib/legacy-routes";
import { activeOrgCtx } from "@/server/services/integrations";
import { readArchiveFilterOptions } from "@/server/chat/archive";
import { actorCan } from "@/server/policy/actor";
import { getServerT } from "@/lib/i18n/server";
import { ArchiveClient } from "@/lib/chat/archive/archive-client";

export default async function ArchivePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> } = {}) {
  const { actor } = await pageActor();
  const { t } = getServerT();
  if (!actorCan(actor, "archive.view")) {
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-fg-muted">{t("access.section_off")}</div>;
  }
  // A2.1: with the switch `controlPanelV2` ON the archive is the section «الأرشيف والرقابة» of the one panel (the same screen, `ArchiveBody`)
  const inPanel = await panelRedirectFor(actor, "/archive", carriedQuery(searchParams));
  if (inPanel) redirect(inPanel);
  return <div dir="rtl" className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold tracking-tight">{t("archive.title")}</h1><p className="mt-1 text-sm text-fg-muted">{t("archive.subtitle")}</p></header>
  <ArchiveClient options={await readArchiveFilterOptions(await activeOrgCtx())} />
  </div>;
}

export const dynamic = "force-dynamic";
