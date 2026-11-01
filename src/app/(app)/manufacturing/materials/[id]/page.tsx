import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { MaterialPage } from "@/components/manufacturing/material-page";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { actorCan } from "@/server/policy/actor";
import { readMaterial } from "@/server/services/manufacturing";

/** The browser tab says «مخزون التصنيع» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("mfg.title") };

/**
 * One material of the ledger. `readMaterial` decides: another company's material, a space the person is not in, a partner, a person without
 * `manufacturing.view` and a switched-off feature are all «not found». The costs are in the answer only for a holder of `manufacturing.cost`.
 */
export default async function MaterialRoute({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  if (actor.isExternal || !actorCan(actor, "manufacturing.view")) notFound();
  try {
    const initial = await readMaterial(actor, params.id);
    return <MaterialPage key={initial.id} initial={initial} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
