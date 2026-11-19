import { DocumentSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/cards` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function CardsLoading() {
  return <DocumentSkeleton place="cards" />;
}
