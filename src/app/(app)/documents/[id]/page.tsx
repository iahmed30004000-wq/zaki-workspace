import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { DocumentPage } from "@/components/documents/document-page";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { readDocument } from "@/server/services/documents";

/** The browser tab says «المستندات» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("docs.title") };

/**
 * One document. `readDocument` decides: a person outside the space, a document an external partner may not read, a deleted one
 * (the owner's alone) and a switched-off feature are all «not found». What the person may do (write, mark shared, delete) is
 * decided there too, and decided again by every request the screen makes.
 */
export default async function DocumentRoute({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "documents")) return <GuestNotice />;
  try {
    const initial = await readDocument(actor, params.id);
    return <DocumentPage key={initial.id} initial={initial} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
