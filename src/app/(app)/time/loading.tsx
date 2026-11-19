import { TableSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/time` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function TimeLoading() {
  return <TableSkeleton place="time" lead="filters" columns={6} />;
}
