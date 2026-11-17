import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { NotFoundError } from "@/server/auth";
import { actorFeatureOn } from "@/server/services/features";
import { readSheet } from "@/server/services/knowledge";
import { SheetView } from "@/components/knowledge/sheet-view";

/** One product sheet: what the reader may see (the approved version and the live price), or «not found». */
export default async function SheetPage({ params }: { params: { cardId: string } }) {
  const { user, actor } = await pageActor();
  if (actor.isExternal || !(await actorFeatureOn(actor, "knowledgeCards"))) notFound();
  try {
    const sheet = await readSheet(actor, params.cardId);
    return <SheetView initial={sheet} userId={user.id} isOwner={actor.isOwner} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
