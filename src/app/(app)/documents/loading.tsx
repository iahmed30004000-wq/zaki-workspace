import { DocumentSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/documents` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function DocumentsLoading() {
  return <DocumentSkeleton place="documents" />;
}
