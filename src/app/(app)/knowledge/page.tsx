import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { actorFeatureOn } from "@/server/services/features";
import { listSheets } from "@/server/services/knowledge";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";

/** The browser tab says «المنتجات» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("knowledge.title") };

/**
 * «المنتجات» (Q1.1): the product sheets. Staff only, behind the switch `knowledgeCards`; an external partner and a company with the switch off are
 * told the page does not exist. The list is made by the service from the session (a reader who is not an editor gets only the approved sheets).
 */
export default async function KnowledgePage() {
  const { actor } = await pageActor();
  if (actor.isExternal || !(await actorFeatureOn(actor, "knowledgeCards"))) notFound();
  const list = await listSheets(actor);
  return <KnowledgeView initial={list} />;
}

export const dynamic = "force-dynamic";
