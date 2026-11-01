import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { OrdersPage } from "@/components/manufacturing/orders-view";
import { EmptyState } from "@/components/ui/card";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { actorCan } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { readOrders } from "@/server/services/manufacturing-production";

/** The browser tab says «مخزون التصنيع» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("mfg.title") };

/**
 * «أوامر التصنيع» of the manufacturing space the person is in.
 * The page decides nothing: WHO the person is comes from `pageActor()`; an external partner, a person without `manufacturing.view` and a
 * switched-off feature are all «not found»; WHAT is read (and whether any money is) is decided by the service, again on every request.
 */
export default async function ManufacturingOrdersRoute() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (actor.isExternal || !actorCan(actor, "manufacturing.view")) notFound();
  if (!(await actorFeatureOn(actor, "mfgLedger"))) notFound();
  const space = await currentSpace(actor);
  if (!space) return <EmptyState title={t("mfg.no_space")} />;
  if (space.layout !== "MANUFACTURING") return <EmptyState title={t("mfg.not_mfg_space")} hint={t("mfg.not_mfg_space_hint")} />;
  try {
    return <OrdersPage initial={await readOrders(actor, space.id)} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
