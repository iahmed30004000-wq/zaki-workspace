import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { ReportsPage } from "@/components/manufacturing/reports-view";
import { EmptyState } from "@/components/ui/card";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError, ValidationError } from "@/server/auth";
import { actorCan } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { readReports } from "@/server/services/manufacturing-reports";

/** The browser tab says «مخزون التصنيع» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("mfg.title") };

/**
 * «تقارير» of the manufacturing space the person is in (`?from=&to=` is the period).
 * The page decides nothing: WHO the person is comes from `pageActor()`; an external partner, a person without `manufacturing.view` and a
 * switched-off feature are all «not found»; WHAT is read (and whether any money is) is decided by the service, again on every request.
 */
export default async function ManufacturingReportsRoute({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (actor.isExternal || !actorCan(actor, "manufacturing.view")) notFound();
  if (!(await actorFeatureOn(actor, "mfgLedger"))) notFound();
  const space = await currentSpace(actor);
  if (!space) return <EmptyState title={t("mfg.no_space")} />;
  if (space.layout !== "MANUFACTURING") return <EmptyState title={t("mfg.not_mfg_space")} hint={t("mfg.not_mfg_space_hint")} />;
  try {
    try {
      return <ReportsPage initial={await readReports(actor, { spaceId: space.id, from: searchParams.from, to: searchParams.to })} />;
    } catch (err) {
      // a period typed into the address that makes no sense: show the default one instead of an error page
      if (!(err instanceof ValidationError)) throw err;
      return <ReportsPage initial={await readReports(actor, { spaceId: space.id })} />;
    }
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
