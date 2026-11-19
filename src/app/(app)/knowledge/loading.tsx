import { DocumentSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/knowledge` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function KnowledgeLoading() {
  return <DocumentSkeleton place="knowledge" />;
}
