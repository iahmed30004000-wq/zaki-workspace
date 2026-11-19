import { ListSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/archive` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function ArchiveLoading() {
  return <ListSkeleton place="archive" />;
}
