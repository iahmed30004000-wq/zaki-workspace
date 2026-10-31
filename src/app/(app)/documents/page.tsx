import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { DocumentsView } from "@/components/documents/documents-view";
import { EmptyState } from "@/components/ui/card";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { currentSpace } from "@/server/services/current-space";
import { listDocuments } from "@/server/services/documents";
import { actorFeatureOn } from "@/server/services/features";

/** The browser tab says «المستندات» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("docs.title") };

/**
 * «المستندات» — the text documents of the space the person is in. (It used to be an empty «قريباً» page that redirected to
 * the files library; the library keeps its own address, /files.)
 *
 * The page decides nothing. WHO the person is comes from `pageActor()`; the company's `spaceDocs` switch makes the page
 * «not found»; WHAT is listed is decided by `listDocuments` (an external partner is handed only the documents shared with
 * partners; a person outside the space gets «not found»).
 */
export default async function DocumentsPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "documents")) return <GuestNotice />;
  if (!(await actorFeatureOn(actor, "spaceDocs"))) notFound();
  const space = await currentSpace(actor);
  if (!space) return <EmptyState title={t("docs.no_space")} />;
  try {
    const list = await listDocuments(actor, space.id);
    return <DocumentsView spaceId={space.id} spaceName={space.name} initial={list.documents} canCreate={list.canCreate} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
