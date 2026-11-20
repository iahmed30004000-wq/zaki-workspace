import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice } from "@/app/(app)/_guest";
import { StaleTasksView } from "@/components/work/stale/stale-view";
import { getServerT } from "@/lib/i18n/server";
import { isFeatureOn } from "@/server/services/features";
import { managedSpacesOf, staleListFor } from "@/server/services/stale-tasks";
import { parseStaleParams, staleApiQuery } from "@/lib/work/stale";

/**
 * «مهام قديمة» — /my-work/stale (W1.9): the review list of open tasks nobody touched for N days (default 14), grouped by person and project, for the
 * OWNER and the people who run a space (a space's ADMIN, an org ADMIN who is in it). Bulk actions: سكّريها · عيّني مسؤول · أجّليها لتاريخ · أرشفيها, each
 * through the services that already exist and judged per task (a task the person may not change is refused and listed with its reason).
 *
 * A guest gets the same notice every internal page gives; a person who manages no space is told the page is for managers. Both are decided again by the
 * route behind the page. While the owner's switch `workStaleSweep` is OFF (the default) there is no such page: not found, for everybody.
 */
export default async function StalePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  if (!(await isFeatureOn(actor.orgId, "workStaleSweep"))) notFound();
  if (actor.isExternal) return <GuestNotice />;
  if ((await managedSpacesOf(actor)).length === 0) {
    const { t } = getServerT();
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("stale.managers_only")}</div>;
  }
  const params = parseStaleParams(searchParams ?? {});
  const initial = await staleListFor(actor, params);
  // `key`: an address the screen did not make itself (a pasted link) is a NEW screen, not a stale one
  return <StaleTasksView key={staleApiQuery(params)} initial={initial} />;
}

export const dynamic = "force-dynamic";
